import { connectViaProtocol, createAcknowledgedWebRemoteControlRelayProtocol } from "@zcode/client";
import type { AcknowledgedWebRemoteControlRelayProtocolAdapter } from "@zcode/client";
import {
  parseRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  type WebRemoteControlAppPayload,
} from "@zcode/shared";
import type { WebRemoteControlMobileTaskView, WebRemoteControlTaskTarget } from "@zcode/shared";
import { markWebRemoteControlBridgeTaskRead } from "../../webRemoteControlTaskRead.js";
import { createWebRemoteControlAppPayloadRequester } from "../../webRemoteControlTransport.js";
import { registerWebRemoteControlWorkspaceBridgeServices } from "../../webRemoteControlWorkspaceBridgeSession.js";
import { createWebRemoteControlProjectNavigation } from "../app/projectDraftNavigation.js";
import type {
  ProjectBridgeOpenOptions,
  ProjectBridgeRootInput,
  ProjectBridgeSession,
} from "../contracts/projectBridge.js";

/** 必须由已有的、已鉴权/已配对的传输 owner 注入；这里不产生授权或物理连接。 */
export function createPairedWebRemoteControlProjectSession(port: {
  deviceIdentity: string;
  sendPayload(payload: WebRemoteControlAppPayload): boolean;
  renderRoot(input: ProjectBridgeRootInput): void;
  onDegraded?(reason: string): void;
}) {
  let serial = 0;
  let disposed = false;
  let workspaceKey: string | undefined;
  let taskId: string | undefined;
  let rootInput: ProjectBridgeRootInput | undefined;
  let candidate: AcknowledgedWebRemoteControlRelayProtocolAdapter | undefined;
  let active: AcknowledgedWebRemoteControlRelayProtocolAdapter | undefined;
  let activeSession: ProjectBridgeSession | undefined;
  let viewEpoch: string | undefined;
  let viewSequence = 0;
  let actualView: WebRemoteControlMobileTaskView | null = null;
  let registration: ReturnType<typeof registerWebRemoteControlWorkspaceBridgeServices> | undefined;
  let pendingOpen: AbortController | undefined;
  const listeners = new Set<
    (
      value: Extract<
        WebRemoteControlAppPayload,
        { zcode_type: "workspace-list-updated" }
      >["result"],
    ) => void
  >();
  const requester = createWebRemoteControlAppPayloadRequester({ sendPayload: port.sendPayload });
  const cancelled = () => new Error("Workspace bridge request was cancelled or superseded");
  const waitForOpen = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
    new Promise((resolve, reject) => {
      const abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        signal.removeEventListener("abort", abort);
        reject(cancelled());
        return;
      }
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  async function openWorkspaceBridge(
    key: string,
    options?: ProjectBridgeOpenOptions,
  ): Promise<ProjectBridgeSession> {
    const generation = ++serial;
    pendingOpen?.abort();
    const opening = new AbortController();
    pendingOpen = opening;
    candidate?.dispose();
    candidate = undefined;
    const current = () => !disposed && generation === serial && options?.isCurrent?.() !== false;
    if (!current()) throw cancelled();
    const id = crypto.randomUUID();
    const response = await waitForOpen(
      requester.requestAppPayload(
        {
          zcode_type: "workspace-bridge-open",
          requestId: id,
          bridgeSessionId: id,
          bridgeGeneration: generation,
          workspaceKey: key,
          ...(options?.taskId ? { taskId: options.taskId } : {}),
          ...(options?.taskHostId ? { taskHostId: options.taskHostId } : {}),
          ...(options?.fileTreeTaskId ? { fileTreeTaskId: options.fileTreeTaskId } : {}),
          ...(options?.project ? { project: options.project } : {}),
        },
        (
          payload,
        ): payload is Extract<
          WebRemoteControlAppPayload,
          { zcode_type: "workspace-bridge-ready" }
        > =>
          payload.zcode_type === "workspace-bridge-ready" &&
          payload.requestId === id &&
          payload.bridgeSessionId === id,
      ),
      opening.signal,
    );
    if (!current()) throw cancelled();
    const bridge = response.bridge;
    if (
      bridge.bridgeSessionId !== id ||
      (bridge.bridgeGeneration !== undefined && bridge.bridgeGeneration !== generation)
    )
      throw cancelled();
    const protocol = createAcknowledgedWebRemoteControlRelayProtocol({
      bridgeSessionId: id,
      bridgeGeneration: bridge.bridgeGeneration,
      recoveryId: bridge.recoveryId,
      sendFrame: (frame) => port.sendPayload(frame),
    });
    candidate = protocol;
    try {
      const windowProjectDirectory =
        bridge.kind === "remote" && bridge.capabilities?.windowProjectDirectory === true;
      const services = connectViaProtocol(protocol.protocol, { windowProjectDirectory });
      if (windowProjectDirectory) {
        const capability = await waitForOpen(
          services.windowProjectDirectory!.changesService.getCapabilities(),
          opening.signal,
        );
        if (capability.version !== 1)
          throw new Error("Window project directory capability is not ready");
      }
      if (!current()) throw cancelled();
      const nextRegistration = registerWebRemoteControlWorkspaceBridgeServices({
        bridge,
        services,
      });
      const previous = active;
      const previousRegistration = registration;
      active = protocol;
      if (pendingOpen === opening) pendingOpen = undefined;
      candidate = undefined;
      registration = nextRegistration;
      protocol.onDegraded((fault) => {
        if (active === protocol) port.onDegraded?.(fault.reasonCode);
      });
      workspaceKey = bridge.workspaceKey;
      taskId = bridge.initialTaskId;
      activeSession = { bridge, services };
      actualView = null;
      publishActualView();
      if (typeof options?.markTaskReadExpectedUnreadAt === "number")
        void markWebRemoteControlBridgeTaskRead({
          bridge,
          expectedUnreadAt: options.markTaskReadExpectedUnreadAt,
          service: services.zcodeTaskService,
        });
      previousRegistration?.dispose();
      previous?.dispose();
      return { bridge, services };
    } catch (error) {
      if (candidate === protocol) candidate = undefined;
      protocol.dispose();
      throw error;
    }
  }
  const navigation = createWebRemoteControlProjectNavigation({
    deviceIdentity: port.deviceIdentity,
    getWorkspaceKey: () => workspaceKey,
    openWorkspaceBridge,
    renderRoot(input) {
      rootInput = input;
      port.renderRoot(input);
    },
  });
  return {
    ...navigation,
    openWorkspaceBridge,
    acceptPayload(payload: WebRemoteControlAppPayload) {
      if (
        payload.zcode_type === "bootstrap-response" &&
        payload.result.mobileTaskViewEpoch &&
        payload.result.mobileTaskViewEpoch !== viewEpoch
      ) {
        viewEpoch = payload.result.mobileTaskViewEpoch;
        viewSequence = 0;
      }
      if (payload.zcode_type === "mobile-task-view-request") {
        if (payload.epoch !== viewEpoch) {
          viewEpoch = payload.epoch;
          viewSequence = 0;
        }
        publishActualView();
        return true;
      }
      if (payload.zcode_type === "rpc-frame" || payload.zcode_type === "rpc-frame-ack")
        return candidate?.acceptPayload(payload) || active?.acceptPayload(payload) || false;
      if (payload.zcode_type === "workspace-list-updated")
        for (const listener of listeners) listener(payload.result);
      return requester.acceptPayload(payload);
    },
    async listWorkspaces() {
      const requestId = crypto.randomUUID();
      const response = await requester.requestAppPayload(
        { zcode_type: "workspace-list-request", requestId },
        (
          payload,
        ): payload is Extract<
          WebRemoteControlAppPayload,
          { zcode_type: "workspace-list-response" }
        > => payload.zcode_type === "workspace-list-response" && payload.requestId === requestId,
      );
      return response.result;
    },
    onWorkspaceListUpdated(
      listener: (
        value: Extract<
          WebRemoteControlAppPayload,
          { zcode_type: "workspace-list-updated" }
        >["result"],
      ) => void,
    ) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async updateMobileViewState(key: string, selectedTaskId?: string) {
      workspaceKey = key;
      taskId = selectedTaskId;
      if (selectedTaskId) rootInput = undefined;
      if (
        !port.sendPayload({
          zcode_type: "mobile-view-state-update",
          viewState: {
            activeWorkspaceKey: key,
            activeTaskId: selectedTaskId,
            updatedAt: Date.now(),
          },
        })
      )
        throw new Error("Web remote control transport is unavailable");
    },
    async updateMobileTaskView(view: WebRemoteControlMobileTaskView | null) {
      // 仅接收 UI 明确的实际可见状态；最后导航位置不能代替当前查看。
      actualView = view;
      publishActualView();
    },
    async markTaskRead(task: WebRemoteControlTaskTarget) {
      if (
        !activeSession ||
        (task.workspaceIdentity?.trim() || task.workspacePath) !== activeSession.bridge.workspaceKey
      )
        throw new Error("Task read target does not belong to the current bridge");
      if (typeof task.unreadAt !== "number") return;
      await activeSession.services.zcodeTaskService.setTaskUnread({
        workspacePath: task.workspacePath,
        workspaceIdentity: task.workspaceIdentity,
        taskId: task.taskId,
        expectedUnreadAt: task.unreadAt,
        unread: false,
      });
    },
    async recover() {
      if (rootInput?.initialTaskDraft && !taskId)
        return navigation.openProjectDraft(rootInput.initialTaskDraft);
      if (!workspaceKey) throw new Error("No accepted workspace bridge to recover");
      const hostId = parseRemoteWorkspaceIdentity(workspaceKey)
        ? (remoteHostIdFromWorkspaceIdentity(workspaceKey) ?? undefined)
        : "local";
      return navigation.switchWorkspace(workspaceKey, {
        ...(taskId ? { taskId, taskHostId: hostId } : {}),
        mobileNavigationIntent: "chat",
      });
    },
    dispose() {
      disposed = true;
      serial++;
      pendingOpen?.abort();
      pendingOpen = undefined;
      requester.dispose();
      candidate?.dispose();
      active?.dispose();
      registration?.dispose();
      activeSession = undefined;
      listeners.clear();
    },
  };
  function publishActualView() {
    const bridge = activeSession?.bridge;
    if (!viewEpoch || !bridge || disposed) return;
    if (
      actualView &&
      (actualView.workspacePath !== bridge.workspacePath ||
        (actualView.workspaceIdentity?.trim() || actualView.workspacePath) !== bridge.workspaceKey)
    )
      return;
    port.sendPayload({
      zcode_type: "mobile-task-view-update",
      epoch: viewEpoch,
      seq: ++viewSequence,
      bridgeSessionId: bridge.bridgeSessionId,
      bridgeGeneration: bridge.bridgeGeneration,
      view:
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? null
          : actualView,
    });
  }
}

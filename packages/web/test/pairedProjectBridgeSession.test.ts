import { beforeEach, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebRemoteControlAppPayload } from "@zcode/shared";
import { parseWebRemoteControlAppPayload } from "@zcode/shared";
const state = vi.hoisted(() => ({
  connect: vi.fn(),
  protocols: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  register: vi.fn(),
  root: vi.fn(),
}));
vi.mock("@zcode/ui", () => ({
  AppErrorBoundary: ({ children }: { children: unknown }) => children,
  ZCodeIntlProvider: ({ children }: { children: unknown }) => children,
  Root: (props: unknown) => {
    state.root(props);
    return createElement("section");
  },
  ensurePendingTaskDraft: vi.fn(() => ({ draftId: "11111111-1111-4111-8111-111111111111" })),
}));
vi.mock("@zcode/client", () => ({
  connectViaProtocol: state.connect,
  createAcknowledgedWebRemoteControlRelayProtocol: () => {
    const protocol = {
      protocol: {},
      acceptPayload: vi.fn(() => false),
      onDegraded: vi.fn(),
      dispose: vi.fn(),
    };
    state.protocols.push(protocol);
    return protocol;
  },
}));
vi.mock("../src/webRemoteControlWorkspaceBridgeSession.js", () => ({
  registerWebRemoteControlWorkspaceBridgeServices: state.register,
}));
import {
  createPairedWebRemoteControlProjectSession,
  PairedProjectBridgeRoot,
} from "../src/web-remote-control/index.js";
beforeEach(() => {
  state.connect.mockReset().mockReturnValue({});
  state.protocols.length = 0;
  state.register.mockReset().mockReturnValue({ dispose: vi.fn() });
  state.root.mockReset();
});
function fixture() {
  const requests: WebRemoteControlAppPayload[] = [];
  const renderRoot = vi.fn();
  const session = createPairedWebRemoteControlProjectSession({
    deviceIdentity: "stable-device",
    sendPayload: (payload) => {
      expect(parseWebRemoteControlAppPayload(payload)).not.toBeNull();
      requests.push(payload);
      return true;
    },
    renderRoot,
  });
  const reply = (index: number, remote = false) => {
    const request = requests[index] as Extract<
      WebRemoteControlAppPayload,
      { zcode_type: "workspace-bridge-open" }
    >;
    session.acceptPayload({
      zcode_type: "workspace-bridge-ready",
      requestId: request.requestId,
      bridgeSessionId: request.bridgeSessionId,
      bridge: {
        bridgeSessionId: request.bridgeSessionId,
        bridgeGeneration: request.bridgeGeneration,
        workspaceKey: remote ? "remote:server:source:/host/project" : "/host/project",
        workspacePath: "/host/project",
        ...(remote
          ? {
              kind: "remote" as const,
              workspaceIdentity: "remote:server:source:/host/project",
              remoteSessionId: "source-scope",
              capabilities: { windowProjectDirectory: true as const },
            }
          : { kind: "local" as const }),
      },
    });
  };
  return { session, requests, renderRoot, reply };
}
it("真实 project bridge payload 经过 ACK 和协议连接后才交付 Root，未创建独立 runtime", async () => {
  const { session, requests, reply, renderRoot } = fixture();
  const opened = session.openProjectDraft({ projectId: "project" });
  expect(requests[0]).toMatchObject({
    zcode_type: "workspace-bridge-open",
    project: { projectId: "project" },
  });
  expect(renderRoot).not.toHaveBeenCalled();
  reply(0);
  await opened;
  expect(state.connect).toHaveBeenCalledWith(expect.anything(), { windowProjectDirectory: false });
  expect(renderRoot).toHaveBeenCalledWith(
    expect.objectContaining({
      initialTaskDraft: { projectId: "project" },
      composerClientNamespace: "mobile:stable-device",
    }),
  );
  session.dispose();
});
it("远端声明窗口目录能力时必须等其真实就绪，不能拿 Source 目录兜底", async () => {
  const capability = Promise.withResolvers<{ version: 1 }>();
  state.connect.mockReturnValue({
    windowProjectDirectory: { changesService: { getCapabilities: () => capability.promise } },
  });
  const { session, reply, renderRoot } = fixture();
  const opened = session.openProjectDraft({ projectId: "project", hostId: "remote:server:source" });
  reply(0, true);
  await Promise.resolve();
  await Promise.resolve();
  expect(renderRoot).not.toHaveBeenCalled();
  capability.resolve({ version: 1 });
  await opened;
  expect(state.connect).toHaveBeenCalledWith(expect.anything(), { windowProjectDirectory: true });
  expect(state.register).toHaveBeenCalledOnce();
  session.dispose();
});
it("新的导航代际使旧 ACK 失效，不能替换较新的项目 Root", async () => {
  const { session, reply, renderRoot } = fixture();
  const first = session.openProjectDraft({ projectId: "first" });
  const rejected = expect(first).rejects.toThrow(/cancel|superseded/);
  const second = session.openProjectDraft({ projectId: "second" });
  reply(1);
  await second;
  reply(0);
  await rejected;
  expect(renderRoot).toHaveBeenCalledOnce();
  expect(renderRoot.mock.calls[0][0].initialTaskDraft.projectId).toBe("second");
  session.dispose();
});
it("正式任务恢复发送 Host task 地址，不把新建项目意图重放为新会话", async () => {
  const { session, reply, requests } = fixture();
  const opened = session.openProjectDraft({ projectId: "project" });
  reply(0);
  await opened;
  await session.updateMobileViewState("/host/project", "accepted-task");
  const recovering = session.recover();
  expect(requests.at(-1)).toMatchObject({
    zcode_type: "workspace-bridge-open",
    taskId: "accepted-task",
    taskHostId: "local",
  });
  expect(requests.at(-1)).not.toHaveProperty("project");
  reply(requests.length - 1);
  await recovering;
  session.dispose();
});

it("配对 Root 真实接收项目草稿、稳定 namespace 和 bridge switcher，不恢复桌面会话", async () => {
  const { session, reply, renderRoot } = fixture();
  const opened = session.openProjectDraft({ projectId: "project" });
  reply(0);
  await opened;
  renderToStaticMarkup(
    createElement(PairedProjectBridgeRoot, {
      input: renderRoot.mock.calls[0][0],
      platform: {} as never,
      switcher: session,
    }),
  );
  expect(state.root).toHaveBeenCalledWith(
    expect.objectContaining({
      initialWorkspaceAbsPath: "/host/project",
      initialTaskDraft: { projectId: "project" },
      composerClientNamespace: "mobile:stable-device",
      webRemoteControlWorkspaceSwitcher: session,
      restoreSession: false,
      allowOpenWorkspace: false,
      allowRemoteWorkspace: false,
    }),
  );
  session.dispose();
});

it("新导航撤销仍在等待窗口目录 capability 的旧 owner，不靠超时退出", async () => {
  const capability = Promise.withResolvers<{ version: 1 }>();
  state.connect.mockReturnValueOnce({
    windowProjectDirectory: { changesService: { getCapabilities: () => capability.promise } },
  });
  const { session, reply } = fixture();
  const failed = vi.fn();
  const first = session.openProjectDraft({ projectId: "old" }).catch(failed);
  reply(0, true);
  await Promise.resolve();
  await Promise.resolve();
  const next = session.openProjectDraft({ projectId: "new" });
  reply(1);
  await next;
  expect(failed).toHaveBeenCalledWith(
    expect.objectContaining({ message: expect.stringMatching(/cancel|superseded/) }),
  );
  capability.resolve({ version: 1 });
  await first;
  session.dispose();
});

it("最后导航只保存恢复地址；实际查看需要有效 epoch 和 UI 显式事实", async () => {
  const { session, requests, reply } = fixture();
  const opened = session.openProjectDraft({ projectId: "project" });
  reply(0);
  await opened;
  await session.updateMobileViewState("/host/project", "task");
  expect(requests.filter((item) => item.zcode_type === "mobile-task-view-update")).toHaveLength(0);
  session.acceptPayload({ zcode_type: "mobile-task-view-request", epoch: "view-epoch" });
  expect(requests.at(-1)).toMatchObject({
    zcode_type: "mobile-task-view-update",
    view: null,
    seq: 1,
  });
  await session.updateMobileTaskView({ workspacePath: "/host/project", taskId: "task" });
  expect(requests.at(-1)).toMatchObject({
    zcode_type: "mobile-task-view-update",
    view: { workspacePath: "/host/project", taskId: "task" },
    seq: 2,
  });
  session.acceptPayload({ zcode_type: "mobile-task-view-request", epoch: "view-epoch" });
  expect(requests.at(-1)).toMatchObject({ seq: 3 });
  session.dispose();
});

// @vitest-environment jsdom
import { createElement, useEffect } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEnvelope, ConversationSnapshot } from "@zcode/shared/zcode-protocol-v4";
import type { ConversationComposerProps } from "@/v4/ConversationComposer.js";
import type { ConversationTimelineProps } from "@/v4/ConversationTimeline.js";
import { SessionPane } from "@/v4/SessionPane.js";
import { getPluginUiSessionActions } from "@/plugin-ui/index.js";
import { ConversationPanePresentationContext } from "@/side-pane-full-view/conversationPanePresentation.js";
import type { ConversationPanePresentationValue } from "@/side-pane-full-view/contract.js";

const h = vi.hoisted(() => {
  const selection = {
    providerId: "provider",
    modelId: "model",
    options: { reasoningLevel: "high" },
  };
  const config = {
    mode: "build" as const,
    modelSelection: selection,
    provider: "provider",
    model: "model",
    thought: "high",
    planEnabled: false,
  };
  const store = {
    onLiveDeltas: vi.fn(() => () => {}),
    onOnlineModelTransition: vi.fn(() => () => {}),
    refreshPlans: vi.fn(async () => {}),
    markCommandPending: vi.fn(),
    settleCommand: vi.fn(),
    expectAcceptedInputProjection: vi.fn(),
  };
  const layer = { acquire: vi.fn((sessionId: string) => ({ sessionId, store, release: vi.fn() })) };
  const sendCommand = vi.fn(async (envelope: CommandEnvelope) => ({
    commandId: envelope.commandId,
    status: "accepted",
    revisionAtDecision: 1,
  }));
  const attachmentPut = vi.fn(async () => ({ ref: "uploaded-image" }));
  const services = {
    projectService: { resolveSessionDirectories: vi.fn(async () => ({ projectId: "project-p" })) },
    zcodeSessionService: {},
    zcodeTaskService: {},
  };
  const control = {
    modelSelectionRead: {
      state: {
        status: "ready",
        view: {
          preferredSelection: selection,
          effectiveSelection: selection,
          providers: [
            {
              providerId: "provider",
              models: [
                {
                  modelId: "model",
                  config: { optionSpecs: { reasoningLevel: { values: ["high"] } } },
                },
              ],
            },
          ],
        },
      },
      reload: vi.fn(),
    },
    draftConfig: config,
    draftConfigRef: { current: config },
    composerDraft: { text: "", mode: "build", updatedAt: 0 },
    captureAcceptedModelSelection: () => () => {},
    resolveInitialDraftConfig: () => config,
    handleDraftSelectModel: vi.fn(),
    handleDraftSelectThought: vi.fn(),
    handleDraftSwitchMode: vi.fn(),
    promoteComposerDraft: vi.fn(),
    updateComposerContent: vi.fn(),
    replaceComposerDraft: vi.fn(),
  };
  return {
    layer,
    store,
    sendCommand,
    attachmentPut,
    services,
    control,
    snapshot: null as ConversationSnapshot | null,
    composer: null as ConversationComposerProps | null,
    timeline: null as ConversationTimelineProps | null,
    mounts: 0,
  };
});
vi.mock("@/v4/V4ConversationContext.js", () => ({
  useV4Conversation: () => ({
    layer: h.layer,
    sendCommand: h.sendCommand,
    attachmentPut: h.attachmentPut,
  }),
}));
vi.mock("@/v4/useConversationProjection.js", () => ({
  useConversationProjection: () => ({
    status: "live",
    snapshot: h.snapshot,
    subscriptionId: "sub",
    loadingOlder: false,
    sessionPlans: [],
    optimisticCommands: [],
  }),
}));
vi.mock("@/v4/usePendingCommandRecovery.js", () => ({ usePendingCommandRecovery: () => [] }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => h.services,
  useOptionalServices: () => null,
  useComposerClientNamespace: () => "desktop",
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => h.services,
  useOptionalBaseWorkspaceServices: () => h.services,
}));
vi.mock("@/hooks/useWorkspaceHomePath.js", () => ({ useWorkspaceHomePath: () => "/work" }));
vi.mock("@/hooks/useSettingService.js", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("@/hooks/useSlashCommands.js", () => ({ useSlashCommands: () => [] }));
vi.mock("@/hooks/useStartPlanRecommendation.js", () => ({
  useStartPlanRecommendation: () => async (selection: unknown) => selection,
}));
vi.mock("@/hooks/useWorkflowRunJournalSummaries.js", () => ({
  useWorkflowRunJournalSummaries: () => [],
}));
vi.mock("@/hooks/useInterfaceMode.js", () => ({ useIsOfficeMode: () => false }));
vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStoreWithDefault: (_selector: unknown, fallback: unknown) => fallback,
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));
vi.mock("@/v4/composer/useDraftConfigControl.js", () => ({
  useDraftConfigControl: () => h.control,
  buildDraftCreateConfigPayload: () => ({}),
}));
vi.mock("@/v4/composer/useDraftSessionPrewarm.js", () => ({
  useDraftSessionPrewarm: () => ({ binding: null, waitForSession: vi.fn() }),
}));
vi.mock("@/v4/composer/useDraftRuntimeRebuildGate.js", () => ({
  useDraftRuntimeRebuildGate: () => ({ rebuilding: false }),
}));
vi.mock("@/v4/composer/useDraftModelReadinessGate.js", () => ({
  useDraftModelReadinessGate: () => ({
    agentStartupAllowed: true,
    error: null,
    dismissError: vi.fn(),
    ensureReadyForSend: async () => true,
    markProviderNotReady: vi.fn(),
  }),
}));
vi.mock("@/v4/useV4SessionQuotaBanner.js", () => ({
  useV4SessionQuotaBanner: () => ({
    state: { kind: "none", blocksSubmit: false },
    takesOverError: false,
    markShown: vi.fn(),
    dismiss: vi.fn(),
  }),
}));
vi.mock("@/v4/ConversationComposer.js", () => ({
  ConversationComposer: (props: ConversationComposerProps) => {
    h.composer = props;
    useEffect(() => {
      h.mounts += 1;
    }, []);
    return createElement("textarea", {
      "data-testid": "single-composer",
      defaultValue: "保留的草稿",
    });
  },
}));
vi.mock("@/v4/ConversationTimeline.js", () => ({
  ConversationTimeline: (props: ConversationTimelineProps) => {
    h.timeline = props;
    return createElement("div", null, props.bottomDock);
  },
}));
vi.mock("@/v4/ConversationHeader.js", () => ({ ConversationHeader: () => null }));
vi.mock("@/v4/ConversationStatusPanel.js", () => ({ ConversationStatusPanel: () => null }));
vi.mock("@/v4/ConversationQueuePanel.js", () => ({ ConversationQueuePanel: () => null }));
vi.mock("@/v4/V4InteractionDialogs.js", () => ({ V4InteractionDialogs: () => null }));

function snapshot(sessionId = "session-p"): ConversationSnapshot {
  return {
    protocolVersion: 1,
    sessionId,
    logEpoch: "epoch",
    seq: 1,
    revision: 1,
    meta: { title: "P", titleSource: "generated" },
    config: { ...h.control.draftConfig, followupMode: "queue" },
    control: {
      activeWorks: [],
      apiRetry: null,
      canStop: false,
      lastError: null,
      phase: "completedSuccess",
      sessionEnded: true,
      stopState: "idle",
      stopTargetKind: "unknown",
    },
    availability: {
      fork: { allowed: true },
      compact: { allowed: true },
      queueEdit: { allowed: true },
      pauseGoal: { allowed: false, reasonCode: "noGoalToPause" },
      resumeGoal: { allowed: false, reasonCode: "noGoalToResume" },
      sendQueuedNow: { allowed: true },
      setFollowupMode: { allowed: true },
      switchModelConfig: { allowed: true },
    },
    inputRouting: { mode: "startNow" },
    pendingCommands: [],
    pendingInteractions: [],
    backgroundWorks: [],
    goal: null,
    plan: null,
    queue: { autoDrain: true, items: [] },
    rows: { totalCount: 0, firstRowId: null, window: [] },
    usage: {
      contextWindow: null,
      cumulative: { cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0 },
    },
  };
}
const scope = { workspacePath: "/work", workspaceIdentity: "host-p", sessionId: "session-p" };
const source = { kind: "genUi" as const, path: "/work/chart.html", title: "图表" };
function pane(
  presentation: ConversationPanePresentationValue,
  options: { readOnly?: boolean; focused?: boolean; sessionId?: string } = {},
) {
  return createElement(ConversationPanePresentationContext.Provider, {
    value: presentation,
    children: createElement(SessionPane, {
      paneId: "pane",
      sessionId: "session-p",
      ...options,
      workspacePath: scope.workspacePath,
      workspaceIdentity: scope.workspaceIdentity,
    }),
  });
}
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.snapshot = snapshot();
  h.mounts = 0;
});
afterEach(() => cleanup());

describe("ZUP08/11 SessionPane 的实际消费者", () => {
  it("图片上传期间切换会话，旧 GenUI 请求不得续写到新 owner", async () => {
    let upload!: (result: { ref: string }) => void;
    h.attachmentPut.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          upload = resolve;
        }),
    );
    const presentation: ConversationPanePresentationValue = {
      presentation: "docked",
      reportFloatingStatus: vi.fn(),
      reportComposerDockHeight: vi.fn(),
    };
    const view = render(pane(presentation));
    const pending = getPluginUiSessionActions(scope)!
      .sendFollowUp({
        prompt: "旧图表",
        source,
        images: [{ type: "image", mimeType: "image/png", dataBase64: "YQ==" }],
      })
      .then(
        () => "sent",
        () => "stale",
      );
    h.snapshot = snapshot("session-q");
    view.rerender(pane(presentation, { sessionId: "session-q" }));
    await act(async () => upload({ ref: "old-upload" }));
    expect(await pending).toBe("stale");
    expect(h.sendCommand).not.toHaveBeenCalled();
  });
  it("GenUI 确认续写和图片走原命令/上传链；只读、非 ready 及无 Provider 均无动作", async () => {
    expect(getPluginUiSessionActions(scope)).toBeNull();
    const presentation: ConversationPanePresentationValue = {
      presentation: "docked",
      reportFloatingStatus: vi.fn(),
      reportComposerDockHeight: vi.fn(),
    };
    const view = render(pane(presentation));
    const actions = getPluginUiSessionActions(scope);
    expect(actions).not.toBeNull();
    await act(async () =>
      actions!.sendFollowUp({
        prompt: "继续绘图",
        source,
        images: [{ type: "image", mimeType: "image/png", dataBase64: "YQ==" }],
      }),
    );
    expect(h.attachmentPut).toHaveBeenCalledWith({
      sessionId: "session-p",
      fileName: expect.any(String),
      mime: "image/png",
      dataBase64: "YQ==",
    });
    expect(h.sendCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-p",
        type: "sendText",
        payload: expect.objectContaining({
          text: "继续绘图",
          source,
          attachments: [
            { ref: "uploaded-image", fileName: expect.any(String), mime: "image/png", bytes: 1 },
          ],
        }),
      }),
    );
    expect(h.store.onLiveDeltas).toHaveBeenCalledOnce();
    view.rerender(pane(presentation, { readOnly: true }));
    expect(getPluginUiSessionActions(scope)).toBeNull();
    h.snapshot = null;
    view.rerender(pane(presentation));
    expect(getPluginUiSessionActions(scope)).toBeNull();
  });

  it("同一 pane 从 docked 切 floating 不重挂编辑器，只上报焦点 owner 的摘要与 dock 高度", () => {
    const reportFloatingStatus = vi.fn();
    const reportComposerDockHeight = vi.fn();
    const presentation: ConversationPanePresentationValue = {
      presentation: "docked",
      reportFloatingStatus,
      reportComposerDockHeight,
    };
    const view = render(pane(presentation));
    const editor = view.getByTestId("single-composer");
    view.rerender(pane({ ...presentation, presentation: "floating" }));
    expect(h.composer!.layout).toBe("inline");
    expect(h.timeline!.floatingComposerDock).toBe(true);
    act(() => h.timeline!.onComposerDockHeightChange?.(98));
    expect(reportComposerDockHeight).toHaveBeenLastCalledWith(98);
    act(() =>
      h.timeline!.onLatestTurnSummaryChange?.({
        turnKey: "turn",
        running: true,
        workDurationMs: 1200,
        answer: null,
      }),
    );
    expect(h.composer!.workingDurationMs).toBe(1200);
    expect(reportFloatingStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        ownerKey: "session-p",
        latestTurn: { turnKey: "turn", running: true, answer: null },
      }),
    );
    expect(view.getByTestId("single-composer")).toBe(editor);
    expect(h.mounts).toBe(1);
    const staleSummary = h.timeline!.onLatestTurnSummaryChange;
    h.snapshot = snapshot("session-q");
    view.rerender(pane({ ...presentation, presentation: "floating" }, { sessionId: "session-q" }));
    act(() =>
      staleSummary?.({
        turnKey: "late-p",
        running: false,
        workDurationMs: undefined,
        answer: { rowId: 1, text: "P 的迟到回答" },
      }),
    );
    expect(reportFloatingStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ ownerKey: "session-q", latestTurn: null }),
    );
    view.rerender(pane({ ...presentation, presentation: "floating" }, { focused: false }));
    expect(h.timeline!.onComposerDockHeightChange).toBeUndefined();
    expect(h.timeline!.onLatestTurnSummaryChange).toBeUndefined();
  });
});

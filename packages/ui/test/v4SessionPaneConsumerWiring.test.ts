import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 这些断言只守护实际消费者接线；Provider 准入和浮窗测高/摘要另有运行时回归。
const pane = readFileSync("packages/ui/src/v4/SessionPane.tsx", "utf8");
const composer = readFileSync("packages/ui/src/v4/ConversationComposer.tsx", "utf8");
const recovery = readFileSync("packages/ui/src/v4/usePendingCommandRecovery.ts", "utf8");
describe("SessionPane 的 scope、GenUI 与浮窗消费者边界", () => {
  it("GenUI 经可写且 runtime-ready 的原会话入口登记，投影只取当前 lease", () => {
    expect(pane).toContain("<PluginUiSessionProvider");
    expect(pane).toContain("sessionId={runtimeReady ? sessionId : null}");
    expect(pane).toContain("readOnly={readOnly || !runtimeReady}");
    expect(pane).toContain("sendText={dispatchSendText}");
    expect(pane).toContain("uploadAttachment={pluginUiUploadAttachment}");
    expect(pane).toContain("projectionStore={sessionLeaseReady ? lease?.store : null}");
  });
  it("浮窗只改变同一个 Pane 的 presentation，焦点 pane 上报高度和最后回合", () => {
    expect(pane).toContain("useConversationPanePresentation()");
    expect(pane).toContain("floatingComposerDock={isFloatingPresentation}");
    expect(pane).toContain("panePresentation.reportComposerDockHeight");
    expect(pane).toContain("handleFloatingLatestTurnSummaryChange");
    expect(pane.match(/<ConversationComposer\b/g)).toHaveLength(1);
    expect(pane.match(/<ConversationTimeline\b/g)).toHaveLength(1);
  });
  it("Root 项目 scope 用于真实编辑器及附件交接，恢复查询带 workspace identity", () => {
    expect(composer).toContain("`${V4_DRAFT_SCOPE_ROOT}:${rootDraftScopeKey}`");
    expect(composer).toContain("registerV4ComposerDraftReader");
    expect(composer).toContain(
      "consumeV4ComposerDraftAttachments(workspaceKey, draftFocusVersion)",
    );
    expect(composer).toContain("submittedDraftText: trimmed");
    expect(recovery).toContain("workspaceIdentity?.trim() || workspacePath");
  });
});

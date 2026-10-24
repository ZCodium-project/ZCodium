// @vitest-environment jsdom

import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTextRow, UserInputRow } from "@zcode/shared/zcode-protocol-v4";
import { TID_V4_EDIT, testId } from "@zcode/shared";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";
import { ConversationRowView } from "@/v4/ConversationRowView.js";
import type { ConversationRowRenderContext } from "@/v4/conversationRowContext.js";
import type { GenUiCardTarget, GenUiPage, GenUiPageSnapshot } from "@/gen-ui/contract.js";

const runtime = vi.hoisted(() => ({
  page: null as GenUiPage | null,
  targets: [] as GenUiCardTarget[],
  confirm: undefined as ((prompt: string) => Promise<string | null>) | undefined,
}));

vi.mock("@/hooks/useGenUi.js", () => ({
  useGenUi: (target: GenUiCardTarget, confirm: (prompt: string) => Promise<string | null>) => {
    runtime.targets.push(target);
    runtime.confirm = confirm;
    return { page: runtime.page, supported: true, online: true };
  },
}));
vi.mock("@/components/ai-elements/message.js", async () => {
  const React = await import("react");
  return {
    MessageResponse: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "markdown" }, children),
    MessageActions: ({ children }: { children?: React.ReactNode }) =>
      React.createElement("div", null, children),
    MessageAction: ({ children, label, tooltip: _tooltip, ...props }: Record<string, unknown>) =>
      React.createElement("button", { ...props, "aria-label": label }, children as React.ReactNode),
  };
});
vi.mock("@/ToolCallBlocks.js", () => ({ ToolCallBlock: () => null }));
vi.mock("@/prompt-editor/ChatPromptEditor.js", () => ({ ChatPromptEditor: () => null }));
vi.mock("@/v4/ConversationFileRewindDialog.js", () => ({
  ConversationFileRewindDialog: () => null,
}));

const context: ConversationRowRenderContext = {
  workspacePath: "/work",
  workspaceIdentity: "workspace-local",
  sessionId: "session-1",
  theme: "light",
  codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
};
const common = { rowId: 4, entityId: "input-4", turnId: "turn-1", createdAt: 1, createdAtSeq: 1 };
function message(
  row: UserInputRow | AssistantTextRow,
  overrides: Partial<ConversationRowRenderContext> = {},
  onEdit = vi.fn(),
) {
  return createElement(
    ZCodeIntlProvider,
    { initialLocale: "zh-CN" },
    createElement(ConversationRowView, { row, context: { ...context, ...overrides }, onEdit }),
  );
}
function userRow(overrides: Partial<UserInputRow> = {}): UserInputRow {
  return { ...common, kind: "userInput", text: "原消息", ...overrides };
}
function assistant(state: AssistantTextRow["state"]): AssistantTextRow {
  return {
    ...common,
    kind: "assistantText",
    state,
    text: '图表之前\n::visualize{path="/work/chart.html" title="本地图表"}\n图表之后',
  };
}

beforeEach(() => {
  runtime.targets = [];
  const snapshot: GenUiPageSnapshot = {
    phase: "ready",
    height: 240,
    tweak: null,
    groups: [],
    tweakValues: {},
    previewOriginal: false,
    hovered: false,
    escapeSequence: 0,
  };
  runtime.page = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    bind: vi.fn(() => () => {}),
    preview: vi.fn(),
    focus: vi.fn(),
    copyImage: vi.fn(),
    setTweaks: vi.fn(),
    previewTweaks: vi.fn(),
    submitTweaks: vi.fn(),
    isBusy: () => false,
    dispose: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ZUP08 正式消息入口", () => {
  it("只在完成态创建本地可视化；展开收起使用同一页面和稳定消息身份", async () => {
    const view = render(message(assistant("streaming")));
    expect(screen.queryByTestId("gen-ui-card")).toBeNull();
    expect(runtime.targets).toHaveLength(0);
    view.rerender(message(assistant("complete")));
    expect(screen.getByTestId("gen-ui-card")).toBeTruthy();
    expect(screen.getByText("图表之前")).toBeTruthy();
    expect(screen.getByText("图表之后")).toBeTruthy();
    expect(runtime.targets.at(-1)).toMatchObject({
      workspacePath: "/work",
      workspaceIdentity: "workspace-local",
      sessionId: "session-1",
      path: "/work/chart.html",
      instanceKey: "4:input-4:5",
    });
    const page = runtime.page!;
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    await waitFor(() => expect(page.preview).toHaveBeenCalledWith(expect.any(HTMLElement)));
    fireEvent.click(screen.getByRole("button", { name: "收起" }));
    await waitFor(() => expect(page.preview).toHaveBeenLastCalledWith(null));
    expect(page.bind).toHaveBeenCalledTimes(1);
    expect(page.dispose).not.toHaveBeenCalled();
  });

  it("显示持久化的 Gen UI 续写来源", () => {
    render(
      message(userRow({ source: { kind: "genUi", path: "/work/chart.html", title: "本地图表" } })),
    );
    expect(document.querySelector('[data-v4-user-input-source="genUi"]')?.textContent).toContain(
      "本地图表",
    );
  });

  it("真实卡片入口允许确认或取消续写，空白不能提交", async () => {
    render(message(assistant("complete")));
    let pending!: Promise<string | null>;
    act(() => {
      pending = runtime.confirm!("初始续写");
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    expect((screen.getByRole("button", { name: "发送" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "修改后的续写" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await expect(pending).resolves.toBe("修改后的续写");
    act(() => {
      pending = runtime.confirm!("再次续写");
    });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await expect(pending).resolves.toBeNull();
  });
});

describe("ZUP13 已发送文本材料", () => {
  it.each(["clipboard-text", "topic-history"] as const)(
    "%s 点击后读取文本，关闭会取消读取",
    async (sourceKind) => {
      const readAttachment = vi.fn(async () => ({
        bytes: new TextEncoder().encode("材料内容 <script>不是 HTML</script>"),
        mediaType: "text/plain",
      }));
      render(
        message(
          userRow({
            attachments: [
              {
                ref: "material",
                fileName: "material.txt",
                mime: "text/plain",
                sourceKind,
                messageCount: 7,
              },
            ],
          }),
          { readAttachment },
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "打开文本附件" }));
      await waitFor(() =>
        expect(document.querySelector("[data-text-attachment-preview]")?.textContent).toBe(
          "材料内容 <script>不是 HTML</script>",
        ),
      );
      expect(readAttachment).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: "session-1",
          ref: "material",
          target: { rowId: 4, entityId: "input-4" },
          attachmentIndex: 0,
        }),
      );
      expect(document.querySelector("script")).toBeNull();
      const signal = readAttachment.mock.calls[0]![0].signal;
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(signal.aborted).toBe(true);
    },
  );

  it("关闭后忽略迟到的文本读取，并可重新打开重试", async () => {
    let resolve!: (value: { bytes: Uint8Array; mediaType: string }) => void;
    const readAttachment = vi.fn(
      () =>
        new Promise<{ bytes: Uint8Array; mediaType: string }>((done) => {
          resolve = done;
        }),
    );
    render(
      message(
        userRow({
          attachments: [
            {
              ref: "material",
              fileName: "material.txt",
              mime: "text/plain",
              sourceKind: "clipboard-text",
            },
          ],
        }),
        { readAttachment },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文本附件" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    resolve({ bytes: new TextEncoder().encode("旧内容"), mediaType: "text/plain" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "打开文本附件" }));
    expect(readAttachment).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("旧内容")).toBeNull();
  });

  it("读取失败只影响本次预览，不会永久禁用材料入口", async () => {
    const readAttachment = vi
      .fn()
      .mockRejectedValueOnce(new Error("读取失败"))
      .mockResolvedValueOnce({
        bytes: new TextEncoder().encode("重试成功"),
        mediaType: "text/plain",
      });
    render(
      message(
        userRow({
          attachments: [
            {
              ref: "material",
              fileName: "material.txt",
              mime: "text/plain",
              sourceKind: "clipboard-text",
            },
          ],
        }),
        { readAttachment },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "打开文本附件" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "打开文本附件" }));
    await waitFor(() => expect(screen.getByText("重试成功")).toBeTruthy());
    expect(readAttachment).toHaveBeenCalledTimes(2);
  });
});

describe("ZUP13 Bot 合批按原消息呈现", () => {
  const source: NonNullable<UserInputRow["botGroupSource"]> = {
    provider: "feishu",
    botId: "bot",
    chatId: "chat",
    threadId: "thread",
    senderId: "b",
    senderName: "乙",
    messageId: "b",
    messages: [
      {
        messageId: "a",
        senderId: "a",
        senderName: "甲",
        text: "甲的原文",
        attachmentIndexes: [1],
        conversationQuotes: [{ text: "引用原文" }],
      },
      { messageId: "b", senderId: "b", senderName: "乙", text: "乙的原文", attachmentIndexes: [0] },
    ],
  };
  it("分别显示发送人、正文、附件和引用，预览保留原始附件索引，禁止局部编辑", async () => {
    const row = userRow({
      text: "给模型的合并内容",
      botGroupSource: source,
      attachments: [
        { ref: "b-file", fileName: "乙.txt", mime: "text/plain", sourceKind: "clipboard-text" },
        { ref: "a-file", fileName: "甲.txt", mime: "text/plain", sourceKind: "clipboard-text" },
        {
          ref: "history",
          fileName: "history.txt",
          mime: "text/plain",
          sourceKind: "topic-history",
          messageCount: 3,
        },
      ],
    });
    const readAttachment = vi.fn(async () => ({
      bytes: new TextEncoder().encode("甲的附件"),
      mediaType: "text/plain",
    }));
    render(message(row, { readAttachment }));
    const a = document.querySelector('[data-topic-message-id="a"]') as HTMLElement;
    const b = document.querySelector('[data-topic-message-id="b"]') as HTMLElement;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a.textContent).toContain("甲的原文");
    expect(a.textContent).toContain("甲");
    expect(a.textContent).not.toContain("乙.txt");
    expect(b.textContent).toContain("乙的原文");
    expect(b.textContent).not.toContain("甲.txt");
    expect(document.body.textContent).not.toContain("给模型的合并内容");
    expect(a.querySelector('[data-v4-user-input-quotes="true"]')).not.toBeNull();
    expect(screen.queryByTestId(testId(TID_V4_EDIT, "4"))).toBeNull();
    fireEvent.click(within(a).getAllByRole("button", { name: "打开文本附件" })[0]!);
    await waitFor(() => expect(readAttachment).toHaveBeenCalled());
    expect(readAttachment).toHaveBeenCalledWith(
      expect.objectContaining({ ref: "a-file", attachmentIndex: 1 }),
    );
    expect(row.text).toBe("给模型的合并内容");
    expect(row.attachments?.map((attachment) => attachment.ref)).toEqual([
      "b-file",
      "a-file",
      "history",
    ]);
  });
  it("合批数组即使仅含一条，也不能将局部原文编辑为整批输入", () => {
    render(
      message(userRow({ botGroupSource: { ...source, messages: source.messages!.slice(0, 1) } })),
    );
    expect(screen.queryByTestId(testId(TID_V4_EDIT, "4"))).toBeNull();
  });
  it("普通用户输入仍保留原有编辑入口", () => {
    render(message(userRow()));
    expect(screen.getByTestId(testId(TID_V4_EDIT, "4"))).toBeTruthy();
  });
});

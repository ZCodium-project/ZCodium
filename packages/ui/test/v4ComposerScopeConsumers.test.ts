// @vitest-environment jsdom
import { createElement, useEffect, type ComponentProps, type ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEditor } from "lexical";
import type { ChatPromptEditor } from "@/prompt-editor/ChatPromptEditor.js";
import type { LexicalChatInputHandle } from "@/LexicalChatInput.js";
import { ConversationComposer, type ConversationComposerProps } from "@/v4/ConversationComposer.js";
import {
  captureV4ComposerDraftHandoff,
  stageV4ComposerDraftAttachments,
} from "@/v4/composer/composerDraftWorkspaceTransfer.js";
import {
  composerScopeKey,
  resolveComposerScope,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";
import { useComposerAttachmentUploadStore } from "@/store/composerAttachmentUploadStore.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";

type EditorProps = ComponentProps<typeof ChatPromptEditor>;
const h = vi.hoisted(() => ({ editor: null as EditorProps | null, text: "", mounts: 0 }));
vi.mock("@/prompt-editor/ChatPromptEditor.js", () => ({
  ChatPromptEditor: (props: EditorProps) => {
    h.editor = props;
    useEffect(() => {
      h.mounts += 1;
    }, []);
    const api: LexicalChatInputHandle = {
      clear: () => {
        h.text = "";
      },
      focus: () => {},
      getEditorState: () => createEditor().getEditorState(),
      getMarkdown: () => h.text,
      getText: () => h.text,
      appendText: (text) => {
        h.text += text;
      },
      appendFileMention: () => {},
      prependMentionIfMissing: () => false,
      setMention: () => {},
      insertMention: () => {},
      setText: (text) => {
        h.text = text;
      },
      setTextWithPluginMentions: (text) => {
        h.text = text;
      },
      setEditorStateJson: () => {},
      setSkillMention: () => {},
      setSlashCommandMention: () => {},
    };
    if (props.inputApiRef) props.inputApiRef.current = api;
    return createElement("div", { "data-testid": "editor" });
  },
}));
vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ canSelectFilePath: true }),
  useOptionalPlatform: () => null,
}));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ promptAttachmentTransferService: {} }),
  useOptionalServices: () => null,
}));
vi.mock("@/hooks/useSettingService.js", () => ({ useSettings: () => ({ settings: null }) }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/v4/composer/V4ComposerToolbar.js", () => ({
  V4ComposerModeSwitch: () => null,
  V4ComposerModelControls: () => null,
}));
vi.mock("@/v4/composer/V4ComposerCuaEntry.js", () => ({ V4ComposerCuaEntry: () => null }));
vi.mock("@/components/ui/dialog.js", () => {
  const Passthrough = ({ children }: { children?: ReactNode }) => children;
  return {
    Dialog: () => null,
    DialogClose: Passthrough,
    DialogContent: Passthrough,
    DialogDescription: Passthrough,
    DialogFooter: Passthrough,
    DialogHeader: Passthrough,
    DialogTitle: Passthrough,
  };
});
vi.mock("@/v4/composer/composerPromptContexts.js", () => ({
  serializeComposerPromptContexts: (text: string) => `${text}\n\nCONTEXT`,
  countComposerPromptContexts: () => 1,
}));

const p = resolveComposerScope("p");
const q = resolveComposerScope("q");
const draft: V4ComposerDraft = { text: "P", mode: "build", updatedAt: 0 };
function props(scope = p): ConversationComposerProps {
  return {
    snapshot: null,
    sessionId: null,
    draftMode: true,
    workspacePath: "/same",
    composerDraft: draft,
    rootDraftScopeKey: composerScopeKey(scope),
    updateComposerContent: vi.fn(),
    replaceComposerDraft: vi.fn(),
    createSubmissionFromComposer: () => ({
      mode: "build",
      planEnabled: false,
      modelSelection: { providerId: "p", modelId: "m", options: { reasoningLevel: "high" } },
    }),
    onSendText: vi.fn<ConversationComposerProps["onSendText"]>(async () => "sent"),
    onStop: vi.fn(),
    onSelectModel: vi.fn(),
    onSelectThought: vi.fn(),
    onSwitchMode: vi.fn(),
    attachmentPut: vi.fn(),
    autoFocusEnabled: false,
  };
}
const frames = new Map<number, FrameRequestCallback>();
let frameSequence = 0;
function flushFrames() {
  act(() => {
    const current = [...frames.values()];
    frames.clear();
    current.forEach((callback) => callback(0));
  });
}
beforeEach(() => {
  localStorage.clear();
  h.text = "";
  h.mounts = 0;
  h.editor = null;
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++frameSequence;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  useZCodeSessionStore.setState({ workspaces: {} });
  useComposerAttachmentUploadStore.setState({ scopes: {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useComposerAttachmentUploadStore.setState({ scopes: {} });
});

describe("ZUP05 实际 Composer 项目 scope 消费者", () => {
  it("同 cwd 两项目切换复用同一编辑器，正文和附件各自恢复，reader 读取未防抖的当前文本", () => {
    useZCodeSessionStore.getState().startDraft("/same", undefined, undefined, { projectId: "p" });
    const focus = useZCodeSessionStore.getState().getWorkspaceState("/same").draftFocusVersion;
    stageV4ComposerDraftAttachments("/same", undefined, focus, {
      sourceWorkspaceKey: "/source",
      draft: { text: "P" },
      attachments: [
        {
          id: "file",
          filename: "p.txt",
          mimeType: "text/plain",
          sizeBytes: 1,
          localPath: "/same/p.txt",
        },
      ],
    });
    const original = props();
    const view = render(createElement(ConversationComposer, original));
    flushFrames();
    act(() => {
      h.text = "P live";
      h.editor!.onChange?.("P live");
    });
    expect(captureV4ComposerDraftHandoff("/same")).toMatchObject({
      draft: { text: "P live" },
      attachments: [{ filename: "p.txt" }],
    });
    view.rerender(
      createElement(ConversationComposer, { ...props(q), composerDraft: { ...draft, text: "Q" } }),
    );
    flushFrames();
    expect(h.text).toBe("Q");
    expect(captureV4ComposerDraftHandoff("/same").attachments).toEqual([]);
    expect(h.mounts).toBe(1);
    view.rerender(createElement(ConversationComposer, original));
    flushFrames();
    expect(captureV4ComposerDraftHandoff("/same").attachments).toMatchObject([
      { filename: "p.txt" },
    ]);
  });

  it("发送冻结原始正文，不把上下文增强后的协议文本当作恢复正文；迟到成功不清新项目", async () => {
    let accepted!: () => void;
    const send = vi.fn(
      () =>
        new Promise<"sent">((resolve) => {
          accepted = () => resolve("sent");
        }),
    );
    const view = render(createElement(ConversationComposer, { ...props(), onSendText: send }));
    flushFrames();
    await act(async () => {
      h.text = "  hello  ";
      h.editor!.onChange?.("  hello  ");
      h.editor!.onSubmit?.("  hello  ");
      await Promise.resolve();
    });
    expect(send).toHaveBeenCalledWith(
      "hello\n\nCONTEXT",
      expect.objectContaining({ submittedDraftText: "hello" }),
    );
    view.rerender(
      createElement(ConversationComposer, {
        ...props(q),
        composerDraft: { ...draft, text: "Q next" },
      }),
    );
    flushFrames();
    await act(async () => accepted());
    expect(h.text).toBe("Q next");
    expect(h.mounts).toBe(1);
  });
});

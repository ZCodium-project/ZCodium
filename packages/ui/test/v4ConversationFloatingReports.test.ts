// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationRow } from "@zcode/shared/zcode-protocol-v4";
import { ConversationTimeline, type ConversationTimelineProps } from "@/v4/ConversationTimeline.js";
import { DEFAULT_CODE_PREVIEW_SETTINGS } from "@/lib/codePreviewSettings.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/v4/ConversationTurnGroup.js", () => ({ ConversationTurnGroup: () => null }));
vi.mock("@/v4/ConversationTurnNavigator.js", () => ({ ConversationTurnNavigator: () => null }));
vi.mock("@/v4/useConversationTimelineFind.js", () => ({
  useConversationTimelineFind: () => undefined,
}));
vi.mock("@/v4/ConversationSelectionTooltip.js", () => ({
  ConversationSelectionTooltip: () => null,
}));
vi.mock("@/v4/ConversationPendingGuideList.js", () => ({
  ConversationPendingGuideList: () => null,
}));
vi.mock("@/v4/BotTopicPreparation.js", () => ({ useBotTopicPreparations: () => [] }));
vi.mock("@/plugin-ui/index.js", () => ({
  deriveLogicalUiInstances: () => ({ byToolCallId: {} }),
  getPluginUiDisclosureVersion: () => 0,
  getPluginUiManualPin: () => undefined,
  setPluginUiInstanceDerivation: () => {},
  subscribePluginUiDisclosure: () => () => {},
}));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getVirtualItems: () => [],
    getTotalSize: () => 0,
    measure: () => {},
    measurementsCache: [],
    measureElement: () => {},
  }),
}));

class TestResizeObserver {
  static instances = new Set<TestResizeObserver>();
  readonly targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {
    TestResizeObserver.instances.add(this);
  }
  observe(element: Element) {
    this.targets.add(element);
  }
  unobserve(element: Element) {
    this.targets.delete(element);
  }
  disconnect() {
    TestResizeObserver.instances.delete(this);
  }
}

let dockHeight = 46;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.hasAttribute("data-v4-composer-dock"))
        return { ...original.call(this), height: dockHeight };
      return original.call(this);
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  TestResizeObserver.instances.clear();
  dockHeight = 46;
});

function timelineProps(rows: readonly ConversationRow[] = []): ConversationTimelineProps {
  return {
    rows,
    totalCount: rows.length,
    sessionKey: "task-a",
    floatingComposerDock: true,
    bottomDock: createElement("textarea", {
      defaultValue: "同一个草稿",
      "data-testid": "composer",
    }),
    rowContext: {
      workspacePath: "/workspace",
      theme: "light",
      codePreviewSettings: DEFAULT_CODE_PREVIEW_SETTINGS,
    },
    onComposerDockHeightChange: vi.fn(),
    onLatestTurnSummaryChange: vi.fn(),
  };
}

function completedRows(turnId: string, rowId: number): ConversationRow[] {
  return [
    {
      kind: "turnHeader",
      rowId,
      turnId,
      createdAt: 100,
      createdAtSeq: rowId,
      origin: "userInput",
      state: "completedSuccess",
      startedAt: 100,
      activeMs: 1000,
    },
    {
      kind: "userInput",
      rowId: rowId + 1,
      turnId,
      createdAt: 101,
      createdAtSeq: rowId + 1,
      origin: "realUser",
      text: "问题",
    },
    {
      kind: "assistantText",
      rowId: rowId + 2,
      turnId,
      createdAt: 1100,
      createdAtSeq: rowId + 2,
      state: "complete",
      text: `回答:${turnId}`,
    },
  ];
}

describe("ZUP11 时间线浮窗投影上报", () => {
  it("初始测高与阻塞卡增高均取同一个 dock；切回 sticky 不重挂编辑器", () => {
    const props = timelineProps();
    const view = render(createElement(ConversationTimeline, props));
    const input = view.getByTestId("composer");
    const dock = view.container.querySelector<HTMLElement>("[data-v4-composer-dock]")!;
    const root = view.container.firstElementChild as HTMLElement;
    expect(props.onComposerDockHeightChange).toHaveBeenLastCalledWith(46);
    expect(root.style.getPropertyValue("--v4-floating-composer-dock-height")).toBe("46px");
    dockHeight = 170;
    act(() => {
      for (const observer of TestResizeObserver.instances) {
        if (observer.targets.has(dock))
          observer.callback([], observer as unknown as ResizeObserver);
      }
    });
    expect(props.onComposerDockHeightChange).toHaveBeenLastCalledWith(170);
    expect(root.style.getPropertyValue("--v4-floating-composer-dock-height")).toBe("170px");
    view.rerender(createElement(ConversationTimeline, { ...props, floatingComposerDock: false }));
    expect(view.getByTestId("composer")).toBe(input);
    expect(dock.className).toContain("sticky bottom-0");
    expect(root.style.getPropertyValue("--v4-floating-composer-dock-height")).toBe("");
  });

  it("最后回合的完整回答只按值变化上报；切 owner 回调后重新报告，不要求观察运行中", () => {
    const props = timelineProps(completedRows("turn-a", 1));
    const view = render(createElement(ConversationTimeline, props));
    expect(props.onLatestTurnSummaryChange).toHaveBeenCalledOnce();
    expect(props.onLatestTurnSummaryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        turnKey: "turn-a",
        running: false,
        answer: { rowId: 3, text: "回答:turn-a" },
      }),
    );
    view.rerender(createElement(ConversationTimeline, { ...props, rows: [...props.rows] }));
    expect(props.onLatestTurnSummaryChange).toHaveBeenCalledOnce();
    view.rerender(
      createElement(ConversationTimeline, {
        ...props,
        rows: [...props.rows, ...completedRows("turn-b", 4)],
      }),
    );
    expect(props.onLatestTurnSummaryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        turnKey: "turn-b",
        running: false,
        answer: { rowId: 6, text: "回答:turn-b" },
      }),
    );
    const onNextOwner = vi.fn();
    view.rerender(
      createElement(ConversationTimeline, {
        ...props,
        sessionKey: "task-b",
        onLatestTurnSummaryChange: onNextOwner,
      }),
    );
    expect(onNextOwner).toHaveBeenCalledOnce();
  });
});

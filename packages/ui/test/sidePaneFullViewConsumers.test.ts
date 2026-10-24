// @vitest-environment jsdom
import { createElement, type ComponentProps, type ReactNode } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnimatedSidePanePanel } from "@/app-shell/AnimatedSidePanePanel.js";

vi.mock("@/hooks/useServices.js", () => ({
  ServiceProvider: ({ children }: { children: ReactNode }) => children,
  useComposerClientNamespace: () => "qa-desktop",
}));
vi.mock("@/hooks/useInterfaceMode.js", () => ({ useIsOfficeMode: () => false }));
vi.mock("@/hooks/useDeveloperToolsVisibility.js", () => ({
  useDeveloperToolsVisibility: () => false,
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({}) }));
vi.mock("@/lib/mobileTextInput.js", () => ({ useIsMobileTextInputViewport: () => false }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/ErrorBoundary.js", () => ({
  ScopedErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/DesktopWindowControls.js", () => ({ DesktopWindowControls: () => null }));
vi.mock("@/WorkspaceSidePaneToggleButton.js", () => ({
  WorkspaceSidePaneToggleButton: () => createElement("button", { "aria-label": "close-pane" }),
}));
vi.mock("@/components/ui/resizable.js", () => ({
  ResizableHandle: () => createElement("div", { "data-testid": "resize-handle" }),
  ResizablePanel: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-testid": "resizable-panel" }, children),
}));
vi.mock("@dnd-kit/core", () => ({
  closestCenter: () => null,
  DndContext: ({ children }: { children: ReactNode }) => children,
  DragOverlay: () => null,
  PointerSensor: class {},
  useSensor: () => null,
  useSensors: () => [],
}));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  horizontalListSortingStrategy: () => null,
}));
vi.mock("@/app-shell/SidePaneTabTrigger.js", () => ({
  getSidePaneTabTitle: (tab: { id: string }) => tab.id,
  SidePaneTabDragOverlay: () => null,
  // 真实 trigger 在 pointerdown 上直接回调，不能只验证 Radix onValueChange。
  SortableSidePaneTabTrigger: ({
    tab,
    onActivateTab,
  }: {
    tab: { id: string };
    onActivateTab: (id: string) => void;
  }) => createElement("button", { onPointerDown: () => onActivateTab(tab.id) }, tab.id),
}));
vi.mock("@/app-shell/SidePaneTabOverview.js", () => ({ SidePaneTabOverview: () => null }));
vi.mock("@/plugin-ui/index.js", () => ({
  useOpenPluginUi: () => undefined,
  PluginUiLauncherItems: () => null,
  PluginUiSidePane: () => null,
}));
vi.mock("@/PreviewPane.js", () => ({ PreviewPane: () => null }));
vi.mock("@/SidePaneTerminalPane.js", () => ({
  SidePaneTerminalPane: ({ isVisible }: { isVisible: boolean }) =>
    createElement("input", {
      "data-testid": "terminal",
      "data-visible": String(isVisible),
      defaultValue: "terminal-state",
    }),
}));
vi.mock("@/browser-use/BrowserUseSidePaneContent.js", () => ({
  BrowserUseSidePaneContent: () => null,
}));
vi.mock("@/browser-use/BrowserSitePermissionsPage.js", () => ({
  BrowserSitePermissionsPage: () => null,
}));
vi.mock("@/browser-use/HumanBrowserView.js", () => ({
  HumanBrowserView: ({ isVisible, isSelected }: { isVisible: boolean; isSelected: boolean }) =>
    createElement("div", {
      "data-testid": "browser",
      "data-visible": String(isVisible),
      "data-selected": String(isSelected),
    }),
}));
vi.mock("@/GitPane.js", () => ({ GitPane: () => null }));
vi.mock("@/TreemappingPane.js", () => ({ TreemappingPane: () => null }));
vi.mock("@/WhiteboardPane.js", () => ({ WhiteboardPane: () => null }));
vi.mock("@/ModelTrajectoryPane.js", () => ({ ModelTrajectoryPane: () => null }));
vi.mock("@/DeveloperToolsPane.js", () => ({ DeveloperToolsPane: () => null }));
vi.mock("@/app-shell/SubagentSessionSidePane.js", () => ({ SubagentSessionSidePane: () => null }));
vi.mock("@/app-shell/SubagentDirectorySidePane.js", () => ({
  SubagentDirectorySidePane: () => null,
}));
vi.mock("@/app-shell/SelectionSideChatPane.js", () => ({ SelectionSideChatPane: () => null }));
vi.mock("@/app-shell/BackgroundBashOutputSidePane.js", () => ({
  BackgroundBashOutputSidePane: () => null,
}));
vi.mock("@/app-shell/PlanDetailSidePane.js", () => ({ PlanDetailSidePane: () => null }));
vi.mock("@/app-shell/WorkflowRunSidePane.js", () => ({ WorkflowRunSidePane: () => null }));
vi.mock("@/app-shell/WorkflowRunDirectorySidePane.js", () => ({
  WorkflowRunDirectorySidePane: () => null,
}));
vi.mock("@/app-shell/WorkflowActorSessionSidePane.js", () => ({
  WorkflowActorSessionSidePane: () => null,
}));
vi.mock("@/app-shell/WorkflowWorkspaceSidePane.js", () => ({
  WorkflowWorkspaceSidePane: () => null,
}));
vi.mock("@/app-shell/WorkflowArtifactSidePane.js", () => ({
  WorkflowArtifactSidePane: () => null,
}));

function props() {
  return {
    services: {},
    isDesktop: true,
    isVisible: true,
    sidePaneState: {
      activeTabId: "terminal-1",
      tabs: [
        { id: "terminal-1", type: "terminal", ownerTaskId: "task-a" },
        {
          id: "browser-1",
          type: "browser",
          initialUrl: null,
          faviconUrl: null,
          ownerTaskId: "task-a",
        },
      ],
    },
    recentClosedSidePaneTabs: [],
    isBrowserOpen: true,
    workspaceAbsPath: "/workspace",
    activeTaskId: "task-a",
    sidePaneOwnerId: "task-a",
    gitState: {},
    activeGitSourceId: "workspace",
    panelRef: { current: null },
    panelElementRef: { current: null },
    browserNavigationRequest: null,
    browserRestoreUrls: {},
    fileChangeFindActiveIndex: -1,
    fileChangeFindNavigationRequestId: 0,
    fileChangeFindQuery: "",
    onFileChangeFindMatchCountChange: vi.fn(),
    onCloseCodeViewer: vi.fn(),
    onCloseGit: vi.fn(),
    onActivateTab: vi.fn(),
    onReorderTab: vi.fn(),
    onCloseTab: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseAllTabs: vi.fn(),
    onReopenClosedTab: vi.fn(),
    onOpenBrowserTab: vi.fn(),
    onOpenWhiteboard: vi.fn(),
    onOpenDeveloperTools: vi.fn(),
    onOpenTerminalTab: vi.fn(),
    onOpenReviewTab: vi.fn(),
    onOpenSelectionSideConversation: vi.fn(),
    onOpenBrowserUrl: vi.fn(),
    onOpenCodeViewer: vi.fn(),
    onOpenSubagentSession: vi.fn(),
    onRefreshGit: vi.fn(),
    onBrowserNavigationRequestHandled: vi.fn(),
    onBrowserUrlChange: vi.fn(),
    onBrowserPageMetadataChange: vi.fn(),
    onSelectGitSource: vi.fn(),
    onCloseSidePane: vi.fn(),
    fullViewToggle: { active: true, onToggle: vi.fn() },
    fullView: { surface: "side-pane", conversationTitle: "当前任务", onSelectSurface: vi.fn() },
    fullViewSlotRef: vi.fn(),
  } as unknown as ComponentProps<typeof AnimatedSidePanePanel>;
}

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ZUP11 Side Pane 完整视图消费者", () => {
  it("桌面对话 tab 切换保留原内容节点，并取消 terminal/browser 可见性", () => {
    const input = props();
    const view = render(createElement(AnimatedSidePanePanel, input));
    const frame = view.container.querySelector("[data-workspace-side-frame]")!;
    expect(frame.className).toContain("absolute inset-0 z-0");
    expect(view.queryByTestId("resize-handle")).toBeNull();
    expect(view.getByRole("tab", { name: "当前任务" }).className).toContain("[app-region:no-drag]");
    expect(view.getByTestId("terminal").getAttribute("data-visible")).toBe("true");
    const terminal = view.getByTestId("terminal");
    const browserState = { ...input.sidePaneState!, activeTabId: "browser-1" };
    view.rerender(createElement(AnimatedSidePanePanel, { ...input, sidePaneState: browserState }));
    expect(view.getByTestId("browser").getAttribute("data-selected")).toBe("true");
    expect(view.getByTestId("browser").getAttribute("data-visible")).toBe("true");
    fireEvent.mouseDown(view.getByRole("tab", { name: "当前任务" }), { button: 0, ctrlKey: false });
    expect(input.fullView!.onSelectSurface).toHaveBeenCalledWith("conversation");
    view.rerender(
      createElement(AnimatedSidePanePanel, {
        ...input,
        sidePaneState: browserState,
        fullView: { ...input.fullView!, surface: "conversation" },
      }),
    );
    expect(view.getByTestId("terminal")).toBe(terminal);
    expect(terminal.getAttribute("data-visible")).toBe("false");
    expect(view.getByTestId("browser").getAttribute("data-selected")).toBe("false");
    expect(input.fullViewSlotRef).toHaveBeenCalledWith(
      view.container.querySelector("[data-side-pane-content-slot]"),
    );
    fireEvent.pointerDown(view.getByText("terminal-1"));
    expect(input.fullView!.onSelectSurface).toHaveBeenLastCalledWith("side-pane");
    expect(input.onActivateTab).toHaveBeenCalledWith("terminal-1");
    expect(vi.mocked(input.fullView!.onSelectSurface).mock.invocationCallOrder.at(-1)).toBeLessThan(
      vi.mocked(input.onActivateTab).mock.invocationCallOrder.at(-1)!,
    );
    fireEvent.click(view.getByRole("button", { name: "sidePane.fullView.exit" }));
    expect(input.fullViewToggle!.onToggle).toHaveBeenCalledOnce();
    view.rerender(createElement(AnimatedSidePanePanel, { ...input, fullView: null }));
    expect(view.getByTestId("terminal")).toBe(terminal);
    expect(view.getByTestId("resize-handle")).toBeTruthy();
  });

  it("空 tab 集合仍提供对话、退出按钮与真实内容 slot，不丢启动页", () => {
    const input = { ...props(), sidePaneState: null };
    const view = render(createElement(AnimatedSidePanePanel, input));
    expect(view.getByRole("tab", { name: "当前任务" })).toBeTruthy();
    expect(view.getAllByRole("button", { name: "sidePane.fullView.exit" })).toHaveLength(1);
    expect(view.container.querySelector("[data-side-pane-content-slot]")).not.toBeNull();
    expect(view.getByText("sidePane.openTab")).toBeTruthy();
  });

  it.each([{ isDesktop: false }, { mobileOverlay: true }, { mobileStacked: true }])(
    "不在 Web/mobile 启用完整视图：%o",
    (override) => {
      const view = render(createElement(AnimatedSidePanePanel, { ...props(), ...override }));
      expect(view.queryByRole("tab", { name: "当前任务" })).toBeNull();
      expect(view.queryByRole("button", { name: "sidePane.fullView.exit" })).toBeNull();
      expect(
        view.container.querySelector("[data-workspace-side-frame]")?.className ?? "",
      ).not.toContain("absolute inset-0 z-0");
    },
  );
});

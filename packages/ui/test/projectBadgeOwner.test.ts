// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectDirectoryProvider } from "@/project-sidebar/ProjectDirectoryProvider.js";
import { useRootPlatformEffects } from "@/root/useRootPlatformEffects.js";

const state = vi.hoisted(() => ({
  tree: { projects: [], tasks: [] } as never,
  enabled: true,
  badge: vi.fn(),
}));
vi.mock("@/project-sidebar/useProjectTree.js", () => ({
  useProjectTree: () => ({ tree: state.tree, factTree: state.tree }),
}));
vi.mock("@/project-sidebar/useTaskGroups.js", () => ({ useTaskGroups: () => ({}) }));
vi.mock("@/hooks/useSourceServerDisplayNames.js", () => ({
  useSourceServerDisplayNames: () => new Map(),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => null,
}));
vi.mock("@/hooks/usePlatform.js", () => ({ useOptionalPlatform: () => platform }));
vi.mock("@/store/StoreProvider.js", () => ({ useZCodeStoreWithDefault: () => state.enabled }));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: (select: (value: unknown) => unknown) => select({ tabs: [], activeTabId: null }),
}));
const event = () => () => {};
const platform = {
  syncWindowUnreadCount: state.badge,
  syncWindowTabs: vi.fn(),
  onFocusTab: event,
  onNewTab: event,
  onNewTask: event,
  onOpenWorkspace: event,
  onTaskNotificationClick: event,
};
afterEach(() => {
  cleanup();
  state.badge.mockReset();
  state.enabled = true;
  localStorage.clear();
});
function LegacyRootEffects({ count }: { count: number }) {
  const input = {
    canBootstrapInitialWorkspace: false,
    platform,
    tabs: [],
    isDesktop: false,
    locale: "en-US",
    totalUnreadTaskCount: count,
    addTab() {},
    setIsBootstrappingInitialWorkspace() {},
    activateTabByPath: () => false,
    startDraftInWorkspace() {},
    startNewTaskFromActiveWorkspace() {},
    openWorkspace() {},
    openWorkspacePath() {},
    setWorkspaceActionError() {},
    intl: { formatMessage: ({ id }: { id: string }) => id },
    isRestoringOAuthSession: false,
  };
  useRootPlatformEffects(input as never);
  return null;
}
function view(count: number) {
  return createElement(ProjectDirectoryProvider, null, createElement(LegacyRootEffects, { count }));
}
it("Host 项目树是唯一角标写者；旧 Root 汇总变化不覆盖后台项目未读", () => {
  state.tree = {
    projects: [],
    tasks: [
      { hostId: "local", projectId: null, workspacePath: "/background", taskId: "t", unreadAt: 1 },
    ],
  } as never;
  const rendered = render(view(99));
  expect(state.badge.mock.calls.map(([count]) => count)).toEqual([1]);
  state.badge.mockClear();
  rendered.rerender(view(123));
  expect(state.badge).not.toHaveBeenCalled();
  // 没有挂侧栏，后台快照仍通过常驻 Provider 更新角标。
  state.tree = { projects: [], tasks: [] } as never;
  rendered.rerender(view(123));
  expect(state.badge.mock.calls.map(([count]) => count)).toEqual([0]);
});
it("关闭通知清零角标，Host 树蓝点事实不被修改", () => {
  state.tree = {
    projects: [],
    tasks: [
      { hostId: "local", projectId: null, workspacePath: "/background", taskId: "t", unreadAt: 1 },
    ],
  } as never;
  const rendered = render(view(99));
  state.badge.mockClear();
  state.enabled = false;
  rendered.rerender(view(42));
  expect(state.badge.mock.calls.map(([count]) => count)).toEqual([0]);
  expect((state.tree as { tasks: Array<{ unreadAt: number }> }).tasks[0]!.unreadAt).toBe(1);
});

// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V4WorkspaceChatArea } from "@/v4/V4WorkspaceChatArea.js";
import {
  INITIAL_PANE_LAYOUT,
  usePaneLayoutStore,
  V4_PRIMARY_PANE_ID,
} from "@/v4/paneLayoutStore.js";
import { useWorkbenchGroupStore } from "@/v4/workbenchGroupStore.js";
import { SidePaneFullViewConversationHost } from "@/side-pane-full-view/index.js";

vi.mock("@/hooks/useServices.js", () => ({ useServices: () => ({}) }));
vi.mock("@/v4/V4ConversationContext.js", () => ({
  V4PaneConversationProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/v4/SessionPane.js", () => ({
  SessionPane: ({ paneId }: { paneId: string }) =>
    createElement("textarea", { "data-testid": paneId, defaultValue: `草稿:${paneId}` }),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) => children,
}));

beforeEach(() => {
  usePaneLayoutStore.setState(INITIAL_PANE_LAYOUT);
  useWorkbenchGroupStore.getState().resetWorkbenchGroups();
});
afterEach(() => {
  cleanup();
  usePaneLayoutStore.setState(INITIAL_PANE_LAYOUT);
});

describe("ZUP11 完整视图分屏展示投影", () => {
  it("浮窗只显示焦点 pane；切回对话时恢复 rect/分隔条、草稿及同一 DOM", () => {
    usePaneLayoutStore
      .getState()
      .splitPane(V4_PRIMARY_PANE_ID, "row", { workspacePath: "/workspace" });
    const layout = usePaneLayoutStore.getState();
    const paneId = layout.focusedPaneId;
    const hostProps = {
      floating: "collapsed" as const,
      anchor: "bottom-right" as const,
      slotElement: null,
      onFloatingChange: vi.fn(),
      onAnchorChange: vi.fn(),
      onOpenConversation: vi.fn(),
    };
    const chat = createElement(V4WorkspaceChatArea, {
      workspacePath: "/workspace",
      sessionId: null,
      isDesktop: true,
    });
    const view = render(
      createElement(SidePaneFullViewConversationHost, {
        ...hostProps,
        mode: "normal",
        children: chat,
      }),
    );
    const primary = view.getByTestId(V4_PRIMARY_PANE_ID);
    const secondary = view.getByTestId(paneId);
    fireEvent.input(secondary, { target: { value: "尚未发送的分屏草稿" } });
    const primaryShell = primary.closest("[data-pane-id]")!;
    const secondaryShell = secondary.closest("[data-pane-id]")!;
    const originalStyle = secondaryShell.getAttribute("style");
    const divider = view.container.querySelector("[data-split-id]");
    act(() =>
      view.rerender(
        createElement(SidePaneFullViewConversationHost, {
          ...hostProps,
          mode: "floating",
          children: chat,
        }),
      ),
    );
    expect(view.getByTestId(paneId)).toBe(secondary);
    expect((secondary as HTMLTextAreaElement).value).toBe("尚未发送的分屏草稿");
    expect(view.getByTestId(V4_PRIMARY_PANE_ID)).toBe(primary);
    expect(primaryShell.getAttribute("aria-hidden")).toBe("true");
    expect(primaryShell.hasAttribute("inert")).toBe(true);
    expect(secondaryShell.getAttribute("style")).toContain("width: calc(100%)");
    expect(view.container.querySelector("[data-split-id]")).toBeNull();
    expect(usePaneLayoutStore.getState().root).toBe(layout.root);
    expect(usePaneLayoutStore.getState().panes).toBe(layout.panes);
    view.rerender(
      createElement(SidePaneFullViewConversationHost, {
        ...hostProps,
        mode: "conversation",
        children: chat,
      }),
    );
    expect(view.getByTestId(paneId)).toBe(secondary);
    expect(primaryShell.hasAttribute("inert")).toBe(false);
    expect(secondaryShell.getAttribute("style")).toBe(originalStyle);
    expect(divider).not.toBeNull();
    expect(view.container.querySelector("[data-split-id]")).not.toBeNull();
  });
});

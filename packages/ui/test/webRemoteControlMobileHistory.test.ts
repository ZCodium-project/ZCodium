// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebRemoteControlMobileShell } from "@/WebRemoteControlMobileShell.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/WebRemoteControlThemeMenu.js", () => ({ WebRemoteControlThemeMenu: () => null }));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function renderShell(intent?: "chat") {
  act(() =>
    root.render(
      createElement(WebRemoteControlMobileShell, {
        activeTaskId: "task",
        activeWorkspacePath: "/workspace",
        initialNavigationIntent: intent,
        onSelectTask: vi.fn(),
        switcher: { listWorkspaces: async () => ({ workspaces: [] }), switchWorkspace: vi.fn() },
        chatContent: "Conversation",
        renderTaskHome: ({ onNavigateToChat }) =>
          createElement("button", { onClick: onNavigateToChat }, "Open task"),
        renderChatHeader: () => null,
      }),
    ),
  );
}

function clickButton() {
  act(() => container.querySelector("button")!.click());
}

async function traverse(navigate: () => void) {
  await act(async () => {
    const popped = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    navigate();
    await popped;
  });
}

describe("mobile browser history", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    history.replaceState({ previous: true }, "", "#previous");
    history.pushState({ fromPairing: true }, "", "#remote");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("uses the owned chat entry after reload and allows a second Back to leave", async () => {
    const baseLength = history.length;
    renderShell();
    clickButton();
    expect(container.textContent).toContain("Conversation");
    expect(history.length).toBe(baseLength + 1);

    act(() => root.unmount());
    root = createRoot(container);
    renderShell();
    expect(container.textContent).toContain("Conversation");
    expect(history.length).toBe(baseLength + 1);

    // 页头返回必须移动历史游标，而不是把当前聊天项篡改为第二条列表项。
    const back = vi.spyOn(history, "back");
    await traverse(() => {
      clickButton();
      expect(back).toHaveBeenCalledOnce();
    });
    expect(container.textContent).toBe("Open task");
    expect(history.state).toEqual({ fromPairing: true });
    await traverse(() => history.back());
    expect(location.hash).toBe("#previous");
    await traverse(() => history.forward());
    await traverse(() => history.forward());
    expect(container.textContent).toContain("Conversation");
    expect(history.length).toBe(baseLength + 1);
    back.mockRestore();
  });

  it("returns in place from an unowned chat and later adds exactly one entry for a list click", async () => {
    history.replaceState({ fromPairing: true, zcodeMobilePage: "chat" }, "");
    const baseLength = history.length;
    renderShell();
    expect(container.textContent).toContain("Conversation");
    clickButton();
    expect(container.textContent).toBe("Open task");
    expect(history.state).toEqual({ fromPairing: true, zcodeMobilePage: "home" });
    expect(history.length).toBe(baseLength);
    clickButton();
    expect(history.length).toBe(baseLength + 1);
    await traverse(() => history.back());
    expect(container.textContent).toBe("Open task");
    expect(location.hash).toBe("#remote");
    await traverse(() => history.back());
    expect(location.hash).toBe("#previous");
  });

  it("creates the same single owned entry for a cross-workspace navigation intent", async () => {
    const baseLength = history.length;
    renderShell("chat");
    expect(container.textContent).toContain("Conversation");
    expect(history.length).toBe(baseLength + 1);
    await traverse(clickButton);
    expect(container.textContent).toBe("Open task");
    expect(history.state).toEqual({ fromPairing: true });
  });
});

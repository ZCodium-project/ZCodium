// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPluginUiPagePlane } from "@/plugin-ui/adapters/pluginUiPagePlane.js";
import type { PluginSandboxHandle } from "@zcode/shared/mcp-apps";
vi.mock("@floating-ui/dom", () => ({
  autoUpdate: (_a: unknown, _b: unknown, update: () => void) => {
    update();
    return () => {};
  },
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  HTMLElement.prototype.checkVisibility = function () {
    return this.dataset.hidden !== "true";
  };
  HTMLElement.prototype.moveBefore = function (node, child) {
    this.insertBefore(node, child);
  };
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
function anchor(width = 500, height = 400) {
  const node = document.createElement("div");
  node.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON() {},
  });
  document.body.append(node);
  return node;
}
describe("后台非零表面与原子迁移", () => {
  it("无锚点可执行，隐藏的 forceMount tab 不夺取表面；重新显示仍使用原 guest", () => {
    const plane = createPluginUiPagePlane({ onVisibility: vi.fn(), onCrash: vi.fn() });
    plane.setExecutionActive(true);
    plane.mount({
      sandboxId: "s",
      shellUrl: "zcode-sandbox://s",
      partition: "p",
    } as PluginSandboxHandle);
    const frame = document.querySelector("webview")!;
    (frame as any).connectedMoveCallback = () => {};
    const root = frame.parentElement!;
    expect(root.style.display).toBe("block");
    expect(parseInt(root.style.width)).toBeGreaterThan(0);
    expect(parseInt(root.style.height)).toBeGreaterThan(0);
    expect(root.inert).toBe(true);
    const hidden = anchor(0, 0);
    hidden.dataset.hidden = "true";
    const offHidden = plane.bind({ node: hidden, kind: "sidebar" });
    expect(root.parentElement?.dataset.sandboxPageParking).toBe("true");
    expect(root.style.display).toBe("block");
    const shown = anchor();
    const offShown = plane.bind({ node: shown, kind: "flow" });
    expect(root.parentElement).toBe(shown);
    expect(root.inert).toBe(false);
    offShown();
    expect(root.inert).toBe(true);
    expect(root.style.display).toBe("block");
    expect(document.querySelector("webview")).toBe(frame);
    offHidden();
    plane.dispose();
    expect(document.querySelector("webview")).toBeNull();
  });
});

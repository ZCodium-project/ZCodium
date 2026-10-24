// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IGenUiService } from "@zcode/services";
import type { PluginSandboxHandle, PluginSandboxPlatformPort } from "@zcode/shared/mcp-apps";
import { GEN_UI_FOLLOW_UP_METHOD, GEN_UI_STATE_METHOD } from "@zcode/shared/gen-ui";
import { createGenUiPage, type GenUiPage } from "@/gen-ui/host.js";
import type { PluginUiSessionActions } from "@/plugin-ui/contract.js";

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (input: unknown) => Promise<unknown>>(),
  initialized: undefined as (() => void) | undefined,
  visibility: undefined as ((visible: boolean) => void) | undefined,
  ports: undefined as ((event: unknown) => void) | undefined,
  actions: null as PluginUiSessionActions | null,
}));
vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => ({
  AppBridge: class {
    set oninitialized(callback: () => void) {
      harness.initialized = callback;
    }
    setRequestHandler(
      method: string,
      _schema: unknown,
      handler: (input: unknown) => Promise<unknown>,
    ) {
      harness.handlers.set(method, handler);
    }
    setHostContext() {}
    async connect() {
      harness.initialized?.();
    }
    async close() {}
  },
}));
vi.mock("@/plugin-ui/hostPrimitives.js", () => ({
  getPluginUiSessionActions: () => harness.actions,
  readPluginUiStyleVariables: () => ({}),
  createPluginUiMessagePortTransport: () => ({}),
  createPluginUiPagePlane: ({ onVisibility }: { onVisibility: (visible: boolean) => void }) => {
    harness.visibility = onVisibility;
    return {
      mount: () => onVisibility(true),
      bind: () => () => {},
      preview: () => {},
      focus: () => {},
      prepareUnmount: () => onVisibility(false),
      dispose: () => {},
    };
  },
  sandboxPages: {},
}));

let page: GenUiPage | undefined;
const followUp = () =>
  harness.handlers.get(GEN_UI_FOLLOW_UP_METHOD)!({ prompt: "继续完善", title: "本地图表" });
async function setup(
  confirm: (prompt: string) => Promise<string | null> = async (prompt) => prompt,
) {
  const handle = { sandboxId: "sandbox", initId: 1 } as PluginSandboxHandle;
  const files = {
    readDocument: vi.fn(async () => ({ path: "/work/chart.html", html: "<main>local</main>" })),
  };
  const state = {
    onStateChanged: () => ({ dispose: () => {} }),
    prepareSandbox: vi.fn(async () => handle),
    getState: vi.fn(async () => null),
    setState: vi.fn(async () => {}),
  };
  const platform = {
    getOwnerWebContentsId: async () => 1,
    disposeSandbox: vi.fn(async () => {}),
    consumeUserGesture: vi.fn(async () => false),
    onPorts: (callback: (event: unknown) => void) => {
      harness.ports = callback;
      return () => {};
    },
  };
  page = createGenUiPage({
    target: {
      workspacePath: "/work",
      workspaceIdentity: "local-identity",
      sessionId: "session",
      path: "/work/chart.html",
      instanceKey: "message:0",
    },
    files: files as unknown as IGenUiService,
    state: state as unknown as IGenUiService,
    platform: platform as unknown as PluginSandboxPlatformPort,
    openExternal: vi.fn(),
    confirm,
  });
  await vi.waitFor(() => expect(state.getState).toHaveBeenCalled());
  harness.ports?.({ ...handle, port: {} });
  await vi.waitFor(() => expect(page?.getSnapshot().phase).toBe("ready"));
  return { files, state, platform };
}
beforeEach(() => {
  harness.handlers.clear();
  harness.actions = { sendFollowUp: vi.fn(async () => {}) };
});
afterEach(async () => {
  await page?.dispose();
  page = undefined;
});

describe("ZUP08 复用的沙箱交互准入", () => {
  it("确认续写沿用会话入口及持久化来源，保存状态本身不发送", async () => {
    const { state } = await setup();
    await harness.handlers.get(GEN_UI_STATE_METHOD)!({
      state: { modelContent: { choice: 1 }, privateContent: null },
    });
    expect(state.setState).toHaveBeenCalled();
    expect(harness.actions!.sendFollowUp).not.toHaveBeenCalled();
    await followUp();
    expect(harness.actions!.sendFollowUp).toHaveBeenCalledWith({
      prompt: "继续完善",
      source: { kind: "genUi", path: "/work/chart.html", title: "本地图表" },
    });
  });
  it.each(["hidden", "disposed", "readonly"])("%s 实例不可发送", async (reason) => {
    await setup();
    const actions = harness.actions!;
    if (reason === "hidden") harness.visibility?.(false);
    if (reason === "disposed") await page!.dispose();
    if (reason === "readonly") harness.actions = null;
    await expect(followUp()).rejects.toThrow();
    expect(actions.sendFollowUp).not.toHaveBeenCalled();
  });
  it("等待确认期间会话绑定失效，不能向新绑定发送旧实例请求", async () => {
    let confirm!: (prompt: string | null) => void;
    await setup(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const old = harness.actions!;
    const pending = followUp();
    await vi.waitFor(() => expect(confirm).toBeTypeOf("function"));
    harness.actions = { sendFollowUp: vi.fn(async () => {}) };
    confirm("确认后发送");
    await expect(pending).rejects.toThrow("Session binding changed");
    expect(old.sendFollowUp).not.toHaveBeenCalled();
    expect(harness.actions.sendFollowUp).not.toHaveBeenCalled();
  });
  it("等待确认期间沙箱重建，旧桥实例不能借新实例的 ready 状态发送", async () => {
    let confirm!: (prompt: string | null) => void;
    await setup(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = followUp();
    await vi.waitFor(() => expect(confirm).toBeTypeOf("function"));
    harness.ports?.({ sandboxId: "sandbox", initId: 1, port: {} });
    confirm("旧实例请求");
    await expect(pending).rejects.toThrow("Gen UI instance was closed");
    expect(harness.actions!.sendFollowUp).not.toHaveBeenCalled();
  });
});

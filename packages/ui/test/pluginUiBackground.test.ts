import { afterEach, describe, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";
import { attachPluginUiToolResults } from "@/plugin-ui/adapters/pluginUiBackground.js";
import { acquirePluginUiPage, pluginUiPages } from "@/plugin-ui/adapters/pluginUiPageRegistry.js";
import { createPage } from "@/plugin-ui/adapters/pluginUiManagedPage.js";
import { buildPluginUiSessionKey } from "@/plugin-ui/contract.js";

vi.mock("@/plugin-ui/adapters/pluginUiManagedPage.js", () => ({
  createPage: vi.fn((key, input) => ({
    kind: "mcp",
    key,
    task: buildPluginUiSessionKey(input.scope),
    visible: false,
    start: vi.fn(),
    updateToolFeed: vi.fn(),
    update: vi.fn(),
    destroy: vi.fn(),
    running: () => true,
    busy: () => false,
    suspend: async () => false,
  })),
}));
afterEach(() => {
  pluginUiPages.clear();
  vi.clearAllMocks();
});
const result = {
  workspacePath: "/repo",
  sessionId: "background",
  toolCallId: "open-1",
  serverName: "plugin:editor:editor",
  input: { file: "drawing.png" },
  ui: { pluginId: "editor@personal", resourceUri: "ui://editor", surface: "editor" },
};
function setup(supported = true) {
  let accept = (_value: typeof result & { workspaceIdentity?: string }) => {};
  const dispose = vi.fn();
  const subscribe = vi.fn(() => (listener: typeof accept) => {
    accept = listener;
    return { dispose };
  });
  const services = {
    zcodeAgentService: { onDynamicPluginUiToolResult: subscribe },
    pluginUiBridgeService: {},
  } as unknown as IServiceAccessor;
  const platform = (supported ? { pluginSandbox: {} } : {}) as IPlatformService;
  const off = attachPluginUiToolResults(services, platform, () => ({
    theme: "light",
    locale: "en",
  }));
  return {
    send: (value: typeof result & { workspaceIdentity?: string } = result) => accept(value),
    off,
    dispose,
    subscribe,
  };
}
describe("窗口级后台插件创建", () => {
  it("无卡片也启动；并发卡片请求和后续结果复用 guest 且只更新 feed", async () => {
    const host = setup();
    host.send();
    const page = vi.mocked(createPage).mock.results[0]!.value;
    expect(
      await acquirePluginUiPage(page.key, () => {
        throw new Error("duplicate guest");
      }),
    ).toBe(page);
    await vi.waitFor(() => expect(page.start).toHaveBeenCalledTimes(1));
    host.send({ ...result, toolCallId: "open-2" });
    await vi.waitFor(() => expect(page.updateToolFeed).toHaveBeenCalledTimes(2));
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(page.update).not.toHaveBeenCalled();
    host.off();
    expect(host.dispose).toHaveBeenCalledOnce();
  });
  it("同插件不同会话隔离", async () => {
    const host = setup();
    host.send();
    host.send({ ...result, sessionId: "other" });
    await vi.waitFor(() => expect(createPage).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createPage).mock.calls[0]![0]).not.toBe(
      vi.mocked(createPage).mock.calls[1]![0],
    );
    host.off();
  });
  it("Web 不订阅，远程结果不创建沙箱", () => {
    const web = setup(false);
    expect(web.subscribe).not.toHaveBeenCalled();
    web.send();
    web.off();
    const desktop = setup();
    desktop.send({ ...result, workspaceIdentity: "remote:ssh:host:22:user:/repo" });
    expect(createPage).not.toHaveBeenCalled();
    desktop.off();
  });
  it("退出后的迟到通知不复活页面", () => {
    const host = setup();
    host.off();
    host.send();
    expect(createPage).not.toHaveBeenCalled();
  });
});

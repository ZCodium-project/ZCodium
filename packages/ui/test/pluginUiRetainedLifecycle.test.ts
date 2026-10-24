// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "@zcode/services";
import type { IPlatformService } from "@zcode/shared";
import type { PluginSandboxHandle } from "@zcode/shared/mcp-apps";
import type { UsePluginUiHostInput } from "@/plugin-ui/adapters/pluginUiHostTypes.js";
import { createPage } from "@/plugin-ui/adapters/pluginUiManagedPage.js";

const fake = vi.hoisted(() => ({
  controller: {
    start: vi.fn(),
    dispose: vi.fn(async () => {}),
    isBusy: () => false,
    tryRecycle: vi.fn(async () => true),
    notifyToolInput: vi.fn(),
    notifyToolResult: vi.fn(),
    updateHostContext: vi.fn(),
  },
  plane: {
    mount: vi.fn(),
    bind: vi.fn(() => () => {}),
    setExecutionActive: vi.fn(),
    prepareUnmount: vi.fn(),
    unmount: vi.fn(),
    dispose: vi.fn(),
  },
  controllerDeps: null as any,
  planeEvents: null as any,
  runtimeStopped: null as any,
  workspaceChanged: null as any,
  releaseConnection: vi.fn(),
  releaseLease: vi.fn(),
  releaseFeed: vi.fn(),
}));
vi.mock("@/plugin-ui/adapters/pluginUiPagePlane.js", () => ({
  createPluginUiPagePlane: (events: any) => {
    fake.planeEvents = events;
    return fake.plane;
  },
}));
vi.mock("@/plugin-ui/app/pluginUiHostController.js", () => ({
  createPluginUiHostController: (deps: any) => {
    fake.controllerDeps = deps;
    return fake.controller;
  },
}));
vi.mock("@/plugin-ui/adapters/pluginUiPageRegistry.js", () => ({
  pluginUiPages: {
    reserve: vi.fn(async () => {}),
    released: vi.fn(),
    settled: vi.fn(),
    visibility: vi.fn(),
    removeTask: vi.fn(),
  },
}));
vi.mock("@/plugin-ui/adapters/pluginUiResourceDeltaFeed.js", () => ({
  attachPluginUiResourceDeltaFeed: () => fake.releaseFeed,
}));
vi.mock("@/v4/workspaceConnectionRegistry.js", () => ({
  acquireWorkspaceConnection: () => ({
    release: fake.releaseConnection,
    layer: { acquire: () => ({ store: {}, release: fake.releaseLease }) },
    transport: {
      onRuntimeRestart: (handler: any) => {
        fake.runtimeStopped = handler;
        return () => {};
      },
    },
  }),
}));
vi.mock("@/plugin-ui/adapters/pluginUiDownloads.js", () => ({
  createPluginUiDownloadInteraction: () => ({}),
}));
vi.mock("@/logger.js", () => ({ logger: { lifecycle: { info: vi.fn() }, warn: vi.fn() } }));
const input: UsePluginUiHostInput = {
  scope: {
    workspacePath: "/repo",
    sessionId: "s",
    scope: { kind: "surface", surfaceId: "editor" },
  },
  presentation: {
    serverName: "plugin:editor:editor",
    pluginId: "editor@personal",
    resourceUri: "ui://editor",
  },
  theme: "light",
  locale: "en",
  displayMode: "inline",
  width: 0,
  hostVersion: "zcode",
  toolInput: undefined,
  toolResult: undefined,
};
const handle = {
  sandboxId: "sandbox",
  initId: 7,
  instance: { appIdentity: "app" },
} as PluginSandboxHandle;
function setup() {
  const setExecutionActive = vi.fn(async () => {});
  const page = createPage(
    "key",
    input,
    { pluginSandbox: { setExecutionActive } } as unknown as IPlatformService,
    {
      pluginUiBridgeService: {},
      zcodeTaskService: {
        onDynamicWorkspaceEvent: () => (handler: any) => {
          fake.workspaceChanged = handler;
          return { dispose: vi.fn() };
        },
      },
    } as unknown as IServiceAccessor,
  );
  return { page, setExecutionActive };
}
afterEach(() => {
  vi.clearAllMocks();
});
describe("保留 MCP guest 的生命周期", () => {
  it("无锚点启动后保留执行；session 空闲也不得回收未保存编辑", async () => {
    const { page, setExecutionActive } = setup();
    page.start();
    await vi.waitFor(() => expect(fake.controller.start).toHaveBeenCalledOnce());
    fake.controllerDeps.onPhase("mounted", { handle });
    expect(fake.plane.setExecutionActive).toHaveBeenLastCalledWith(true);
    expect(setExecutionActive).toHaveBeenLastCalledWith("sandbox", 7, true);
    await expect(page.suspend(false)).resolves.toBe(false);
    expect(fake.controller.tryRecycle).not.toHaveBeenCalled();
    expect(fake.controller.dispose).not.toHaveBeenCalled();
    await page.suspend(true);
    expect(fake.controller.dispose).toHaveBeenCalledOnce();
    expect(fake.plane.prepareUnmount).toHaveBeenCalledWith("sandbox");
    expect(fake.plane.unmount).toHaveBeenCalledWith("sandbox");
    expect(fake.releaseFeed).toHaveBeenCalledOnce();
    expect(fake.releaseLease).toHaveBeenCalledOnce();
    expect(fake.releaseConnection).toHaveBeenCalledOnce();
    page.destroy();
  });
  it("运行时失效只释放现有实例，不因隐藏页面仍保留而重新启动", async () => {
    const { page } = setup();
    page.start();
    await vi.waitFor(() => expect(fake.controller.start).toHaveBeenCalledOnce());
    fake.controllerDeps.onPhase("mounted", { handle });
    fake.runtimeStopped();
    await vi.waitFor(() => expect(fake.plane.unmount).toHaveBeenCalledWith("sandbox"));
    expect(page.snapshot().phase).toBe("error");
    page.start();
    expect(fake.controller.start).toHaveBeenCalledOnce();
    page.destroy();
  });
  it("可见性与窗口隐藏仅切换原代际执行租约，不重建 guest", async () => {
    const { page, setExecutionActive } = setup();
    page.start();
    await vi.waitFor(() => expect(fake.controller.start).toHaveBeenCalledOnce());
    fake.controllerDeps.onPhase("mounted", { handle });
    page.visible = true;
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    fake.planeEvents.onVisibility(true);
    expect(setExecutionActive).toHaveBeenLastCalledWith("sandbox", 7, false);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(setExecutionActive).toHaveBeenLastCalledWith("sandbox", 7, true);
    expect(fake.plane.mount).toHaveBeenCalledOnce();
    await page.suspend(true);
    page.destroy();
    hidden.mockRestore();
  });
});

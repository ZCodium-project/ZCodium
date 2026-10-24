import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels } from "@zcode/shared";
import type {
  PluginSandboxHandle,
  PluginSandboxRegisterRequestPayload,
} from "@zcode/shared/mcp-apps";
import { registerLocalMediaPreviewScheme } from "../src/main/localMediaPreviewProtocol.js";

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  sessions: new Map<string, any>(),
  owners: new Map<number, any>(),
  acquire: vi.fn(),
  release: vi.fn(),
  writeImage: vi.fn(),
  ports: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
}));
vi.mock("electron", () => ({
  app: { getLocale: () => "en", isPackaged: true },
  BrowserWindow: {
    fromWebContents: (owner: { id: number }) => ({ id: owner.id, isDestroyed: () => false }),
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      if (electron.handlers.has(channel)) throw new Error(`Duplicate handler: ${channel}`);
      electron.handlers.set(channel, handler);
    },
  },
  webContents: { fromId: (id: number) => electron.owners.get(id) },
  session: {
    fromPartition: (partition: string) => {
      if (!electron.sessions.has(partition))
        electron.sessions.set(partition, {
          protocol: { handle: vi.fn(), isProtocolHandled: () => false },
          webRequest: { onBeforeRequest: vi.fn() },
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setProxy: vi.fn(async () => {}),
          on: vi.fn(),
        });
      return electron.sessions.get(partition);
    },
  },
  clipboard: { writeImage: electron.writeImage },
  nativeImage: { createFromBitmap: (_bitmap: unknown, image: unknown) => image },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  MessageChannelMain: class {
    port1 = { close: vi.fn() };
    port2 = { close: vi.fn() };
    constructor() {
      electron.ports.push(this.port1, this.port2);
    }
  },
}));
vi.mock("@desktop/main/browserView/browserScreenshotActivityController.js", () => ({
  DesktopBrowserScreenshotActivityController: class {
    acquire = electron.acquire;
  },
}));

type SandboxModule = typeof import("../src/main/pluginSandbox/index.js");
let sandbox: SandboxModule;
let source: ts.SourceFile;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  electron.handlers.clear();
  electron.sessions.clear();
  electron.owners.clear();
  electron.ports.length = 0;
  electron.acquire.mockReturnValue({ release: electron.release, markPrepared: vi.fn() });
  for (const id of [7, 8])
    electron.owners.set(
      id,
      Object.assign(new EventEmitter(), { id, isDestroyed: () => false, postMessage: vi.fn() }),
    );
  sandbox = await import("../src/main/pluginSandbox/index.js");
  source = ts.createSourceFile(
    "main/index.ts",
    await readFile(new URL("../src/main/index.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
});

/** 执行入口的实际 AST 函数体，只在 Electron/无关启动端口注入替身；不加载 App、不写构建产物。 */
function evaluate(code: string, ports: Record<string, unknown>) {
  const compiled = ts.transpileModule(code.replaceAll("import.meta.dirname", "mainDir"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(compiled, {
    mainDir: "/app/out/main",
    join,
    process: { env: {} },
    ...sandbox,
    ...ports,
  });
}
function callNamed(statement: ts.Statement, name: string): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(source) === name
  );
}
async function boot(dataRootState = "ready", isPackaged = true) {
  const statement = source.statements.find(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(source) === "app.whenReady().then",
  ) as ts.ExpressionStatement;
  if (!statement) throw new Error("Main ready entry is missing");
  const callback = (statement.expression as ts.CallExpression).arguments[0] as ts.ArrowFunction;
  const body = callback.body as ts.Block;
  // 在既有 browser 协议初始化边界停下；沙箱必须在此窗口/Host 创建之前同步完成。
  const boundary = body.statements.findIndex((node) =>
    callNamed(node, "installBrowserRestoreBootstrapProtocol"),
  );
  if (boundary < 0) throw new Error("Main ready protocol boundary is missing");
  const decision = vi.fn(async () => {});
  await evaluate(
    `(async () => { ${body.statements
      .slice(0, boundary + 1)
      .map((node) => node.getText(source))
      .join("\n")} })()`,
    {
      app: { isPackaged },
      markMainLaunchAppReady: vi.fn(),
      getDesktopDataRootStartupResult: () => ({
        state: dataRootState,
        baseDir: "/isolated",
        status: {},
      }),
      runDesktopDataRootDecisionFlow: decision,
      resolveSystemApplicationLocale: () => "en-US",
      session: { defaultSession: { protocol: {} }, fromPartition: () => ({ protocol: {} }) },
      installLocalMediaPreviewProtocol: vi.fn(),
      localMediaPreviewPathRegistry: { isAuthorized: vi.fn() },
      desktopContextPromptRollout: null,
      installBrowserRestoreBootstrapProtocol: vi.fn(),
      EMBEDDED_BROWSER_PARTITION: "browser",
      logger: { warn: vi.fn(), info: vi.fn() },
    },
  );
  return { decision };
}
function hostRegistration() {
  let initializer: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "createWindowInstance") {
      function findProperty(child: ts.Node) {
        if (ts.isPropertyAssignment(child) && child.name.getText(source) === "spawnHostProcess")
          initializer = child.initializer;
        else ts.forEachChild(child, findProperty);
      }
      ts.forEachChild(node, findProperty);
    } else ts.forEachChild(node, visit);
  }
  visit(source);
  if (!initializer) throw new Error("Main window Host factory is missing");
  const spawn = vi.fn(
    (
      _win: unknown,
      _label: unknown,
      _init: unknown,
      dependencies: {
        registerPluginSandbox?: (input: PluginSandboxRegisterRequestPayload) => PluginSandboxHandle;
      },
    ) => dependencies,
  );
  const noop = () => {};
  const factory = evaluate(`(${initializer.getText(source)})`, {
    spawnHostProcess: spawn,
    resolveZCodeBuiltinProviderConfigFilePath: () => "/isolated/providers.json",
    hostProcessLocalEnv: {},
    resolveDesktopContextPromptEnabledForHost: noop,
    logger: { warn: noop, info: noop },
    broadcastHub: {},
    taskRealtimeBus: {},
    windowHostProcessMap: new Map(),
    hostRunningTaskCountMap: new Map(),
    forwardCronRunResult: noop,
    forwardOffPeakRunResult: noop,
    wakeCronScheduler: noop,
    wakeOffPeakScheduler: noop,
    localMediaPreviewPathRegistry: { authorize: noop },
    windowWorkspaceMap: new Map(),
  }) as (
    win: { id: number },
    label: string,
    init: object,
  ) => {
    registerPluginSandbox?: (input: PluginSandboxRegisterRequestPayload) => PluginSandboxHandle;
  };
  return factory({ id: 1 }, "primary", {}).registerPluginSandbox;
}
function input(
  ownerWebContentsId = 7,
  contentKind?: "gen-ui",
): PluginSandboxRegisterRequestPayload {
  return {
    requestId: "request",
    ownerWebContentsId,
    contentKind,
    workspacePath: "/isolated/work",
    workspaceIdentity: "isolated-host-identity",
    sessionId: "session",
    instance: {
      runtimeId: "runtime",
      generation: 1,
      token: contentKind ?? "mcp",
      appIdentity: "a".repeat(64),
    },
    ...(contentKind ? {} : { pluginId: "local-plugin", serverName: "local-server" }),
    scopeId: "tool:one",
    html: "<main>local</main>",
  };
}
function invoke(channel: string, ownerId: number, ...args: unknown[]) {
  const handler = electron.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for '${channel}'`);
  return handler({ sender: electron.owners.get(ownerId) }, ...args);
}
function captureRequest(handle: PluginSandboxHandle) {
  return {
    sandboxId: handle.sandboxId,
    initId: handle.initId,
    captureRect: { x: 0, y: 0, width: 10, height: 10 },
    viewportSize: { width: 10, height: 10 },
  };
}
function attachGuest(handle: PluginSandboxHandle) {
  let destroyed = false;
  const image = {
    getSize: () => ({ width: 10, height: 10 }),
    crop: vi.fn().mockReturnThis(),
    toBitmap: () => Buffer.alloc(400),
  };
  const guest = Object.assign(new EventEmitter(), {
    id: 70,
    hostWebContents: electron.owners.get(7),
    isDestroyed: () => destroyed,
    getURL: () => handle.shellUrl,
    mainFrame: { frames: [] as Array<{ url: string; detached: boolean }> },
    isLoadingMainFrame: () => false,
    setWindowOpenHandler: vi.fn(),
    postMessage: vi.fn(),
    loadURL: vi.fn(async () => {}),
    capturePage: vi.fn(async () => image),
    close: vi.fn(() => {
      destroyed = true;
      guest.emit("destroyed");
    }),
  });
  sandbox.getPluginSandboxHost()!.attachGuest({
    guest: guest as never,
    hostWebContents: guest.hostWebContents,
    sandboxId: handle.sandboxId,
  });
  guest.emit("dom-ready");
  return { guest, image };
}

describe("ZUP08/09 正式 Main 沙箱初始化", () => {
  it("ready 前同一次注册 media/sandbox scheme，保留沙箱权限声明", () => {
    const statement = source.statements.find((node) =>
      callNamed(node, "registerLocalMediaPreviewScheme"),
    );
    if (!statement) throw new Error("Main scheme bootstrap is missing");
    const register = vi.fn();
    evaluate(statement.getText(source), {
      registerLocalMediaPreviewScheme,
      protocol: { registerSchemesAsPrivileged: register },
    });
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0]![0]).toContainEqual(sandbox.PLUGIN_SANDBOX_PRIVILEGED_SCHEME);
    expect(register.mock.calls[0]![0]).toContainEqual(
      expect.objectContaining({ scheme: "zcode-media" }),
    );
  });
  it("正式 ready 入口安装全部公开 IPC，重入不创建第二套 owner 或重复 handler", async () => {
    await boot();
    expect(invoke(PlatformChannels.PluginSandboxOwnerWebContentsId, 7)).toBe(7);
    const channels = Object.entries(PlatformChannels)
      .filter(([name]) => name.startsWith("PluginSandbox"))
      .map(([, channel]) => channel);
    expect([...electron.handlers.keys()].sort()).toEqual(channels.sort());
    const owner = sandbox.getPluginSandboxHost();
    await boot();
    expect(sandbox.getPluginSandboxHost()).toBe(owner);
    expect(invoke(PlatformChannels.PluginSandboxOwnerWebContentsId, 8)).toBe(8);
  });
  it("数据根 pending 不安装正式沙箱，也不开放 IPC", async () => {
    const { decision } = await boot("pending");
    expect(decision).toHaveBeenCalledOnce();
    expect(sandbox.getPluginSandboxHost()).toBeNull();
    expect(electron.handlers.size).toBe(0);
  });
  it("窗口 Host 的实际注入回调把 Gen UI/MCP 登记交给同一 host，分区权限随登记准备", async () => {
    await boot();
    const register = hostRegistration();
    expect(register).toBeTypeOf("function");
    const host = sandbox.getPluginSandboxHost()!;
    for (const kind of [undefined, "gen-ui"] as const) {
      const request = input(7, kind);
      const handle = register!(request);
      const { requestId: _id, ...payload } = request;
      expect(host.registerFromHost(payload)).toEqual(handle);
      const partition = electron.sessions.get(handle.partition);
      expect(partition.protocol.handle).toHaveBeenCalledWith("zcode-sandbox", expect.any(Function));
      expect(partition.setPermissionRequestHandler).toHaveBeenCalledOnce();
      expect(partition.setPermissionCheckHandler).toHaveBeenCalledOnce();
      expect(
        host.configureGuest({
          ownerWebContentsId: 7,
          params: { src: handle.shellUrl, partition: handle.partition },
          webPreferences: {},
        }),
      ).toMatchObject({ ok: true });
      expect(
        host.configureGuest({
          ownerWebContentsId: 8,
          params: { src: handle.shellUrl, partition: handle.partition },
          webPreferences: {},
        }),
      ).toMatchObject({ ok: false, reason: "owner-mismatch" });
      invoke(PlatformChannels.PluginSandboxDispose, 8, handle.sandboxId, handle.initId);
      expect(host.registerFromHost(payload)).toEqual(handle);
      invoke(PlatformChannels.PluginSandboxDispose, 7, handle.sandboxId, handle.initId - 1);
      expect(host.registerFromHost(payload)).toEqual(handle);
      invoke(PlatformChannels.PluginSandboxDispose, 7, handle.sandboxId, handle.initId);
      expect(
        host.configureGuest({
          ownerWebContentsId: 7,
          params: { src: handle.shellUrl, partition: handle.partition },
          webPreferences: {},
        }),
      ).toMatchObject({ ok: false });
    }
  });
  it("真实安装的执行/截图/手势 handler 拒绝跨 owner、旧代次及 Gen UI 执行活动", async () => {
    await boot();
    const register = hostRegistration()!;
    expect(register).toBeTypeOf("function");
    const handle = register(input());
    expect(() =>
      invoke(
        PlatformChannels.PluginSandboxExecutionActive,
        8,
        handle.sandboxId,
        handle.initId,
        true,
      ),
    ).toThrow("no longer available");
    expect(() =>
      invoke(
        PlatformChannels.PluginSandboxExecutionActive,
        7,
        handle.sandboxId,
        handle.initId - 1,
        true,
      ),
    ).toThrow("no longer available");
    const genUi = register(input(7, "gen-ui"));
    expect(() =>
      invoke(PlatformChannels.PluginSandboxExecutionActive, 7, genUi.sandboxId, genUi.initId, true),
    ).toThrow("no longer available");
    expect(invoke(PlatformChannels.PluginSandboxConsumeUserGesture, 8, handle.sandboxId)).toBe(
      false,
    );
    await expect(
      invoke(PlatformChannels.PluginSandboxCopyImage, 8, captureRequest(handle)),
    ).rejects.toThrow("Sandbox capture is no longer available");
    expect(electron.writeImage).not.toHaveBeenCalled();
    expect(electron.acquire).not.toHaveBeenCalled();
  });
  it("同一 owner 串联端口、手势、截图和执行租约；释放等待文档停止且拒绝迟到截图", async () => {
    await boot();
    const handle = hostRegistration()!(input());
    const { guest, image } = attachGuest(handle);
    expect(electron.owners.get(7).postMessage).toHaveBeenCalledOnce();
    expect(guest.postMessage).toHaveBeenCalledOnce();
    guest.emit("input-event", {}, { type: "mouseDown" });
    expect(invoke(PlatformChannels.PluginSandboxConsumeUserGesture, 8, handle.sandboxId)).toBe(
      false,
    );
    expect(invoke(PlatformChannels.PluginSandboxConsumeUserGesture, 7, handle.sandboxId)).toBe(
      true,
    );
    expect(invoke(PlatformChannels.PluginSandboxConsumeUserGesture, 7, handle.sandboxId)).toBe(
      false,
    );
    invoke(PlatformChannels.PluginSandboxExecutionActive, 7, handle.sandboxId, handle.initId, true);
    invoke(PlatformChannels.PluginSandboxExecutionActive, 7, handle.sandboxId, handle.initId, true);
    expect(electron.acquire).toHaveBeenCalledOnce();
    await invoke(PlatformChannels.PluginSandboxCopyImage, 7, captureRequest(handle));
    expect(electron.writeImage).toHaveBeenCalledOnce();
    const capture = Promise.withResolvers<typeof image>();
    guest.capturePage.mockReturnValueOnce(capture.promise);
    const pending = invoke(PlatformChannels.PluginSandboxCopyImage, 7, captureRequest(handle));
    await invoke(PlatformChannels.PluginSandboxDispose, 7, handle.sandboxId, handle.initId - 1);
    expect(electron.release).not.toHaveBeenCalled();
    await invoke(PlatformChannels.PluginSandboxDispose, 7, handle.sandboxId, handle.initId);
    expect(electron.release).toHaveBeenCalledOnce();
    expect(electron.ports).toHaveLength(2);
    for (const port of electron.ports) expect(port.close).toHaveBeenCalledOnce();
    expect(guest.loadURL).toHaveBeenCalledExactlyOnceWith("about:blank");
    expect(guest.close).toHaveBeenCalledOnce();
    capture.resolve(image);
    await expect(pending).rejects.toThrow("Sandbox capture is no longer available");
    expect(electron.writeImage).toHaveBeenCalledOnce();
  });
  it("正式登记的权限闸门只允许声明的 MCP 权限，Gen UI 仍拒绝原生权限", async () => {
    await boot();
    const register = hostRegistration()!;
    for (const contentKind of [undefined, "gen-ui"] as const) {
      const handle = register({
        ...input(7, contentKind),
        ...(contentKind ? {} : { permissions: ["camera"] }),
      });
      const { guest } = attachGuest(handle);
      const requestingUrl = `zcode-sandbox://plugin-${handle.instance.appIdentity}/instance/${handle.sandboxId}/index.html`;
      guest.mainFrame.frames.push({ url: requestingUrl, detached: false });
      const partition = electron.sessions.get(handle.partition);
      const request = partition.setPermissionRequestHandler.mock.calls[0][0];
      const answer = vi.fn();
      request(guest, "media", answer, { requestingUrl, mediaTypes: ["video"] });
      await vi.waitFor(() => expect(answer).toHaveBeenCalledWith(!contentKind));
      await invoke(PlatformChannels.PluginSandboxDispose, 7, handle.sandboxId, handle.initId);
    }
  });
});

import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";
import { HostMessageTypes, HostResponseTypes } from "@zcode/shared";
const windows = vi.hoisted(() => new Map<number, unknown>());
vi.mock("electron", () => ({
  BrowserWindow: {
    fromId: (id: number) => windows.get(id),
    getAllWindows: () => [...windows.values()],
  },
  MessageChannelMain: class {
    port1 = { close: vi.fn() };
    port2 = { close: vi.fn() };
  },
}));
import { createRemoteWorkspaceSessionManager } from "../src/main/desktopRemoteSessions.js";
beforeEach(() => windows.clear());
function fixture() {
  const child = Object.assign(new EventEmitter(), { pid: 42, postMessage: vi.fn() });
  const win = {
    id: 1,
    isDestroyed: () => false,
    webContents: { id: 101, isDestroyed: () => false, postMessage: vi.fn(), send: vi.fn() },
  };
  windows.set(1, win);
  const manager = createRemoteWorkspaceSessionManager({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    windowHostProcessMap: new Map([[101, child]]) as never,
    resolveRemoteAssetDirs: () => ({}) as never,
    webRemoteControlManagerRef: { current: null },
  });
  const local = {
    hostId: "local",
    projectId: "p",
    workspacePath: "/project",
    additionalDirectories: [],
  };
  const remote = {
    hostId: "remote:server:source",
    projectId: "p",
    workspacePath: "/project",
    workspaceIdentity: "remote:server:source:/project",
    additionalDirectories: [],
    remote: {
      sourceServerId: "source",
      remoteSessionId: "mobile-session",
      workspacePath: "/project",
      workspaceIdentity: "remote:server:source:/project",
      generation: 1,
      target: { kind: "ssh" as const, host: "device.example", username: "dev" },
    },
  };
  const ready = (id: string, value = local) =>
    child.emit("message", {
      type: HostResponseTypes.ProjectWorkspacePrepared,
      requestId: id,
      result: { ok: true, value },
    });
  return { child, win, manager, local, remote, ready };
}
it("手机项目准备只转交既有窗口 Host，不创建桌面 continuous port", async () => {
  const { manager, child, win, local, ready } = fixture();
  const request = manager.prepareProjectWorkspace(win as never, { projectId: "p" }, "request");
  expect(child.postMessage).toHaveBeenCalledWith({
    type: HostMessageTypes.PrepareProjectWorkspace,
    requestId: "request",
    projectId: "p",
    clientMode: "web-remote-replayable",
  });
  ready("request");
  await expect(request).resolves.toEqual(local);
  expect(win.webContents.postMessage).not.toHaveBeenCalled();
});
it("Host 退出或窗口关闭会结束在途准备，迟到 ACK 不发布成功", async () => {
  const { manager, child, win, ready } = fixture();
  const request = manager.prepareProjectWorkspace(win as never, { projectId: null }, "request");
  const rejected = expect(request).rejects.toThrow("Host");
  child.emit("exit", 1);
  ready("request");
  await rejected;
  expect(win.webContents.postMessage).not.toHaveBeenCalled();
});
it("取消只发对应 Host request，晚到准备结果不能注册 route", async () => {
  const { manager, child, win, remote, ready } = fixture();
  const request = manager.prepareProjectWorkspace(
    win as never,
    { projectId: "p", hostId: remote.hostId },
    "request",
  );
  const rejected = expect(request).rejects.toThrow(/取消|cancel/);
  manager.cancelPendingRemoteWorkspaceSessionsForWindow(101, "cancel", "request");
  ready("request", remote);
  await rejected;
  expect(child.postMessage).toHaveBeenCalledWith({
    type: HostMessageTypes.CancelRemoteWorkspaceConnect,
    requestId: "request",
  });
  expect(() =>
    manager.attachRemoteWorkspaceSessionHost({
      windowId: 1,
      remoteSessionId: "mobile-session",
      workspacePath: "/project",
      workspaceIdentity: remote.workspaceIdentity,
      workspaceKey: remote.workspaceIdentity,
      clientMode: "web-remote-replayable",
    }),
  ).toThrow();
});
it("同一 Source scope 的并发手机准备等待同一个首次 Provisioning，完成后仅可 bridge", async () => {
  const { manager, child, win, remote, ready } = fixture();
  const first = manager.prepareProjectWorkspace(
    win as never,
    { projectId: "p", hostId: remote.hostId },
    "first",
  );
  ready("first", remote);
  await vi.waitFor(() =>
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: HostMessageTypes.ProviderProvisioningExecute }),
    ),
  );
  const settled = vi.fn();
  const second = manager
    .prepareProjectWorkspace(win as never, { projectId: "p", hostId: remote.hostId }, "second")
    .then(settled);
  ready("second", remote);
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  const commands = child.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === HostMessageTypes.ProviderProvisioningExecute);
  expect(commands).toHaveLength(1);
  child.emit("message", {
    type: HostResponseTypes.ProviderProvisioningExecutionResult,
    requestId: commands[0].requestId,
    environmentKey: commands[0].environmentKey,
    status: "applied",
  });
  await Promise.all([first, second]);
  manager.reattachRemoteWorkspaceSessionsForWindow(win as never, "reload");
  expect(win.webContents.postMessage).not.toHaveBeenCalled();
  const bridge = manager.attachRemoteWorkspaceSessionHost({
    windowId: 1,
    remoteSessionId: "mobile-session",
    workspacePath: "/project",
    workspaceIdentity: remote.workspaceIdentity,
    workspaceKey: remote.workspaceIdentity,
    clientMode: "web-remote-replayable",
  });
  expect(bridge.process).toBe(child);
});

it("首次 Provisioning 失败后，显式重试重新进入原 coordinator，不永久复用失败 scope", async () => {
  const { manager, child, win, remote, ready } = fixture();
  const first = manager.prepareProjectWorkspace(
    win as never,
    { projectId: "p", hostId: remote.hostId },
    "first",
  );
  const rejected = expect(first).rejects.toThrow("Provisioning");
  ready("first", remote);
  await vi.waitFor(() =>
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: HostMessageTypes.ProviderProvisioningExecute }),
    ),
  );
  const command = child.postMessage.mock.calls
    .map(([message]) => message)
    .find((message) => message.type === HostMessageTypes.ProviderProvisioningExecute)!;
  child.emit("message", {
    type: HostResponseTypes.ProviderProvisioningExecutionResult,
    requestId: command.requestId,
    environmentKey: command.environmentKey,
    status: "failed",
  });
  await rejected;
  const retry = manager.prepareProjectWorkspace(
    win as never,
    { projectId: "p", hostId: remote.hostId },
    "retry",
  );
  ready("retry", remote);
  await vi.waitFor(() =>
    expect(
      child.postMessage.mock.calls.filter(
        ([message]) => message.type === HostMessageTypes.ProviderProvisioningExecute,
      ),
    ).toHaveLength(2),
  );
  const next = child.postMessage.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === HostMessageTypes.ProviderProvisioningExecute)
    .at(-1)!;
  child.emit("message", {
    type: HostResponseTypes.ProviderProvisioningExecutionResult,
    requestId: next.requestId,
    environmentKey: next.environmentKey,
    status: "applied",
  });
  await expect(retry).resolves.toEqual(remote);
});

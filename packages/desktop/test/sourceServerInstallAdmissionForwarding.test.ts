import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import {
  HostMessageTypes,
  HostResponseTypes,
  InternalChannels,
  scopedServicePortPayloadSchema,
  SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE,
} from "@zcode/shared";
import { createRemoteWorkspaceSessionManager } from "../src/main/desktopRemoteSessions.js";

const fixture = vi.hoisted(() => ({ windows: [] as unknown[] }));

vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => fixture.windows },
  MessageChannelMain: class {},
}));

it("#68：Main 只转发显式安装授权，且不丢失 Host 准入原因", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 100, postMessage: vi.fn() });
  const win = {
    id: 2,
    isDestroyed: () => false,
    webContents: { id: 7, isDestroyed: () => false, send: vi.fn() },
  };
  const manager = createRemoteWorkspaceSessionManager({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    windowHostProcessMap: new Map([[7, child]]) as never,
    resolveRemoteAssetDirs: () => ({ remoteCacheDir: "/fixture/runtime-cache" }),
    webRemoteControlManagerRef: { current: null },
  });
  const pending = manager.createRemoteWorkspaceSession(
    win as never,
    { kind: "ssh", host: "example.test", username: "fixture" },
    "install-fixture",
    { confirmSourceServerInstall: true },
  );
  const rejection = expect(pending).rejects.toMatchObject({
    code: SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE,
    retryable: false,
  });
  expect(child.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: HostMessageTypes.ConnectRemoteWorkspace,
      confirmSourceServerInstall: true,
    }),
  );
  child.emit("message", {
    type: HostResponseTypes.RemoteWorkspaceConnectFailed,
    requestId: "install-fixture",
    error: "explicit confirmation required",
    reasonCode: SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE,
    retryable: false,
  });
  await rejection;
});

it("#68：Main 下发完整 scope，严格 schema 接受后只有正确窗口和 attachment 能确认 ready", async () => {
  const child = Object.assign(new EventEmitter(), { pid: 101, postMessage: vi.fn() });
  const win = {
    id: 2,
    isDestroyed: () => false,
    webContents: { id: 7, isDestroyed: () => false, send: vi.fn(), postMessage: vi.fn() },
  };
  const manager = createRemoteWorkspaceSessionManager({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    windowHostProcessMap: new Map([[7, child]]) as never,
    resolveRemoteAssetDirs: () => ({}),
    webRemoteControlManagerRef: { current: null },
    providerProvisioningCoordinator: {
      register: () => ({ initialSync: Promise.resolve(), dispose: vi.fn() }),
    } as never,
    createMessageChannel: () => ({ port1: {}, port2: {} }) as never,
  });
  let ready = false;
  const pending = manager
    .createRemoteWorkspaceSession(
      win as never,
      { kind: "ssh", host: "example.test", username: "fixture" },
      "scope-fixture",
    )
    .then((id) => {
      ready = true;
      return id;
    });
  child.emit("message", {
    type: HostResponseTypes.RemoteWorkspaceConnected,
    requestId: "scope-fixture",
    descriptor: {
      remoteSessionId: "fixture-session",
      sourceServerId: "fixture-source",
      target: { kind: "ssh", host: "example.test", username: "fixture" },
      workspacePath: "/repo",
      workspaceIdentity: "fixture-identity",
      generation: 1,
    },
  });
  await vi.waitFor(() => expect(win.webContents.postMessage).toHaveBeenCalled());
  const [channel, payload] = win.webContents.postMessage.mock.calls[0];
  expect(channel).toBe(InternalChannels.ScopedServicePort);
  const parsed = scopedServicePortPayloadSchema.parse(payload);
  expect(parsed).toMatchObject({
    sourceServerId: "fixture-source",
    workspacePath: "/repo",
    workspaceIdentity: "fixture-identity",
  });
  manager.confirmRendererAttachmentReady(8, {
    sessionId: parsed.sessionId,
    attachmentId: parsed.attachmentId,
  });
  await Promise.resolve();
  expect(ready).toBe(false);
  manager.confirmRendererAttachmentReady(7, {
    sessionId: parsed.sessionId,
    attachmentId: parsed.attachmentId,
  });
  await expect(pending).resolves.toBe("fixture-session");
  fixture.windows = [win];
  const binding = manager.bindRemoteWorkspaceSessionContext(
    "fixture-session",
    { workspacePath: "/repo-new", workspaceIdentity: "requested-route" },
    7,
  );
  expect(win.webContents.postMessage).toHaveBeenCalledTimes(1);
  const bindRequest = child.postMessage.mock.calls
    .map(([request]) => request)
    .find((request) => request.type === HostMessageTypes.BindRemoteWorkspaceContext);
  child.emit("message", {
    type: HostResponseTypes.RemoteWorkspaceContextBound,
    requestId: bindRequest.requestId,
    descriptor: {
      remoteSessionId: "fixture-session",
      sourceServerId: "fixture-source",
      target: { kind: "ssh", host: "example.test", username: "fixture" },
      workspacePath: "/repo-new",
      workspaceIdentity: "canonical-identity",
      generation: 2,
    },
  });
  await vi.waitFor(() => expect(win.webContents.postMessage).toHaveBeenCalledTimes(2));
  const boundPort = scopedServicePortPayloadSchema.parse(
    win.webContents.postMessage.mock.calls[1][1],
  );
  expect(boundPort.workspaceIdentity).toBe("canonical-identity");
  manager.confirmRendererAttachmentReady(7, {
    sessionId: boundPort.sessionId,
    attachmentId: boundPort.attachmentId,
  });
  await expect(binding).resolves.toMatchObject({
    workspacePath: "/repo-new",
    workspaceIdentity: "canonical-identity",
    remoteSessionId: "fixture-session",
  });
  const abandoned = manager.bindRemoteWorkspaceSessionContext(
    "fixture-session",
    { workspacePath: "/other" },
    7,
  );
  const rejection = expect(abandoned).rejects.toThrow("已释放");
  manager.disposeRemoteWorkspaceSession("fixture-session");
  await rejection;
});

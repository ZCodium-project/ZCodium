import { describe, expect, it, vi } from "vitest";
import type { RemoteConnectionProgressInput } from "./contract.js";
import { buildRemoteConnectionProgress } from "./progressProjection.js";

function input(
  overrides: Partial<RemoteConnectionProgressInput> = {},
): RemoteConnectionProgressInput {
  return {
    currentStep: "connecting",
    loading: true,
    selectingDirectory: false,
    open: false,
    error: "",
    connectedSessionId: null,
    connectingRequestId: "original-request",
    pendingRemoteTarget: { kind: "ssh", host: "example.test", username: "user" },
    connectionLogs: [],
    onResume: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("ZUP10 既有连接 owner 的薄进度投影", () => {
  it("空闲不建立展示；真实请求可在收起时保留，重置后清空", () => {
    const idle = input({
      currentStep: "kind",
      loading: false,
      connectingRequestId: null,
      pendingRemoteTarget: null,
    });
    expect(buildRemoteConnectionProgress(idle)).toBeNull();
    const progress = buildRemoteConnectionProgress(input());
    expect(progress).toMatchObject({
      view: "connecting",
      dialogOpen: false,
      loading: true,
      ready: false,
      requestId: "original-request",
    });
    expect(buildRemoteConnectionProgress(idle)).toBeNull();
  });
  it("ready 仅来自实际目录步骤/已连接事实，不调用任何 owner 动作", () => {
    const source = input({
      currentStep: "directory",
      loading: false,
      connectedSessionId: "existing-session",
    });
    expect(buildRemoteConnectionProgress(source)?.ready).toBe(true);
    expect(buildRemoteConnectionProgress({ ...source, selectingDirectory: true })?.ready).toBe(
      false,
    );
    expect(buildRemoteConnectionProgress({ ...source, connectedSessionId: null })?.ready).toBe(
      false,
    );
    expect(source.onResume).not.toHaveBeenCalled();
    expect(source.onCancel).not.toHaveBeenCalled();
  });
  it("SSH secret 不进入 target、错误或日志，不改原 owner 数据", () => {
    const source = input({
      pendingRemoteTarget: {
        kind: "ssh",
        host: "example.test",
        username: "user",
        password: "test-secret",
        privateKeyPath: "/private/key",
        privateKeyPassphrase: "test-passphrase",
      },
      error: "connect rejected test-secret",
      connectionLogs: [
        {
          id: "1",
          level: "error",
          timestamp: "10:00:00",
          message: "test-secret / test-passphrase",
        },
      ],
    });
    const progress = buildRemoteConnectionProgress(source);
    const serialized = JSON.stringify(progress);
    expect(serialized).not.toContain("test-secret");
    expect(serialized).not.toContain("test-passphrase");
    expect(serialized).not.toContain("/private/key");
    expect(progress?.target).toEqual({ kind: "ssh", host: "example.test", username: "user" });
    expect(source.error).toContain("test-secret");
  });
  it("Server URL 丢弃 userinfo/query/hash；token 不进入共享投影", () => {
    const progress = buildRemoteConnectionProgress(
      input({
        pendingRemoteTarget: {
          kind: "server",
          url: "https://user:test-secret@example.test/api?token=query-secret#fragment",
          token: "test-token",
        },
        connectionLogs: [
          { id: "1", level: "info", timestamp: "10:00:00", message: "using test-token" },
        ],
      }),
    );
    expect(progress?.target).toEqual({ kind: "server", url: "https://example.test/api" });
    expect(JSON.stringify(progress)).not.toContain("test-token");
  });
});

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IServiceAccessor } from "../contract.js";
import { registerSourceSettingsServices } from "@/store/sourceSettingsServiceStore.js";
import { useConfigWorkspaceServicesResolution } from "../index.js";

const state = vi.hoisted(() => ({
  mobile: false,
  local: {},
  request: vi.fn(async () => ({ attachmentId: "config" })),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => state.local,
  useWorkspaceServicesResolution: () => ({
    services: {},
    remoteSessionId: null,
    isRemoteTarget: true,
    connectionKind: "remote-waiting",
    rpcReady: false,
  }),
}));
const platform = { requestSourceSettingsAttachment: state.request };
vi.mock("@/hooks/usePlatform.js", () => ({
  useOptionalPlatform: () => (state.mobile ? null : platform),
}));
afterEach(() => {
  cleanup();
  state.mobile = false;
  state.request.mockClear();
});

it("无 tab 配置先完成 canonical 绑定，未完成与旧结果都不开放写入", async () => {
  let finish!: () => void;
  const resolveWorkspace = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const services = {
    sourceServerWorkspaceService: { resolveWorkspace },
  } as unknown as IServiceAccessor;
  const release = registerSourceSettingsServices({
    sourceServerId: "config-owner",
    attachmentId: "config",
    services,
    dispose: vi.fn(),
  });
  try {
    const { result, rerender } = renderHook(
      ({ path }) =>
        useConfigWorkspaceServicesResolution(path, undefined, `remote:server:config-owner:${path}`),
      { initialProps: { path: "/root-a" } },
    );
    expect(result.current.rpcReady).toBe(false);
    await waitFor(() =>
      expect(resolveWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: "/root-a" }),
      ),
    );
    const first = finish;
    rerender({ path: "/root-b" });
    await waitFor(() => expect(resolveWorkspace).toHaveBeenCalledTimes(2));
    await act(async () => first());
    expect(result.current.rpcReady).toBe(false);
    await act(async () => finish());
    expect(result.current.rpcReady).toBe(true);
    expect(result.current.services).toBe(services);
    act(release);
    expect(result.current.rpcReady).toBe(false);
  } finally {
    release();
  }
});

it("手机不能借配置目录取得桌面 Source settings attachment", () => {
  state.mobile = true;
  const release = registerSourceSettingsServices({
    sourceServerId: "mobile-owner",
    attachmentId: "desktop-only",
    services: {} as IServiceAccessor,
    dispose: vi.fn(),
  });
  try {
    const { result } = renderHook(() =>
      useConfigWorkspaceServicesResolution("/repo", undefined, "remote:server:mobile-owner:/repo"),
    );
    expect(result.current.rpcReady).toBe(false);
    expect(state.request).not.toHaveBeenCalled();
  } finally {
    release();
  }
});

it("显式本机配置不能被同路径活动远端 tab 的推断劫持", () => {
  const { result } = renderHook(() => useConfigWorkspaceServicesResolution("/repo"));
  expect(result.current.services).toBe(state.local);
  expect(result.current.connectionKind).toBe("local-ready");
  expect(state.request).not.toHaveBeenCalled();
});

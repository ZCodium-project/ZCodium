// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { IServiceAccessor, VirtualProject } from "../contract.js";
import { useConfigWorkspaceTargets } from "../index.js";
import { useAutomationProjectOptions } from "@/hooks/useAutomationProjectOptions.js";

const state = vi.hoisted(() => ({ services: null as unknown, tabs: [] }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => state.services,
}));
vi.mock("@/store/TabStoreProvider.js", () => ({
  useTabStore: (selector: (value: typeof state) => unknown) => selector(state),
}));
afterEach(cleanup);

const project = (id: string, paths: string[]): VirtualProject => ({
  id,
  hostId: "local",
  name: id,
  nameOverridden: false,
  position: 0,
  pinned: false,
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
  roots: paths.map((rootPath, position) => ({ rootPath, position, isPrimary: position === 0 })),
});
function services(readProjects: () => Promise<VirtualProject[]>) {
  let onMessage!: (event: { channel: string }) => void;
  const dispose = vi.fn();
  const prepareSession = vi.fn();
  const service = {
    projectService: { readProjects, prepareSession },
    broadcastService: {
      onMessage: vi.fn((listener: typeof onMessage) => {
        onMessage = listener;
        return { dispose };
      }),
    },
  } as unknown as IServiceAccessor;
  return {
    service,
    prepareSession,
    dispose,
    notify: () => onMessage({ channel: "state:projects" }),
  };
}

it("无 tab 的所有 roots 可配置，自动化列出空项目；浏览和广播重读均不 prepare", async () => {
  const read = vi.fn(async () => [project("unopened", ["/a", "/b"]), project("empty", [])]);
  const owner = services(read);
  state.services = owner.service;
  const config = renderHook(() => useConfigWorkspaceTargets());
  const automation = renderHook(() => useAutomationProjectOptions());
  await waitFor(() =>
    expect(config.result.current.map((target) => target.workspacePath)).toEqual(["/a", "/b"]),
  );
  await waitFor(() =>
    expect(automation.result.current.map((target) => target.projectId)).toEqual([
      "unopened",
      "empty",
    ]),
  );
  expect(owner.prepareSession).not.toHaveBeenCalled();
  act(owner.notify);
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(2));
  expect(owner.prepareSession).not.toHaveBeenCalled();
});

it("Host 代际切换立即清空旧候选，旧异步结果不能回填新 Host", async () => {
  let finish!: (value: VirtualProject[]) => void;
  const old = services(vi.fn(async () => [project("old", ["/old"])]));
  state.services = old.service;
  const { result, rerender } = renderHook(() => useConfigWorkspaceTargets());
  await waitFor(() => expect(result.current[0]?.workspacePath).toBe("/old"));
  const next = services(
    vi.fn(
      () =>
        new Promise<VirtualProject[]>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  state.services = next.service;
  rerender();
  expect(result.current).toEqual([]);
  await waitFor(() => expect(typeof finish).toBe("function"));
  await act(async () => finish([project("next", ["/next"])]));
  await waitFor(() => expect(result.current[0]?.workspacePath).toBe("/next"));
  expect(old.dispose).toHaveBeenCalledTimes(1);
});

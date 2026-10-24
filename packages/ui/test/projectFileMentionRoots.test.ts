// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Emitter } from "@zcode/rpc";
import type { IServiceAccessor } from "@zcode/services";
import { useFileMentionProvider } from "@/mentions/providers/fileMentionProvider.js";

const scope = vi.hoisted(() => ({ services: null as unknown as IServiceAccessor }));
vi.mock("@/hooks/useServices.js", () => ({ useServices: () => scope.services }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({ services: scope.services, rpcReady: true }),
}));

let events: Emitter<{ channel: string }>;
let readProjects: ReturnType<typeof vi.fn>;
let resolveDirectories: ReturnType<typeof vi.fn>;
let searchFiles: ReturnType<typeof vi.fn>;

beforeEach(() => {
  events = new Emitter();
  readProjects = vi.fn(async () => [
    { id: "p", roots: [{ rootPath: "/main" }, { rootPath: "/second" }] },
  ]);
  resolveDirectories = vi.fn(async () => ({
    workspacePath: "/main",
    additionalDirectories: ["/second"],
    projectId: "p",
  }));
  searchFiles = vi.fn(async ({ rootPath }: { rootPath: string }) => [
    { name: "same.ts", path: `${rootPath}/src/same.ts`, relativePath: "src/same.ts", type: "file" },
  ]);
  scope.services = {
    projectService: { readProjects, resolveSessionDirectories: resolveDirectories },
    fileService: { searchWorkspaceFiles: searchFiles },
    broadcastService: { onMessage: events.event },
  } as unknown as IServiceAccessor;
});
afterEach(() => {
  cleanup();
  events.dispose();
  vi.clearAllMocks();
});

function provider(
  context?: { sessionId?: string | null; projectId?: string | null },
  query = "same",
  identity?: string,
) {
  return useFileMentionProvider("/main", identity, query, true, "Empty", "Files", 20, context);
}

it("ZUP：项目草稿搜索所有 roots，同名文件按绝对路径区分并展示来源", async () => {
  const { result } = renderHook(() => provider({ projectId: "p" }));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(searchFiles.mock.calls.map(([params]) => params.rootPath)).toEqual(["/main", "/second"]);
  expect(result.current.items.map((item) => item.id)).toEqual([
    "file:/main/src/same.ts",
    "file:/second/src/same.ts",
  ]);
  expect(result.current.items.map((item) => item.value)).toEqual([
    "src/same.ts",
    "/second/src/same.ts",
  ]);
  expect(result.current.items.map((item) => item.data?.rootName)).toEqual(["main", "second"]);
  expect(result.current.items[1].markdown).toContain("/second/src/same.ts");
});

it("ZUP：正式会话只按 Host 的 task 归属解析目录，不猜当前草稿项目", async () => {
  const { result } = renderHook(() =>
    provider({ sessionId: "task-a", projectId: "p" }, "same", "remote:fixture"),
  );
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(resolveDirectories).toHaveBeenCalledWith({
    taskId: "task-a",
    workspacePath: "/main",
    workspaceIdentity: "remote:fixture",
  });
  expect(readProjects).not.toHaveBeenCalled();
  expect(
    searchFiles.mock.calls.every(([params]) => params.workspaceIdentity === "remote:fixture"),
  ).toBe(true);
});

it("ZUP：项目 roots 与 cwd 去重，父子 root 重叠结果按真实文件路径去重", async () => {
  readProjects.mockResolvedValue([
    { id: "p", roots: [{ rootPath: "/main" }, { rootPath: "/main" }, { rootPath: "/main/src" }] },
  ]);
  searchFiles.mockImplementation(async () => [
    { name: "same.ts", path: "/main/src/same.ts", relativePath: "same.ts", type: "file" },
  ]);
  const { result } = renderHook(() => provider({ projectId: "p" }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items).toHaveLength(1);
  expect(searchFiles).toHaveBeenCalledTimes(2);
});

it("ZUP：项目不存在时明确失败，不静默缩成当前目录", async () => {
  readProjects.mockResolvedValue([]);
  const { result } = renderHook(() => provider({ projectId: "gone" }));
  await waitFor(() => expect(result.current.error?.message).toBe("project.not-found"));
  expect(searchFiles).not.toHaveBeenCalled();
});

it("ZUP：Host 目录解析失败不回退本地查询", async () => {
  resolveDirectories.mockRejectedValue(new Error("owner unavailable"));
  const { result } = renderHook(() => provider({ sessionId: "task-a" }));
  await waitFor(() => expect(result.current.error?.message).toBe("owner unavailable"));
  expect(searchFiles).not.toHaveBeenCalled();
});

it("ZUP：无项目无会话仍保持单目录，不能为文件提及创建项目或任务", async () => {
  const { result } = renderHook(() => provider());
  await waitFor(() => expect(result.current.items).toHaveLength(1));
  expect(readProjects).not.toHaveBeenCalled();
  expect(resolveDirectories).not.toHaveBeenCalled();
});

it("ZUP：项目编辑广播后重读 roots，不继续展示已移除目录", async () => {
  const { result } = renderHook(() => provider({ projectId: "p" }));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  readProjects.mockResolvedValue([{ id: "p", roots: [{ rootPath: "/third" }] }]);
  act(() => events.fire({ channel: "state:projects" }));
  await waitFor(() =>
    expect(result.current.items.map((item) => item.data?.rootName)).toEqual(["main", "third"]),
  );
});

it("ZUP：所有 roots 无命中时只补一次绕 TTL 刷新，并保持每个 root 的查询范围", async () => {
  searchFiles.mockResolvedValue([]);
  const { result } = renderHook(() => provider({ projectId: "p" }, "new-file"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(searchFiles).toHaveBeenCalledTimes(4);
  expect(
    searchFiles.mock.calls.slice(2).map(([params]) => [params.rootPath, params.refresh]),
  ).toEqual([
    ["/main", true],
    ["/second", true],
  ]);
});

it("ZUP：旧项目查询迟到不能覆盖切换后的同 cwd 项目结果", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  readProjects.mockImplementation(async () => [
    { id: "p", roots: [{ rootPath: "/old" }] },
    { id: "q", roots: [{ rootPath: "/new" }] },
  ]);
  searchFiles.mockImplementation(async ({ rootPath }: { rootPath: string }) => {
    if (rootPath === "/old") await pending;
    return [
      { name: "same.ts", path: `${rootPath}/same.ts`, relativePath: "same.ts", type: "file" },
    ];
  });
  const { result, rerender } = renderHook(({ projectId }) => provider({ projectId }), {
    initialProps: { projectId: "p" },
  });
  await waitFor(() =>
    expect(searchFiles.mock.calls.some(([params]) => params.rootPath === "/old")).toBe(true),
  );
  rerender({ projectId: "q" });
  await waitFor(() =>
    expect(result.current.items.map((item) => item.data?.rootName)).toEqual(["main", "new"]),
  );
  await act(async () => {
    release();
    await pending;
  });
  expect(result.current.items.map((item) => item.data?.rootName)).toEqual(["main", "new"]);
});

// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Emitter } from "@zcode/rpc";
import type { IServiceAccessor, ProjectTask, ProjectTree, VirtualProject } from "@zcode/services";
import { useSessionsMentionProvider } from "@/mentions/providers/sessionsMentionProvider.js";

const owner = vi.hoisted(() => ({ services: null as unknown as IServiceAccessor }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({
    services: owner.services,
    remoteSessionId: null,
    isRemoteTarget: false,
  }),
}));
let events: Emitter<{ channel: string }>;
let readTree: ReturnType<typeof vi.fn>;
let tree: ProjectTree;
const project = (id: string): VirtualProject => ({
  id,
  hostId: "local",
  name: `Project ${id}`,
  roots: [],
  nameOverridden: true,
  position: 0,
  pinned: false,
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
});
const task = (
  taskId: string,
  projectId: string | null,
  fields: Partial<ProjectTask> = {},
): ProjectTask => ({
  taskId,
  traceId: taskId,
  title: taskId,
  workspacePath: "/closed",
  hostId: "local",
  projectId,
  pinned: false,
  archived: false,
  mode: "default",
  createdAt: 1,
  updatedAt: 2,
  ...fields,
});
beforeEach(() => {
  events = new Emitter();
  tree = {
    projects: [project("p"), project("q")],
    tasks: [task("closed-p", "p"), task("unclassified", null)],
  };
  readTree = vi.fn(async () => tree);
  owner.services = {
    projectService: { readTree },
    broadcastService: { onMessage: events.event },
  } as unknown as IServiceAccessor;
});
afterEach(() => {
  cleanup();
  events.dispose();
  vi.clearAllMocks();
});
const provider = (query = "", currentOnly = false, enabled = true) =>
  useSessionsMentionProvider(
    "glm",
    "/cwd",
    undefined,
    query,
    enabled,
    currentOnly ? "current-workspace" : "same-authority-workspaces",
    "Empty",
    "Sessions",
    "Tasks",
  );

it("ZUP：未打开项目的任务也由当前 Host 查询，# 按项目与未归类分组", async () => {
  tree.projects[0].deleted = true;
  const { result } = renderHook(() => provider());
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  expect(readTree).toHaveBeenCalledWith({ includeDeleted: true });
  expect(
    result.current.groups?.map((group) => [group.title, group.items.map((item) => item.value)]),
  ).toEqual([
    ["Project p", ["closed-p"]],
    ["Tasks", ["unclassified"]],
  ]);
});

it("ZUP：先搜索所有项目任务再分别限制20条，旧任务仍可找到", async () => {
  tree.tasks = ["p", "q"].flatMap((id) =>
    Array.from({ length: 25 }, (_, index) =>
      task(`${id}-${index}`, id, { updatedAt: 100 - index }),
    ),
  );
  const { result, rerender } = renderHook(({ query }) => provider(query), {
    initialProps: { query: "" },
  });
  await waitFor(() => expect(result.current.items).toHaveLength(40));
  rerender({ query: "q-24" });
  await waitFor(() => expect(result.current.items.map((item) => item.value)).toEqual(["q-24"]));
});

it("ZUP：@ 会话候选保持 workspace identity 隔离，同物理路径不能混主机", async () => {
  tree.tasks = [
    task("local-task", "p", { workspacePath: "/cwd" }),
    task("remote-task", "q", { workspacePath: "/cwd", workspaceIdentity: "remote:fixture" }),
  ];
  const { result } = renderHook(() => provider("", true));
  await waitFor(() =>
    expect(result.current.items.map((item) => item.value)).toEqual(["local-task"]),
  );
  expect(result.current.groups).toBeUndefined();
});

it("ZUP：项目变更晚回不能抹掉新目录快照", async () => {
  let resolveOld!: (tree: ProjectTree) => void;
  readTree.mockImplementationOnce(
    () =>
      new Promise<ProjectTree>((resolve) => {
        resolveOld = resolve;
      }),
  );
  const { result } = renderHook(() => provider());
  await waitFor(() => expect(readTree).toHaveBeenCalledTimes(1));
  act(() => events.fire({ channel: "state:projects" }));
  await waitFor(() => expect(result.current.items).toHaveLength(2));
  await act(async () => {
    resolveOld({ projects: [], tasks: [] });
  });
  expect(result.current.items).toHaveLength(2);
});

it("ZUP：关闭面板不读项目，查询失败明确展示而非借本机列表兜底", async () => {
  const { result, rerender } = renderHook(({ enabled }) => provider("", false, enabled), {
    initialProps: { enabled: false },
  });
  expect(readTree).not.toHaveBeenCalled();
  readTree.mockRejectedValue(new Error("owner offline"));
  rerender({ enabled: true });
  await waitFor(() => expect(result.current.error?.message).toBe("owner offline"));
  expect(result.current.items).toEqual([]);
});

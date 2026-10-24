import { beforeEach, expect, it, vi } from "vitest";
const draft = vi.hoisted(() => ({ ensure: vi.fn() }));
vi.mock("@zcode/ui", () => ({ ensurePendingTaskDraft: draft.ensure }));
import { createWebRemoteControlProjectNavigation } from "../src/web-remote-control/app/projectDraftNavigation.js";
beforeEach(() => draft.ensure.mockReset());
function fixture() {
  const bridge = {
    bridgeSessionId: "bridge",
    bridgeGeneration: 1,
    kind: "local" as const,
    workspaceKey: "/host/project",
    workspacePath: "/host/project",
  };
  const openWorkspaceBridge = vi.fn(async () => ({ bridge, services: {} as never }));
  const renderRoot = vi.fn();
  const navigation = createWebRemoteControlProjectNavigation({
    deviceIdentity: "device-one",
    getWorkspaceKey: () => "/current",
    openWorkspaceBridge,
    renderRoot,
  });
  return { navigation, openWorkspaceBridge, renderRoot, bridge };
}
it("手机项目新建提交 Host project bridge admission；Root 收到实际目录及同一 projectId", async () => {
  const { navigation, openWorkspaceBridge, renderRoot, bridge } = fixture();
  await navigation.openProjectDraft({ projectId: "project", hostId: "local" });
  expect(openWorkspaceBridge).toHaveBeenCalledWith(
    "/current",
    expect.objectContaining({ project: { projectId: "project", hostId: "local" } }),
  );
  expect(renderRoot).toHaveBeenCalledWith(
    expect.objectContaining({
      bridge,
      initialTaskDraft: { projectId: "project", hostId: "local" },
      composerClientNamespace: "mobile:device-one",
      navigationIntent: "chat",
    }),
  );
  expect(draft.ensure).not.toHaveBeenCalled();
});
it("未归类草稿复用持久 draftId，并只由 Host 准备对应目录", async () => {
  draft.ensure.mockReturnValue({
    draftId: "11111111-1111-4111-8111-111111111111",
    workspacePath: "/previous",
  });
  const { navigation, openWorkspaceBridge } = fixture();
  await navigation.openProjectDraft({ projectId: null });
  expect(draft.ensure).toHaveBeenCalledWith({
    clientNamespace: "mobile:device-one",
    hostId: "local",
    projectId: null,
  });
  expect(openWorkspaceBridge).toHaveBeenCalledWith(
    "/current",
    expect.objectContaining({
      project: {
        projectId: null,
        draftId: "11111111-1111-4111-8111-111111111111",
        reuseDraft: true,
      },
    }),
  );
});
it("恢复/文件目标传完整 Host task 地址，不由手机 cwd 反推项目", async () => {
  const { navigation, openWorkspaceBridge, renderRoot } = fixture();
  await navigation.switchWorkspace("remote:server:source:/task-cwd", {
    taskId: "task",
    taskHostId: "remote:server:source",
    mobileNavigationIntent: "chat",
  });
  expect(openWorkspaceBridge).toHaveBeenCalledWith(
    "remote:server:source:/task-cwd",
    expect.objectContaining({ taskId: "task", taskHostId: "remote:server:source" }),
  );
  expect(renderRoot.mock.calls[0][0].initialTaskDraft).toBeUndefined();
});
it("准备失败保留原 Root；草稿换代后的迟到结果不挂载", async () => {
  const { navigation, openWorkspaceBridge, renderRoot, bridge } = fixture();
  openWorkspaceBridge.mockRejectedValueOnce(new Error("host offline"));
  await expect(navigation.openProjectDraft({ projectId: "project" })).rejects.toThrow(
    "host offline",
  );
  expect(renderRoot).not.toHaveBeenCalled();
  const pending = Promise.withResolvers<{ bridge: typeof bridge; services: never }>();
  openWorkspaceBridge.mockReturnValueOnce(pending.promise);
  let current = true;
  const opening = navigation.openProjectDraft({ projectId: "project", isCurrent: () => current });
  current = false;
  pending.resolve({ bridge, services: {} as never });
  await expect(opening).rejects.toThrow(/cancel|superseded/i);
  expect(renderRoot).not.toHaveBeenCalled();
});
it("同目录两个项目仍交付各自项目 ID，换 bridge 不改变稳定客户端 namespace", async () => {
  const { navigation, renderRoot } = fixture();
  await navigation.openProjectDraft({ projectId: "first" });
  await navigation.openProjectDraft({ projectId: "second" });
  expect(renderRoot.mock.calls.map(([props]) => props.initialTaskDraft.projectId)).toEqual([
    "first",
    "second",
  ]);
  expect(renderRoot.mock.calls.map(([props]) => props.composerClientNamespace)).toEqual([
    "mobile:device-one",
    "mobile:device-one",
  ]);
});

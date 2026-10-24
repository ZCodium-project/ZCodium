import { describe, expect, it, vi } from "vitest";
import { selectRemoteWorkspaceProjectFromDialog } from "@/root/useRemoteWorkspaceHistory.js";

const identity = "remote:server:source:/alias/project";
function fixture() {
  let bound = false;
  const target = { kind: "ssh" as const, host: "device.example", username: "dev" };
  const initial = { sessionId: "s", target, sourceServerId: "source", services: {} };
  const prepared = { ...initial, workspacePath: "/alias/project", workspaceIdentity: identity };
  const input = {
    canUseRemoteWorkspace: true,
    sessionId: "s",
    path: "/alias/project",
    loadingMessage: "loading",
    preparedWorkspaceIdentity: identity,
    isCurrent: vi.fn(async () => true),
    getRemoteWorkspaceSession: vi.fn(() => (bound ? prepared : initial)),
    getWorkspaceTabs: vi.fn(() => []),
    resolveRemoteWorkspaceCanonicalPath: vi.fn(async () => "/physical/project"),
    activateTabByPath: vi.fn(() => false),
    handleCancelRemoteProject: vi.fn(async () => {}),
    bindRemoteWorkspaceSessionContext: vi.fn(async () => {
      bound = true;
    }),
    commitRemoteWorkspaceSessionMutation: vi.fn(
      async (mutation: { entry: unknown }) => mutation.entry,
    ),
    getRemoteSessions: () => [],
    bindRemoteWorkspacePath: vi.fn(),
    bindRemoteWorkspaceIdentity: vi.fn(),
    addTab: vi.fn(),
    onWorkspaceActivated: vi.fn(),
    refreshPinnedTasks: vi.fn(async () => {}),
    refreshTimelineTasks: vi.fn(async () => {}),
  };
  return { input, prepared };
}
describe("prepared project navigation owner", () => {
  it("Host 已准备的 cwd/identity 不再 realpath，并等 bind ACK 后才保存和导航", async () => {
    const { input } = fixture();
    await selectRemoteWorkspaceProjectFromDialog(input as never);
    expect(input.resolveRemoteWorkspaceCanonicalPath).not.toHaveBeenCalled();
    expect(input.bindRemoteWorkspaceSessionContext).toHaveBeenCalledWith({
      sessionId: "s",
      workspacePath: "/alias/project",
      workspaceIdentity: identity,
    });
    expect(input.addTab).toHaveBeenCalledWith(
      "/alias/project",
      expect.objectContaining({ workspaceIdentity: identity }),
    );
    expect(input.bindRemoteWorkspaceSessionContext.mock.invocationCallOrder[0]).toBeLessThan(
      input.commitRemoteWorkspaceSessionMutation.mock.invocationCallOrder[0]!,
    );
  });
  it.each(["realpath", "bind", "persist"])(
    "%s 等待期间取消后，不提交后续阶段或导航",
    async (stage) => {
      const { input } = fixture();
      let current = true;
      input.isCurrent.mockImplementation(async () => current);
      const gate = Promise.withResolvers<void>();
      let reached!: () => void;
      const entered = new Promise<void>((resolve) => {
        reached = resolve;
      });
      if (stage === "realpath") {
        delete (input as { preparedWorkspaceIdentity?: string }).preparedWorkspaceIdentity;
        input.resolveRemoteWorkspaceCanonicalPath.mockImplementation(async () => {
          reached();
          await gate.promise;
          return "/alias/project";
        });
      } else if (stage === "bind") {
        const bind = input.bindRemoteWorkspaceSessionContext.getMockImplementation()!;
        input.bindRemoteWorkspaceSessionContext.mockImplementation(async () => {
          reached();
          await gate.promise;
          await bind();
        });
      } else {
        input.commitRemoteWorkspaceSessionMutation.mockImplementation(async (mutation) => {
          reached();
          await gate.promise;
          return mutation.entry;
        });
      }
      const navigation = selectRemoteWorkspaceProjectFromDialog(input as never);
      await entered;
      current = false;
      gate.resolve();
      await expect(navigation).rejects.toMatchObject({ code: "remote-connection-canceled" });
      expect(input.addTab).not.toHaveBeenCalled();
      expect(input.onWorkspaceActivated).not.toHaveBeenCalled();
      if (stage === "realpath")
        expect(input.bindRemoteWorkspaceSessionContext).not.toHaveBeenCalled();
      if (stage !== "persist")
        expect(input.commitRemoteWorkspaceSessionMutation).not.toHaveBeenCalled();
    },
  );
  it("prepared identity 与 Host bind 返回不一致时 fail closed，不持久化", async () => {
    const { input, prepared } = fixture();
    input.getRemoteWorkspaceSession.mockImplementation(() => ({
      ...prepared,
      workspaceIdentity: "remote:server:other:/alias/project",
    }));
    await expect(selectRemoteWorkspaceProjectFromDialog(input as never)).rejects.toThrow(
      /identity|scope/i,
    );
    expect(input.commitRemoteWorkspaceSessionMutation).not.toHaveBeenCalled();
    expect(input.addTab).not.toHaveBeenCalled();
  });
  it("复用已打开的同一 session 不能取消当前 attachment", async () => {
    const { input } = fixture();
    input.getWorkspaceTabs.mockReturnValue([
      {
        id: "tab",
        kind: "workspace",
        workspacePath: "/alias/project",
        workspaceIdentity: identity,
        remoteSessionId: "s",
      },
    ] as never);
    input.activateTabByPath.mockReturnValue(true);
    await selectRemoteWorkspaceProjectFromDialog(input as never);
    expect(input.handleCancelRemoteProject).not.toHaveBeenCalled();
  });

  it("绑定等待中 Source owner 换代时，旧请求拒绝导航但不能取消后来 owner", async () => {
    const { input, prepared } = fixture();
    input.bindRemoteWorkspaceSessionContext.mockImplementation(async () => {
      input.getRemoteWorkspaceSession.mockReturnValue({
        ...prepared,
        sourceServerId: "another-source",
      });
    });
    await expect(selectRemoteWorkspaceProjectFromDialog(input as never)).rejects.toThrow(
      /owner changed/,
    );
    expect(input.addTab).not.toHaveBeenCalled();
    expect(input.handleCancelRemoteProject).not.toHaveBeenCalled();
  });
});

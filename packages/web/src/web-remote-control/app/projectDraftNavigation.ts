import { ensurePendingTaskDraft } from "@zcode/ui";
import type {
  MobileProjectDraft,
  ProjectDraftNavigationPort,
  ProjectBridgeOpenOptions,
} from "../contracts/projectBridge.js";

/** 已配对的同一桥接 owner 交付新 Root；本模块不登录、不起 Agent、不消费 accepted 草稿。 */
export function createWebRemoteControlProjectNavigation(port: ProjectDraftNavigationPort) {
  if (!port.deviceIdentity.trim()) throw new Error("A stable target device identity is required");
  const composerClientNamespace = `mobile:${port.deviceIdentity}`;
  const assertCurrent = (isCurrent?: () => boolean) => {
    if (isCurrent?.() === false) throw new Error("Project navigation was cancelled or superseded");
  };
  return {
    async openProjectDraft(request: MobileProjectDraft) {
      assertCurrent(request.isCurrent);
      const projectId = request.projectId ?? null;
      const pending =
        !projectId && (!request.hostId || request.hostId === "local")
          ? ensurePendingTaskDraft({
              clientNamespace: composerClientNamespace,
              hostId: "local",
              projectId: null,
            })
          : null;
      const session = await port.openWorkspaceBridge(
        port.getWorkspaceKey() ?? "project-navigation",
        {
          project: {
            projectId,
            ...(request.hostId ? { hostId: request.hostId } : {}),
            ...(pending
              ? { draftId: pending.draftId, reuseDraft: Boolean(pending.workspacePath) }
              : {}),
          },
          isCurrent: request.isCurrent,
        },
      );
      assertCurrent(request.isCurrent);
      port.renderRoot({
        ...session,
        initialTaskDraft: {
          ...request,
          projectId,
          ...(pending ? { draftId: pending.draftId } : {}),
        },
        composerClientNamespace,
        navigationIntent: "chat",
      });
    },
    async switchWorkspace(workspaceKey: string, options?: ProjectBridgeOpenOptions) {
      assertCurrent(options?.isCurrent);
      const session = await port.openWorkspaceBridge(workspaceKey, options);
      assertCurrent(options?.isCurrent);
      port.renderRoot({
        ...session,
        composerClientNamespace,
        navigationIntent: options?.mobileNavigationIntent,
        initialSidebarFileTreeOpen: Boolean(options?.openFileManager || options?.fileTreeTaskId),
      });
    },
  };
}

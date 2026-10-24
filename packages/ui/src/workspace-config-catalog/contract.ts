import type { WorkspaceTabState } from "@/store/tabStore.js";
import type { VirtualProject, RemoteProjectDirectory } from "@zcode/services";
export {
  buildRemoteHostWorkspaceIdentity,
  buildRemoteWorkspaceIdentity,
  remoteTargetSchema,
  parseRemoteWorkspaceIdentity,
  resolveWorkspaceKey,
} from "@zcode/shared";
export type { IServiceAccessor } from "@zcode/services";
export type { VirtualProject, RemoteProjectDirectory };
export interface WorkflowRunProjectTask {
  taskId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  projectId: string | null;
  hostId: string;
}
export interface WorkflowRunProjectOrigin {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId?: string;
  projectId?: string | null;
  hostId?: string;
}

/** 配置目录地址不是 tab/session；连接信息只能复用已有 attachment。 */
export type ConfigWorkspaceTarget = Pick<
  WorkspaceTabState,
  | "workspacePath"
  | "workspaceIdentity"
  | "label"
  | "remoteSessionId"
  | "remoteTarget"
  | "localWorkspacePath"
  | "availability"
> & { hostId?: string; configOnline?: boolean };
export type {
  ProjectCatalogPort as ConfigCatalogPort,
  ProjectCatalogSnapshot as ConfigCatalogSnapshot,
} from "@zcode/services";

import {
  buildRemoteHostWorkspaceIdentity,
  resolveWorkspaceKey,
  type WorkflowRunProjectTask,
  type WorkflowRunProjectOrigin,
  type ConfigCatalogSnapshot,
  type ConfigWorkspaceTarget,
} from "./contract.js";

export { readProjectCatalog as readConfigCatalog } from "@zcode/services";

/** 父会话归属来自现有 Host 树；同 cwd 的多个虚拟项目不能按目录反查。 */
export function resolveWorkflowRunProjectOwnership(
  host: WorkflowRunProjectOrigin,
  tasks: readonly WorkflowRunProjectTask[],
): { projectId: string | null; hostId?: string } {
  if (host.projectId !== undefined)
    return { projectId: host.projectId, ...(host.hostId ? { hostId: host.hostId } : {}) };
  const task = host.sessionId
    ? tasks.find(
        (candidate) =>
          candidate.taskId === host.sessionId &&
          resolveWorkspaceKey(candidate) === resolveWorkspaceKey(host),
      )
    : undefined;
  return task ? { projectId: task.projectId, hostId: task.hostId } : { projectId: null };
}

export function projectConfigTargets(
  snapshot: ConfigCatalogSnapshot,
  existing: readonly ConfigWorkspaceTarget[],
): ConfigWorkspaceTarget[] {
  const hosts = new Map(snapshot.directory.hosts.map((host) => [host.id, host]));
  const targets = new Map<string, ConfigWorkspaceTarget>();
  for (const project of snapshot.projects) {
    if (project.deleted) continue;
    const foreign = hosts.get(project.hostId);
    for (const root of project.roots) {
      const identity = foreign
        ? buildRemoteHostWorkspaceIdentity(project.hostId, root.rootPath)
        : undefined;
      const key = identity || root.rootPath;
      if (targets.has(key)) continue;
      const connection = existing.find(
        (target) => (target.workspaceIdentity?.trim() || target.workspacePath) === key,
      );
      const normalizedPath = root.rootPath.replace(/\\/g, "/").replace(/\/$/, "");
      targets.set(key, {
        workspacePath: root.rootPath,
        workspaceIdentity: identity,
        hostId: project.hostId,
        label: normalizedPath.split("/").pop() || root.rootPath,
        ...(foreign
          ? {
              configOnline: foreign.connectionStatus === "online",
              ...(foreign.target ? { remoteTarget: foreign.target } : {}),
            }
          : {}),
        ...(connection
          ? {
              remoteSessionId: connection.remoteSessionId,
              ...(connection.remoteTarget ? { remoteTarget: connection.remoteTarget } : {}),
              localWorkspacePath: connection.localWorkspacePath,
              availability: connection.availability,
            }
          : {}),
      });
    }
  }
  return [...targets.values()];
}

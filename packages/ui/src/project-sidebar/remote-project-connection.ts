import type { IRemoteProjectService, RemoteProjectDirectory } from "@/project-sidebar/contract.js";
import {
  buildRemoteHostWorkspaceIdentity,
  buildServerRemoteWorkspaceIdentity,
} from "@/project-sidebar/contract.js";
import type { SourceServerManagementSnapshot } from "@zcode/shared";
import type { RemoteConnectionOpenPreference } from "@/app-shell/types.js";
import { getWorkspaceSourceServerId } from "@/conversation-workspace-target/sourceIdentity.js";
import { resolveRemoteConnectionPresentation } from "@/lib/remoteConnectionPresentation.js";

/** 最近目录不是新建请求；连接前固定已有入口，避免连接完成后误入创建器。 */
export function resolveRecentRemoteProjectPreference(
  directory: RemoteProjectDirectory,
  input: { sourceServerId: string; path: string; profileId?: string },
): RemoteConnectionOpenPreference | null {
  const identity = buildServerRemoteWorkspaceIdentity({
    serverId: input.sourceServerId,
    workspacePath: input.path,
  });
  const entries = directory.entries.filter(
    (entry) =>
      directory.hosts.some((host) => host.id === entry.hostId) &&
      [...entry.roots.map((root) => root.rootPath), entry.legacyWorkspace?.workspacePath].some(
        (path) => path && buildRemoteHostWorkspaceIdentity(entry.hostId, path) === identity,
      ),
  );
  if (entries.length !== 1) return null;
  return {
    ...(input.profileId
      ? { preferredProfileId: input.profileId }
      : { preferredSourceServerId: input.sourceServerId }),
    preferredDirectoryPath: input.path,
    preferredProjectEntryId: entries[0]!.id,
  };
}

/** F5 下项目成员不等于已打开 tab；连接成员仍交给 Host，需要交互才移交唯一向导。 */
export async function requestRetainedRemoteProjectConnection(input: {
  workspaceKey: string;
  service: IRemoteProjectService;
  getSnapshot?: () => Promise<SourceServerManagementSnapshot>;
  openWizard: (preference: RemoteConnectionOpenPreference) => void;
}) {
  const directory = await input.service.readDirectory();
  const pathForEntry = (entry: (typeof directory.entries)[number]) =>
    entry.roots.find(
      (root) =>
        buildRemoteHostWorkspaceIdentity(entry.hostId, root.rootPath) === input.workspaceKey,
    )?.rootPath ??
    (entry.legacyWorkspace &&
    buildRemoteHostWorkspaceIdentity(entry.hostId, entry.legacyWorkspace.workspacePath) ===
      input.workspaceKey
      ? entry.legacyWorkspace.workspacePath
      : undefined);
  const entry = directory.entries.find((candidate) => pathForEntry(candidate));
  const host = directory.hosts.find((candidate) => candidate.id === entry?.hostId);
  const path = entry && pathForEntry(entry);
  if (!entry || !host || !path) throw new Error("remote-project.entry-not-found");
  // Direct Server 不属于 Source Profile 管理域，保留其原有连接与错误出口。
  if (host.kind === "server") {
    await input.service.connectHost(host.id);
    return;
  }
  const stillRetained = async () => {
    const current = await input.service.readDirectory();
    return (
      current.hosts.some(
        (candidate) => candidate.id === host.id && candidate.membershipId === host.membershipId,
      ) &&
      current.entries.some(
        (candidate) => candidate.id === entry.id && pathForEntry(candidate) === path,
      )
    );
  };
  const snapshot = await input.getSnapshot?.();
  if (!(await stillRetained())) return;
  const sourceId = getWorkspaceSourceServerId(
    {
      workspacePath: path,
      workspaceIdentity: input.workspaceKey,
      remoteTarget: host.target ?? undefined,
    },
    { workspaceHistory: snapshot?.workspaceHistory },
  );
  // 展示聚合会优先选失败/待处理线路，不能据此替换 Host 的默认操作线路。
  const server = snapshot?.servers.find((candidate) => candidate.sourceServerId === sourceId);
  const profiles =
    snapshot?.profiles.filter(
      (candidate) =>
        candidate.sourceServerId === sourceId && candidate.lifecycleState !== "retired",
    ) ?? [];
  const profile =
    profiles.find((candidate) => candidate.profileId === server?.preferredProfileId) ?? profiles[0];
  const state = snapshot?.states.find((candidate) => candidate.profileId === profile?.profileId);
  const preference: RemoteConnectionOpenPreference = {
    preferredDirectoryPath: path,
    preferredProjectEntryId: entry.id,
    preferredProfileId: profile?.profileId,
    preferredTarget: profile?.target ?? host.target ?? undefined,
  };
  const presentation = resolveRemoteConnectionPresentation({
    ...state,
    installState: server?.installState,
    // Host 错误也是设备聚合；已确定操作线路时只能使用该线路的错误。
    projectError: profile ? undefined : host.lastConnectionError,
  });
  const failure = {
    code: state?.errorCode,
    message: state?.error ?? (profile ? "" : (host.lastConnectionError ?? "")),
  };
  // Root/SSH 仍是唯一交互 owner：展示态只决定是否移交，不启动另一份连接 flow。
  if (presentation.status === "failed" || presentation.status === "pending") {
    if (await stillRetained()) input.openWizard({ ...preference, initialFailure: failure });
    return;
  }
  try {
    await input.service.connectHost(host.id);
  } catch (cause) {
    if (await stillRetained())
      input.openWizard({
        ...preference,
        initialFailure: {
          message: String(cause),
          ...(cause && typeof cause === "object" && "code" in cause
            ? { code: String(cause.code) }
            : {}),
        },
      });
  }
}

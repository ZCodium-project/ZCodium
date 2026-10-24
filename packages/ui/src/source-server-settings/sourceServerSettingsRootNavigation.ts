import {
  buildServerRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  stripRemoteTargetSecrets,
} from "@zcode/shared";
import type { SourceServerSettingsNavigation, SourceServerSettingsRootPorts } from "./contract.js";

/** Root 的薄适配端口：连接事实归管理服务，只有明确目录/项目选择才进入原导航 owner。 */
export function createSourceServerSettingsNavigation(
  ports: SourceServerSettingsRootPorts,
): SourceServerSettingsNavigation {
  let sequence = 0;
  const open = async (
    sourceServerId: string,
    path?: string,
    profileId?: string,
    current?: () => boolean,
  ) => {
    const request = ++sequence;
    const isCurrent = () => request === sequence && ports.isCurrent() && current?.() !== false;
    if (!isCurrent()) return;
    const snapshot = await ports.management.getSnapshot();
    if (!isCurrent()) return;
    const source = snapshot.servers.find((item) => item.sourceServerId === sourceServerId);
    const profile =
      snapshot.profiles.find(
        (item) =>
          item.sourceServerId === sourceServerId &&
          item.lifecycleState !== "retired" &&
          item.profileId === (profileId ?? source?.preferredProfileId),
      ) ??
      (!profileId
        ? snapshot.profiles.find(
            (item) => item.sourceServerId === sourceServerId && item.lifecycleState !== "retired",
          )
        : undefined);
    if (!source || !profile) throw new Error("project.connection-unavailable");
    const connected = await ports.management.connectProfile(profile.profileId);
    if (!isCurrent()) return;
    if (
      !connected.states.some(
        (state) => state.sourceServerId === sourceServerId && state.state === "online",
      )
    )
      throw new Error("project.host-offline");
    const hostId = remoteHostIdFromWorkspaceIdentity(
      buildServerRemoteWorkspaceIdentity({ serverId: sourceServerId, workspacePath: "/" }),
    );
    if (!hostId) throw new Error("project.host-identity-required");
    // #79：历史目录没有 projectId，不能按 cwd 任意挑同目录项目。用户显式打开设备时
    // 只保存连接入口，随后交给同一个项目选择器；不提前创建项目、任务或独立运行时。
    const host = await ports.remote.saveHost({
      id: hostId,
      target: stripRemoteTargetSecrets(profile.target),
    });
    if (!isCurrent()) return;
    const selectedPath = path ?? (await ports.projects.readDirectory({ hostId })).path;
    if (isCurrent()) ports.openProjectPicker({ host, path: selectedPath });
  };
  return {
    onCreateConnection() {
      sequence++;
      ports.openConnection();
    },
    async onConnectProfile(profileId) {
      await ports.management.connectProfile(profileId);
    },
    async onDisconnectSource(sourceServerId) {
      await ports.management.disconnectSource(sourceServerId);
    },
    onOpenProject: (sourceServerId, path, profileId, current) =>
      open(sourceServerId, path, profileId, current),
    onShowInSidebar(sourceServerId, current) {
      void open(sourceServerId, undefined, undefined, current).catch((error) => {
        if (ports.isCurrent() && current?.() !== false) ports.reportError(error);
      });
    },
  };
}

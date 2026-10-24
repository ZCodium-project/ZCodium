import type {
  AppSettings,
  SourceServerManagementSnapshot,
  SourceServerUpdateTarget,
} from "@zcode/shared";
import type { ISourceServerManagementService } from "@zcode/services";

export type {
  AppSettings,
  ConnectionProfile,
  SourceServerRecord,
  SourceServerManagementSnapshot,
  SourceServerConnectionStateSnapshot,
  SourceServerMigrationReport,
  SourceServerMigrationReportRow,
  SourceServerOperationLog,
  SourceServerUpdateTarget,
  RemoteTarget,
  RemoteAssetInstallMode,
  SourceServerProfileTarget,
} from "@zcode/shared";
export {
  DEFAULT_REMOTE_ASSET_INSTALL_MODE,
  DesktopCommandIds,
  SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE,
  isValidWslUser,
  resolveWorkspaceKey,
  getSourceServerUpdateTarget,
} from "@zcode/shared";
export type { ISourceServerManagementService, UpdateConnectionProfileInput } from "@zcode/services";

/** 连接及导航继续归属同窗口既有 owner；面板不直接创建 attachment。 */
export interface SourceServerSettingsNavigation {
  onCreateConnection?: () => void;
  onConnectProfile?: (profileId: string) => Promise<void> | void;
  onDisconnectSource?: (sourceServerId: string) => Promise<void>;
  onOpenProject?: (
    sourceServerId: string,
    path: string,
    profileId?: string,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  onShowInSidebar?: (sourceServerId: string, isCurrent?: () => boolean) => void;
  onShowUpdateDetails?: (sourceServerId: string) => void;
  targetSourceServerId?: string;
  targetSourceServerDetails?: boolean;
  onTargetSourceServerFocused?: () => void;
}

export interface SourceServerSettingsRootPorts {
  management: ISourceServerManagementService;
  projects: import("@zcode/services").IProjectService;
  remote: import("@zcode/services").IRemoteProjectService;
  isCurrent(): boolean;
  openConnection(): void;
  openProjectPicker(input: {
    host: import("@zcode/services").RemoteProjectHost;
    path: string;
  }): void;
  reportError(error: unknown): void;
}

export interface SourceServerManagementPanelProps extends SourceServerSettingsNavigation {
  settings?: Pick<
    AppSettings,
    "remoteStartupAutoReconnectEnabled" | "remoteConversationWorkspaceBySourceServerId"
  > | null;
  onUpdateSettings?: (patch: Partial<AppSettings>) => Promise<unknown> | void;
}

export interface SourceServerUpdateAction {
  management: Pick<ISourceServerManagementService, "updateSource">;
  profileId: string;
  expectedTarget?: SourceServerUpdateTarget;
  confirmForce: () => Promise<boolean>;
}
export type SourceServerUpdateResult = SourceServerManagementSnapshot | null;

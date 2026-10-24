# ZUP10 待主代理收口的国际化键

本模块不修改 i18n。下列消息除最后两项新增键外均可取固定上游三个 locale 的同名文本；另需保留本仓已有的 `remote.runtime.*`。`remote.*` 的状态、错误、阶段文案由 A 的 presentation/connection-flow 同步。

```text
settings.remoteDevicesDescription
settings.remoteDevicesTitle
settings.source.abandonMigration
settings.source.abandonMigrationDescription
settings.source.abandonMigrationTitle
settings.source.connectionHistoryNeedsAttention
settings.source.connectionName
settings.source.connectionNameRequired
settings.source.connectionPreferences
settings.source.defaultProfile
settings.source.deviceName
settings.source.deviceNameRequired
settings.source.editConnection
settings.source.editConnectionDescription
settings.source.editConnectionTitle
settings.source.empty
settings.source.forceUpdate
settings.source.forceUpdateDescription
settings.source.forceUpdateTitle
settings.source.hideMigrationReport
settings.source.identityChangeConfirm
settings.source.identityChangeDescription
settings.source.identityChangeTitle
settings.source.info.deviceId
settings.source.info.hostname
settings.source.info.osUser
settings.source.info.version
settings.source.keepSavedSecret
settings.source.lastOnline
settings.source.migrationDetailUnavailable
settings.source.migrationMergedHistory
settings.source.migrationPhase.aliasPublished
settings.source.migrationPhase.backupsCreated
settings.source.migrationPhase.completed
settings.source.migrationPhase.configDirsMerged
settings.source.migrationPhase.preflight
settings.source.migrationPhase.sessionDbMerged
settings.source.migrationPhase.taskDbMerged
settings.source.migrationStatus.abandoned
settings.source.migrationStatus.abandonedDiverged
settings.source.migrationStatus.completed
settings.source.migrationStatus.failed
settings.source.migrationStatus.running
settings.source.newConnection
settings.source.noMigrationIssues
settings.source.noOpenProjects
settings.source.operationFailed
settings.source.otherSavedConnectionsCount
settings.source.recentLog
settings.source.recentProjects
settings.source.removeOpenProjects
settings.source.removeProfile
settings.source.removeProfileDescription
settings.source.removeProfileTitle
settings.source.removeSourceServer
settings.source.removeSourceServerDescription
settings.source.retiredNameSuffix
settings.source.retiredProfilesDescription
settings.source.retiredProfilesWithCount
settings.source.retryMigration
settings.source.setDefault
settings.source.showAllProjects
settings.source.showInSidebar
settings.source.showLessProjects
settings.source.showMigrationReport
settings.source.startupAutoReconnect
settings.source.startupAutoReconnectDescription
settings.source.unfinishedConnections
settings.source.updateAvailableVersion
settings.source.updateInProgress
settings.source.updateLog
settings.source.updateLogWaiting
settings.source.updatePhase.checking
settings.source.updatePhase.completed
settings.source.updatePhase.downloading
settings.source.updatePhase.installing
settings.source.updatePhase.preparing
settings.source.updatePhase.reconnecting
settings.source.updatePhase.uploading
settings.source.updateProgress
settings.source.updateRequired
settings.source.versionDetails
sourceServer.updateCompletedToast
sourceServer.updateFailedToast
```

错误码映射也依赖上游 `settings.source.error.*`（按公开错误码动态读取，不把 Host 原始错误变成顶层用户文案）。

新增键建议：

- `settings.source.invalidPort`：端口必须是 1 到 65535 之间的整数。 / Port must be an integer between 1 and 65535.
- `settings.source.unavailable`：此平台暂不提供本机设备管理。 / Local device management is unavailable on this platform.

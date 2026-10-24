import { useState } from "react";
import { ChevronRight, FileWarning, Folder, Pencil, Server, Trash2 } from "lucide-react";
import type {
  ConnectionProfile,
  SourceServerRecord,
  SourceServerManagementSnapshot,
  SourceServerMigrationReport,
  SourceServerOperationLog,
  SourceServerManagementPanelProps,
} from "./contract.js";
import { resolveWorkspaceKey } from "./contract.js";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getPathLeaf } from "@/lib/path.js";
import {
  resolveRemoteConnectionPresentation,
  getRemoteDevicePresentationInput,
  type RemoteConnectionPresentation,
} from "@/lib/remoteConnectionPresentation.js";
import {
  formatConnectionProfileTarget,
  RemoteConnectionKindTag,
  RemoteConnectionStatusTag,
} from "@/remote-connection/RemoteConnectionTags.js";
import { SourceServerUpdateActivity } from "./SourceServerUpdateActivity.js";
import { SourceServerMigrationReportPanel } from "./SourceServerMigrationReportPanel.js";
import { cn } from "@/components/lib/utils.js";

export interface DeviceCardActions {
  edit: (
    profile: ConnectionProfile,
    source?: SourceServerRecord,
    focusField?: "host" | "auth",
  ) => void;
  profileAction: (
    profile: ConnectionProfile,
    presentation: RemoteConnectionPresentation,
    source?: SourceServerRecord,
  ) => void;
  confirmIdentity: (profile: ConnectionProfile) => void;
  removeProfile: (profile: ConnectionProfile) => void;
  removeSource: (source: SourceServerRecord) => void;
  setPreferred: (sourceId: string, profileId: string) => void;
  update: (profile: ConnectionProfile) => void;
  showReport: (sourceId: string) => void;
  retry: (sourceId: string, path: string, migrationId: string) => void;
  abandon: (sourceId: string, path: string, migrationId: string) => void;
}

export function SourceServerProfileRow({
  profile,
  source,
  snapshot,
  busy,
  actions,
  canConnect,
}: {
  profile: ConnectionProfile;
  source?: SourceServerRecord;
  snapshot: SourceServerManagementSnapshot;
  busy: boolean;
  actions: DeviceCardActions;
  canConnect: boolean;
}) {
  const { intl } = useZCodeIntl();
  const state = snapshot.states.find((item) => item.profileId === profile.profileId);
  const presentation = resolveRemoteConnectionPresentation({ ...state, target: profile.target });
  const identity = state?.state === "identity-change-pending";
  const actionAllowed =
    !["none", "disconnect"].includes(presentation.primaryAction) &&
    (canConnect ||
      ["details", "security", "edit-auth", "edit-host", "credentials", "update-server"].includes(
        presentation.primaryAction,
      ));
  return (
    <div
      data-connection-profile={profile.profileId}
      className="flex min-w-0 flex-wrap items-center gap-2 py-2 text-ui-sm"
    >
      <RemoteConnectionKindTag kind={profile.transport} />
      <span className="font-medium">{profile.displayName ?? profile.transport}</span>
      {!source ? <RemoteConnectionStatusTag presentation={presentation} /> : null}
      <span className="min-w-0 break-all font-mono text-remote-foreground-muted">
        {formatConnectionProfileTarget(profile)}
      </span>
      {source?.preferredProfileId === profile.profileId ? (
        <span className="rounded-md bg-tag px-1.5 py-0.5 text-ui-xs">
          {intl.formatMessage({ id: "settings.source.defaultProfile" })}
        </span>
      ) : null}
      <span className="ml-auto flex flex-wrap gap-1">
        {identity ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => actions.confirmIdentity(profile)}
          >
            {intl.formatMessage({ id: "settings.source.identityChangeConfirm" })}
          </Button>
        ) : actionAllowed ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy || presentation.status === "connecting"}
            onClick={() => actions.profileAction(profile, presentation, source)}
          >
            {intl.formatMessage({ id: presentation.actionMessageId })}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => actions.edit(profile, source)}
        >
          <Pencil className="size-3.5" />
          {intl.formatMessage({ id: "settings.source.editConnection" })}
        </Button>
        {source && source.preferredProfileId !== profile.profileId ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => actions.setPreferred(source.sourceServerId, profile.profileId)}
          >
            {intl.formatMessage({ id: "settings.source.setDefault" })}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={busy}
          onClick={() => actions.removeProfile(profile)}
        >
          <Trash2 className="size-3.5" />
          {intl.formatMessage({ id: "settings.source.removeProfile" })}
        </Button>
      </span>
    </div>
  );
}

export function SourceServerDeviceCard({
  source,
  snapshot,
  busy,
  actions,
  logsByProfileId,
  report,
  navigation,
  remoteConversationWorkspacePath,
  background,
}: {
  source: SourceServerRecord;
  snapshot: SourceServerManagementSnapshot;
  busy: boolean;
  actions: DeviceCardActions;
  logsByProfileId: Record<string, SourceServerOperationLog[]>;
  report?: SourceServerMigrationReport;
  navigation: SourceServerManagementPanelProps;
  remoteConversationWorkspacePath?: string;
  background?: React.ReactNode;
}) {
  const { intl, locale } = useZCodeIntl();
  const [expandedProjects, setExpandedProjects] = useState(false);
  const profiles = snapshot.profiles.filter(
    (profile) =>
      profile.sourceServerId === source.sourceServerId && profile.lifecycleState !== "retired",
  );
  const presentation = resolveRemoteConnectionPresentation(
    getRemoteDevicePresentationInput(snapshot, source.sourceServerId),
  );
  const preferred =
    profiles.find((profile) => profile.profileId === source.preferredProfileId) ?? profiles[0];
  const actionProfile =
    profiles.find((profile) => profile.profileId === presentation.profileId) ?? preferred;
  const current =
    profiles.find((profile) =>
      snapshot.states.some(
        (state) => state.profileId === profile.profileId && state.state === "online",
      ),
    ) ?? preferred;
  const identityProfiles = profiles.filter((profile) =>
    snapshot.states.some(
      (state) => state.profileId === profile.profileId && state.state === "identity-change-pending",
    ),
  );
  const updateState =
    snapshot.states.find(
      (state) =>
        profiles.some((profile) => profile.profileId === state.profileId) &&
        state.state === "updating",
    ) ??
    snapshot.states.find(
      (state) =>
        profiles.some((profile) => profile.profileId === state.profileId) &&
        state.updateAvailability &&
        state.updateAvailability !== "none",
    );
  const logs = logsByProfileId[updateState?.profileId ?? actionProfile?.profileId ?? ""] ?? [];
  const history = new Map<string, SourceServerManagementSnapshot["workspaceHistory"][number]>();
  for (const entry of snapshot.workspaceHistory) {
    if (
      entry.sourceServerId !== source.sourceServerId ||
      entry.workspacePath === remoteConversationWorkspacePath
    )
      continue;
    const key = resolveWorkspaceKey(entry);
    if (!history.has(key) || history.get(key)!.lastOpenedAt < entry.lastOpenedAt)
      history.set(key, entry);
  }
  const migrationCount = snapshot.migrationCounts.find(
    (count) => count.sourceServerId === source.sourceServerId,
  );
  const migrationNeedsAttention =
    migrationCount?.status === "available" &&
    migrationCount.failedPathCount + migrationCount.abandonedPathCount > 0;
  const projects = [...history.values()].sort(
    (left, right) => right.lastOpenedAt - left.lastOpenedAt,
  );
  const canPrimary =
    presentation.primaryAction === "disconnect"
      ? Boolean(navigation.onDisconnectSource)
      : ["connect", "retry", "install"].includes(presentation.primaryAction)
        ? Boolean(navigation.onConnectProfile)
        : true;
  return (
    <section
      data-source-server-card={source.sourceServerId}
      tabIndex={-1}
      className="min-w-0 overflow-hidden rounded-xl border border-card-border bg-card"
    >
      {background}
      <div className="space-y-3 p-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Server className="size-4 shrink-0 text-remote-foreground-muted" />
          <h3 className="min-w-0 break-words text-ui-base font-medium">{source.displayName}</h3>
          <RemoteConnectionStatusTag presentation={presentation} />
          <span className="ml-auto flex flex-wrap gap-1">
            {actionProfile && presentation.primaryAction !== "none" && canPrimary ? (
              <Button
                type="button"
                variant={presentation.primaryAction === "disconnect" ? "ghost" : "outline"}
                size="sm"
                disabled={busy || presentation.status === "connecting"}
                onClick={() =>
                  presentation.primaryAction === "confirm-identity"
                    ? actions.confirmIdentity(actionProfile)
                    : actions.profileAction(actionProfile, presentation, source)
                }
              >
                {intl.formatMessage({ id: presentation.actionMessageId })}
              </Button>
            ) : null}
            {current ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => actions.edit(current, source)}
              >
                <Pencil className="size-3.5" />
                {intl.formatMessage({ id: "settings.source.editConnection" })}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => actions.removeSource(source)}
            >
              <Trash2 className="size-3.5" />
              {intl.formatMessage({ id: "settings.source.removeSourceServer" })}
            </Button>
          </span>
        </div>
        {current ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-ui-sm text-remote-foreground-muted">
            <RemoteConnectionKindTag kind={current.transport} />
            <span className="min-w-0 break-all font-mono">
              {formatConnectionProfileTarget(current)}
            </span>
            {source.lastSeenVersion ? (
              <span>v{source.lastSeenVersion.replace(/^v/i, "")}</span>
            ) : null}
          </div>
        ) : null}
        {presentation.reason ? (
          <p
            role="status"
            className={cn(
              "rounded-lg px-3 py-2 text-ui-sm",
              presentation.surface,
              presentation.foreground,
            )}
          >
            {intl.formatMessage({ id: presentation.reason.titleId }, presentation.reason.values)}
          </p>
        ) : null}
        {updateState ? (
          <div
            className={cn(
              "space-y-2 rounded-lg p-3 text-ui-sm",
              updateState.state === "failed"
                ? "bg-destructive-surface text-destructive-surface-foreground"
                : updateState.state === "updating"
                  ? "bg-progress-surface text-progress-surface-foreground"
                  : "bg-warning-surface text-warning-surface-foreground",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {intl.formatMessage(
                  {
                    id:
                      updateState.state === "updating"
                        ? "settings.source.updateInProgress"
                        : updateState.state === "failed"
                          ? "settings.source.operationFailed"
                          : updateState.updateAvailability === "required"
                            ? "settings.source.updateRequired"
                            : "settings.source.updateAvailableVersion",
                  },
                  { version: updateState.availableVersion?.replace(/^v/i, "") ?? "" },
                )}
              </span>
              {updateState.state !== "updating" &&
              actionProfile &&
              presentation.primaryAction !== "update-desktop" ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    const profile = profiles.find(
                      (candidate) => candidate.profileId === updateState.profileId,
                    );
                    if (profile) actions.update(profile);
                  }}
                >
                  {intl.formatMessage({
                    id:
                      updateState.state === "failed"
                        ? "remote.action.retry"
                        : "remote.action.update-server",
                  })}
                </Button>
              ) : null}
            </div>
            {updateState.currentVersion && updateState.minimumVersion ? (
              <p className="text-ui-xs">
                {intl.formatMessage(
                  { id: "settings.source.versionDetails" },
                  { current: updateState.currentVersion, minimum: updateState.minimumVersion },
                )}
              </p>
            ) : null}
            {updateState.state === "updating" ? (
              <SourceServerUpdateActivity active logs={logs} />
            ) : null}
          </div>
        ) : null}
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-ui-sm text-remote-foreground-muted">
              {intl.formatMessage({ id: "settings.source.recentProjects" })} · {projects.length}
            </p>
            {projects.length > 3 ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={expandedProjects}
                onClick={() => setExpandedProjects((currentValue) => !currentValue)}
              >
                {intl.formatMessage(
                  {
                    id: expandedProjects
                      ? "settings.source.showLessProjects"
                      : "settings.source.showAllProjects",
                  },
                  { count: projects.length },
                )}
              </Button>
            ) : null}
          </div>
          {(expandedProjects ? projects : projects.slice(0, 3)).map((project) => (
            <Button
              key={resolveWorkspaceKey(project)}
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto w-full min-w-0 justify-start py-1.5 text-left"
              disabled={busy || !navigation.onOpenProject}
              onClick={() =>
                void navigation.onOpenProject?.(
                  source.sourceServerId,
                  project.workspacePath,
                  current?.profileId,
                )
              }
            >
              <Folder className="size-3.5 shrink-0" />
              <span className="truncate">
                {source.declaredWorkspaces?.find(
                  (item) => item.workspacePath === project.workspacePath,
                )?.label ?? getPathLeaf(project.workspacePath)}
              </span>
              <span className="min-w-0 truncate font-mono text-ui-xs text-remote-foreground-muted">
                {project.workspacePath}
              </span>
            </Button>
          ))}
        </div>
        {identityProfiles.map((profile) => (
          <SourceServerProfileRow
            key={profile.profileId}
            profile={profile}
            source={source}
            snapshot={snapshot}
            busy={busy}
            actions={actions}
            canConnect={Boolean(navigation.onConnectProfile)}
          />
        ))}
        <details className="border-t border-border pt-2">
          <summary className="cursor-pointer text-ui-sm text-remote-foreground-muted">
            {intl.formatMessage(
              { id: "settings.source.otherSavedConnectionsCount" },
              { count: profiles.length },
            )}
          </summary>
          {profiles
            .filter((profile) => !identityProfiles.includes(profile))
            .map((profile) => (
              <SourceServerProfileRow
                key={profile.profileId}
                profile={profile}
                source={source}
                snapshot={snapshot}
                busy={busy}
                actions={actions}
                canConnect={Boolean(navigation.onConnectProfile)}
              />
            ))}
        </details>
        {logs.length > 0 && updateState?.state !== "updating" ? (
          <SourceServerUpdateActivity active={false} recent logs={logs} />
        ) : null}
        <details className="text-ui-sm text-remote-foreground-muted">
          <summary className="cursor-pointer">
            {intl.formatMessage({ id: "remote.error.details" })}
          </summary>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
            {[
              ["version", source.lastSeenVersion],
              ["hostname", source.hostname],
              ["osUser", source.osUser],
              ["deviceId", source.sourceServerId],
            ].map(([key, value]) => (
              <div key={key} className="contents">
                <dt>{intl.formatMessage({ id: `settings.source.info.${key}` })}</dt>
                <dd className="min-w-0 select-text break-all font-mono">
                  {value ?? intl.formatMessage({ id: "remote.infoUnavailable" })}
                </dd>
              </div>
            ))}
          </dl>
          {source.lastOnlineAt ? (
            <p className="mt-2">
              {intl.formatMessage(
                { id: "settings.source.lastOnline" },
                { time: new Date(source.lastOnlineAt).toLocaleString(locale) },
              )}
            </p>
          ) : null}
        </details>
        <div className="border-t border-border pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-expanded={Boolean(report)}
            onClick={() => actions.showReport(source.sourceServerId)}
          >
            <ChevronRight className={cn("size-3.5", report && "rotate-90")} />
            <FileWarning className="size-3.5" />
            {intl.formatMessage({
              id: migrationNeedsAttention
                ? "settings.source.connectionHistoryNeedsAttention"
                : report
                  ? "settings.source.hideMigrationReport"
                  : "settings.source.showMigrationReport",
            })}
          </Button>
          {report ? (
            <SourceServerMigrationReportPanel
              report={report}
              disabled={busy}
              onRetry={(path, id) => actions.retry(source.sourceServerId, path, id)}
              onAbandon={(path, id) => actions.abandon(source.sourceServerId, path, id)}
            />
          ) : null}
        </div>
        {navigation.onShowInSidebar ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigation.onShowInSidebar?.(source.sourceServerId)}
          >
            {intl.formatMessage({ id: "settings.source.showInSidebar" })}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

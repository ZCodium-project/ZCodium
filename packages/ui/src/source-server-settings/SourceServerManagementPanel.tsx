import { useEffect, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type {
  ConnectionProfile,
  SourceServerRecord,
  SourceServerMigrationReport,
  SourceServerManagementPanelProps,
} from "./contract.js";
import { resolveWorkspaceKey, getSourceServerUpdateTarget, DesktopCommandIds } from "./contract.js";
import { Button } from "@/components/ui/button.js";
import { Switch } from "@/components/ui/switch.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { toast } from "@/components/ui/toast.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  classifyRemoteConnectionError,
  type RemoteConnectionPresentation,
} from "@/lib/remoteConnectionPresentation.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import {
  useRemoteConnectionProgress,
  RemoteConnectionMinimizedProgress,
} from "@/remote-connection-flow/ui/RemoteConnectionProgress.js";
import {
  SourceServerDeviceCard,
  SourceServerProfileRow,
  type DeviceCardActions,
} from "./SourceServerDeviceCard.js";
import { SourceServerUpdateActivity } from "./SourceServerUpdateActivity.js";
import { EditConnectionProfileDialog } from "./EditConnectionProfileDialog.js";
import { useSourceServerSettings } from "./useSourceServerSettings.js";
import { runSourceServerUpdate } from "./sourceServerSettingsActions.js";

function profileScope(profile: ConnectionProfile): string {
  return profile.sourceServerId
    ? `source:${profile.sourceServerId}`
    : `profile:${profile.profileId}`;
}

export function SourceServerManagementPanel(navigation: SourceServerManagementPanelProps) {
  const { management, snapshot, ready, refresh, logsByProfileId, busy, error, run } =
    useSourceServerSettings();
  const { intl } = useZCodeIntl();
  const confirm = useConfirmDialog();
  const platform = useOptionalPlatform();
  const background = useRemoteConnectionProgress();
  const tabs = useTabStore((state) => state.tabs);
  const [editing, setEditing] = useState<{
    profile: ConnectionProfile;
    source?: SourceServerRecord;
    focusField?: "host" | "auth";
  } | null>(null);
  const [details, setDetails] = useState<ConnectionProfile | null>(null);
  const [reports, setReports] = useState<Record<string, SourceServerMigrationReport | undefined>>(
    {},
  );
  const [autoReconnect, setAutoReconnect] = useState(
    navigation.settings?.remoteStartupAutoReconnectEnabled ?? true,
  );
  useEffect(() => {
    setAutoReconnect(navigation.settings?.remoteStartupAutoReconnectEnabled ?? true);
  }, [navigation.settings?.remoteStartupAutoReconnectEnabled]);
  const containerRef = useRef<HTMLDivElement>(null);
  const focused = useRef<string | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const id = navigation.targetSourceServerId;
    if (!id) {
      focused.current = null;
      return;
    }
    const key = `${id}:${navigation.targetSourceServerDetails}`;
    if (!ready || focused.current === key) return;
    // 不将外部 id 插入 CSS selector；用 dataset 精确匹配，避免特殊字符破坏定位。
    const card = [
      ...(containerRef.current?.querySelectorAll<HTMLElement>("[data-source-server-card]") ?? []),
    ].find((element) => element.dataset.sourceServerCard === id);
    if (!card) return;
    card.scrollIntoView({ block: "center" });
    card.focus({ preventScroll: true });
    if (navigation.targetSourceServerDetails) {
      const state = snapshot?.states.find(
        (item) => item.sourceServerId === id && item.state === "failed",
      );
      const profile = snapshot?.profiles.find((item) => item.profileId === state?.profileId);
      if (profile) setDetails(profile);
    }
    focused.current = key;
    navigation.onTargetSourceServerFocused?.();
  }, [
    ready,
    snapshot,
    navigation.targetSourceServerId,
    navigation.targetSourceServerDetails,
    navigation.onTargetSourceServerFocused,
  ]);

  if (!management)
    return (
      <p className="text-ui-sm text-remote-foreground-muted">
        {intl.formatMessage({ id: "settings.source.unavailable" })}
      </p>
    );
  const busyScopes = new Set(busy.values());
  if (background?.sourceServerId) busyScopes.add(`source:${background.sourceServerId}`);
  else if (background?.profileId) busyScopes.add(`profile:${background.profileId}`);
  for (const state of snapshot?.states ?? [])
    if (["updating", "bootstrapping", "retrying"].includes(state.state))
      busyScopes.add(
        state.sourceServerId ? `source:${state.sourceServerId}` : `profile:${state.profileId}`,
      );

  const updateProfile = async (profile: ConnectionProfile) => {
    await run(`update:${profile.profileId}`, profileScope(profile), async () => {
      try {
        const result = await runSourceServerUpdate({
          management,
          profileId: profile.profileId,
          expectedTarget: getSourceServerUpdateTarget(profile.target),
          confirmForce: async () => {
            const latest = await management.getSnapshot();
            const tasks = latest.states.find(
              (state) => state.profileId === profile.profileId,
            )?.runningTasks;
            return await confirm({
              title: intl.formatMessage({ id: "settings.source.forceUpdateTitle" }),
              description:
                intl.formatMessage({ id: "settings.source.forceUpdateDescription" }) +
                "\n\n" +
                (tasks?.length
                  ? tasks.map((task) => `${task.sessionId} — ${task.workspacePath}`).join("\n")
                  : intl.formatMessage({ id: "remote.runningTasksUnavailable" })),
              confirmLabel: intl.formatMessage({ id: "settings.source.forceUpdate" }),
              confirmVariant: "destructive",
            });
          },
        });
        // 更新完成只提示，不 dispatch 导航；切页后也不抢当前任务。
        if (result)
          toast(
            intl.formatMessage(
              { id: "sourceServer.updateCompletedToast" },
              { source: profile.displayName ?? profile.transport },
            ),
            { variant: "info" },
          );
        return result ?? undefined;
      } catch (cause) {
        toast(
          intl.formatMessage(
            { id: "sourceServer.updateFailedToast" },
            { source: profile.displayName ?? profile.transport },
          ),
          {
            variant: "warning",
            ...(profile.sourceServerId && navigation.onShowUpdateDetails
              ? {
                  actionLabel: intl.formatMessage({ id: "remote.action.details" }),
                  onAction: () => navigation.onShowUpdateDetails?.(profile.sourceServerId!),
                }
              : {}),
          },
        );
        throw cause;
      }
    });
  };
  const confirmIdentity = async (profile: ConnectionProfile) => {
    if (
      !(await confirm({
        title: intl.formatMessage({ id: "settings.source.identityChangeTitle" }),
        description: intl.formatMessage({ id: "settings.source.identityChangeDescription" }),
        confirmLabel: intl.formatMessage({ id: "settings.source.identityChangeConfirm" }),
      }))
    )
      return;
    await run(`identity:${profile.profileId}`, profileScope(profile), () =>
      management.confirmIdentityChange(profile.profileId),
    );
  };
  const profileAction = (
    profile: ConnectionProfile,
    presentation: RemoteConnectionPresentation,
    source?: SourceServerRecord,
  ) => {
    switch (presentation.primaryAction) {
      case "update-server":
        void updateProfile(profile);
        return;
      case "update-desktop":
        void run("desktop-update", "desktop-update", async () => {
          await platform?.executeDesktopCommand(DesktopCommandIds.CheckForUpdates);
        });
        return;
      case "confirm-identity":
        void confirmIdentity(profile);
        return;
      case "disconnect":
        if (profile.sourceServerId && navigation.onDisconnectSource)
          void run(`disconnect:${profile.profileId}`, profileScope(profile), () =>
            navigation.onDisconnectSource!(profile.sourceServerId!),
          );
        return;
      case "credentials":
      case "edit-auth":
        setEditing({ profile, source, focusField: "auth" });
        return;
      case "edit-host":
        setEditing({ profile, source, focusField: "host" });
        return;
      case "security":
      case "details":
        setDetails(profile);
        return;
      case "none":
      case "cancel":
        return;
      default:
        if (navigation.onConnectProfile)
          void run(`connect:${profile.profileId}`, profileScope(profile), async () => {
            await navigation.onConnectProfile?.(profile.profileId);
          });
    }
  };
  const removeProfile = async (profile: ConnectionProfile) => {
    if (
      !(await confirm({
        title: intl.formatMessage({ id: "settings.source.removeProfileTitle" }),
        description: intl.formatMessage(
          { id: "settings.source.removeProfileDescription" },
          { name: profile.displayName ?? profile.transport },
        ),
        confirmLabel: intl.formatMessage({ id: "settings.source.removeProfile" }),
        confirmVariant: "destructive",
      }))
    )
      return;
    await run(`remove:${profile.profileId}`, profileScope(profile), () =>
      management.removeProfile(profile.profileId),
    );
  };
  const removeSource = async (source: SourceServerRecord) => {
    const workspaceKeys = new Set(
      snapshot?.workspaceHistory
        .filter((entry) => entry.sourceServerId === source.sourceServerId)
        .map((entry) => resolveWorkspaceKey(entry)),
    );
    const affected = tabs
      .filter(isWorkspaceTab)
      .filter(
        (tab) => tab.workspaceIdentity?.trim() || tab.remoteSessionId?.trim() || tab.remoteTarget,
      )
      .filter((tab) => workspaceKeys.has(resolveWorkspaceKey(tab)));
    const notice = affected.length
      ? intl.formatMessage(
          { id: "settings.source.removeOpenProjects" },
          { projects: affected.map((tab) => `${tab.label} (${tab.workspacePath})`).join("\n") },
        )
      : intl.formatMessage({ id: "settings.source.noOpenProjects" });
    if (
      !(await confirm({
        title: intl.formatMessage({ id: "settings.source.removeSourceServer" }),
        description:
          intl.formatMessage(
            { id: "settings.source.removeSourceServerDescription" },
            { name: source.displayName },
          ) +
          "\n\n" +
          notice,
        confirmLabel: intl.formatMessage({ id: "settings.source.removeSourceServer" }),
        confirmVariant: "destructive",
      }))
    )
      return;
    // 离线设备同样能移除：Host 幂等断开后删除本机记录，不依赖远端在线。
    await run(`remove-source:${source.sourceServerId}`, `source:${source.sourceServerId}`, () =>
      management.removeSourceServer(source.sourceServerId),
    );
  };
  const migrationOperation = (
    sourceId: string,
    key: string,
    operation: () => Promise<SourceServerMigrationReport>,
  ) =>
    run(key, `source:${sourceId}`, async () => {
      const report = await operation();
      if (mounted.current) setReports((current) => ({ ...current, [sourceId]: report }));
    });
  const actions: DeviceCardActions = {
    edit: (profile, source, focusField) => setEditing({ profile, source, focusField }),
    profileAction,
    confirmIdentity: (profile) => {
      void confirmIdentity(profile);
    },
    removeProfile: (profile) => {
      void removeProfile(profile);
    },
    removeSource: (source) => {
      void removeSource(source);
    },
    setPreferred: (sourceId, profileId) => {
      void run(`preferred:${profileId}`, `source:${sourceId}`, () =>
        management.setPreferredProfile(sourceId, profileId),
      );
    },
    update: (profile) => {
      void updateProfile(profile);
    },
    showReport: (sourceId) => {
      if (reports[sourceId]) {
        setReports((current) => ({ ...current, [sourceId]: undefined }));
        return;
      }
      void migrationOperation(sourceId, `report:${sourceId}`, () =>
        management.getMigrationReport(sourceId),
      );
    },
    retry: (sourceId, path, id) => {
      void migrationOperation(sourceId, `retry:${id}`, () =>
        management.retryWorkspaceMigration(sourceId, path, id),
      );
    },
    abandon: (sourceId, path, id) => {
      void confirm({
        title: intl.formatMessage({ id: "settings.source.abandonMigrationTitle" }),
        description: intl.formatMessage({ id: "settings.source.abandonMigrationDescription" }),
        confirmLabel: intl.formatMessage({ id: "settings.source.abandonMigration" }),
        confirmVariant: "destructive",
      }).then((accepted) => {
        if (accepted)
          void migrationOperation(sourceId, `abandon:${id}`, () =>
            management.abandonWorkspaceMigration(sourceId, path, id),
          );
      });
    },
  };
  const activeProfiles =
    snapshot?.profiles.filter((profile) => profile.lifecycleState !== "retired") ?? [];
  const unbound = activeProfiles.filter((profile) => !profile.sourceServerId);
  const retired =
    snapshot?.profiles.filter((profile) => profile.lifecycleState === "retired") ?? [];
  const detailsState = snapshot?.states.find((state) => state.profileId === details?.profileId);
  const classified = details
    ? classifyRemoteConnectionError({
        errorCode: detailsState?.errorCode,
        error: detailsState?.error,
        target: details.target,
      })
    : null;
  return (
    <div ref={containerRef} className="min-w-0 space-y-4" aria-busy={busy.size > 0}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-ui-sm text-remote-foreground-muted">
          {intl.formatMessage({ id: "settings.remoteDevicesDescription" })}
        </p>
        {navigation.onCreateConnection ? (
          <Button type="button" size="sm" onClick={navigation.onCreateConnection}>
            <Plus className="size-3.5" />
            {intl.formatMessage({ id: "settings.source.newConnection" })}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-ui-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!ready && !error ? (
        <p
          role="status"
          className="flex items-center gap-2 text-ui-sm text-remote-foreground-muted"
        >
          <Loader2 className="size-4 animate-spin" />
          {intl.formatMessage({ id: "common.loading" })}
        </p>
      ) : null}
      {background &&
      !snapshot?.servers.some((source) => source.sourceServerId === background.sourceServerId) ? (
        <RemoteConnectionMinimizedProgress {...background} />
      ) : null}
      {snapshot?.servers.map((source) => (
        <SourceServerDeviceCard
          key={source.sourceServerId}
          source={source}
          snapshot={snapshot}
          busy={busyScopes.has(`source:${source.sourceServerId}`)}
          actions={actions}
          report={reports[source.sourceServerId]}
          logsByProfileId={logsByProfileId}
          navigation={{
            ...navigation,
            onShowInSidebar: navigation.onShowInSidebar
              ? (sourceId) => navigation.onShowInSidebar?.(sourceId, () => mounted.current)
              : undefined,
            onOpenProject: navigation.onOpenProject
              ? async (sourceId, path, profileId) => {
                  await run(`open:${sourceId}:${path}`, `source:${sourceId}`, async () => {
                    await navigation.onOpenProject?.(
                      sourceId,
                      path,
                      profileId,
                      () => mounted.current,
                    );
                  });
                }
              : undefined,
          }}
          remoteConversationWorkspacePath={
            navigation.settings?.remoteConversationWorkspaceBySourceServerId?.[
              source.sourceServerId
            ]?.workspacePath
          }
          background={
            background?.sourceServerId === source.sourceServerId ? (
              <RemoteConnectionMinimizedProgress {...background} />
            ) : undefined
          }
        />
      ))}
      {snapshot && unbound.length > 0 ? (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-ui-base font-medium">
            {intl.formatMessage({ id: "settings.source.unfinishedConnections" })} · {unbound.length}
          </summary>
          {unbound.map((profile) => (
            <div key={profile.profileId}>
              <SourceServerProfileRow
                profile={profile}
                snapshot={snapshot}
                busy={busyScopes.has(profileScope(profile))}
                actions={actions}
                canConnect={Boolean(navigation.onConnectProfile)}
              />
              {(logsByProfileId[profile.profileId]?.length ?? 0) > 0 ? (
                <SourceServerUpdateActivity
                  active={false}
                  recent
                  logs={logsByProfileId[profile.profileId] ?? []}
                />
              ) : null}
            </div>
          ))}
        </details>
      ) : null}
      {retired.length > 0 ? (
        <details className="border-t border-border pt-3">
          <summary className="cursor-pointer text-ui-sm">
            {intl.formatMessage(
              { id: "settings.source.retiredProfilesWithCount" },
              { count: retired.length },
            )}
          </summary>
          <p className="mt-2 text-ui-sm text-remote-foreground-muted">
            {intl.formatMessage({ id: "settings.source.retiredProfilesDescription" })}
          </p>
          {retired.map((profile) => (
            <p key={profile.profileId} className="mt-1 text-ui-sm text-remote-foreground-muted">
              {profile.displayName ?? profile.transport}
              {intl.formatMessage({ id: "settings.source.retiredNameSuffix" })}
            </p>
          ))}
        </details>
      ) : null}
      <section className="space-y-3 border-t border-border pt-3">
        <h3 className="text-ui-base font-medium">
          {intl.formatMessage({ id: "settings.source.connectionPreferences" })}
        </h3>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-ui-sm">
              {intl.formatMessage({ id: "settings.source.startupAutoReconnect" })}
            </p>
            <p className="text-ui-xs text-remote-foreground-muted">
              {intl.formatMessage({ id: "settings.source.startupAutoReconnectDescription" })}
            </p>
          </div>
          <Switch
            checked={autoReconnect}
            disabled={!navigation.onUpdateSettings || busy.has("startup-reconnect")}
            aria-label={intl.formatMessage({ id: "settings.source.startupAutoReconnect" })}
            onCheckedChange={(checked) => {
              const previous = autoReconnect;
              setAutoReconnect(checked);
              void run("startup-reconnect", "startup-reconnect", async () => {
                try {
                  await navigation.onUpdateSettings?.({
                    remoteStartupAutoReconnectEnabled: checked,
                  });
                } catch (cause) {
                  setAutoReconnect(previous);
                  throw cause;
                }
              });
            }}
          />
        </div>
      </section>
      {ready && snapshot?.servers.length === 0 && activeProfiles.length === 0 ? (
        <p className="py-4 text-center text-ui-sm text-remote-foreground-muted">
          {intl.formatMessage({ id: "settings.source.empty" })}
        </p>
      ) : null}
      <EditConnectionProfileDialog
        profile={editing?.profile ?? null}
        source={editing?.source}
        management={management}
        focusField={editing?.focusField}
        onClose={() => setEditing(null)}
        onSaved={refresh}
      />
      <Dialog
        open={Boolean(details)}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {intl.formatMessage({ id: classified?.titleId ?? "remote.error.details" })}
            </DialogTitle>
            <DialogDescription>
              {classified ? intl.formatMessage({ id: classified.reasonId }) : ""}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-ui-sm">
            {detailsState?.error ?? details?.lastConnectError}
          </pre>
          <SourceServerUpdateActivity
            active={false}
            recent
            logs={logsByProfileId[details?.profileId ?? ""] ?? []}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

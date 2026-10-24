import type { SourceServerMigrationReport, SourceServerMigrationReportRow } from "./contract.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const statusMessages = {
  running: "settings.source.migrationStatus.running",
  completed: "settings.source.migrationStatus.completed",
  failed: "settings.source.migrationStatus.failed",
  abandoned: "settings.source.migrationStatus.abandoned",
  "abandoned-diverged": "settings.source.migrationStatus.abandonedDiverged",
} satisfies Record<SourceServerMigrationReportRow["status"], string>;
const phaseMessages: Record<string, string> = {
  preflight: "settings.source.migrationPhase.preflight",
  "backups-created": "settings.source.migrationPhase.backupsCreated",
  "task-db-merged": "settings.source.migrationPhase.taskDbMerged",
  "session-db-merged": "settings.source.migrationPhase.sessionDbMerged",
  "config-dirs-merged": "settings.source.migrationPhase.configDirsMerged",
  "alias-published": "settings.source.migrationPhase.aliasPublished",
  completed: "settings.source.migrationPhase.completed",
};
const errorMessages: Record<string, string> = {
  "workspace-task-identity-conflict": "remote.error.workspaceTaskIdentityConflict",
  "workspace-config-file-conflict": "remote.error.workspaceConfigConflict",
  "workspace-migration-plan-diverged": "remote.error.workspaceMigrationPlanDiverged",
  "workspace-session-generation-changed": "remote.error.workspaceSessionGenerationChanged",
};

export function SourceServerMigrationReportPanel({
  report,
  disabled,
  onAbandon,
  onRetry,
}: {
  report: SourceServerMigrationReport;
  disabled: boolean;
  onAbandon: (path: string, migrationId: string) => void;
  onRetry: (path: string, migrationId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const latest = new Map<string, string>();
  for (const row of report.rows)
    if (!latest.has(row.workspacePath)) latest.set(row.workspacePath, row.migrationId);
  return (
    <div className="space-y-2">
      {report.rows.length === 0 ? (
        <p className="text-ui-sm text-remote-foreground-muted">
          {intl.formatMessage({ id: "settings.source.noMigrationIssues" })}
        </p>
      ) : (
        report.rows.map((row) => {
          const actionable =
            latest.get(row.workspacePath) === row.migrationId &&
            ["failed", "abandoned", "abandoned-diverged"].includes(row.status);
          const detail = row.errorCode
            ? errorMessages[row.errorCode]
            : row.phase
              ? phaseMessages[row.phase]
              : undefined;
          return (
            <div
              key={row.migrationId}
              className="flex min-w-0 flex-wrap items-center gap-2 text-ui-sm"
            >
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-ui-xs",
                  row.status === "failed"
                    ? "bg-destructive-surface text-destructive-surface-foreground"
                    : row.status === "completed"
                      ? "bg-success-surface text-success-surface-foreground"
                      : "bg-surface text-remote-foreground-muted",
                )}
              >
                {intl.formatMessage({ id: statusMessages[row.status] })}
              </span>
              <span className="min-w-0 break-all font-mono">{row.workspacePath}</span>
              <span className="text-remote-foreground-muted">
                {row.status === "completed"
                  ? intl.formatMessage(
                      { id: "settings.source.migrationMergedHistory" },
                      { count: row.variantKeys.length },
                    )
                  : intl.formatMessage({
                      id: detail ?? "settings.source.migrationDetailUnavailable",
                    })}
              </span>
              {actionable ? (
                <span className="ml-auto flex flex-wrap gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={disabled}
                    onClick={() => onRetry(row.workspacePath, row.migrationId)}
                  >
                    {intl.formatMessage({ id: "settings.source.retryMigration" })}
                  </Button>
                  {row.status === "failed" && !row.phase ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      disabled={disabled}
                      onClick={() => onAbandon(row.workspacePath, row.migrationId)}
                    >
                      {intl.formatMessage({ id: "settings.source.abandonMigration" })}
                    </Button>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

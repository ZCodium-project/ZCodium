import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { AlertTriangleIcon, LoaderIcon } from "lucide-react";
import type { RemoteConnectionProgress } from "../contract.js";
import { formatRemoteConnectionProgressTarget } from "../progressProjection.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const ProgressContext = createContext<RemoteConnectionProgress | null>(null);
const PublishProgressContext = createContext<
  ((progress: RemoteConnectionProgress | null) => void) | null
>(null);

/** 同窗口一个 Provider、一个原向导发布者；不拥有 Host 或连接业务状态。 */
export function RemoteConnectionProgressProvider({ children }: { children?: ReactNode }) {
  const [progress, publish] = useState<RemoteConnectionProgress | null>(null);
  return (
    <PublishProgressContext value={publish}>
      <ProgressContext value={progress}>{children}</ProgressContext>
    </PublishProgressContext>
  );
}

export function useRemoteConnectionProgress(): RemoteConnectionProgress | null {
  return useContext(ProgressContext);
}

export function usePublishRemoteConnectionProgress(
  progress: RemoteConnectionProgress | null,
): void {
  // 发布者只消费稳定的 setter，不能读取自己的日志投影，否则 Provider 更新会反向触发发布。
  const publish = useContext(PublishProgressContext);
  useEffect(() => {
    publish?.(progress);
  }, [publish, progress]);
  useEffect(
    () => () => {
      publish?.(null);
    },
    [publish],
  );
}

/** 纯展示：实际日志代替阶段/百分比猜测；ready 不调用任何动作。 */
export function RemoteConnectionMinimizedProgress(progress: RemoteConnectionProgress) {
  const { intl } = useZCodeIntl();
  const busy = progress.loading || progress.selectingDirectory;
  const device = formatRemoteConnectionProgressTarget(progress.target);
  const latest = progress.logs.at(-1);
  const title = intl.formatMessage(
    {
      id: progress.error
        ? "remote.minimized.failed"
        : progress.ready
          ? "remote.background.ready"
          : busy
            ? "remote.minimized.connecting"
            : `remote.minimized.${progress.view}`,
    },
    { device },
  );
  return (
    <section data-background-connection className="min-w-0 space-y-2 px-4 py-3">
      <div
        className={cn(
          "min-w-0 space-y-2 rounded-lg border border-border p-3",
          progress.error
            ? "bg-destructive-surface text-destructive-surface-foreground"
            : busy
              ? "bg-progress-surface text-progress-surface-foreground"
              : "bg-surface text-foreground",
        )}
      >
        <p role="status" className="flex min-w-0 items-center gap-2 text-ui-sm font-medium">
          {progress.error ? (
            <AlertTriangleIcon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : busy ? (
            <LoaderIcon className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
          ) : null}
          <span className="min-w-0 break-words">{title}</span>
        </p>
        {device ? <p className="break-all font-mono text-ui-xs">{device}</p> : null}
        {progress.error ? (
          <p className="break-words text-ui-sm">{progress.error}</p>
        ) : latest ? (
          <p className="break-words font-mono text-ui-xs">{latest.message}</p>
        ) : (
          <p className="text-ui-xs">
            {intl.formatMessage({
              id: busy ? "remote.connectionLogEmpty" : "remote.minimized.resume",
            })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            data-testid="remote-connection-minimized"
            type="button"
            variant="outline"
            size="sm"
            onClick={progress.onResume}
          >
            {intl.formatMessage({
              id: progress.ready ? "remote.background.continue" : "remote.background.review",
            })}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              void progress.onCancel();
            }}
          >
            {intl.formatMessage({ id: "remote.background.cancel" })}
          </Button>
        </div>
        {progress.logs.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-ui-xs">
              {intl.formatMessage({ id: "remote.connectionLog" })} · {progress.logs.length}
            </summary>
            <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-md bg-surface p-2 font-mono text-ui-xs text-remote-foreground-muted">
              {progress.logs.map((entry) => (
                <p
                  key={entry.id}
                  className={cn(
                    "min-w-0 break-words",
                    entry.level === "error" && "text-destructive",
                    entry.level === "warn" && "text-warning",
                  )}
                >
                  <span>{entry.timestamp}</span> {entry.message}
                </p>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}

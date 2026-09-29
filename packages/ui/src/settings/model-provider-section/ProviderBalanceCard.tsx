import type { ProviderBalanceEntry, ProviderBalanceSnapshot } from "@zcode/shared";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useProviderBalance } from "@/hooks/useProviderBalance.js";

/**
 * 外部 API Key Provider 的账户余额卡片。
 *
 * 只有已知余额接口的供应商会渲染；未识别（`unsupported`）时返回 null，
 * 不占用 Provider 卡片空间。余额属于可选数据面，查询失败不影响 Provider 使用。
 */
export function ProviderBalanceCard({
  providerId,
  enabled = true,
}: {
  providerId: string;
  enabled?: boolean;
}) {
  const { intl, locale } = useZCodeIntl();
  const { snapshot, loading, refresh } = useProviderBalance(providerId, { enabled });

  if (!snapshot || snapshot.status === "unsupported") {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h4 className="min-w-0 truncate text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "settings.modelProvider.balance.title" })}
        </h4>
        <button
          type="button"
          onClick={() => {
            void refresh();
          }}
          disabled={loading}
          aria-label={intl.formatMessage({ id: "settings.modelProvider.balance.refresh" })}
          className="shrink-0 rounded-md p-1 text-foreground-subtle transition-colors hover:text-foreground disabled:opacity-50"
        >
          <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        </button>
      </div>
      {snapshot.status === "ok" ? (
        <div className="mt-3 flex gap-2 max-sm:flex-col">
          {snapshot.balances.map((entry) => (
            <ProviderBalanceEntryView
              key={`${entry.label}:${entry.unit ?? ""}`}
              entry={entry}
              locale={locale}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-2 text-ui-xs text-foreground-subtle">
          {loading ? <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> : null}
          {resolveStatusMessage(intl, snapshot)}
        </p>
      )}
    </div>
  );
}

function ProviderBalanceEntryView({
  entry,
  locale,
}: {
  entry: ProviderBalanceEntry;
  locale: string;
}) {
  return (
    <div className="min-w-0 flex-1 rounded-lg bg-surface p-3">
      <div className="truncate text-ui-xs text-foreground-subtle">{entry.label}</div>
      <div
        className={
          entry.isAvailable
            ? "mt-1 truncate text-ui-lg font-semibold leading-none text-foreground"
            : "mt-1 truncate text-ui-lg font-semibold leading-none text-destructive"
        }
      >
        {formatBalance(locale, entry)}
      </div>
    </div>
  );
}

function resolveStatusMessage(
  intl: ReturnType<typeof useZCodeIntl>["intl"],
  snapshot: ProviderBalanceSnapshot,
): string {
  if (snapshot.status === "not_configured") {
    return intl.formatMessage({ id: "settings.modelProvider.balance.notConfigured" });
  }
  if (snapshot.status === "unauthorized") {
    return intl.formatMessage({ id: "settings.modelProvider.balance.unauthorized" });
  }
  return intl.formatMessage({ id: "settings.modelProvider.balance.error" });
}

function formatBalance(locale: string, entry: ProviderBalanceEntry): string {
  if (entry.remaining === null) {
    return "—";
  }
  const currency = entry.unit?.trim().toUpperCase();
  try {
    return new Intl.NumberFormat(locale || undefined, {
      style: currency ? "currency" : "decimal",
      ...(currency ? { currency } : {}),
      maximumFractionDigits: 2,
    }).format(entry.remaining);
  } catch {
    return `${entry.remaining} ${entry.unit ?? ""}`.trim();
  }
}

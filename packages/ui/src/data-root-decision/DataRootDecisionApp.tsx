/**
 * 数据根决策页（独立轻量窗口）。
 *
 * 不依赖 services / store / Host：只通过专用 bridge 与 main 交换状态与选择。
 * 文案集中在 ui 的 locale 文件（dataRoot.* keys），组件自行按 locale 解析。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DataRootDecisionBridge,
  DataRootDecisionProgress,
  DataRootDecisionState,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import zhCN from "@/i18n/locales/zh-CN.js";
import enUS from "@/i18n/locales/en-US.js";
import faIR from "@/i18n/locales/fa.js";

type SupportedLocale = "zh-CN" | "en-US" | "fa-IR";

const MESSAGES: Record<SupportedLocale, Record<string, string>> = {
  "zh-CN": zhCN,
  "en-US": enUS,
  "fa-IR": faIR,
};

function resolveLocale(value: unknown): SupportedLocale {
  return value === "zh-CN" || value === "en-US" || value === "fa-IR" ? value : "en-US";
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "…";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

export function DataRootDecisionApp({ bridge }: { bridge: DataRootDecisionBridge }) {
  const [state, setState] = useState<DataRootDecisionState | null>(null);
  const [progress, setProgress] = useState<DataRootDecisionProgress | null>(null);
  const [busy, setBusy] = useState<"migrate" | "fresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void bridge.getState().then((next) => {
      if (!cancelled) setState(next);
    });
    const offState = bridge.onStateChanged((next) => {
      if (!cancelled) setState(next);
    });
    const offProgress = bridge.onProgress((next) => {
      if (!cancelled) setProgress(next);
    });
    return () => {
      cancelled = true;
      offState();
      offProgress();
    };
  }, [bridge]);

  const locale = resolveLocale(state?.locale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "fa-IR" ? "rtl" : "ltr";
  }, [locale]);

  const t = useCallback(
    (key: string, values?: Record<string, string>): string => {
      let text = MESSAGES[locale][key] ?? MESSAGES["en-US"][key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        text = text.replaceAll(`{${name}}`, value);
      }
      return text;
    },
    [locale],
  );

  const hasCandidates = (state?.candidates.length ?? 0) > 0;
  const insufficientDisk =
    state?.diskFreeBytes != null &&
    state?.requiredBytes != null &&
    state.diskFreeBytes < state.requiredBytes;
  const isImportMode = state?.mode === "import";

  const decide = useCallback(
    async (action: "migrate" | "fresh" | "quit") => {
      if (busy || restarting) return;
      setError(null);
      if (action === "quit") {
        setBusy(null);
        void bridge.decide("quit");
        return;
      }
      setBusy(action);
      try {
        const result = await bridge.decide(action);
        if (!result.ok) {
          setBusy(null);
          setError(result.error);
          return;
        }
        setRestarting(true);
      } catch (decideError) {
        setBusy(null);
        setError(decideError instanceof Error ? decideError.message : String(decideError));
      }
    },
    [bridge, busy, restarting],
  );

  const statusDescription = useMemo(() => {
    if (!state) return "";
    switch (state.status.kind) {
      case "absent-with-legacy":
        return t("dataRoot.status.absentWithLegacy");
      case "unowned":
        return t("dataRoot.status.unowned");
      case "corrupt":
        return t("dataRoot.status.corrupt");
      default:
        return "";
    }
  }, [state, t]);

  const progressPercent = useMemo(() => {
    if (!progress || !progress.totalBytes || progress.totalBytes <= 0) return null;
    return Math.min(100, Math.round((progress.copiedBytes / progress.totalBytes) * 100));
  }, [progress]);

  if (!state) {
    return (
      <div className="flex h-full items-center justify-center bg-background text-ui-base text-muted-foreground">
        {t("dataRoot.loading")}
      </div>
    );
  }

  const progressLabel = progress
    ? progress.phase === "copying"
      ? t("dataRoot.progress.copying")
      : progress.phase === "finalizing"
        ? t("dataRoot.progress.finalizing")
        : t("dataRoot.progress.preparing")
    : null;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="border-b border-border px-6 py-5">
        <h1 className="text-ui-lg font-semibold">
          {isImportMode ? t("dataRoot.import.title") : t("dataRoot.title")}
        </h1>
        <p className="mt-2 text-ui-base leading-relaxed text-muted-foreground">
          {isImportMode ? t("dataRoot.import.description") : statusDescription}
        </p>
        {state.status.conflictingRoot ? (
          <p className="mt-2 text-ui-sm text-muted-foreground">
            {t("dataRoot.conflict.notice", { path: state.status.conflictingRoot })}
          </p>
        ) : null}
      </header>

      <main className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
        {state.candidates.length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-ui-base font-semibold">{t("dataRoot.candidates.title")}</h2>
            <ul className="space-y-2">
              {state.candidates.map((candidate) => (
                <li
                  key={`${candidate.baseDir}:${candidate.legacyRoot}`}
                  className="rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="break-all font-mono text-ui-sm">{candidate.legacyRoot}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-muted-foreground">
                    <span>
                      {t("dataRoot.candidate.size")}: {formatBytes(candidate.sizeBytes)}
                    </span>
                    <span>
                      {t("dataRoot.candidate.modified")}:{" "}
                      {candidate.modifiedAt
                        ? new Date(candidate.modifiedAt).toLocaleString(locale)
                        : "…"}
                    </span>
                    {!candidate.isPrimaryBase ? (
                      <span className="text-muted-foreground/80">{candidate.baseDir}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="text-ui-base text-muted-foreground">{t("dataRoot.candidate.empty")}</p>
        )}

        {insufficientDisk ? (
          <p className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-ui-base text-warning-foreground">
            {t("dataRoot.disk.insufficient", {
              required: formatBytes(state.requiredBytes),
              free: formatBytes(state.diskFreeBytes),
            })}
          </p>
        ) : null}

        {busy || restarting ? (
          <section className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex items-center justify-between text-ui-base">
              <span>{restarting ? t("dataRoot.done.restarting") : progressLabel}</span>
              {progressPercent !== null && !restarting ? <span>{progressPercent}%</span> : null}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className={
                  progressPercent === null && !restarting
                    ? "h-full w-1/3 animate-pulse rounded-full bg-primary"
                    : "h-full rounded-full bg-primary transition-[width] duration-200"
                }
                style={progressPercent !== null ? { width: `${progressPercent}%` } : undefined}
              />
            </div>
            {progress ? (
              <div className="text-ui-sm text-muted-foreground">
                {formatBytes(progress.copiedBytes)}
                {progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? (
          <section className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3">
            <div className="text-ui-base font-semibold text-destructive">
              {t("dataRoot.error.title")}
            </div>
            <div className="break-all text-ui-sm text-muted-foreground">{error}</div>
            <div className="text-ui-sm text-muted-foreground">{t("dataRoot.error.retry")}</div>
          </section>
        ) : null}
      </main>

      <footer className="space-y-3 border-t border-border px-6 py-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="lg"
            disabled={Boolean(busy) || restarting}
            onClick={() => void decide("quit")}
            title={t("dataRoot.action.quitHint")}
          >
            {isImportMode ? t("dataRoot.action.cancel") : t("dataRoot.action.quit")}
          </Button>
          {!isImportMode ? (
            <Button
              variant="outline"
              size="lg"
              disabled={Boolean(busy) || restarting}
              onClick={() => void decide("fresh")}
              title={t("dataRoot.action.freshHint")}
            >
              {t("dataRoot.action.fresh")}
            </Button>
          ) : null}
          <Button
            size="lg"
            disabled={Boolean(busy) || restarting || !hasCandidates || Boolean(insufficientDisk)}
            onClick={() => void decide("migrate")}
            title={t("dataRoot.action.migrateHint")}
          >
            {isImportMode ? t("dataRoot.action.import") : t("dataRoot.action.migrate")}
          </Button>
        </div>
      </footer>
    </div>
  );
}

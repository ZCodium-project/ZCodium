import { homedir } from "node:os";
import { join } from "node:path";
import type { ExecutionRequest } from "@zcode/contracts";

export const DEFAULT_TIMEOUT_MS = 300_000;
const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const DEFAULT_INLINE_OUTPUT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_PERSISTED_OUTPUT_BYTES = 50 * 1024 * 1024;
export const BASH_RUNTIME_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024 * 1024;
export const IO_DRAIN_TIMEOUT_MS = 1_000;
export const FORCE_EXIT_AFTER_KILL_MS = 5_000;
export const DEFAULT_PROGRESS_THRESHOLD_MS = 2_000;
export const DEFAULT_PROGRESS_INTERVAL_MS = 1_000;
export const DEFAULT_PROGRESS_TAIL_BYTES = 4 * 1024;

export function resolveDefaultOutputRootDir(processEnv: NodeJS.ProcessEnv = process.env): string {
  const storageRoot = processEnv.ZCODE_STORAGE_DIR?.trim() || join(homedir(), ".zcodium");
  return join(storageRoot, "cli", "exec");
}

export function isExpectedChildStdinClosureError(error: Error): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

export function isBashMergedOutputRequest(request: ExecutionRequest): boolean {
  return request.command.mode === "shell" && request.command.shellProfile === "posix-bash";
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

export function abortSignalReason(signal: AbortSignal | undefined): unknown {
  if (!signal || !("reason" in signal)) return undefined;
  return (signal as AbortSignal & { reason?: unknown }).reason;
}

export function waitForPromise(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(completed);
    };
    timer = setTimeout(() => finish(false), timeoutMs);
    // losing timeout 不应在目标 Promise 已完成后继续单独保活 CLI。
    timer.unref?.();
    void promise.then(
      () => finish(true),
      () => finish(true),
    );
  });
}

export function formatTimeoutDuration(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs < MS_PER_SECOND) {
    return `${Math.max(0, Math.round(timeoutMs))}ms`;
  }

  if (timeoutMs < MS_PER_MINUTE) {
    return `${formatUnitValue(timeoutMs / MS_PER_SECOND)}s`;
  }

  if (timeoutMs < MS_PER_HOUR) {
    return `${formatUnitValue(timeoutMs / MS_PER_MINUTE)}m`;
  }

  return `${formatUnitValue(timeoutMs / MS_PER_HOUR)}h`;
}

function formatUnitValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}

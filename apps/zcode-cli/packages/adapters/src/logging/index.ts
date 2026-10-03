// ============================================================
// Node logging adapter - JSONL file and optional stderr sink
// ============================================================

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LogContext, LogEntry, Logger, LoggerFactory, LogRedactor } from "@zcode/contracts";
import { LogLevel, LogLevelName } from "@zcode/contracts";
import { ZCODE_RUNTIME_ENV_KEY, normalizeZCodeRuntimeEnv } from "@zcode/shared";
import {
  formatLocalLogDate,
  scheduleLogRetentionCleanup as scheduleRetentionCleanup,
  type LogRetentionScheduleOptions,
  type LogRetentionTimer,
} from "./retention.js";
import {
  DefaultLogRedactor,
  formatConsoleLine,
  isLogStatus,
  serializeLogError,
  stripReservedContext,
  toSerializableEntry,
} from "./serialize.js";
import { maybeThrowStorageFsFault } from "../storage/fs-fault-injection.js";

export {
  LOG_CLEANUP_STARTUP_DELAY_MS,
  LOG_RETENTION_DAYS,
  cleanupLogRetention,
  formatLocalLogDate,
  scheduleLogRetentionCleanup,
} from "./retention.js";
export type {
  LogRetentionCleanupOptions,
  LogRetentionCleanupResult,
  LogRetentionScheduleOptions,
  LogRetentionTimer,
} from "./retention.js";
export { DefaultLogRedactor } from "./serialize.js";
export type { SerializableLogEntry, SerializedLogError } from "./serialize.js";

export interface NodeLoggerFactoryOptions {
  env?: NodeJS.ProcessEnv;
  logDir?: string;
  minLevel?: LogLevel;
  console?: boolean | { stream: NodeJS.WritableStream };
  includeErrorStack?: boolean;
  redactor?: LogRedactor;
}

export type NodeLogRetentionScheduleOptions = Pick<
  LogRetentionScheduleOptions,
  "delayMs" | "logger" | "now" | "retentionDays" | "setTimeout"
>;

export interface NodeLoggerFactory extends LoggerFactory {
  getLogDir(): string;
  scheduleLogRetentionCleanup(
    options?: NodeLogRetentionScheduleOptions,
  ): LogRetentionTimer | undefined;
}

export class NodeFileLogger implements Logger {
  private readonly category: string;
  private readonly defaultContext: LogContext;
  private readonly getMinLevel: () => LogLevel;
  private readonly logDir: string;
  private readonly consoleStream?: NodeJS.WritableStream;
  private readonly includeErrorStack: boolean;
  private readonly redactor: LogRedactor;

  constructor(options: {
    category: string;
    defaultContext?: LogContext;
    getMinLevel: () => LogLevel;
    logDir: string;
    consoleStream?: NodeJS.WritableStream;
    includeErrorStack?: boolean;
    redactor: LogRedactor;
  }) {
    this.category = options.category;
    this.defaultContext = options.defaultContext ?? {};
    this.getMinLevel = options.getMinLevel;
    this.logDir = options.logDir;
    this.consoleStream = options.consoleStream;
    this.includeErrorStack = options.includeErrorStack ?? false;
    this.redactor = options.redactor;
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.Debug, message, undefined, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.Info, message, undefined, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.Warn, message, undefined, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log(LogLevel.Error, message, error, context);
  }

  child(context: LogContext): Logger {
    return new NodeFileLogger({
      category: this.category,
      defaultContext: { ...this.defaultContext, ...context },
      getMinLevel: this.getMinLevel,
      logDir: this.logDir,
      consoleStream: this.consoleStream,
      includeErrorStack: this.includeErrorStack,
      redactor: this.redactor,
    });
  }

  private log(level: LogLevel, message: string, error?: Error, context?: LogContext): void {
    if (level < this.getMinLevel()) {
      return;
    }

    const mergedContext = { ...this.defaultContext, ...context };
    const entry = this.createEntry(level, message, mergedContext, error);
    const serialized = toSerializableEntry(entry, this.redactor);
    const line = JSON.stringify(serialized);

    try {
      ensureLogDir(this.logDir);
      const logPath = join(this.logDir, getLogFileName());
      maybeThrowStorageFsFault({ operation: "appendFile", path: logPath });
      appendFileSync(logPath, `${line}\n`, "utf8");
    } catch {
      // Logging must never break the agent execution path.
    }

    if (this.consoleStream) {
      this.consoleStream.write(`${formatConsoleLine(entry)}\n`);
    }
  }

  private createEntry(
    level: LogLevel,
    message: string,
    context: LogContext,
    error?: Error,
  ): LogEntry {
    return {
      timestamp: new Date(),
      level,
      levelName: LogLevelName[level],
      event: typeof context.event === "string" ? context.event : undefined,
      module: typeof context.module === "string" ? context.module : this.category,
      message,
      traceId: context.traceId,
      sessionId: typeof context.sessionId === "string" ? context.sessionId : undefined,
      turnId: typeof context.turnId === "string" ? context.turnId : undefined,
      spanId: typeof context.spanId === "string" ? context.spanId : undefined,
      parentSpanId: typeof context.parentSpanId === "string" ? context.parentSpanId : undefined,
      toolCallId: typeof context.toolCallId === "string" ? context.toolCallId : undefined,
      durationMs: typeof context.durationMs === "number" ? context.durationMs : undefined,
      status: isLogStatus(context.status) ? context.status : undefined,
      context: stripReservedContext(context),
      error: error ? serializeLogError(error, this.includeErrorStack) : undefined,
    };
  }
}

export function createNodeLoggerFactory(options: NodeLoggerFactoryOptions = {}): NodeLoggerFactory {
  let currentLevel = options.minLevel ?? getDefaultMinLevel(options.env);
  let retentionCleanupScheduled = false;
  const logDir = options.logDir ?? options.env?.ZCODE_LOG_DIR ?? getDefaultLogDir();
  const consoleStream =
    typeof options.console === "object"
      ? options.console.stream
      : options.console === true || options.env?.ZCODE_LOG_CONSOLE === "1"
        ? process.stderr
        : undefined;
  const redactor = options.redactor ?? new DefaultLogRedactor();

  const create = (category: string, defaultContext: LogContext = {}) =>
    new NodeFileLogger({
      category,
      defaultContext,
      getMinLevel: () => currentLevel,
      logDir,
      consoleStream,
      includeErrorStack: options.includeErrorStack,
      redactor,
    });

  return {
    createLogger(category: string): Logger {
      return create(category);
    },
    withContext(context: LogContext): Logger {
      return create("root", context);
    },
    setLevel(level: LogLevel): void {
      currentLevel = level;
    },
    getLogDir(): string {
      return logDir;
    },
    scheduleLogRetentionCleanup(scheduleOptions = {}): LogRetentionTimer | undefined {
      if (retentionCleanupScheduled) return undefined;
      retentionCleanupScheduled = true;
      return scheduleRetentionCleanup({
        ...scheduleOptions,
        logDir,
        logger:
          scheduleOptions.logger ??
          create("zcode", {
            module: "adapters.logging",
          }),
      });
    },
  };
}

export function getDefaultLogDir(): string {
  return join(homedir(), ".zcodium", "cli", "log");
}

function getDefaultMinLevel(env: NodeJS.ProcessEnv | undefined): LogLevel {
  return isDevelopmentMode(env ?? process.env) ? LogLevel.Debug : LogLevel.Info;
}

function isDevelopmentMode(env: NodeJS.ProcessEnv): boolean {
  const runtimeEnv = normalizeZCodeRuntimeEnv(env[ZCODE_RUNTIME_ENV_KEY]);
  if (runtimeEnv === "development") return true;
  if (runtimeEnv === "production" || runtimeEnv === "test") return false;

  // The local dev script runs `tsx src/main.ts`; packaged CLI entrypoints run from dist.
  const entrypoint = process.argv[1] ?? "";
  return entrypoint.endsWith(".ts") && entrypoint.includes(`${join("packages", "cli", "src")}`);
}

function ensureLogDir(logDir: string): void {
  if (!existsSync(logDir)) {
    maybeThrowStorageFsFault({ operation: "mkdir", path: logDir });
    mkdirSync(logDir, { recursive: true });
  }
}

function getLogFileName(): string {
  return `zcode-${formatLocalLogDate(new Date())}.jsonl`;
}

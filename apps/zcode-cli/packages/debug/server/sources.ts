import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DbMessageRecord,
  DbObservation,
  DbPartRecord,
  DbSessionRecord,
  EventRecord,
  JsonRecord,
  LogRecord,
  ObservationOptions,
  SourceLoadResult,
} from "./types.js";

export function defaultLogDir(): string {
  return join(homedir(), ".zcodium", "cli", "log");
}

export function defaultDbPath(): string {
  return join(homedir(), ".zcodium", "cli", "db", "db.sqlite");
}

export async function loadLogs(options: ObservationOptions): Promise<SourceLoadResult<LogRecord>> {
  const logDir = resolve(options.logDir ?? defaultLogDir());
  const jsonl = await readJsonlFiles(logDir, "结构化日志");
  return {
    kind: "log",
    label: "结构化日志",
    path: logDir,
    records: jsonl.records.map(toLogRecord).filter((record) => record !== null),
    warning: jsonl.warning,
  };
}

export async function loadEventLog(
  options: ObservationOptions,
): Promise<SourceLoadResult<EventRecord>> {
  if (!options.eventPath) {
    return {
      kind: "eventlog",
      label: "Session 事件 JSONL",
      records: [],
      warning: "未配置 Session 事件 JSONL 路径。",
    };
  }

  const eventPath = resolve(options.eventPath);
  const jsonl = await readJsonlFiles(eventPath, "Session 事件 JSONL");
  return {
    kind: "eventlog",
    label: "Session 事件 JSONL",
    path: eventPath,
    records: jsonl.records.map(toEventRecord).filter((record) => record !== null),
    warning: jsonl.warning,
  };
}

export function loadSqlite(options: ObservationOptions): SourceLoadResult<DbObservation> {
  const dbPath = resolve(options.dbPath ?? defaultDbPath());
  if (!existsSync(dbPath)) {
    return {
      kind: "sqlite",
      label: "SQLite Session 数据库",
      path: dbPath,
      records: [],
      warning: "未找到 SQLite Session 数据库。",
    };
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const observation: DbObservation = {
      sessions: readSessions(db),
      messages: readMessages(db),
      parts: readParts(db),
    };
    return {
      kind: "sqlite",
      label: "SQLite Session 数据库",
      path: dbPath,
      records: [observation],
    };
  } catch (error) {
    return {
      kind: "sqlite",
      label: "SQLite Session 数据库",
      path: dbPath,
      records: [],
      warning: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db?.close();
  }
}

interface JsonlReadResult {
  records: JsonRecord[];
  warning?: string;
}

async function readJsonlFiles(inputPath: string, label: string): Promise<JsonlReadResult> {
  if (!existsSync(inputPath)) {
    return { records: [], warning: `${label} 路径不存在。` };
  }

  const inputStat = await stat(inputPath);
  const files = inputStat.isDirectory()
    ? (await readdir(inputPath))
        .filter((entry) => entry.endsWith(".jsonl") || entry.endsWith(".log"))
        .sort()
        .map((entry) => join(inputPath, entry))
    : [inputPath];
  const records: JsonRecord[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file, "utf8");
      const lines = content.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          if (isRecord(parsed)) {
            records.push({ value: parsed, sourcePath: file, line: index + 1 });
          }
        } catch {
          warnings.push(`${basename(file)}:${index + 1} 不是合法 JSON。`);
        }
      }
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    records,
    warning: warnings.length > 0 ? warnings.join(" ") : undefined,
  };
}

function toLogRecord(record: JsonRecord): LogRecord | null {
  const value = record.value;
  const message = stringValue(value.message);
  const event = stringValue(value.event);
  if (!message && !event) return null;

  return {
    timestamp: stringValue(value.timestamp),
    level: stringValue(value.level),
    event,
    module: stringValue(value.module),
    message,
    traceId: stringValue(value.traceId),
    sessionId: stringValue(value.sessionId),
    turnId: stringValue(value.turnId),
    spanId: stringValue(value.spanId),
    parentSpanId: stringValue(value.parentSpanId),
    toolCallId: stringValue(value.toolCallId),
    durationMs: numberValue(value.durationMs),
    status: stringValue(value.status),
    context: isRecord(value.context) ? value.context : undefined,
    error: value.error,
    sourcePath: record.sourcePath,
    line: record.line,
  };
}

function toEventRecord(record: JsonRecord): EventRecord | null {
  const value = record.value;
  const type = stringValue(value.type);
  if (!type) return null;

  return {
    id: stringValue(value.id) ?? stringValue(value.eventId) ?? `${record.sourcePath}:${record.line}`,
    type,
    timestamp:
      stringValue(value.timestamp) ?? stringValue(value.occurredAt) ?? stringValue(value.recordedAt),
    traceId: stringValue(value.traceId),
    sessionId: stringValue(value.sessionId),
    turnId: stringValue(value.turnId),
    spanId: stringValue(value.spanId),
    parentSpanId: stringValue(value.parentSpanId),
    sequenceNumber: numberValue(value.sequenceNumber),
    payload: isRecord(value.payload) ? value.payload : undefined,
    sourcePath: record.sourcePath,
    line: record.line,
  };
}

function readSessions(db: DatabaseSync): DbSessionRecord[] {
  const rows = db
    .prepare(
      `
      select id, project_id, title, directory, time_created, time_updated
      from session
      order by time_updated desc
      limit 200
      `,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    id: String(row.id),
    projectId: String(row.project_id),
    title: String(row.title ?? ""),
    directory: String(row.directory ?? ""),
    createdAt: millisToIso(row.time_created),
    updatedAt: millisToIso(row.time_updated),
  }));
}

function readMessages(db: DatabaseSync): DbMessageRecord[] {
  const rows = db
    .prepare(
      `
      select id, session_id, time_created, time_updated, data
      from message
      order by time_created asc, rowid asc
      limit 1000
      `,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => {
    const data = parseData(row.data);
    return {
      id: String(row.id),
      sessionId: String(row.session_id),
      role: stringValue(data.role),
      createdAt: millisToIso(row.time_created),
      updatedAt: millisToIso(row.time_updated),
      data,
    };
  });
}

function readParts(db: DatabaseSync): DbPartRecord[] {
  const rows = db
    .prepare(
      `
      select id, message_id, session_id, time_created, time_updated, data
      from part
      order by time_created asc, id asc
      limit 2000
      `,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => {
    const data = parseData(row.data);
    return {
      id: String(row.id),
      messageId: String(row.message_id),
      sessionId: String(row.session_id),
      type: stringValue(data.type),
      createdAt: millisToIso(row.time_created),
      updatedAt: millisToIso(row.time_updated),
      data,
    };
  });
}

function parseData(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function millisToIso(value: unknown): string | undefined {
  const millis = numberValue(value);
  return millis === undefined ? undefined : new Date(millis).toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, join, normalize, parse } from "node:path";
import type {
  WorkflowDefinition,
  WorkflowDefinitionStorePort,
  WorkflowEvent,
  WorkflowGraphRecord,
  WorkflowKind,
  WorkflowRunSnapshot,
  WorkflowRunListItem,
  WorkflowStorePort,
} from "@zcode/contracts";
import {
  WorkflowDefinitionSchema,
  WorkflowEventSchema,
  WorkflowGraphRecordSchema,
  WorkflowRunSnapshotSchema,
} from "@zcode/contracts";

export interface NodeWorkflowStoreOptions {
  rootDir?: string;
}

export interface NodeWorkflowDefinitionStoreOptions {
  definitionsDir?: string;
  rootDir?: string;
}

interface WorkflowIndexFile {
  runs: WorkflowRunListItem[];
}

const DEFAULT_WORKFLOW_ROOT = join(homedir(), ".zcodium", "cli", "workflows");
const WORKFLOW_DEFINITION_FILE_EXTENSION = ".json";

export class NodeWorkflowStore implements WorkflowStorePort {
  private readonly rootDir: string;

  constructor(options: NodeWorkflowStoreOptions = {}) {
    this.rootDir = options.rootDir ?? DEFAULT_WORKFLOW_ROOT;
  }

  async appendEvent(event: WorkflowEvent, options?: { signal?: AbortSignal }): Promise<void> {
    throwIfAborted(options?.signal, "Workflow event append cancelled");
    WorkflowEventSchema.parse(event);
    await appendJsonLine(this.eventsPath(event.runId), event, options?.signal);
  }

  async appendGraphRecord(
    runId: string,
    record: WorkflowGraphRecord,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    throwIfAborted(options?.signal, "Workflow graph append cancelled");
    WorkflowGraphRecordSchema.parse(record);
    await appendJsonLine(this.graphPath(runId), record, options?.signal);
  }

  async listRuns(
    options: { cwd?: string; kind?: WorkflowKind; limit?: number } = {},
    signalOptions?: { signal?: AbortSignal },
  ): Promise<WorkflowRunListItem[]> {
    throwIfAborted(signalOptions?.signal, "Workflow run list cancelled");
    const index = await this.readIndex(signalOptions?.signal);
    const filtered = index.runs.filter(
      (run) =>
        (options.cwd === undefined || run.cwd === options.cwd) &&
        (options.kind === undefined || run.kind === options.kind),
    );
    const sorted = filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return options.limit === undefined ? sorted : sorted.slice(0, options.limit);
  }

  async readEvents(runId: string, options?: { signal?: AbortSignal }): Promise<WorkflowEvent[]> {
    throwIfAborted(options?.signal, "Workflow event read cancelled");
    const lines = await readJsonLines(this.eventsPath(runId), options?.signal);
    return lines.map((line) => WorkflowEventSchema.parse(line));
  }

  async readLatestRun(
    options: { cwd?: string; kind?: WorkflowKind } = {},
    signalOptions?: { signal?: AbortSignal },
  ): Promise<WorkflowRunSnapshot | null> {
    const [latest] = await this.listRuns({ ...options, limit: 1 }, signalOptions);
    if (!latest) return null;
    return await this.readRun(latest.runId, signalOptions);
  }

  async readRun(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowRunSnapshot | null> {
    throwIfAborted(options?.signal, "Workflow snapshot read cancelled");
    const parsed = await readJson(this.snapshotPath(runId), options?.signal);
    return parsed === null ? null : WorkflowRunSnapshotSchema.parse(parsed);
  }

  async writeArtifact(
    runId: string,
    relativePath: string,
    content: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ path: string; relativePath: string }> {
    throwIfAborted(options?.signal, "Workflow artifact write cancelled");
    const safeRelativePath = normalizeRelativePath(relativePath);
    const path = join(this.runRoot(runId), safeRelativePath);
    await writeTextFile(path, content, options?.signal);
    return { path, relativePath: safeRelativePath };
  }

  async writeReport(
    runId: string,
    content: string,
    options?: { signal?: AbortSignal },
  ): Promise<{ path: string; relativePath: string }> {
    return await this.writeArtifact(runId, "report.md", content, options);
  }

  async writeSnapshot(
    snapshot: WorkflowRunSnapshot,
    options?: { signal?: AbortSignal },
  ): Promise<void> {
    throwIfAborted(options?.signal, "Workflow snapshot write cancelled");
    WorkflowRunSnapshotSchema.parse(snapshot);
    await writeJsonFile(this.snapshotPath(snapshot.runId), snapshot, options?.signal);
    await this.upsertIndex(snapshot, options?.signal);
  }

  private async upsertIndex(snapshot: WorkflowRunSnapshot, signal?: AbortSignal): Promise<void> {
    const index = await this.readIndex(signal);
    const item: WorkflowRunListItem = {
      completedAt: snapshot.completedAt,
      createdAt: snapshot.createdAt,
      cwd: snapshot.cwd,
      kind: snapshot.kind,
      runId: snapshot.runId,
      status: snapshot.status,
      task: snapshot.task,
      updatedAt: snapshot.updatedAt,
    };
    const nextRuns = [item, ...index.runs.filter((run) => run.runId !== snapshot.runId)].sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    );
    await writeJsonFile(this.indexPath(), { runs: nextRuns }, signal);
  }

  private async readIndex(signal?: AbortSignal): Promise<WorkflowIndexFile> {
    const parsed = await readJson(this.indexPath(), signal);
    if (parsed === null) return { runs: [] };
    const runs = Array.isArray((parsed as { runs?: unknown }).runs)
      ? (parsed as { runs: WorkflowRunListItem[] }).runs
      : [];
    return { runs };
  }

  private eventsPath(runId: string): string {
    return join(this.runRoot(runId), "events.jsonl");
  }

  private graphPath(runId: string): string {
    return join(this.runRoot(runId), "graph.jsonl");
  }

  private indexPath(): string {
    return join(this.rootDir, "index.json");
  }

  private runRoot(runId: string): string {
    return join(this.rootDir, "runs", sanitizePathSegment(runId));
  }

  private snapshotPath(runId: string): string {
    return join(this.runRoot(runId), "run.json");
  }
}

export function createNodeWorkflowStore(options: NodeWorkflowStoreOptions = {}): WorkflowStorePort {
  return new NodeWorkflowStore(options);
}

export class NodeWorkflowDefinitionStore implements WorkflowDefinitionStorePort {
  private readonly definitionsDir: string;

  constructor(options: NodeWorkflowDefinitionStoreOptions = {}) {
    this.definitionsDir =
      options.definitionsDir ?? join(options.rootDir ?? DEFAULT_WORKFLOW_ROOT, "definitions");
  }

  async listDefinitions(options?: { signal?: AbortSignal }): Promise<WorkflowDefinition[]> {
    throwIfAborted(options?.signal, "Workflow definition list cancelled");
    let entries: string[];
    try {
      entries = await readdir(this.definitionsDir);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    const definitionIds = entries
      .filter((entry) => extname(entry) === WORKFLOW_DEFINITION_FILE_EXTENSION)
      .map((entry) => parse(entry).name)
      .sort((a, b) => a.localeCompare(b));
    const definitions: WorkflowDefinition[] = [];
    for (const definitionId of definitionIds) {
      const definition = await this.readDefinition(definitionId, options);
      if (definition) definitions.push(definition);
    }
    return definitions;
  }

  async readDefinition(
    definitionId: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowDefinition | null> {
    throwIfAborted(options?.signal, "Workflow definition read cancelled");
    validateDefinitionId(definitionId);
    const parsed = await readJson(this.definitionPath(definitionId), options?.signal);
    if (parsed === null) return null;
    const definition = WorkflowDefinitionSchema.parse(parsed);
    if (definition.definitionId !== definitionId) {
      throw new Error(
        `Workflow definition id mismatch: requested ${definitionId}, file declares ${definition.definitionId}`,
      );
    }
    return definition;
  }

  private definitionPath(definitionId: string): string {
    return join(this.definitionsDir, `${definitionId}${WORKFLOW_DEFINITION_FILE_EXTENSION}`);
  }
}

export function createNodeWorkflowDefinitionStore(
  options: NodeWorkflowDefinitionStoreOptions = {},
): WorkflowDefinitionStorePort {
  return new NodeWorkflowDefinitionStore(options);
}

export function getDefaultWorkflowRoot(): string {
  return DEFAULT_WORKFLOW_ROOT;
}

export function getDefaultWorkflowDefinitionsRoot(): string {
  return join(DEFAULT_WORKFLOW_ROOT, "definitions");
}

async function appendJsonLine(path: string, value: unknown, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, "Workflow JSONL append cancelled");
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, "utf8");
}

async function readJson(path: string, signal?: AbortSignal): Promise<unknown | null> {
  throwIfAborted(signal, "Workflow JSON read cancelled");
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonLines(path: string, signal?: AbortSignal): Promise<unknown[]> {
  throwIfAborted(signal, "Workflow JSONL read cancelled");
  try {
    const content = await readFile(path, "utf8");
    return content
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonFile(path: string, value: unknown, signal?: AbortSignal): Promise<void> {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, signal);
}

async function writeTextFile(path: string, content: string, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal, "Workflow file write cancelled");
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, "utf8");
  await rename(tempPath, path);
}

function normalizeRelativePath(value: string): string {
  const normalized = normalize(value);
  if (
    isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith(`..\\`) ||
    normalized.startsWith("../")
  ) {
    throw new Error(`Workflow artifact path must stay inside the run directory: ${value}`);
  }
  return normalized;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "unknown";
}

function validateDefinitionId(value: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    normalize(value) !== value ||
    !/^[a-zA-Z0-9._-]+$/.test(value)
  ) {
    throw new Error(`Workflow definition id must be a file-safe name: ${value}`);
  }
}

function throwIfAborted(signal: AbortSignal | undefined, message: string): void {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error(message);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  WORKFLOW_RUN_ID_PATTERN,
  createCoreError,
  CoreErrorType,
  isFileSystemPortError,
  type FileSystemPort,
  type Logger,
  type ScriptWorkflowRunStatus,
  type SessionId,
  type SessionStorePort,
  type TraceContext,
  type WorkflowOutput,
  type WorkflowPort,
  type WorkflowStartRequest,
  type WorkflowTaskSnapshot,
  type WorkflowTaskStatus,
} from "@zcode/contracts";
import { readWorkflowScriptDocument } from "./script-workflow-meta.js";
import type { ScriptWorkflowRuntime } from "./script-workflow-runtime.js";
import { isScriptWorkflowStore } from "./script-workflow-utils.js";

const WORKFLOW_SCRIPT_SUFFIX = ".workflow.js";
const WORKFLOW_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;
const BUILTIN_WORKFLOW_ALLOWLIST = new Map<string, string>();

interface ScriptWorkflowToolPortDeps {
  fileSystemPort: FileSystemPort;
  getRuntime: () => ScriptWorkflowRuntime;
  logger?: Logger;
  sessionId: SessionId;
  sessionStore: SessionStorePort;
  storageRoot: string;
  traceContext: TraceContext;
  workingDirectory: string;
}

export function createScriptWorkflowToolPort(deps: ScriptWorkflowToolPortDeps): WorkflowPort {
  const completionSnapshots = new Map<string, Promise<WorkflowTaskSnapshot | undefined>>();
  const launchSnapshots = new Map<string, WorkflowTaskSnapshot>();
  return {
    async getTask(taskId): Promise<WorkflowTaskSnapshot | undefined> {
      return (await getWorkflowTaskSnapshot(deps, taskId)) ?? launchSnapshots.get(taskId);
    },
    async waitForTask(taskId, options): Promise<WorkflowTaskSnapshot | undefined> {
      const current = (await getWorkflowTaskSnapshot(deps, taskId)) ?? launchSnapshots.get(taskId);
      if (!current || current.status !== "running") return current;
      const completion = completionSnapshots.get(taskId);
      if (!completion) return current;
      return waitForWorkflowTaskCompletion(completion, options?.signal);
    },
    async start(request, options): Promise<WorkflowOutput> {
      if (options?.signal?.aborted) {
        throw createCoreError(CoreErrorType.ToolCancelled, "Workflow launch cancelled");
      }
      const source = await resolveWorkflowToolSource(deps, request, options?.signal);
      if (options?.signal?.aborted) {
        throw createCoreError(CoreErrorType.ToolCancelled, "Workflow launch cancelled");
      }
      const runId = request.resumeFromRunId ?? `wf_${crypto.randomUUID()}`;
      if (!WORKFLOW_RUN_ID_PATTERN.test(runId)) {
        throw new Error(`Invalid workflow run id: ${runId}`);
      }
      const startedAt = new Date();
      launchSnapshots.set(runId, {
        description: source.name ?? runId,
        name: source.name,
        runId,
        startedAt,
        status: "running",
        taskId: runId,
      });

      const runtime = deps.getRuntime();
      // 后台 workflow 已脱离当前 tool call；父 turn 取消不应中止已返回 runId 的任务。
      const runAbortController = new AbortController();
      const runPromise = source.scriptPath
        ? runtime.run(
            {
              args: request.args,
              resumeFromRunId: request.resumeFromRunId,
              runId,
              scriptPath: source.scriptPath,
            },
            { abortSignal: runAbortController.signal },
          )
        : runtime.resume({ runId }, { abortSignal: runAbortController.signal });

      const completion = runPromise.then(
        (result) => {
          const snapshot: WorkflowTaskSnapshot = {
            completedAt: new Date(),
            description: source.name ?? result.runId,
            name: source.name,
            output: workflowOutputFromRunResult(result, source, deps.traceContext.traceId),
            runId,
            startedAt,
            status: workflowTaskStatus(result.status),
            taskId: runId,
          };
          launchSnapshots.set(runId, snapshot);
          return snapshot;
        },
        (error: unknown) => {
          const snapshot: WorkflowTaskSnapshot = {
            completedAt: new Date(),
            description: source.name ?? runId,
            error: toError(error).message,
            name: source.name,
            runId,
            startedAt,
            status: "failed",
            taskId: runId,
          };
          launchSnapshots.set(runId, snapshot);
          deps.logger?.error("Background workflow failed before status was persisted", toError(error), {
            event: "workflow.tool.background_failed",
            module: "bootstrap.workflow",
            runId,
            status: "failed",
          });
          return snapshot;
        },
      );
      completionSnapshots.set(
        runId,
        completion.finally(() => {
          completionSnapshots.delete(runId);
        }),
      );
      void completion;

      return {
        backgroundTaskId: runId,
        name: source.name,
        response: `Workflow started as ${runId}. Use /workflows ${runId} to watch progress.`,
        runId,
        scriptPath: source.scriptPath,
        status: "backgrounded",
        traceId: request.trace.traceId,
      };
    },
  };
}

function waitForWorkflowTaskCompletion(
  completion: Promise<WorkflowTaskSnapshot | undefined>,
  signal: AbortSignal | undefined,
): Promise<WorkflowTaskSnapshot | undefined> {
  if (!signal) return completion;
  if (signal.aborted) return Promise.reject(workflowAbortReason(signal));

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      cleanup();
      reject(workflowAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    completion.then(
      (snapshot) => {
        cleanup();
        resolve(snapshot);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function workflowAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Workflow task wait aborted");
}

function workflowOutputFromRunResult(
  result: Awaited<ReturnType<ScriptWorkflowRuntime["run"]>>,
  source: ResolvedWorkflowSource,
  traceId: string,
): WorkflowOutput {
  return {
    backgroundTaskId: result.runId,
    name: source.name,
    response: result.response,
    runId: result.runId,
    scriptPath: source.scriptPath,
    status: result.status === "completed" ? "completed" : "failed",
    traceId,
  };
}

async function getWorkflowTaskSnapshot(
  deps: ScriptWorkflowToolPortDeps,
  taskId: string,
): Promise<WorkflowTaskSnapshot | undefined> {
  if (!isScriptWorkflowStore(deps.sessionStore)) return undefined;
  const run = await deps.sessionStore.getScriptWorkflowRun(taskId);
  if (!run) return undefined;
  const status = workflowTaskStatus(run.status);
  return {
    completedAt: run.completedAt ? new Date(run.completedAt) : undefined,
    description: run.name,
    error: failureMessage(run.failure),
    name: run.name,
    output:
      status === "completed" || status === "failed" || status === "cancelled"
        ? {
            backgroundTaskId: run.id,
            name: run.name,
            response: `Workflow ${status}: ${run.id}`,
            runId: run.id,
            scriptPath: run.scriptPath,
            status: status === "completed" ? "completed" : "failed",
            traceId: deps.traceContext.traceId,
          }
        : undefined,
    runId: run.id,
    startedAt: new Date(run.startedAt ?? run.createdAt),
    status,
    taskId: run.id,
  };
}

interface ResolvedWorkflowSource {
  name?: string;
  scriptPath?: string;
}

async function resolveWorkflowToolSource(
  deps: ScriptWorkflowToolPortDeps,
  request: WorkflowStartRequest,
  signal?: AbortSignal,
): Promise<ResolvedWorkflowSource> {
  if (request.scriptPath) {
    const sourcePath = resolve(request.workingDirectory, request.scriptPath);
    await validateScriptPath(deps.fileSystemPort, sourcePath, request.trace, signal);
    const copiedPath = await persistScriptCopy(deps, request, sourcePath, signal);
    await validateScriptPath(deps.fileSystemPort, copiedPath, request.trace, signal);
    return { scriptPath: copiedPath };
  }

  if (request.script) {
    const scriptPath = await persistInlineScript(deps, request, signal);
    await validateScriptPath(deps.fileSystemPort, scriptPath, request.trace, signal);
    return { scriptPath };
  }

  if (request.name) {
    const sourcePath = await resolveNamedWorkflowPath(deps, request.name, request.trace, signal);
    const copiedPath = await persistScriptCopy(deps, request, sourcePath, signal);
    await validateScriptPath(deps.fileSystemPort, copiedPath, request.trace, signal);
    return { name: request.name, scriptPath: copiedPath };
  }

  if (request.resumeFromRunId) {
    return findResumeSource(deps, request.resumeFromRunId);
  }

  throw new Error("Workflow requires scriptPath, script, name, or resumeFromRunId.");
}

async function persistInlineScript(
  deps: ScriptWorkflowToolPortDeps,
  request: WorkflowStartRequest,
  signal?: AbortSignal,
): Promise<string> {
  const scriptPath = sessionWorkflowScriptPath(deps.storageRoot, deps.sessionId, request);
  await deps.fileSystemPort.writeTextFile(
    {
      atomic: true,
      content: request.script ?? "",
      createParents: true,
      path: scriptPath,
      trace: request.trace,
    },
    { signal },
  );
  return scriptPath;
}

async function persistScriptCopy(
  deps: ScriptWorkflowToolPortDeps,
  request: WorkflowStartRequest,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<string> {
  const script = await deps.fileSystemPort.readTextFile(
    { path: sourcePath, trace: request.trace },
    { signal },
  );
  const scriptPath = sessionWorkflowScriptPath(deps.storageRoot, deps.sessionId, request);
  await deps.fileSystemPort.writeTextFile(
    {
      atomic: true,
      content: script.content,
      createParents: true,
      path: scriptPath,
      trace: request.trace,
    },
    { signal },
  );
  return scriptPath;
}

async function resolveNamedWorkflowPath(
  deps: ScriptWorkflowToolPortDeps,
  name: string,
  trace: TraceContext,
  signal?: AbortSignal,
): Promise<string> {
  const fileName = workflowFileName(name);
  const candidates = [
    join(deps.workingDirectory, ".zcode", "workflows", fileName),
    join(homedir(), ".zcodium", "workflows", fileName),
  ];
  const builtIn = BUILTIN_WORKFLOW_ALLOWLIST.get(name);
  if (builtIn) candidates.push(builtIn);

  for (const candidate of candidates) {
    if (await isReadableFile(deps.fileSystemPort, candidate, trace, signal)) return candidate;
  }
  throw new Error(`Workflow not found: ${name}`);
}

async function findResumeSource(
  deps: ScriptWorkflowToolPortDeps,
  runId: string,
): Promise<ResolvedWorkflowSource> {
  if (!isScriptWorkflowStore(deps.sessionStore)) {
    throw new Error("Script workflow store is not available for this session store.");
  }
  const run = await deps.sessionStore.getScriptWorkflowRun(runId);
  if (!run) throw new Error(`Workflow run not found: ${runId}`);
  if (!run.scriptPath) throw new Error(`Workflow run has no script path: ${runId}`);
  return { name: run.name, scriptPath: run.scriptPath };
}

async function validateScriptPath(
  fileSystemPort: FileSystemPort,
  scriptPath: string,
  traceContext: TraceContext,
  signal?: AbortSignal,
): Promise<void> {
  await readWorkflowScriptDocument({ fileSystemPort, scriptPath, traceContext });
  if (signal?.aborted) {
    throw createCoreError(CoreErrorType.ToolCancelled, "Workflow launch cancelled");
  }
}

async function isReadableFile(
  fileSystemPort: FileSystemPort,
  path: string,
  trace: TraceContext,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const stat = await fileSystemPort.stat({ path, trace }, { signal });
    return stat.kind === "file";
  } catch (error) {
    if (isFileSystemPortError(error) && error.code === "not_found") return false;
    throw error;
  }
}

function workflowFileName(name: string): string {
  if (!WORKFLOW_NAME_PATTERN.test(name)) {
    throw new Error(`Workflow name must contain only letters, numbers, dot, dash, or underscore.`);
  }
  return name.endsWith(WORKFLOW_SCRIPT_SUFFIX) ? name : `${name}${WORKFLOW_SCRIPT_SUFFIX}`;
}

function workflowTaskStatus(status: ScriptWorkflowRunStatus): WorkflowTaskStatus {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "pending" || status === "running" || status === "paused") return "running";
  return "lost";
}

function failureMessage(failure: unknown): string | undefined {
  if (!failure) return undefined;
  if (typeof failure === "string") return failure;
  if (typeof failure === "object" && "message" in failure) {
    const message = (failure as { message?: unknown }).message;
    return typeof message === "string" ? message : undefined;
  }
  return String(failure);
}

function sessionWorkflowScriptPath(
  storageRoot: string,
  sessionId: SessionId,
  request: WorkflowStartRequest,
): string {
  const baseName = request.name
    ? workflowFileName(request.name)
    : `${safeId(request.parentToolCallId)}${WORKFLOW_SCRIPT_SUFFIX}`;
  return join(storageRoot, "cli", "sessions", sessionId, "workflows", baseName);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

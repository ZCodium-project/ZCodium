import type {
  ScriptWorkflowRunStats,
  ScriptWorkflowStorePort,
  SessionId,
  SessionStorePort,
  WorkflowAgentCallInput,
} from "@zcode/contracts";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";

const STRUCTURED_OUTPUT_PROMPT =
  "Return only JSON that conforms to the provided JSON Schema. Do not wrap it in Markdown.";

export class WorkflowLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolveAcquire) => this.queue.push(resolveAcquire));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

export function buildAgentPrompt(input: WorkflowAgentCallInput): string {
  const blocks = [];
  if (input.opts?.instructions) blocks.push(input.opts.instructions);
  if (input.opts?.skills?.length) {
    blocks.push(`Use these skills if they are available: ${input.opts.skills.join(", ")}`);
  }
  blocks.push(input.prompt);
  if (input.opts?.schema) {
    blocks.push(`${STRUCTURED_OUTPUT_PROMPT}\nSchema:\n${JSON.stringify(input.opts.schema)}`);
  }
  return blocks.join("\n\n");
}

export function parseStructuredResponse(response: string): unknown {
  const candidate = extractJsonResponse(response);
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new Error("Workflow agent returned non-JSON structured output", { cause: error });
  }
}

function extractJsonResponse(response: string): string {
  const trimmed = response.trim();
  const fenced = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();

  const objectStart = firstJsonStart(trimmed);
  if (objectStart < 0) return trimmed;
  const objectEnd = findJsonValueEnd(trimmed, objectStart);
  return objectEnd < 0 ? trimmed : trimmed.slice(objectStart, objectEnd + 1);
}

function firstJsonStart(value: string): number {
  const objectIndex = value.indexOf("{");
  const arrayIndex = value.indexOf("[");
  if (objectIndex < 0) return arrayIndex;
  if (arrayIndex < 0) return objectIndex;
  return Math.min(objectIndex, arrayIndex);
}

function findJsonValueEnd(value: string, start: number): number {
  const stack: string[] = [];
  for (let index = start; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === '"' || char === "'") {
      index = scanJsonString(value, index, char);
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      continue;
    }
    if (char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (stack.length === 0) return index;
    }
  }
  return -1;
}

function scanJsonString(value: string, start: number, quote: string): number {
  for (let index = start + 1; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === quote) return index;
  }
  return value.length - 1;
}

export function mergedSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
): AbortSignal | undefined {
  if (!timeoutMs) return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export function isScriptWorkflowStore(
  store: SessionStorePort,
): store is SessionStorePort & ScriptWorkflowStorePort {
  return "createScriptWorkflowRun" in store && "createScriptWorkflowActivity" in store;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export async function collectScriptWorkflowSessionStats(
  sessionStore: SessionStorePort,
  sessionId: SessionId,
  createEmptyStats: () => ScriptWorkflowRunStats,
): Promise<ScriptWorkflowRunStats> {
  const messages = await sessionStore.messages({ sessionID: sessionId });
  const stats = createEmptyStats();
  stats.agentCalls = 1;
  for (const message of messages) {
    stats.toolCalls += message.parts.filter((part) => part.type === "tool").length;
    if (message.info.role !== "assistant") continue;
    stats.tokens.cacheRead += message.info.tokens.cache.read;
    stats.tokens.cacheWrite += message.info.tokens.cache.write;
    stats.tokens.input += message.info.tokens.input;
    stats.tokens.output += message.info.tokens.output;
    stats.tokens.reasoning += message.info.tokens.reasoning;
    stats.tokens.total +=
      message.info.tokens.total ??
      message.info.tokens.input + message.info.tokens.output + message.info.tokens.reasoning;
  }
  return stats;
}

export function inferScriptWorkflowScope(
  scriptPath: string,
  workingDirectory: string,
): "explicit" | "project" | "user" {
  if (isWithin(scriptPath, join(workingDirectory, ".zcode", "workflows"))) return "project";
  if (isWithin(scriptPath, join(homedir(), ".zcodium", "workflows"))) return "user";
  return "explicit";
}

function isWithin(filePath: string, directory: string): boolean {
  const rel = relative(directory, filePath);
  return rel.length === 0 || (!rel.startsWith("..") && !isAbsolute(rel));
}

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelTextResult } from "@zcode/contracts";
import { ZCODE_RUNTIME_ENV_KEY, normalizeZCodeRuntimeEnv } from "@zcode/shared";
import { redactAnthropicRequestMetadata } from "./anthropic-request-metadata.js";
import type { EnvRecord } from "./model-execution.js";
import { sanitizeModelIODebugRecord } from "./runner-debug-redaction.js";
import { getGenerateTextResultMetadata } from "./runner-diagnostics.js";
import {
  normalizeReasoning,
  normalizeSources,
  normalizeToolResults,
  normalizeUsage,
} from "./runner-normalization.js";
import { stringMetadata } from "./runner-record.js";
import type {
  AiSdkGenerateTextOptions,
  AiSdkGenerateTextResult,
  AiSdkModelTextRequest,
  AiSdkStreamTextOptions,
  AiSdkStreamTextResult,
  ResolvedAiSdkModel,
} from "./runner-runtime.js";

// 生产环境 rollout 目录最多保留的 model-io 会话文件数。超出删最旧。
const MAX_ROLLOUT_FILES = 3;
// 生产环境单个 session 的 model-io 文件硬上限。诊断日志不能因为无限增长影响 agent 主流程。
const MAX_ROLLOUT_SESSION_BYTES = 64 * 1024 * 1024;
// 开发态保留更多上下文，但仍避免单个 debug 文件无限膨胀。
const MAX_DEBUG_SESSION_BYTES = 256 * 1024 * 1024;
// 缓存缺失或文件超限后写 baseline 时，仅保留最近上下文，避免长 session 重启后再次写出巨型记录。
const MAX_ROLLOUT_BASELINE_MESSAGES = 64;
const MAX_DEBUG_BASELINE_MESSAGES = 256;
const FINGERPRINT_STRING_LIMIT = 512;

interface ModelIOCollectionState {
  count: number;
  firstFingerprint?: string;
  lastFingerprint?: string;
  sampleFingerprints?: string[];
}

interface ModelIORequestCompactionState {
  bodyMessages?: ModelIOCollectionState;
  messages?: ModelIOCollectionState;
  sdkMessages?: ModelIOCollectionState;
}

interface ModelIOCompactionState {
  request?: ModelIORequestCompactionState;
}

const modelIOCompactionStates = new Map<string, ModelIOCompactionState>();

export function shouldRecordModelIO(env: EnvRecord): boolean {
  // 开发态与生产态都记录(分别落到 debug / rollout 目录);仅测试态(ZCODE_RUNTIME_ENV=test)不写,
  // 避免单测产生磁盘副作用。未设时按生产处理(记录到 rollout,带条数上限)。
  return normalizeRuntimeEnv(env) !== "test";
}

// 判定当前是否开发态,用于选择落盘目录(debug vs rollout)。
// 直接看 ZCODE_RUNTIME_ENV === "development";dev 桌面/CLI 启动时已注入该变量。
export function isDevelopmentModelIOEnv(env: EnvRecord): boolean {
  return normalizeRuntimeEnv(env) === "development";
}

export function recordGenerateTextDebug(input: {
  attempt: number;
  debugDir?: string;
  error?: unknown;
  isDev: boolean;
  modelIoFullRetentionEnabled: boolean;
  normalizedToolCalls: ModelTextResult["toolCalls"];
  options: AiSdkGenerateTextOptions;
  recordModelIO: boolean;
  request: AiSdkModelTextRequest;
  requestId: string;
  resolved: ResolvedAiSdkModel;
  result?: AiSdkGenerateTextResult;
  startedAt: number;
}): void {
  if (!input.recordModelIO) {
    return;
  }

  const completedAt = Date.now();
  const resultWithMetadata = getGenerateTextResultMetadata(input.result);
  const metadata = input.request.metadata ?? {};
  const requestBody =
    input.resolved.rawRequestBodyCapture?.body ??
    resultWithMetadata?.request?.body ??
    (input.error
      ? buildFallbackRequestBodyFromOptions({
          options: input.options,
          resolved: input.resolved,
          stream: false,
        })
      : undefined);

  writeModelIODebugRecord(
    {
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - input.startedAt,
      error: input.error ? serializeError(input.error) : undefined,
      requestId: input.requestId,
      attempt: input.attempt,
      model: {
        modelId: input.resolved.modelId,
        providerId: input.resolved.providerId,
      },
      request: {
        body: redactAnthropicRequestMetadata(requestBody),
        headers: input.options.headers,
        maxOutputTokens: input.options.maxOutputTokens,
        messages: input.request.messages,
        providerOptions: input.request.providerOptions,
        sdkMessages: input.options.messages,
        temperature: input.request.temperature,
        toolChoice: input.request.toolChoice,
        toolNames: input.request.tools?.map((toolContract) => toolContract.name) ?? [],
      },
      response: input.result
        ? {
            body: resultWithMetadata?.response?.body,
            finishReason: input.result.finishReason,
            headers: resultWithMetadata?.response?.headers,
            modelId: resultWithMetadata?.response?.modelId,
            providerMetadata: input.result.providerMetadata,
            // 运行结果已有 reasoning，但 model-io 过去只记录 text，
            // 导致调用轨迹无法得到 response.reasoningText，始终不显示思考过程。
            reasoningText: modelIOReasoningText(input.result.reasoning),
            responseId: resultWithMetadata?.response?.id,
            text: input.result.text,
            toolCalls: input.normalizedToolCalls,
            toolResults: normalizeToolResults(input.result, input.normalizedToolCalls),
            sources: normalizeSources(input.result),
            usage: normalizeUsage(input.result.totalUsage ?? input.result.usage),
          }
        : undefined,
      sessionId: stringMetadata(metadata.sessionId),
      querySource: stringMetadata(metadata.querySource),
      startedAt: new Date(input.startedAt).toISOString(),
      traceId: stringMetadata(metadata.traceId),
      turnId: stringMetadata(metadata.turnId),
      type: "model_io",
    },
    input.debugDir,
    input.isDev,
    input.modelIoFullRetentionEnabled,
  );
}

/**
 * 流式请求的 model I/O 记录。
 *
 * 背景（bug：开发态桌面 agent 始终走流式，model-io 一直为空）：
 * 只在非流式 `runGenerateText` 里写 model-io 会让桌面/协议端默认 `modelStreaming: "on"` 的
 * 每个 turn（`streamText`）即便 ZCODE_RUNTIME_ENV=development 也从不落盘。流式路径同样要记录。
 *
 * 与 generate 路径的关键差异：StreamTextResult 的 text/toolResults/sources/response 等聚合字段是 **promise**，
 * 必须等 fullStream 读完后再 await；toolResults/sources 的归一化期望数组，
 * 所以先解析聚合 promise，再用合成对象处理。toolCalls 则直接复用 assembler 的归一化快照。
 * 任何失败都不得影响模型请求路径。
 */
export async function recordStreamTextDebug(input: {
  attempt: number;
  debugDir?: string;
  error?: unknown;
  isDev: boolean;
  modelIoFullRetentionEnabled: boolean;
  normalizedToolCalls: ModelTextResult["toolCalls"];
  options: AiSdkStreamTextOptions;
  recordModelIO: boolean;
  request: AiSdkModelTextRequest;
  requestId: string;
  resolved: ResolvedAiSdkModel;
  result?: AiSdkStreamTextResult;
  startedAt: number;
}): Promise<void> {
  if (!input.recordModelIO) {
    return;
  }

  try {
    // 成功路径下解析完整聚合结果；失败路径只读取 request/response 元数据，且必须限时——
    // 流中途被 abort（用户 Stop / idle timeout）后 AI SDK 的聚合 promise 永不 settle。
    const aggregate = input.result
      ? input.error
        ? await resolveFailedStreamModelIOAggregate(input.result, input.request.abortSignal)
        : await resolveStreamModelIOAggregate(input.result)
      : undefined;
    const completedAt = Date.now();
    const metadata = input.request.metadata ?? {};
    const requestBody =
      input.resolved.rawRequestBodyCapture?.body ??
      aggregate?.requestBody ??
      (input.error
        ? buildFallbackRequestBodyFromOptions({
            options: input.options,
            resolved: input.resolved,
            stream: true,
          })
        : undefined);
    const syntheticResult = {
      toolResults: aggregate?.toolResults,
      sources: aggregate?.sources,
    } as unknown as AiSdkGenerateTextResult;

    writeModelIODebugRecord(
      {
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - input.startedAt,
        error: input.error ? serializeError(input.error) : undefined,
        requestId: input.requestId,
        attempt: input.attempt,
        model: {
          modelId: input.resolved.modelId,
          providerId: input.resolved.providerId,
        },
        request: {
          body: redactAnthropicRequestMetadata(requestBody),
          headers: input.options.headers,
          maxOutputTokens: input.options.maxOutputTokens,
          messages: input.request.messages,
          providerOptions: input.request.providerOptions,
          sdkMessages: input.options.messages,
          temperature: input.request.temperature,
          toolChoice: input.request.toolChoice,
          toolNames: input.request.tools?.map((toolContract) => toolContract.name) ?? [],
        },
        response: aggregate
          ? {
              body: aggregate.responseBody,
              finishReason: aggregate.finishReason,
              headers: aggregate.responseHeaders,
              modelId: aggregate.responseModelId,
              providerMetadata: aggregate.providerMetadata,
              reasoningText: modelIOReasoningText(aggregate.reasoning),
              responseId: aggregate.responseId,
              text: aggregate.text,
              // assembler 是流式参数归一化的唯一所有者；
              // model-io 复用其快照，避免二次解析、重复 warn 和诊断结果漂移。
              toolCalls: input.normalizedToolCalls,
              toolResults: normalizeToolResults(syntheticResult, input.normalizedToolCalls),
              sources: normalizeSources(syntheticResult),
              usage: normalizeUsage(aggregate.usage),
            }
          : undefined,
        sessionId: stringMetadata(metadata.sessionId),
        querySource: stringMetadata(metadata.querySource),
        startedAt: new Date(input.startedAt).toISOString(),
        traceId: stringMetadata(metadata.traceId),
        turnId: stringMetadata(metadata.turnId),
        type: "model_io",
      },
      input.debugDir,
      input.isDev,
      input.modelIoFullRetentionEnabled,
    );
  } catch {
    // Model I/O debug logging must never affect the model request path.
  }
}

function buildFallbackRequestBodyFromOptions(input: {
  options: AiSdkGenerateTextOptions | AiSdkStreamTextOptions;
  resolved: ResolvedAiSdkModel;
  stream: boolean;
}): Record<string, unknown> {
  const options = input.options as Record<string, unknown>;
  return removeUndefined({
    // 失败路径经常拿不到 AI SDK 暴露的 raw request.body。此处记录送入
    // AI SDK 的完整 payload 快照，方便排查 provider 400 的 messages/tools 结构。
    bodySource: "ai_sdk_options",
    experimental_include: options.experimental_include,
    frequencyPenalty: options.frequencyPenalty,
    maxOutputTokens: options.maxOutputTokens,
    messages: options.messages,
    model: input.resolved.modelId,
    presencePenalty: options.presencePenalty,
    providerOptions: options.providerOptions,
    seed: options.seed,
    stopSequences: options.stopSequences,
    stream: input.stream,
    temperature: options.temperature,
    toolChoice: options.toolChoice,
    tools: options.tools,
    topK: options.topK,
    topP: options.topP,
  });
}

interface StreamModelIOAggregate {
  finishReason?: unknown;
  providerMetadata?: unknown;
  reasoning?: unknown;
  requestBody?: unknown;
  responseBody?: unknown;
  responseHeaders?: unknown;
  responseId?: unknown;
  responseModelId?: unknown;
  sources?: unknown;
  text?: unknown;
  toolResults?: unknown;
  usage?: Parameters<typeof normalizeUsage>[0];
}

// StreamTextResult 的聚合字段都是 promise，逐个 best-effort 解析(失败回退 undefined)。
async function resolveStreamModelIOAggregate(
  result: AiSdkStreamTextResult,
): Promise<StreamModelIOAggregate> {
  const streamResult = result as unknown as {
    text?: Promise<unknown>;
    reasoning?: Promise<unknown>;
    finishReason?: Promise<unknown>;
    totalUsage?: Promise<unknown>;
    usage?: Promise<unknown>;
    toolResults?: Promise<unknown>;
    sources?: Promise<unknown>;
    providerMetadata?: Promise<unknown>;
    request?: Promise<unknown>;
    response?: Promise<unknown>;
  };

  const [
    text,
    reasoning,
    finishReason,
    totalUsage,
    usage,
    toolResults,
    sources,
    providerMetadata,
    request,
    response,
  ] = await Promise.all([
    settleModelIOValue(streamResult.text),
    settleModelIOValue(streamResult.reasoning),
    settleModelIOValue(streamResult.finishReason),
    settleModelIOValue(streamResult.totalUsage),
    settleModelIOValue(streamResult.usage),
    settleModelIOValue(streamResult.toolResults),
    settleModelIOValue(streamResult.sources),
    settleModelIOValue(streamResult.providerMetadata),
    settleModelIOValue(streamResult.request),
    settleModelIOValue(streamResult.response),
  ]);

  const requestRecord = (request ?? undefined) as { body?: unknown } | undefined;
  const responseRecord = (response ?? undefined) as
    | { id?: unknown; modelId?: unknown; headers?: unknown; body?: unknown }
    | undefined;

  return {
    text,
    reasoning,
    finishReason,
    usage: (totalUsage ?? usage) as StreamModelIOAggregate["usage"],
    toolResults,
    sources,
    providerMetadata,
    requestBody: requestRecord?.body,
    responseBody: responseRecord?.body,
    responseHeaders: responseRecord?.headers,
    responseId: responseRecord?.id,
    responseModelId: responseRecord?.modelId,
  };
}

function modelIOReasoningText(reasoning: unknown): string | undefined {
  if (!Array.isArray(reasoning)) {
    return undefined;
  }

  const text = normalizeReasoning(reasoning)
    ?.map((part) => part.text)
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  return text && text.length > 0 ? text : undefined;
}

// 流中途被 abort 后，AI SDK 的 request/response 聚合 promise 既不 resolve 也不 reject
// （只有流正常读完或流级报错才会 settle），无限 await 会把 runner-stream 的 catch 挂死，
// turn 永不结束、activeAbortController 永不释放，session 从此拒绝一切新 prompt。
// 诊断记录是 best-effort：调用方已 abort 时直接跳过聚合，其余失败限时等待。
const FAILED_STREAM_AGGREGATE_TIMEOUT_MS = 1_000;

async function resolveFailedStreamModelIOAggregate(
  result: AiSdkStreamTextResult,
  abortSignal?: AbortSignal,
): Promise<StreamModelIOAggregate> {
  if (abortSignal?.aborted) {
    // 用户 Stop：让失败路径立即走完，request body 由 fallback 快照兜底。
    return {};
  }
  const streamResult = result as unknown as {
    request?: Promise<unknown>;
    response?: Promise<unknown>;
  };
  const [request, response] = await Promise.all([
    settleModelIOValueWithTimeout(streamResult.request, FAILED_STREAM_AGGREGATE_TIMEOUT_MS),
    settleModelIOValueWithTimeout(streamResult.response, FAILED_STREAM_AGGREGATE_TIMEOUT_MS),
  ]);
  const requestRecord = (request ?? undefined) as { body?: unknown } | undefined;
  const responseRecord = (response ?? undefined) as
    | { id?: unknown; modelId?: unknown; headers?: unknown; body?: unknown }
    | undefined;

  return {
    requestBody: requestRecord?.body,
    responseBody: responseRecord?.body,
    responseHeaders: responseRecord?.headers,
    responseId: responseRecord?.id,
    responseModelId: responseRecord?.modelId,
  };
}

async function settleModelIOValue<T>(value: Promise<T> | T | undefined): Promise<T | undefined> {
  try {
    return await value;
  } catch {
    return undefined;
  }
}

// 用户 stop / v4 sendQueuedNow 抢占会 abort 当前流式请求；此时
// AI SDK StreamTextResult 的 request/response 聚合 promise 永不 settle——流被中途放弃，
// 聚合要等 fullStream 关闭才 resolve，而关闭 iterator 的 finally（runner-stream.ts）
// 又排在本 await 之后，形成循环等待。settleModelIOValue 只兜 reject 不兜「不 settle」，
// 导致 runStreamText 的 catch 永远不结束：TurnCancelled 无法上抛、turn 永不收口、
// record.activeAbortController 不释放、UI 的 stop（canStop）永久失效
// （e2e 复现：conversation-session-v4-vertical-slice / v4-sendnow）。
// 失败路径的 model-io 记录必须有界等待：超时按「值不可得」处理，绝不阻塞错误传播。
async function settleModelIOValueWithTimeout<T>(
  value: Promise<T> | T | undefined,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), timeoutMs);
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    });
    return await Promise.race([settleModelIOValue(value), timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

// 归一化 ZCODE_RUNTIME_ENV；未设置时返回 undefined,由调用方按生产处理。
function normalizeRuntimeEnv(env: EnvRecord): string | undefined {
  return normalizeZCodeRuntimeEnv(env[ZCODE_RUNTIME_ENV_KEY]);
}

function writeModelIODebugRecord(
  record: Record<string, unknown>,
  debugDir?: string,
  isDev?: boolean,
  modelIoFullRetentionEnabled = false,
): void {
  try {
    // model-I/O 诊断直接持久化 AI SDK 的 request/response headers，
    // 闲时 Provider 的 JWT、Coding Plan Key 与 ticket 因此会写入按 session 命名的文件。
    // 在统一落盘边界复用网络遥测脱敏，保证 generate/stream 及后续调用方都不会漏掉。
    const sanitizedRecord = sanitizeModelIODebugRecord(record);
    const development = isDev ?? false;
    const dir = debugDir ?? getModelIOBaseDir(isDev ?? false);
    mkdirSync(dir, { recursive: true });
    const sessionSegment =
      sanitizeFileSegment(stringMetadata(sanitizedRecord.sessionId)) || "no-session";
    const fileName = `model-io-${sessionSegment}.jsonl`;
    const filePath = join(dir, fileName);
    const fileExists = existsSync(filePath);
    if (modelIoFullRetentionEnabled) {
      // 全量保留仍经过统一脱敏边界，但跳过轮转、限额重置、生产裁剪和上下文压缩。
      // 这是用户显式选择的诊断模式；更新 compaction state 使关闭后下一次 bounded 写入可平滑续接。
      appendFileSync(filePath, `${stringifyDebugRecord(sanitizedRecord)}\n`, "utf8");
      modelIOCompactionStates.set(filePath, buildModelIOCompactionState(sanitizedRecord));
      return;
    }
    // 生产态(rollout)做容量上限,避免长期运行把磁盘刷爆;开发态(debug)也保留更高的单文件上限。
    // 同一 session 之前每次模型请求都会新建一个完整上下文文件，形成三角形重复；
    // 现在改为一个 session 一个 JSONL 文件，新请求 append 到同文件，只有新 session 才参与淘汰。
    if (!development && !fileExists) {
      rotateModelIOFiles(dir, MAX_ROLLOUT_FILES - 1);
    }
    const existingBytes = fileExists ? readFileSize(filePath) : 0;
    const maxSessionBytes = development ? MAX_DEBUG_SESSION_BYTES : MAX_ROLLOUT_SESSION_BYTES;
    const resetForSizeLimit = existingBytes >= maxSessionBytes;
    const preparedRecord = prepareModelIORecordForWrite(sanitizedRecord, development);
    const previousState =
      fileExists && !resetForSizeLimit ? modelIOCompactionStates.get(filePath) : undefined;
    const compacted = compactModelIORecord(preparedRecord, previousState, {
      maxBaselineMessages: development
        ? MAX_DEBUG_BASELINE_MESSAGES
        : MAX_ROLLOUT_BASELINE_MESSAGES,
      preserveFullBodyMessages: Boolean(preparedRecord.error),
    });
    const recordToWrite = resetForSizeLimit
      ? {
          ...compacted,
          modelIOReset: {
            maxFileBytes: maxSessionBytes,
            previousFileBytes: existingBytes,
            reason: "session_file_size_limit",
          },
        }
      : compacted;
    const line = `${stringifyDebugRecord(recordToWrite)}\n`;
    if (resetForSizeLimit) {
      // 每次 append 前同步读取并 expand 整个历史 JSONL 的话，长 session 的 rollout
      // 文件达到 GB 级时会在 UTF-8 转换/V8 字符串分配阶段 native crash。超限时直接重置为
      // 当前 bounded baseline，保证诊断日志不会威胁 agent 主流程。
      writeFileSync(filePath, line, "utf8");
    } else {
      appendFileSync(filePath, line, "utf8");
    }
    modelIOCompactionStates.set(filePath, buildModelIOCompactionState(preparedRecord));
  } catch {
    // Model I/O debug logging must never affect the model request path.
  }
}

// 保证目录下 model-io-*.jsonl 文件数不超过 maxFiles(为本次新 session 文件留位时传 maxFiles-1)。
function rotateModelIOFiles(dir: string, maxFiles: number): void {
  let files: string[];
  try {
    files = readdirSync(dir).filter(
      (name) => name.startsWith("model-io-") && name.endsWith(".jsonl"),
    );
  } catch {
    return; // 目录刚创建/读取失败,无需淘汰
  }

  let removeCount = files.length - maxFiles;
  if (removeCount <= 0) {
    return;
  }

  const oldestFirst = files
    .map((name) => {
      try {
        return { name, mtimeMs: statSync(join(dir, name)).mtimeMs };
      } catch {
        return { name, mtimeMs: 0 };
      }
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((entry) => entry.name);
  for (const name of oldestFirst) {
    if (removeCount <= 0) break;
    const filePath = join(dir, name);
    try {
      rmSync(filePath, { force: true });
      modelIOCompactionStates.delete(filePath);
      removeCount -= 1;
    } catch {
      // 单个文件删除失败不阻断写入
    }
  }
}

// 仅保留文件名安全字符,其余折叠为 -,并限长避免触达 Windows 路径长度上限。
function sanitizeFileSegment(value?: string): string {
  if (!value) {
    return "";
  }
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// storage profile 回滚删除了自定义 CLI 根模块，遗留 import 会让 adapters 无法构建。
// 这里保持历史语义：开发态写 ~/.zcodium/cli/debug，生产态写 ~/.zcodium/cli/rollout。
function getModelIOBaseDir(isDev: boolean): string {
  return join(homedir(), ".zcodium", "cli", isDev ? "debug" : "rollout");
}

function stringifyDebugRecord(record: Record<string, unknown>): string {
  return JSON.stringify(record);
}

function readFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function prepareModelIORecordForWrite(
  record: Record<string, unknown>,
  isDev: boolean,
): Record<string, unknown> {
  if (isDev) {
    return record;
  }

  const request = asRecord(record.request);
  const response = asRecord(record.response);
  return {
    ...record,
    request: request ? prepareProductionRequestRecord(request, Boolean(record.error)) : request,
    response: response ? prepareProductionResponseRecord(response) : response,
  };
}

function prepareProductionRequestRecord(
  request: Record<string, unknown>,
  hasError: boolean,
): Record<string, unknown> {
  const next = { ...request };
  // 生产 rollout 只保留 canonical request.messages。sdkMessages 与 provider body.messages
  // 通常是同一上下文的重复拷贝，长会话下会把诊断文件和单次 stringify 放大数倍。
  delete next.sdkMessages;
  const body = asRecord(next.body);
  if (body && !hasError) {
    const nextBody = { ...body };
    delete nextBody.messages;
    next.body = nextBody;
  }
  return next;
}

function prepareProductionResponseRecord(
  response: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...response };
  // response.body 在生产排障里价值低于 text/toolCalls/usage/finishReason，且可能包含 provider 原始大包。
  delete next.body;
  return next;
}

function compactModelIORecord(
  record: Record<string, unknown>,
  previousState: ModelIOCompactionState | undefined,
  options: { maxBaselineMessages: number; preserveFullBodyMessages?: boolean },
): Record<string, unknown> {
  const request = asRecord(record.request);
  if (!request) {
    return record;
  }

  return {
    ...record,
    request: compactModelIORequest(request, previousState?.request, options),
  };
}

function compactModelIORequest(
  request: Record<string, unknown>,
  previousState: ModelIORequestCompactionState | undefined,
  options: { maxBaselineMessages: number; preserveFullBodyMessages?: boolean },
): Record<string, unknown> {
  const next = { ...request };
  compactMessageCollection(
    next,
    previousState?.messages,
    {
      collectionKey: "messages",
      countKey: "messageCount",
      kindKey: "messagesKind",
      offsetKey: "messageOffset",
    },
    options,
  );
  compactMessageCollection(
    next,
    previousState?.sdkMessages,
    {
      collectionKey: "sdkMessages",
      countKey: "sdkMessageCount",
      kindKey: "sdkMessagesKind",
      offsetKey: "sdkMessageOffset",
    },
    options,
  );

  const body = asRecord(next.body);
  if (body) {
    const nextBody = { ...body };
    const bodyMessageKeys = {
      collectionKey: "messages",
      countKey: "bodyMessageCount",
      kindKey: "bodyMessagesKind",
      offsetKey: "bodyMessageOffset",
    };
    if (options.preserveFullBodyMessages && Array.isArray(nextBody.messages)) {
      // provider 400 等失败排障需要 exact request payload；失败记录若继续
      // 按上一条 model-io 做 delta，会把最关键的完整 messages 丢在导出包之外。
      next[bodyMessageKeys.countKey] = nextBody.messages.length;
      next[bodyMessageKeys.kindKey] = "full";
      next[bodyMessageKeys.offsetKey] = 0;
    } else {
      compactMessageCollection(
        nextBody,
        previousState?.bodyMessages,
        bodyMessageKeys,
        options,
        next,
      );
    }
    next.body = nextBody;
  }

  return next;
}

function compactMessageCollection(
  target: Record<string, unknown>,
  previousState: ModelIOCollectionState | undefined,
  keys: {
    collectionKey: string;
    countKey: string;
    kindKey: string;
    offsetKey: string;
  },
  options: { maxBaselineMessages: number },
  metadataTarget: Record<string, unknown> = target,
): void {
  const currentMessages = target[keys.collectionKey];
  if (!Array.isArray(currentMessages)) {
    return;
  }

  metadataTarget[keys.countKey] = currentMessages.length;
  if (canStoreDeltaFromState(currentMessages, previousState)) {
    // 后续 model-io 只记录相对上一请求新增的消息，避免完整历史在同一 session 内梯度重复。
    // previousState 来自进程内缓存，不再为 append 同步读取并 expand 整个历史 JSONL。
    target[keys.collectionKey] = currentMessages.slice(previousState.count);
    metadataTarget[keys.kindKey] = "delta";
    metadataTarget[keys.offsetKey] = previousState.count;
    return;
  }

  const maxBaselineMessages = Math.max(1, options.maxBaselineMessages);
  if (currentMessages.length > maxBaselineMessages) {
    const offset = currentMessages.length - maxBaselineMessages;
    target[keys.collectionKey] = currentMessages.slice(offset);
    metadataTarget[keys.kindKey] = "tail";
    metadataTarget[keys.offsetKey] = offset;
    return;
  }

  metadataTarget[keys.kindKey] = "full";
  metadataTarget[keys.offsetKey] = 0;
}

function canStoreDeltaFromState(
  currentMessages: unknown[],
  previousState: ModelIOCollectionState | undefined,
): previousState is ModelIOCollectionState {
  if (!previousState || previousState.count <= 0 || currentMessages.length < previousState.count) {
    return false;
  }
  const firstFingerprint = fingerprintValue(currentMessages[0]);
  const lastFingerprint = fingerprintValue(currentMessages[previousState.count - 1]);
  return (
    firstFingerprint === previousState.firstFingerprint &&
    lastFingerprint === previousState.lastFingerprint &&
    hasSameSampleFingerprints(currentMessages, previousState)
  );
}

function buildModelIOCompactionState(record: Record<string, unknown>): ModelIOCompactionState {
  const request = asRecord(record.request);
  if (!request) {
    return {};
  }

  return {
    request: buildRequestCompactionState(request),
  };
}

function buildRequestCompactionState(
  request: Record<string, unknown>,
): ModelIORequestCompactionState {
  const body = asRecord(request.body);
  return {
    bodyMessages: buildCollectionState(body?.messages),
    messages: buildCollectionState(request.messages),
    sdkMessages: buildCollectionState(request.sdkMessages),
  };
}

function buildCollectionState(value: unknown): ModelIOCollectionState | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return {
    count: value.length,
    firstFingerprint: fingerprintValue(value[0]),
    lastFingerprint: fingerprintValue(value[value.length - 1]),
    sampleFingerprints: fingerprintCollectionSamples(value),
  };
}

function hasSameSampleFingerprints(
  currentMessages: unknown[],
  previousState: ModelIOCollectionState,
): boolean {
  const previousSamples = previousState.sampleFingerprints;
  if (!previousSamples) {
    return true;
  }
  const currentSamples = fingerprintCollectionSamples(currentMessages, previousState.count);
  return (
    currentSamples.length === previousSamples.length &&
    currentSamples.every((fingerprint, index) => fingerprint === previousSamples[index])
  );
}

function fingerprintCollectionSamples(value: unknown[], count = value.length): string[] {
  if (count <= 0) {
    return [];
  }
  // 常数级采样首/中/尾位置，避免把整段历史 stringify 成巨型字符串，同时降低中间历史变更被误判为 delta 的概率。
  const lastIndex = count - 1;
  const indexes = new Set([
    0,
    Math.floor(lastIndex * 0.25),
    Math.floor(lastIndex * 0.5),
    Math.floor(lastIndex * 0.75),
    lastIndex,
  ]);
  return [...indexes].map((index) => fingerprintValue(value[index]));
}

function fingerprintValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "string") {
    return [
      "string",
      String(value.length),
      value.slice(0, FINGERPRINT_STRING_LIMIT),
      value.slice(-FINGERPRINT_STRING_LIMIT),
    ].join(":");
  }
  if (typeof value !== "object") {
    return `${typeof value}:${String(value)}`;
  }
  if (depth >= 3) {
    return Array.isArray(value) ? `array:${value.length}` : "object";
  }
  if (Array.isArray(value)) {
    return [
      "array",
      String(value.length),
      fingerprintValue(value[0], depth + 1),
      fingerprintValue(value[value.length - 1], depth + 1),
    ].join(":");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sampledKeys = keys.slice(0, 12);
  return [
    "object",
    String(keys.length),
    ...sampledKeys.map((key) => `${key}=${fingerprintValue(record[key], depth + 1)}`),
  ].join(":");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

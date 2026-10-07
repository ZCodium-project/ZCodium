import {
  SessionEventType,
  type ModelNetworkStatusPayload,
  type SessionEvent,
} from "@zcode/contracts";
import {
  SESSION_DEBUG_LIMITS,
  calculateOutputTps,
  sessionDebugParamsSchema,
  zcodeTaskNetworkDebugStatusFromPayload,
  type SessionDebugSnapshot,
} from "@zcode/shared";
import { requireSession, type ZCodeProtocolAgentServerContext } from "./server-types.js";

type SessionRecord = { app: { sessionId: string } };
interface Observation {
  snapshot: SessionDebugSnapshot;
  seenEvents: Set<string>;
  completedRequests: Set<string>;
  hasUnknownCacheUsage: boolean;
}
// 旁路记录跟随 CLI record 回收，不挂到聊天投影、轮次事实或已提交输入队列上。
const observations = new WeakMap<SessionRecord, Observation>();
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 2048;

function emptySnapshot(sessionId: string): SessionDebugSnapshot {
  return { sessionId, rounds: [], networkEntries: [], cache: null };
}
function remember(keys: Set<string>, key: string): boolean {
  if (keys.has(key)) return false;
  keys.add(key);
  if (keys.size > SESSION_DEBUG_LIMITS.dedupe) keys.delete(keys.values().next().value!);
  return true;
}
function boundedHeaders(headers: Record<string, string>): Record<string, string> {
  // adapter 已脱敏；此处只限制调试响应体积，不保存正文，也不复制无限大小的 headers。
  return Object.fromEntries(
    Object.entries(headers)
      .slice(0, MAX_HEADER_COUNT)
      .map(([key, value]) => [
        key.slice(0, MAX_HEADER_VALUE_LENGTH),
        value.slice(0, MAX_HEADER_VALUE_LENGTH),
      ]),
  );
}
function token(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function observeSessionDebug(record: SessionRecord, event: SessionEvent): void {
  if (
    event.type !== SessionEventType.ModelNetworkStatus ||
    String(event.sessionId) !== record.app.sessionId
  )
    return;
  const payload = event.payload as ModelNetworkStatusPayload;
  const mapped = zcodeTaskNetworkDebugStatusFromPayload({
    taskId: record.app.sessionId,
    traceId: event.traceId,
    eventId: String(event.id),
    payload: { ...payload, model: { providerId: payload.providerId, modelId: payload.modelId } },
  });
  if (!mapped) return;
  let observation = observations.get(record);
  if (!observation) {
    observation = {
      snapshot: emptySnapshot(record.app.sessionId),
      seenEvents: new Set(),
      completedRequests: new Set(),
      hasUnknownCacheUsage: false,
    };
    observations.set(record, observation);
  }
  if (!remember(observation.seenEvents, String(event.id))) return;
  const { type: _type, taskId: _taskId, eventId: _eventId, inputId: _inputId, ...entry } = mapped;
  const parsedAt = Date.parse(payload.timestamp);
  const recordedAt = Number.isFinite(parsedAt) ? parsedAt : event.timestamp.getTime();
  const state = observation.snapshot;
  state.networkEntries = [
    ...state.networkEntries,
    {
      ...entry,
      recordedAt,
      // maxAttempts=0 表示无限重试，旧映射器会丢掉它，调试面必须保留。
      maxAttempts: payload.maxAttempts,
      requestHeaders: boundedHeaders(entry.requestHeaders),
      responseHeaders: boundedHeaders(entry.responseHeaders),
      ...(entry.message ? { message: entry.message.slice(0, MAX_MESSAGE_LENGTH) } : {}),
    },
  ].slice(-SESSION_DEBUG_LIMITS.network);
  if (
    payload.type !== "model_request_completed" ||
    payload.querySource !== "main_turn" ||
    !remember(observation.completedRequests, payload.requestId)
  )
    return;
  const usage = payload.usage;
  const inputTokens = token(usage?.inputTokens);
  const outputTokens = token(usage?.outputTokens);
  const cacheReadTokens = token(usage?.cacheReadTokens);
  const duration = token(payload.durationMs);
  const first = token(payload.timeToFirstContentMs);
  const generationDurationMs =
    duration !== undefined && first !== undefined && duration > first ? duration - first : null;
  // prefill ≈ TTFT 段：提示词处理吞吐 = inputTokens / TTFT 秒。TTFT=0（全缓存直出）
  // 或任一项未知时为 null，不伪造速度。
  const prefillTokensPerSecond =
    inputTokens !== undefined &&
    inputTokens > 0 &&
    first !== undefined &&
    first > 0 &&
    Number.isFinite(first)
      ? Number(((inputTokens * 1000) / first).toFixed(1))
      : null;
  observation.hasUnknownCacheUsage ||= inputTokens === undefined || cacheReadTokens === undefined;
  const previous = state.cache;
  const totalInputTokens = (previous?.totalInputTokens ?? 0) + (inputTokens ?? 0);
  const totalCacheReadTokens = (previous?.totalCacheReadTokens ?? 0) + (cacheReadTokens ?? 0);
  const requestIndex = (previous?.hitRateRequestCount ?? 0) + 1;
  state.cache = {
    hitRateRequestCount: requestIndex,
    totalInputTokens,
    totalCacheReadTokens,
    hitRate:
      !observation.hasUnknownCacheUsage && totalInputTokens > 0
        ? totalCacheReadTokens / totalInputTokens
        : null,
  };
  state.rounds = [
    ...state.rounds,
    {
      eventKey: String(event.id),
      requestId: payload.requestId,
      requestIndex,
      recordedAt,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          token(usage?.totalTokens) ??
          (inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined),
        reasoningTokens: token(usage?.reasoningTokens),
        cachedInputTokens: cacheReadTokens,
        cachedWriteInputTokens: token(usage?.cacheWriteTokens),
      },
      hitRate:
        inputTokens !== undefined && inputTokens > 0 && cacheReadTokens !== undefined
          ? cacheReadTokens / inputTokens
          : null,
      generationDurationMs,
      tokensPerSecond: calculateOutputTps(outputTokens, generationDurationMs),
      prefillDurationMs: first ?? null,
      prefillTokensPerSecond,
    },
  ].slice(-SESSION_DEBUG_LIMITS.rounds);
}

export function readSessionDebug(record: SessionRecord): SessionDebugSnapshot {
  return observations.get(record)?.snapshot ?? emptySnapshot(record.app.sessionId);
}

export function querySessionDebug(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
): SessionDebugSnapshot {
  const params = sessionDebugParamsSchema.parse(rawParams);
  return readSessionDebug(requireSession(context, params.sessionId));
}

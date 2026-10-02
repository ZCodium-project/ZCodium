import {
  buildOrcaModelsUrl,
  filterOrcaModels,
  parseOrcaCatalog,
  type OrcaCapability,
  type OrcaModelRecord,
  type OrcaOrigins,
} from "@zcode/shared";
import type { OrcaCredentialStore } from "./credentialStore.js";

/**
 * 目录来源。
 *
 * `live` 是权威目录；另外两种都明确标记为降级，UI 必须显示 degraded 状态，
 * 且绝不能在 live 成功后把 seed 混入权威结果。
 */
export type OrcaCatalogSource = "live" | "last-known-good" | "verified-seed";

export interface OrcaCatalogResult {
  readonly models: readonly OrcaModelRecord[];
  readonly source: OrcaCatalogSource;
  readonly degraded: boolean;
  readonly fetchedAt: number;
  /** 脱敏失败原因；不含响应体与密钥 */
  readonly error?: string;
  readonly totalBeforeFilter: number;
}

/**
 * 已验证的冷启动 seed。
 *
 * 这是**离线兜底**，不是完整目录：live discovery 成功时它完全不出现在结果里。
 * 元数据（上下文、输入模态、reasoning 档位）与 provider 配置中的 OrcaRouter
 * providerSiteRules 保持一致，避免降级时丢失已验证能力。
 */
export const ORCAROUTER_VERIFIED_SEED: readonly Omit<OrcaModelRecord, "supportedEndpointTypes">[] =
  Object.freeze([
    { id: "openai/gpt-5.5", inputModalities: Object.freeze(["text", "image"]) },
    { id: "anthropic/claude-opus-4.8", inputModalities: Object.freeze(["text", "image"]) },
    { id: "google/gemini-3.5-flash", inputModalities: Object.freeze(["text", "image"]) },
    { id: "deepseek/deepseek-v4-pro", inputModalities: Object.freeze(["text"]) },
    { id: "orcarouter/auto", inputModalities: Object.freeze(["text"]) },
  ]);

function seedRecords(): readonly OrcaModelRecord[] {
  return Object.freeze(
    ORCAROUTER_VERIFIED_SEED.map((model) =>
      Object.freeze({
        id: model.id,
        // seed 模型都是文本对话可用；具体能力仍由 providerSiteRules 的元数据约束。
        supportedEndpointTypes: Object.freeze(["openai", "anthropic"]),
        inputModalities: model.inputModalities,
      }),
    ),
  );
}

export interface OrcaCatalogService {
  /**
   * 按能力列出模型。
   *
   * `requiredInputModality` 用于多模态入口：必须由目录的 `input_modalities` 明确声明，
   * 未声明即被排除（fail closed）。
   */
  list(input: {
    readonly capability: OrcaCapability;
    readonly requiredInputModality?: "image" | "audio" | "video";
    readonly forceRefresh?: boolean;
  }): Promise<OrcaCatalogResult>;
  /** 丢弃缓存（例如切换 provider 或手动刷新） */
  invalidate(): void;
}

export interface OrcaCatalogDeps {
  readonly credentialStore: OrcaCredentialStore;
  readonly origins: OrcaOrigins;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly ttlMs?: number;
  /** 响应体上限，防止异常目录耗尽内存 */
  readonly maxResponseBytes?: number;
  readonly maxItems?: number;
  readonly log?: (level: "info" | "warn", message: string) => void;
}

function defaultLog(level: "info" | "warn", message: string): void {
  // 目录诊断只输出结构化状态，不打印密钥或响应体。
  if (level === "warn") console.warn(`[orcarouter:catalog] ${message}`);
}

export function createOrcaCatalogService(deps: OrcaCatalogDeps): OrcaCatalogService {
  const timeoutMs = deps.timeoutMs ?? 10_000;
  const ttlMs = deps.ttlMs ?? 60_000;
  const maxResponseBytes = deps.maxResponseBytes ?? 512 * 1024;
  const maxItems = deps.maxItems ?? 500;
  const log = deps.log ?? defaultLog;
  const now = deps.now ?? Date.now;

  let cached: { readonly at: number; readonly records: readonly OrcaModelRecord[] } | null = null;
  let pending: Promise<readonly OrcaModelRecord[]> | null = null;

  const fetchLive = async (): Promise<readonly OrcaModelRecord[]> => {
    const credential = await deps.credentialStore.loadUsable();
    if (!credential) {
      throw new Error("尚未连接 OrcaRouter，无法获取模型目录");
    }
    const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(buildOrcaModelsUrl(deps.origins.apiBase), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential.apiKey}`,
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`模型目录请求失败：HTTP ${response.status}`);
      }
      const text = await response.text();
      if (text.length > maxResponseBytes) {
        throw new Error("模型目录响应超过大小上限");
      }
      return parseOrcaCatalog(JSON.parse(text) as unknown, maxItems);
    } finally {
      clearTimeout(timer);
    }
  };

  const loadRecords = async (forceRefresh: boolean): Promise<readonly OrcaModelRecord[]> => {
    if (!forceRefresh && cached && now() - cached.at < ttlMs) {
      return cached.records;
    }
    if (pending) return pending;
    pending = fetchLive()
      .then((records) => {
        cached = { at: now(), records };
        return records;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  };

  return {
    invalidate() {
      cached = null;
      pending = null;
    },

    async list(input) {
      const fetchedAt = now();
      try {
        const records = await loadRecords(input.forceRefresh === true);
        return Object.freeze({
          models: filterOrcaModels(records, input.capability, input.requiredInputModality),
          source: "live" as const,
          degraded: false,
          fetchedAt,
          totalBeforeFilter: records.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "模型目录不可用";
        if (cached) {
          log("warn", `模型目录刷新失败，使用最近一次成功目录：${message}`);
          return Object.freeze({
            models: filterOrcaModels(cached.records, input.capability, input.requiredInputModality),
            source: "last-known-good" as const,
            degraded: true,
            fetchedAt,
            error: message,
            totalBeforeFilter: cached.records.length,
          });
        }
        log("warn", `模型目录不可用，回退到已验证 seed：${message}`);
        const seed = seedRecords();
        return Object.freeze({
          models: filterOrcaModels(seed, input.capability, input.requiredInputModality),
          source: "verified-seed" as const,
          degraded: true,
          fetchedAt,
          error: message,
          totalBeforeFilter: seed.length,
        });
      }
    },
  };
}

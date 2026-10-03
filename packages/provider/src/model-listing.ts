import type { ProviderApiType } from "./config/provider-config.js";

/** 设置页"检测可用模型"的草稿连接信息；全部来自表单草稿，不要求先保存。 */
export interface RemoteModelCatalogRequest {
  readonly apiType: ProviderApiType;
  readonly baseUrl: string;
  readonly apiKey?: string | null;
  readonly headers?: Record<string, string> | null;
}

/** 一次可执行的模型列表 HTTP 请求。URL/头语义必须与正式模型执行链一致。 */
export interface RemoteModelListRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** 单页解析结果；cursor 存在表示还有下一页（Anthropic `after` 游标）。 */
export interface RemoteModelListPage {
  readonly modelIds: readonly string[];
  readonly cursor?: string;
}

export type RemoteModelCatalogResult =
  | { readonly success: true; readonly models: readonly string[] }
  | { readonly success: false; readonly message: string };

/** Anthropic 兼容网关同时读取 x-api-key 和 Bearer Authorization；版本号与执行链共用同一档。 */
const ANTHROPIC_VERSION_HEADER_VALUE = "2023-06-01";
const ANTHROPIC_PAGE_LIMIT = "1000";

/**
 * 按 Provider API 类型构造模型列表请求。
 * openai 系 baseURL 原样使用（不插入 /v1）；anthropic 系复用执行链的 /v1 归一化规则，
 * 否则会出现"检测通过但正式执行失败"的语义分叉。
 */
export function buildRemoteModelListRequest(
  input: RemoteModelCatalogRequest,
): RemoteModelListRequest {
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) throw new Error("Base URL 不能为空");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Base URL 协议不受支持: ${url.protocol}`);
  }
  const apiKey = input.apiKey?.trim();

  switch (input.apiType) {
    case "openai-chat-completions":
    case "openai-responses": {
      url.pathname = `${url.pathname.replace(/\/+$/u, "")}/models`;
      return {
        url: url.href,
        headers: mergeWithExplicitPriority(
          apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          input.headers,
        ),
      };
    }
    case "anthropic-messages": {
      url.pathname = `${normalizeAnthropicBasePathname(url.pathname)}/models`;
      url.searchParams.set("limit", ANTHROPIC_PAGE_LIMIT);
      return {
        url: url.href,
        headers: mergeWithExplicitPriority(
          {
            ...(apiKey ? { "x-api-key": apiKey } : {}),
            "anthropic-version": ANTHROPIC_VERSION_HEADER_VALUE,
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          input.headers,
        ),
      };
    }
  }
  throw new Error(`不支持的 Provider API 类型: ${String(input.apiType)}`);
}

/**
 * 把模型列表响应解析为一页结果。只接受 `{ data: [...] }` 标准形状（OpenAI / Anthropic 一致），
 * 缺失或非字符串 id 直接忽略；无法识别时显式报错，不做第二重猜测。
 */
export function parseRemoteModelListPage(payload: unknown): RemoteModelListPage {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Provider 模型列表响应格式无法识别");
  }
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new Error("Provider 模型列表响应缺少 data 数组");
  }
  const modelIds = data
    .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    .map((id) => id.trim());
  const hasMore = (payload as { has_more?: unknown }).has_more === true;
  const lastId = (payload as { last_id?: unknown }).last_id;
  return Object.freeze({
    modelIds: Object.freeze(modelIds),
    ...(hasMore && typeof lastId === "string" && lastId ? { cursor: lastId } : {}),
  });
}

/** Anthropic 的 SDK 会在 baseURL 后追加 /v1/messages，网关根必须先补齐 /v1 前缀。 */
function normalizeAnthropicBasePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, "");
  return trimmed.toLowerCase().endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** 显式配置的 Provider headers 拥有最高优先级；检测头不覆盖同名（大小写不敏感）显式头。 */
function mergeWithExplicitPriority(
  generated: Record<string, string>,
  explicit: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!explicit) return generated;
  const explicitNames = new Set(Object.keys(explicit).map((key) => key.toLowerCase()));
  const kept = Object.fromEntries(
    Object.entries(generated).filter(([key]) => !explicitNames.has(key.toLowerCase())),
  );
  return { ...kept, ...explicit };
}

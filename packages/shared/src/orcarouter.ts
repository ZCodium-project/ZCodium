/**
 * OrcaRouter 接入协议（跨层共享合同）。
 *
 * OrcaRouter 是 OpenAI 兼容的 AI 网关：推理与模型目录在 `api` origin 的 `/v1` 下，
 * 授权与授权码换取在**另一个** `auth` origin 的 `/auth` 与 `/api/v1/auth/keys`。
 * 两个 origin 必须显式区分，禁止通过替换 hostname 或拼接 `/v1` 相互推导。
 *
 * 本文件只放纯函数与类型：不读文件、不写日志、不依赖 Node 专有模块，
 * 因此 Desktop（host/renderer）、Web 与 CLI 可以复用同一份实现。
 */

/** 内置 OrcaRouter provider 模板 id */
export const ORCAROUTER_PROVIDER_TEMPLATE_ID = "orcarouter" as const;

/** OAuth 认证入口 id（与 provider 模板同源，凭据最终汇入同一 provider） */
export const ORCAROUTER_OAUTH_PROVIDER_ID = "orcarouter" as const;

/** 官方授权 origin 默认值 */
export const ORCAROUTER_DEFAULT_AUTH_BASE = "https://www.orcarouter.ai" as const;

/** 官方推理/模型目录 origin 默认值 */
export const ORCAROUTER_DEFAULT_API_BASE = "https://api.orcarouter.ai" as const;

/** 授权页固定路径 */
export const ORCAROUTER_AUTHORIZE_PATH = "/auth" as const;

/** 授权码换取固定路径（注意不在 `/v1` 下） */
export const ORCAROUTER_EXCHANGE_PATH = "/api/v1/auth/keys" as const;

/** 模型目录路径 */
export const ORCAROUTER_MODELS_PATH = "/v1/models" as const;

/** PKCE 固定使用 S256 */
export const ORCAROUTER_CODE_CHALLENGE_METHOD = "S256" as const;

/** 请求的授权范围；换取响应里的 `scope` 才是实际授权，必须以响应为准 */
export const ORCAROUTER_REQUESTED_SCOPE = "api" as const;

/** 环境变量名：共享自建基址与显式覆盖 */
export const ORCAROUTER_BASE_URL_ENV = "ORCA_BASE_URL" as const;
export const ORCAROUTER_AUTH_BASE_URL_ENV = "ORCA_AUTH_BASE_URL" as const;
export const ORCAROUTER_API_BASE_URL_ENV = "ORCA_API_BASE_URL" as const;

/** 支持的服务端能力过滤值 */
export type OrcaCapability = "chat" | "embedding" | "image" | "video" | "rerank";

/** 推理与模型目录默认 base（带 `/v1`） */
export const ORCAROUTER_DEFAULT_API_V1_BASE = `${ORCAROUTER_DEFAULT_API_BASE}/v1` as const;

export interface OrcaOrigins {
  /** 授权 origin，无尾斜杠，例如 https://www.orcarouter.ai */
  readonly authBase: string;
  /** 推理 origin，无尾斜杠，例如 https://api.orcarouter.ai */
  readonly apiBase: string;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * 校验并归一化一个 origin。
 *
 * 远端 origin 强制 HTTPS；HTTP 只允许 loopback，避免把授权码或密钥送到明文链路。
 */
export function normalizeOrcaOrigin(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空`);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} 不是合法 URL`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} 不允许携带用户信息`);
  }
  if (url.protocol === "http:") {
    if (!isLoopbackHost(url.hostname)) {
      throw new Error(`${label} 只允许 loopback 使用 http，远端必须使用 https`);
    }
  } else if (url.protocol !== "https:") {
    throw new Error(`${label} 只支持 http(s)`);
  }
  url.search = "";
  url.hash = "";
  return stripTrailingSlash(url.toString());
}

/**
 * 解析 auth / api 两个 origin。
 *
 * 优先级：显式 `ORCA_AUTH_BASE_URL` / `ORCA_API_BASE_URL` > `ORCA_BASE_URL`（自建单 origin）> 官方默认。
 * 显式值永远优先，且只用同名字段回退——绝不从另一个 origin 推导。
 */
export function resolveOrcaOrigins(env: Record<string, string | undefined>): OrcaOrigins {
  const shared = env[ORCAROUTER_BASE_URL_ENV]?.trim();
  const explicitAuth = env[ORCAROUTER_AUTH_BASE_URL_ENV]?.trim();
  const explicitApi = env[ORCAROUTER_API_BASE_URL_ENV]?.trim();

  const authBase = explicitAuth || shared || ORCAROUTER_DEFAULT_AUTH_BASE;
  const apiBase = explicitApi || shared || ORCAROUTER_DEFAULT_API_BASE;

  return Object.freeze({
    authBase: normalizeOrcaOrigin(authBase, "OrcaRouter 授权地址"),
    apiBase: normalizeOrcaOrigin(apiBase, "OrcaRouter 推理地址"),
  });
}

/** 由 api origin 构造 `/v1` 推理基址 */
export function buildOrcaV1Base(apiBase: string): string {
  return `${stripTrailingSlash(apiBase)}/v1`;
}

/** 由 api origin 构造模型目录 URL；目录与推理同源，绝不复用 auth origin */
export function buildOrcaModelsUrl(apiBase: string): string {
  return `${stripTrailingSlash(apiBase)}${ORCAROUTER_MODELS_PATH}`;
}

/** 授权 URL 参数 */
export interface OrcaAuthorizeUrlInput {
  readonly authBase: string;
  readonly callbackUrl: string;
  readonly codeChallenge: string;
  readonly state: string;
  readonly appName: string;
  readonly scope?: string;
}

/**
 * 构造授权 URL。
 *
 * `callback_url=oob` 表示 out-of-band：授权页把 code 显示给用户，由用户粘贴回来。
 * 无论哪种 flow 都固定发送 S256——授权页允许用户选择「显示 code」，
 * 因此只要客户端可能被人手递 code，就必须用 S256。
 */
export function buildOrcaAuthorizeUrl(input: OrcaAuthorizeUrlInput): string {
  const url = new URL(`${ORCAROUTER_AUTHORIZE_PATH}`, stripTrailingSlash(input.authBase));
  url.searchParams.set("callback_url", input.callbackUrl);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", ORCAROUTER_CODE_CHALLENGE_METHOD);
  url.searchParams.set("state", input.state);
  url.searchParams.set("app_name", input.appName);
  url.searchParams.set("scope", input.scope ?? ORCAROUTER_REQUESTED_SCOPE);
  return url.toString();
}

/** 授权码换取请求体 */
export interface OrcaExchangeBody {
  readonly code: string;
  readonly code_verifier: string;
  readonly code_challenge_method: typeof ORCAROUTER_CODE_CHALLENGE_METHOD;
}

export function buildOrcaExchangeBody(code: string, codeVerifier: string): OrcaExchangeBody {
  return {
    code,
    code_verifier: codeVerifier,
    code_challenge_method: ORCAROUTER_CODE_CHALLENGE_METHOD,
  };
}

/** 换取成功的响应（服务端只回长期 API key，不回 refresh token） */
export interface OrcaExchangeResult {
  readonly key: string;
  readonly userId: string;
  /** 实际授予的 scope；可能低于请求的 scope */
  readonly scope: string;
  readonly raw: unknown;
}

/** 与用途不符的授权范围错误 */
export class OrcaScopeDowngradedError extends Error {
  readonly grantedScope: string;
  constructor(grantedScope: string) {
    super(`OrcaRouter 只授予了 "${grantedScope}" 范围，无法用于本用途`);
    this.name = "OrcaScopeDowngradedError";
    this.grantedScope = grantedScope;
  }
}

/**
 * 解析换取响应。
 *
 * 必须读取响应里的 `scope`：它表示**被授予**的范围，而不是请求的范围。
 * 范围不足时按失败处理，绝不把「请求过」当成「已获得」。
 */
export function parseOrcaExchangeResult(payload: unknown): OrcaExchangeResult {
  if (!payload || typeof payload !== "object") {
    throw new Error("OrcaRouter 换取响应格式无法识别");
  }
  const record = payload as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key.trim() : "";
  if (!key) {
    throw new Error("OrcaRouter 换取响应缺少 key");
  }
  const scope = typeof record.scope === "string" ? record.scope.trim() : "";
  if (scope !== ORCAROUTER_REQUESTED_SCOPE) {
    throw new OrcaScopeDowngradedError(scope || "(empty)");
  }
  return Object.freeze({
    key,
    userId: typeof record.user_id === "string" ? record.user_id : "",
    scope,
    raw: payload,
  });
}

/** 模型目录条目（最小元数据，供能力过滤使用） */
export interface OrcaModelRecord {
  readonly id: string;
  readonly supportedEndpointTypes: readonly string[];
  /** 明确声明支持的输入模态；未声明时为空数组，必须 fail closed */
  readonly inputModalities: readonly string[];
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(
    value.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
  );
}

/**
 * 解析模型目录条目。
 *
 * 只接受能证明能力的字段，不做任何「按名字猜能力」的推断。
 */
export function parseOrcaModelRecord(payload: unknown): OrcaModelRecord | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;
  const architecture = (record.architecture ?? null) as Record<string, unknown> | null;
  return Object.freeze({
    id,
    supportedEndpointTypes: readStringArray(record.supported_endpoint_types),
    inputModalities: readStringArray(architecture?.input_modalities),
  });
}

/** 判断一组 endpoint types 是否包含可承载文本对话的协议 */
export function supportsTextChat(record: OrcaModelRecord): boolean {
  const textEndpoints = ["openai", "anthropic", "gemini", "openai-response"];
  return record.supportedEndpointTypes.some((type) => textEndpoints.includes(type));
}

/** 非文本专用 endpoint，出现即排除 */
const NON_TEXT_ENDPOINTS = ["image-generation", "openai-video", "jina-rerank", "embeddings"];

function hasNonTextEndpoint(record: OrcaModelRecord): boolean {
  return record.supportedEndpointTypes.some((type) => NON_TEXT_ENDPOINTS.includes(type));
}

/**
 * 按能力过滤目录。
 *
 * - chat：必须能说文本对话协议，且不得是图片生成/视频/rerank 等专用模型；
 *   多模态入口再要求 `input_modalities` 明确包含实际上传的模态（未声明即 fail closed）。
 * - embedding / image / video / rerank：只认对应 endpoint，不按名字猜。
 */
export function filterOrcaModels(
  records: readonly OrcaModelRecord[],
  capability: OrcaCapability,
  requiredInputModality?: "image" | "audio" | "video",
): readonly OrcaModelRecord[] {
  const matches = (record: OrcaModelRecord): boolean => {
    switch (capability) {
      case "chat": {
        if (!supportsTextChat(record)) return false;
        if (hasNonTextEndpoint(record)) return false;
        if (requiredInputModality) {
          return record.inputModalities.includes(requiredInputModality);
        }
        return true;
      }
      case "embedding":
        return record.supportedEndpointTypes.includes("embeddings");
      case "image":
        return record.supportedEndpointTypes.includes("image-generation");
      case "video":
        return record.supportedEndpointTypes.includes("openai-video");
      case "rerank":
        return record.supportedEndpointTypes.includes("jina-rerank");
      default:
        return false;
    }
  };
  return Object.freeze(records.filter(matches));
}

/** 读取模型目录响应里的 data 数组，并对条目数设上界 */
export function parseOrcaCatalog(payload: unknown, maxItems = 500): readonly OrcaModelRecord[] {
  const data = (
    payload && typeof payload === "object" ? (payload as Record<string, unknown>).data : null
  ) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("OrcaRouter 模型目录响应缺少 data 数组");
  }
  const bounded = data.slice(0, Math.max(0, maxItems));
  const records: OrcaModelRecord[] = [];
  for (const item of bounded) {
    const record = parseOrcaModelRecord(item);
    if (record) records.push(record);
  }
  return Object.freeze(records);
}

/** 凭据来源；两种入口最终产出同一种凭据，下游不关心来源 */
export type OrcaCredentialSource = "api-key" | "pkce";

export interface OrcaCredential {
  readonly apiKey: string;
  readonly source: OrcaCredentialSource;
  /** PKCE 授予的 scope；手填 API key 没有 scope 记录 */
  readonly grantedScope?: string;
  /** 该凭据属于哪个账号；用于 401 时精确定位，避免旧失败污染新登录 */
  readonly accountId?: string;
  /** 生成序号：新登录必须递增，旧响应不得覆盖新凭据 */
  readonly generation: number;
}

/** 凭据脱敏：只保留前缀与末四位，绝不回显完整密钥 */
export function maskOrcaSecret(secret: string | null | undefined): string {
  const value = secret?.trim() ?? "";
  if (!value) return "";
  if (value.length <= 8) return "••••";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** 只做轻量格式检查；前缀不是有效性证明 */
export function looksLikeOrcaApiKey(value: string): boolean {
  return /^sk-orca-[A-Za-z0-9._-]{6,}$/.test(value.trim());
}

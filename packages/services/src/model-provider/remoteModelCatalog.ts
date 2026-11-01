import {
  buildRemoteModelListRequest,
  parseRemoteModelListPage,
  type RemoteModelCatalogRequest,
  type RemoteModelCatalogResult,
} from "@zcode/provider";

/** 模型列表拉取的分页与超时上限；异常网关的死循环在这里被截断。 */
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_MS = 15_000;

type RemoteModelCatalogFetcher = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<Response>;

export type RemoteModelCatalogExecutor = (
  input: RemoteModelCatalogRequest,
) => Promise<RemoteModelCatalogResult>;

/**
 * Host 侧执行"检测可用模型"：按 Provider API 类型请求其 models 列表端点并聚合分页。
 * 纯读操作——任何失败或成功都不写配置、不改 Registry。
 */
export function createRemoteModelCatalogExecutor(dependencies: {
  readonly fetch?: RemoteModelCatalogFetcher;
}): RemoteModelCatalogExecutor {
  const doFetch = dependencies.fetch ?? ((url, init) => fetch(url, init));
  return async (input) => {
    try {
      let request = buildRemoteModelListRequest(input);
      const modelIds: string[] = [];
      const seen = new Set<string>();
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const response = await doFetch(request.url, {
          headers: request.headers,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          const statusText = `Provider 返回 ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
          // 404 高频根因是网关把列表挂在 /v1/models 而 Base URL 没带 /v1（正式执行链
          // 同样要求 Base URL 自含前缀）；带上实际请求 URL 并给出提示，避免用户盲猜。
          const hint =
            response.status === 404
              ? `（请求：GET ${publicRequestUrl(request.url)}；若为 OpenAI 兼容网关，请检查 Base URL 是否遗漏 /v1 前缀）`
              : `（请求：GET ${publicRequestUrl(request.url)}）`;
          return {
            success: false,
            message: redactCredentials(`${statusText}${hint}`, input),
          };
        }
        const parsed = parseRemoteModelListPage(await response.json());
        for (const modelId of parsed.modelIds) {
          if (!seen.has(modelId)) {
            seen.add(modelId);
            modelIds.push(modelId);
          }
        }
        if (!parsed.cursor) break;
        const nextUrl = new URL(request.url);
        nextUrl.searchParams.set("after", parsed.cursor);
        request = { url: nextUrl.href, headers: request.headers };
      }
      return { success: true, models: Object.freeze(modelIds) };
    } catch (error) {
      return {
        success: false,
        message: redactCredentials(error instanceof Error ? error.message : String(error), input),
      };
    }
  };
}

/** URL 只用于诊断端点，不能把 userinfo 或查询串中的凭据带回 Renderer。 */
function publicRequestUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function redactCredentials(message: string, input: RemoteModelCatalogRequest): string {
  // Node fetch 会在非法 header 异常中原样回显其值；只隐藏 API Key 不足以保护自定义鉴权头。
  // 同时覆盖转义/编码后的回显，保留其余可诊断错误，不向日志写入请求或凭据。
  const headerValues = Object.values(input.headers ?? {});
  const secrets = [
    input.apiKey ?? "",
    ...headerValues,
    ...headerValues.map((value) => value.replace(/^(?:Bearer|Basic)\s+/iu, "")),
  ];
  try {
    const url = new URL(input.baseUrl);
    secrets.push(url.username, url.password, ...url.searchParams.values(), url.hash.slice(1));
  } catch {
    // URL 校验本身也可能抛错；仍对已知的 Key 和 headers 脱敏。
  }
  const variants = new Set(
    secrets.flatMap((secret) =>
      [secret, secret.trim()].flatMap((value) =>
        value
          ? [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value.toWellFormed())]
          : [],
      ),
    ),
  );
  for (const secret of [...variants].sort((left, right) => right.length - left.length)) {
    message = message.replaceAll(secret, "[REDACTED]");
  }
  return message;
}

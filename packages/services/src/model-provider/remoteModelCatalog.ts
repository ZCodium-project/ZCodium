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
          return {
            success: false,
            message: `Provider 返回 ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
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
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

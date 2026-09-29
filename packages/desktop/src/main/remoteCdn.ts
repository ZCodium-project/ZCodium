import { isOfficialServiceEnabled, ZCODE_VERSION, type ZCodeEnv } from "@zcode/shared";

declare const __ZCODE_CDN_BASE_URL__: string | undefined;
const DEFAULT_CDN_BASE_URL = "";

export interface ResolveRemoteCdnOptions {
  env?: ZCodeEnv;
  locale?: string;
  timeZone?: string;
  overrideBaseUrl?: string;
  version?: string;
  now?: Date;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("CDN URL must use http or https");
  return value.replace(/\/+$/, "");
}

export function resolveRemoteCdnBaseUrls(options: ResolveRemoteCdnOptions = {}): string[] {
  // 显式覆盖地址是用户自有的 remote 资源源（镜像 / GitHub Release 等），与官方平台无关。
  // 它必须先于官方服务开关判断：否则默认关闭的 marketplace 会把自建源一起拦掉，
  // 表现为“连 WSL/SSH 需要先打开插件市场开关”。
  const override = options.overrideBaseUrl?.trim();
  if (override) return [normalizeBaseUrl(override)];

  // 默认（或构建注入）的官方 CDN 仍由 marketplace 开关把关：审计版不自动连接官方 CDN。
  if (!isOfficialServiceEnabled("marketplace")) return [];
  const baseUrl =
    process.env.ZCODE_CDN_BASE_URL?.trim() ||
    (typeof __ZCODE_CDN_BASE_URL__ === "undefined" ? "" : __ZCODE_CDN_BASE_URL__) ||
    DEFAULT_CDN_BASE_URL;
  return [
    `${normalizeBaseUrl(baseUrl)}/zcode/electron/releases/${options.version ?? ZCODE_VERSION}`,
  ];
}

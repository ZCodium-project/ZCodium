/**
 * 外部 API Key Provider 余额查询的识别与解析规则（纯函数，无网络/无状态）。
 *
 * 供应商识别基于 Provider 配置里的 `api.baseUrl` 主机名，解析只依赖响应 JSON，
 * 便于在不发起真实请求的情况下做回归测试。查询地址使用供应商固定的余额接口，
 * 不从 baseUrl 拼接路径（各家 baseUrl 后缀不同，例如 DeepSeek 是 /anthropic）。
 */
import type { ProviderBalanceEntry } from "@zcode/shared";

interface ResolvedProviderBalanceProvider {
  /** 供应商固定余额查询地址。 */
  readonly url: string;
  parse(payload: unknown): ProviderBalanceEntry[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hostnameOf(baseUrl: string | null | undefined): string | null {
  const value = baseUrl?.trim();
  if (!value) {
    return null;
  }
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function entry(partial: Partial<ProviderBalanceEntry> & { label: string }): ProviderBalanceEntry {
  return {
    label: partial.label,
    unit: partial.unit ?? null,
    remaining: partial.remaining ?? null,
    ...(partial.total === undefined ? {} : { total: partial.total }),
    ...(partial.used === undefined ? {} : { used: partial.used }),
    isAvailable: partial.isAvailable ?? true,
  };
}

/** DeepSeek: GET https://api.deepseek.com/user/balance */
function parseDeepSeek(payload: unknown): ProviderBalanceEntry[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const isAvailable = readBoolean(root, "is_available") ?? true;
  const infos = Array.isArray(root.balance_infos) ? root.balance_infos : [];
  const balances: ProviderBalanceEntry[] = [];
  for (const info of infos) {
    const record = asRecord(info);
    if (!record) {
      continue;
    }
    const currency = readString(record, "currency") ?? "CNY";
    balances.push(
      entry({
        label: currency,
        unit: currency,
        remaining: readNumber(record, "total_balance"),
        isAvailable,
      }),
    );
  }
  return balances;
}

/** Moonshot / Kimi: GET https://api.moonshot.{cn,ai}/v1/users/me/balance */
function parseMoonshot(payload: unknown, host: string): ProviderBalanceEntry[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) {
    return [];
  }
  const unit = host.includes("moonshot.ai") ? "USD" : "CNY";
  const remaining = readNumber(data, "available_balance");
  return [
    entry({
      label: unit,
      unit,
      remaining,
      total: readNumber(data, "voucher_balance"),
      isAvailable: remaining === null ? true : remaining > 0,
    }),
  ];
}

/** SiliconFlow: GET https://api.siliconflow.{cn,com}/v1/user/info */
function parseSiliconFlow(payload: unknown, host: string): ProviderBalanceEntry[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) {
    return [];
  }
  const unit = host.includes("siliconflow.com") ? "USD" : "CNY";
  const remaining = readNumber(data, "totalBalance") ?? readNumber(data, "balance");
  return [
    entry({
      label: unit,
      unit,
      remaining,
      total: readNumber(data, "chargeBalance"),
      isAvailable: remaining === null ? true : remaining > 0,
    }),
  ];
}

/** StepFun: GET https://api.stepfun.com/v1/accounts */
function parseStepFun(payload: unknown): ProviderBalanceEntry[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const remaining = readNumber(root, "balance");
  return [
    entry({
      label: "CNY",
      unit: "CNY",
      remaining,
      total: readNumber(root, "total_cash_balance"),
      isAvailable: remaining === null ? true : remaining > 0,
    }),
  ];
}

/** OpenRouter: GET https://openrouter.ai/api/v1/credits */
function parseOpenRouter(payload: unknown): ProviderBalanceEntry[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data) ?? root;
  if (!data) {
    return [];
  }
  const total = readNumber(data, "total_credits");
  const used = readNumber(data, "total_usage");
  const remaining = total === null ? null : total - (used ?? 0);
  return [
    entry({
      label: "USD",
      unit: "USD",
      remaining,
      total,
      used,
      isAvailable: remaining === null ? true : remaining > 0,
    }),
  ];
}

/** Novita AI: GET https://api.novita.ai/v3/user/balance，金额单位 0.0001 USD。 */
function parseNovita(payload: unknown): ProviderBalanceEntry[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }
  const raw = readNumber(root, "availableBalance");
  const remaining = raw === null ? null : raw / 10_000;
  return [
    entry({
      label: "USD",
      unit: "USD",
      remaining,
      total: readNumber(root, "cashBalance"),
      isAvailable: remaining === null ? true : remaining > 0,
    }),
  ];
}

/**
 * 按 baseUrl 主机名识别供应商并返回其固定查询地址与解析器。
 * 未识别的外部 Provider 返回 null，由调用方按 `unsupported` 处理。
 */
export function resolveProviderBalanceProvider(
  baseUrl: string | null | undefined,
): ResolvedProviderBalanceProvider | null {
  const host = hostnameOf(baseUrl);
  if (!host) {
    return null;
  }
  if (isHost(host, "api.deepseek.com")) {
    return { url: "https://api.deepseek.com/user/balance", parse: parseDeepSeek };
  }
  if (isHost(host, "api.moonshot.cn") || isHost(host, "api.moonshot.ai")) {
    return {
      url: `https://${host}/v1/users/me/balance`,
      parse: (payload) => parseMoonshot(payload, host),
    };
  }
  if (isHost(host, "api.siliconflow.cn") || isHost(host, "api.siliconflow.com")) {
    return {
      url: `https://${host}/v1/user/info`,
      parse: (payload) => parseSiliconFlow(payload, host),
    };
  }
  if (isHost(host, "api.stepfun.com") || isHost(host, "api.stepfun.ai")) {
    return { url: `https://${host}/v1/accounts`, parse: parseStepFun };
  }
  if (isHost(host, "openrouter.ai")) {
    return { url: "https://openrouter.ai/api/v1/credits", parse: parseOpenRouter };
  }
  if (isHost(host, "api.novita.ai")) {
    return { url: "https://api.novita.ai/v3/user/balance", parse: parseNovita };
  }
  return null;
}

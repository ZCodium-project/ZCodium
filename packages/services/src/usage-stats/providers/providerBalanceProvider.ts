/**
 * 外部 API Key Provider 的账户余额查询服务。
 *
 * 该能力只读取 Provider 自己声明的 API Key 与 baseUrl，命中已知供应商的余额接口；
 * 未识别、未配置或鉴权失败都返回带 status 的空快照（fail-soft），
 * 不调用 `assertOfficialServiceAvailable`，因为外部供应商不属于官方平台功能。
 */
import { ApiError, type ApiClient } from "@zcode/shared";
import type {
  ProviderBalanceEntry,
  ProviderBalanceRequest,
  ProviderBalanceSnapshot,
  ProviderBalanceStatus,
} from "@zcode/shared";
import { readApiJson } from "../../providers/api/apiJson.js";
import { resolveProviderBalanceProvider } from "./providerBalanceSpecs.js";

const REQUEST_TIMEOUT_MS = 15_000;

export interface ProviderBalanceTarget {
  providerId: string;
  providerName: string;
  baseUrl: string | null;
  apiKey: string | null;
}

interface ProviderBalanceProviderOptions {
  apiClient: ApiClient;
  /**
   * 解析 Provider 的余额查询目标。缺省时所有查询都返回 `unsupported`，
   * 保证只装配了官方能力的 Environment 不产生意外网络请求。
   */
  resolveTarget?: (providerId: string) => Promise<ProviderBalanceTarget | null>;
}

function emptySnapshot(params: {
  generatedAt: number;
  providerId: string;
  providerName: string;
  status: ProviderBalanceStatus;
  message?: string;
}): ProviderBalanceSnapshot {
  return {
    providerId: params.providerId,
    providerName: params.providerName,
    generatedAt: params.generatedAt,
    status: params.status,
    ...(params.message ? { message: params.message } : {}),
    balances: [],
  };
}

export class ProviderBalanceProvider {
  private readonly apiClient: ApiClient;
  private readonly resolveTarget?: ProviderBalanceProviderOptions["resolveTarget"];

  constructor(options: ProviderBalanceProviderOptions) {
    this.apiClient = options.apiClient;
    this.resolveTarget = options.resolveTarget;
  }

  async getSnapshot(request: ProviderBalanceRequest): Promise<ProviderBalanceSnapshot> {
    const generatedAt = Date.now();
    const providerId = request.providerId?.trim() ?? "";
    if (!providerId || !this.resolveTarget) {
      return emptySnapshot({
        generatedAt,
        providerId,
        providerName: providerId,
        status: "unsupported",
      });
    }

    let target: ProviderBalanceTarget | null = null;
    try {
      target = await this.resolveTarget(providerId);
    } catch {
      // Provider 配置读取失败属于瞬时状态：按未配置处理，不把内部错误透给 UI。
      target = null;
    }
    const providerName = target?.providerName?.trim() || providerId;
    if (!target) {
      return emptySnapshot({ generatedAt, providerId, providerName, status: "unsupported" });
    }

    const spec = resolveProviderBalanceProvider(target.baseUrl);
    if (!spec) {
      return emptySnapshot({ generatedAt, providerId, providerName, status: "unsupported" });
    }

    const apiKey = target.apiKey?.trim();
    if (!apiKey) {
      return emptySnapshot({ generatedAt, providerId, providerName, status: "not_configured" });
    }

    let payload: unknown;
    try {
      payload = await readApiJson<unknown>(this.apiClient, spec.url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        return emptySnapshot({ generatedAt, providerId, providerName, status: "unauthorized" });
      }
      return emptySnapshot({
        generatedAt,
        providerId,
        providerName,
        status: "error",
        message: "request_failed",
      });
    }

    let balances: ProviderBalanceEntry[];
    try {
      balances = spec.parse(payload);
    } catch {
      return emptySnapshot({
        generatedAt,
        providerId,
        providerName,
        status: "error",
        message: "invalid_response",
      });
    }
    if (balances.length === 0) {
      return emptySnapshot({
        generatedAt,
        providerId,
        providerName,
        status: "error",
        message: "empty_response",
      });
    }

    return {
      providerId,
      providerName,
      generatedAt,
      status: "ok",
      balances,
    };
  }
}

/**
 * 外部 API Key Provider 的账户余额查询协议类型。
 *
 * 与官方 Coding Plan / Start Plan 的 subscription/quota 快照分离：外部供应商
 * 只提供账户余额（例如 DeepSeek、Moonshot、SiliconFlow、StepFun、OpenRouter、
 * Novita），没有订阅周期与额度桶，套用 `UsageEntitlementSnapshot` 会污染官方套餐语义。
 *
 * 该能力是可选数据面：未识别或未配置的 Provider 返回 `unsupported` / `not_configured`，
 * 不阻断 Provider 的编辑与使用。
 */

export type ProviderBalanceStatus =
  | "ok"
  | "unsupported"
  | "not_configured"
  | "unauthorized"
  | "error";

export interface ProviderBalanceRequest {
  providerId: string;
}

export interface ProviderBalanceEntry {
  /** 余额标签：多币种供应商用币种，单账户供应商用供应商名。 */
  label: string;
  /** 币种代码（CNY / USD）；供应商未提供时为 null。 */
  unit: string | null;
  /** 可用余额；接口未返回时为 null。 */
  remaining: number | null;
  total?: number | null;
  used?: number | null;
  /** 供应商返回的账户可用状态；余额耗尽时为 false。 */
  isAvailable: boolean;
}

export interface ProviderBalanceSnapshot {
  providerId: string;
  /** 供应商展示名，来自 Provider 配置。 */
  providerName: string;
  generatedAt: number;
  status: ProviderBalanceStatus;
  /**
   * status 非 ok 时的稳定说明码。只用于诊断，不承载 API Key、请求头或完整响应体。
   */
  message?: string;
  balances: ProviderBalanceEntry[];
}

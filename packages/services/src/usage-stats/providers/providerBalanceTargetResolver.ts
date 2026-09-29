/**
 * 从 Provider Settings View 解析余额查询目标。
 *
 * 只有普通 `api-key` Provider 参与余额查询：官方账号（zhipu-account）与
 * Coding Plan Key（zhipu-coding-plan-api-key）的额度属于官方链路，不在这里处理。
 */
import type { IProviderSettingsService } from "../../model-provider/providerFacadeServices.js";
import type { ProviderBalanceTarget } from "./providerBalanceProvider.js";

export function createProviderBalanceTargetResolver(
  providerSettings: Pick<IProviderSettingsService, "getView">,
): (providerId: string) => Promise<ProviderBalanceTarget | null> {
  return async (providerId) => {
    const view = await providerSettings.getView();
    const provider = view.providers.find((item) => item.providerId === providerId);
    if (!provider) {
      return null;
    }
    const access = provider.effectiveConfig.access;
    if (!access || access.type !== "api-key") {
      return null;
    }
    return {
      providerId,
      providerName: provider.providerName?.trim() || providerId,
      baseUrl: provider.effectiveConfig.api?.baseUrl ?? null,
      apiKey: typeof access.apiKey === "string" ? access.apiKey : null,
    };
  };
}

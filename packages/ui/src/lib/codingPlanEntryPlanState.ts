/**
 * Coding Plan 入口套餐状态（从设置投影推导）。
 *
 * 审计版不随同步购买漏斗埋点模块；这里只保留 Off-Peak 首页导航需要的纯判断，
 * 从零实现同语义的 plan state 推导（不再携带任何上报上下文）。
 */
import { BUILTIN_MODEL_PROVIDER_IDS, type UsageEntitlementSnapshot } from "@zcode/shared";
import type { ProviderSettingsView } from "@zcode/services";

export type CodingPlanEntryPlanStatus = "no_plan" | "start_plan" | "coding_plan" | "unknown";

export interface CodingPlanEntryPlanState {
  entryPlanStatus: CodingPlanEntryPlanStatus;
  entryPlanLevel: string;
}

function isStartPlanProviderId(providerId: string): boolean {
  return (
    providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan ||
    providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan
  );
}

function isStartPlanLevel(value: string): boolean {
  return /\bstart\b/i.test(value.trim());
}

export function resolveCodingPlanEntryPlanState(params: {
  displayStatus?: string | null;
  providerId?: string | null;
  planLevel?: string | null;
  snapshot?: UsageEntitlementSnapshot | null;
}): CodingPlanEntryPlanState {
  const rawPlanLevel = params.planLevel?.trim() ?? "";
  const snapshotLevel =
    params.snapshot?.subscription?.details?.[0]?.productName?.trim() ||
    params.snapshot?.subscription?.details?.[0]?.productId?.trim() ||
    params.snapshot?.quota?.level?.trim() ||
    "";
  const entryPlanLevel = rawPlanLevel || snapshotLevel;
  if (params.snapshot) {
    if (params.snapshot.unavailableReason === "no_plan") {
      return { entryPlanStatus: "no_plan", entryPlanLevel: "" };
    }
    if (params.snapshot.subscription?.details.length) {
      return {
        entryPlanStatus: isStartPlanLevel(entryPlanLevel) ? "start_plan" : "coding_plan",
        entryPlanLevel,
      };
    }
  }
  if (params.displayStatus === "notPurchased") {
    return { entryPlanStatus: "no_plan", entryPlanLevel: "" };
  }
  if (params.displayStatus === "purchased") {
    return {
      entryPlanStatus: isStartPlanLevel(entryPlanLevel) ? "start_plan" : "coding_plan",
      entryPlanLevel,
    };
  }
  if (params.providerId && isStartPlanProviderId(params.providerId) && entryPlanLevel) {
    return { entryPlanStatus: "start_plan", entryPlanLevel };
  }
  return { entryPlanStatus: "unknown", entryPlanLevel: "" };
}

export function resolveCodingPlanEntryPlanStateFromProviderSettings(
  view: ProviderSettingsView | null,
): CodingPlanEntryPlanState {
  if (!view) {
    return resolveCodingPlanEntryPlanState({});
  }
  const accountProviders = view.providers.filter(
    (provider) =>
      provider.effectiveConfig.access?.type === "zhipu-account" &&
      provider.effectiveConfig.access.entitled === true,
  );
  const codingPlanProvider = accountProviders.find(
    (provider) =>
      provider.providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan ||
      provider.providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan ||
      // Team 同样持有 Coding Plan；不能用包含 Start 的宽泛 helper 判断套餐。
      provider.providerId === BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan ||
      provider.providerId === BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan,
  );
  if (codingPlanProvider) {
    return resolveCodingPlanEntryPlanState({
      displayStatus: "purchased",
      providerId: codingPlanProvider.providerId,
    });
  }
  const startPlanProvider = accountProviders.find((provider) =>
    isStartPlanProviderId(provider.providerId),
  );
  if (startPlanProvider) {
    return resolveCodingPlanEntryPlanState({
      displayStatus: "purchased",
      providerId: startPlanProvider.providerId,
      planLevel: "start",
    });
  }
  return resolveCodingPlanEntryPlanState({ displayStatus: "notPurchased" });
}

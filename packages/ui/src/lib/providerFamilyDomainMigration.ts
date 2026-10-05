import type { IServiceAccessor } from "@zcode/services";
import {
  type ProviderFamilyDomain,
  resolveModelProviderFamilyIdByProviderId,
  resolveProviderFamilyDomainFromOAuthProvider,
} from "@zcode/shared";
import { logger } from "@/logger.js";

function inferProviderFamilyDomainFromSelection(
  providers: readonly { readonly providerId: string }[],
): ProviderFamilyDomain | null {
  const usableDomains = new Set<ProviderFamilyDomain>();

  for (const provider of providers) {
    const domain = resolveModelProviderFamilyIdByProviderId(provider.providerId);
    if (!domain) continue;
    usableDomains.add(domain);
  }

  if (usableDomains.size !== 1) {
    return null;
  }
  return [...usableDomains][0] ?? null;
}

export async function ensureProviderFamilyDomainMigration(
  services: Pick<IServiceAccessor, "settingService" | "oauthService" | "modelSelectionService">,
): Promise<void> {
  const settings = await services.settingService.get();
  if (settings.providerFamilyDomain || settings.providerFamilyDomainMigrated) {
    return;
  }

  let inferredDomain = resolveProviderFamilyDomainFromOAuthProvider(
    await services.oauthService.getActiveProvider(),
  );
  let selectableProviders: readonly { readonly providerId: string }[] | null = null;

  if (!inferredDomain) {
    try {
      selectableProviders = (await services.modelSelectionService.getView()).providers;
      inferredDomain = inferProviderFamilyDomainFromSelection(selectableProviders);
    } catch (error) {
      logger.warn("[providerFamilyDomainMigration] 读取模型选择视图失败", {
        error,
      });
    }
  }

  if (!inferredDomain && selectableProviders?.length === 0) {
    // 启动早期 OAuth active provider 和 Registry 可能都还没恢复。
    // 此时如果把“空结果”标记为已迁移，会让后续草稿预热在 selectedKey 为空时吃到旧 Start Plan 偏好。
    logger.info("[providerFamilyDomainMigration] provider family domain 迁移等待模型选择视图恢复");
    return;
  }

  await services.settingService.update({
    ...(inferredDomain ? { providerFamilyDomain: inferredDomain } : {}),
    providerFamilyDomainUpdatedAt: Date.now(),
    providerFamilyDomainMigrated: true,
  });

  logger.info("[providerFamilyDomainMigration] provider family domain 迁移完成", {
    inferredDomain,
  });
}

/**
 * 去智谱化的一次性清理：清掉存量用户 setting.json 里的 provider family 字段。
 *
 * builtin 已删除全部 account:* Provider 与套餐模板，providerFamilyDomain 的两个合法取值
 * （zai / bigmodel）连同 providerFamilyConnectionSelections 的全部 key 都指向不存在的
 * 套餐体系，留着只会让设置页与 registry 继续按失效 family 做过滤。
 *
 * 一次性守卫用独立字段而不是 providerFamilyDomainMigrated：需要清理的恰恰是已经迁移过、
 * 带着旧 domain 的老用户，复用那个守卫会直接跳过。
 */
export async function ensureRetiredProviderFamilySettingsPurge(
  services: Pick<IServiceAccessor, "settingService">,
): Promise<void> {
  const settings = await services.settingService.get();
  if (settings.retiredProviderFamilySettingsPurged) return;

  const purgedDomain = settings.providerFamilyDomain ?? null;
  const purgedSelections = Object.keys(settings.providerFamilyConnectionSelections ?? {});

  await services.settingService.update({
    // 空串是既有清空约定：normalizeSettingsPatch 把它归一成 undefined，落盘时删掉该键。
    // 领域类型不含空串，这里沿用设置页既有的清空写法。
    providerFamilyDomain: "" as never,
    providerFamilyDomainUpdatedAt: undefined,
    // 两个 family 的 key 全是已下线套餐的连接选择，没有需要保留的子集。
    providerFamilyConnectionSelections: {},
    // 同时置位既有迁移守卫：否则同一次启动里下面的推断会把刚清掉的 family 写回来。
    providerFamilyDomainMigrated: true,
    retiredProviderFamilySettingsPurged: true,
  });

  logger.info("[providerFamilyDomainMigration] provider family 存量设置已清理", {
    purgedDomain,
    purgedSelections,
  });
}

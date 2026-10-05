import {
  ProviderTemplateMap,
  type ModelConfigRule,
  type ModelConfigRules,
  type ModelId,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
  type ProviderConfigMap,
  type ProviderId,
  type ProviderTemplateId,
} from "@zcode/provider";
import type { ModelSelection } from "@zcode/shared/model-selection";

/**
 * 去智谱化下线的 Provider 实体清单，依据是 `config/provider/zcode-builtin.json`
 * revision 30→31 删除的 8 条 `account:*` providerRules（access=zhipu-account）。
 *
 * 必须显式列举，不能写成「不在 builtin 里就算下线」：Personal 层保存的是用户与历史
 * 数据，用户自己创建的 Provider 本来就不在 builtin 里，动态判断会把它们一起删掉。
 */
export const RETIRED_ZHIPU_PROVIDER_IDS: readonly ProviderId[] = Object.freeze([
  "account:bigmodel-individual-coding-plan",
  "account:bigmodel-offpeak-idle-plan",
  "account:bigmodel-start-plan",
  "account:bigmodel-team-coding-plan",
  "account:zai-individual-coding-plan",
  "account:zai-offpeak-idle-plan",
  "account:zai-start-plan",
  "account:zai-team-coding-plan",
]);

/**
 * 已下线模板清单（当前为空）。
 *
 * 原为 `zai-api` / `bigmodel-api`（套餐模板）；「Coding Plan API Key 预设」恢复后
 * 它们不再是已下线实体——账号体系仍移除，这两条只是普通 api-key 预设
 * （见 docs/specs/flatten-provider-zones.md 的修订节）。保留导出与过滤逻辑，
 * 后续若再有模板下线仍从这里统一清理。
 */
export const RETIRED_ZHIPU_PROVIDER_TEMPLATE_IDS: readonly ProviderTemplateId[] = Object.freeze([]);

/**
 * 已下线账号 Provider 的选中模型回退目标。
 *
 * 按 id 前缀映射而不是维护一张「旧 id → 新 id」对照表：套餐名（start-plan /
 * coding-plan / offpeak…）是产品迭代的产物，会随版本增删；而 `account:zai-` /
 * `account:bigmodel-` 这两个前缀是 builtin 里唯一稳定的分族信号，回退语义只需要分族。
 * 回退目标是同族保留的 api-key 标准预设，不是随便挑一个 Provider——用户在智谱上
 * 攒下的模型习惯只对这两个预设成立。
 */
const RETIRED_PROVIDER_FALLBACKS: readonly {
  readonly prefix: string;
  readonly templateId: ProviderTemplateId;
}[] = Object.freeze([
  { prefix: "account:zai-", templateId: "zai-standard-api" },
  { prefix: "account:bigmodel-", templateId: "bigmodel-standard-api" },
]);

/**
 * 把 Personal 层里指向已下线智谱实体的残留条目一次性对账掉。
 *
 * 幂等性来自数据本身而不是额外守卫字段：判定输入就是「当前快照里还有没有已下线 id」，
 * 第一次执行后这些 id 全部消失，第二次必然返回 null。调用方据此跳过写入，
 * 空跑不会产生新的文件版本或失效通知。
 *
 * 返回 null 表示无需变更；返回 `ProviderConfigLayerUpdate` 时必须整体经
 * `personalRepository.update()` 落盘，不能直接改文件。
 */
export function createRetiredZhipuProviderMigrationUpdate(
  current: ProviderConfigLayerSnapshot,
  zcodeBuiltin: ProviderConfigLayerSnapshot,
): ProviderConfigLayerUpdate | null {
  const providers = dropRetiredProviders(current.providers);
  const models = dropRetiredModelRules(current.models);
  const providerOrder = dropRetiredFromOrder(current.providerOrder);
  // Personal 文件目前不落盘模板（见 provider-config-file-codec 的 encode 只写
  // providerOrder / providerConfigRules / modelConfigRules / defaultModelSelection），
  // 这里仍按同一清单过滤，让内存快照与未来落盘路径共用一条判定。
  const providerTemplates = dropRetiredTemplates(current.providerTemplates);
  const defaultModelSelection = resolveMigratedDefaultModelSelection(
    current.defaultModelSelection,
    current,
    zcodeBuiltin,
  );
  if (
    providers === current.providers &&
    models === current.models &&
    providerOrder === current.providerOrder &&
    providerTemplates === current.providerTemplates &&
    defaultModelSelection === current.defaultModelSelection
  ) {
    return null;
  }
  return Object.freeze({
    providers,
    models,
    providerOrder,
    ...(providerTemplates === undefined ? {} : { providerTemplates }),
    ...(defaultModelSelection === undefined ? {} : { defaultModelSelection }),
  });
}

function dropRetiredProviders(providers: ProviderConfigMap): ProviderConfigMap {
  let next = providers;
  for (const providerId of RETIRED_ZHIPU_PROVIDER_IDS) {
    if (!next.has(providerId)) continue;
    next = next.delete(providerId);
  }
  return next;
}

function dropRetiredModelRules(models: ModelConfigRules): ModelConfigRules {
  let next = models;
  for (const providerId of RETIRED_ZHIPU_PROVIDER_IDS) {
    if (!hasExactModelRuleForProvider(models, providerId)) continue;
    next = next.deleteExactForProvider(providerId);
  }
  return next;
}

function hasExactModelRuleForProvider(models: ModelConfigRules, providerId: ProviderId): boolean {
  return models
    .rules()
    .some(
      (rule: ModelConfigRule) =>
        (rule.type === "provider-model" || rule.type === "manual-provider-model") &&
        rule.providerId === providerId,
    );
}

function dropRetiredFromOrder(
  providerOrder: readonly ProviderId[] | undefined,
): readonly ProviderId[] | undefined {
  if (!providerOrder) return undefined;
  const next = providerOrder.filter(
    (providerId) => !RETIRED_ZHIPU_PROVIDER_IDS.includes(providerId),
  );
  return next.length === providerOrder.length ? providerOrder : next;
}

function dropRetiredTemplates(
  providerTemplates: ProviderTemplateMap | undefined,
): ProviderTemplateMap | undefined {
  if (!providerTemplates) return undefined;
  const next = new ProviderTemplateMap(
    providerTemplates
      .entries()
      .filter(([templateId]) => !RETIRED_ZHIPU_PROVIDER_TEMPLATE_IDS.includes(templateId)),
  );
  return next.keys().length === providerTemplates.keys().length ? providerTemplates : next;
}

function resolveMigratedDefaultModelSelection(
  selection: ModelSelection | undefined,
  current: ProviderConfigLayerSnapshot,
  zcodeBuiltin: ProviderConfigLayerSnapshot,
): ModelSelection | undefined {
  if (!selection || !RETIRED_ZHIPU_PROVIDER_IDS.includes(selection.providerId)) return selection;
  const fallback = resolveRetiredProviderFallback(selection.providerId, current, zcodeBuiltin);
  // 解析不到替代 Provider 就清空：悬空 providerId 与迁移前一样不可用，还会继续挡住用户重新选择。
  // 不继承旧 options：reasoningLevel 属于账号套餐的模型清单，套到另一个 Provider 的同名模型上是伪造事实。
  return fallback
    ? Object.freeze({ providerId: fallback.providerId, modelId: fallback.modelId })
    : undefined;
}

/**
 * 回退目标必须先证明它真实存在，否则迁移只会把一个悬空引用换成另一个。
 *
 * `zai-standard-api` / `bigmodel-standard-api` 是 builtin 模板，不是 Provider；Provider
 * 要等用户在 UI 里用它创建才落进 personal 层，id 取模板名归一化后的种子
 * （见 @zcode/provider 的 nextPersonalProviderId）。所以只在 personal 层里查存在性：
 * 去智谱化后 builtin 层的 providers 已被清空，拿 builtin 兜底等于走进空集。
 */
function resolveRetiredProviderFallback(
  retiredProviderId: ProviderId,
  current: ProviderConfigLayerSnapshot,
  zcodeBuiltin: ProviderConfigLayerSnapshot,
): { readonly providerId: ProviderId; readonly modelId: ModelId } | null {
  const templateId = RETIRED_PROVIDER_FALLBACKS.find((candidate) =>
    retiredProviderId.startsWith(candidate.prefix),
  )?.templateId;
  if (!templateId) return null;
  if (!current.providers.has(templateId)) return null;
  const modelId =
    current.providers.get(templateId)?.builtinModelIds?.[0] ??
    zcodeBuiltin.providerTemplates?.get(templateId)?.config.builtinModelIds?.[0];
  return modelId ? { providerId: templateId, modelId } : null;
}

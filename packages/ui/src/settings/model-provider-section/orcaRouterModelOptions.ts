import { filterOrcaModels, type OrcaCapability, type OrcaModelRecord } from "@zcode/shared";

/** 目录视图里的模型（与 host 返回的最小元数据一致） */
export interface OrcaCatalogModel {
  readonly modelId: string;
  readonly inputModalities: readonly string[];
  readonly supportedEndpointTypes: readonly string[];
}

/**
 * 把 host 目录视图还原为共享合同里的记录形状。
 *
 * 目录视图是**服务端已过滤**的结果，这里再按同一份共享规则过滤一次：
 * 即使 host 返回了未过滤或过期的载荷，selector 的 options 也不会混入
 * 未显式声明该模态的模型（fail closed）。
 */
export function toOrcaModelRecords(
  models: readonly OrcaCatalogModel[],
): readonly OrcaModelRecord[] {
  return models.map((model) =>
    Object.freeze({
      id: model.modelId,
      supportedEndpointTypes: model.supportedEndpointTypes,
      inputModalities: model.inputModalities,
    }),
  );
}

export interface OrcaSelectorRequirements {
  readonly capability: OrcaCapability;
  /** 入口实际会上传的非文本模态；未声明该模态的模型必须被排除 */
  readonly requiredInputModality?: "image" | "audio" | "video";
}

/** 真正交给 model selector 的 options：按当前入口能力过滤后的列表 */
export function selectOrcaModelOptions(
  models: readonly OrcaCatalogModel[],
  requirements: OrcaSelectorRequirements,
): readonly OrcaCatalogModel[] {
  const allowed = new Set(
    filterOrcaModels(
      toOrcaModelRecords(models),
      requirements.capability,
      requirements.requiredInputModality,
    ).map((record) => record.id),
  );
  // 保持 host 的原始顺序（目录顺序即权威顺序）。
  return Object.freeze(models.filter((model) => allowed.has(model.modelId)));
}

export interface OrcaSelectionReconciliation {
  readonly options: readonly OrcaCatalogModel[];
  /** 仍然兼容的当前选择；不兼容时为 null（调用方必须清空并提示重选） */
  readonly selectedModelId: string | null;
  /** 当前选择是否因为不再兼容而被清空 */
  readonly cleared: boolean;
}

/**
 * 能力变化后重算 selection。
 *
 * 已选模型不再兼容时必须清空，不能静默保留错误值。
 */
export function reconcileOrcaSelection(input: {
  readonly models: readonly OrcaCatalogModel[];
  readonly requirements: OrcaSelectorRequirements;
  readonly selectedModelId: string | null;
}): OrcaSelectionReconciliation {
  const options = selectOrcaModelOptions(input.models, input.requirements);
  const selected = input.selectedModelId;
  if (!selected) {
    return Object.freeze({ options, selectedModelId: null, cleared: false });
  }
  const stillValid = options.some((model) => model.modelId === selected);
  if (stillValid) {
    return Object.freeze({ options, selectedModelId: selected, cleared: false });
  }
  return Object.freeze({ options, selectedModelId: null, cleared: true });
}

/** 入口需求：有图片附件时必须要求显式声明 image 输入 */
export function resolveOrcaSelectorRequirements(input: {
  readonly capability: OrcaCapability;
  readonly hasImageAttachment: boolean;
}): OrcaSelectorRequirements {
  if (input.capability === "chat" && input.hasImageAttachment) {
    return Object.freeze({ capability: "chat", requiredInputModality: "image" });
  }
  return Object.freeze({ capability: input.capability });
}

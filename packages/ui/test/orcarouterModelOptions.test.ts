import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileOrcaSelection,
  resolveOrcaSelectorRequirements,
  selectOrcaModelOptions,
  toOrcaModelRecords,
  type OrcaCatalogModel,
} from "../src/settings/model-provider-section/orcaRouterModelOptions.js";

/**
 * 直接断言「交给 model selector 的 options」：
 * 切到 OrcaRouter 后来自 API 目录；加图片附件后只剩显式声明 image 的 chat 模型；
 * 旧值不再兼容时被清空。只有一套输入框或只有自由文本都不满足要求。
 */
const TEXT_ENDPOINTS = ["openai", "openai-response", "anthropic", "gemini"];

function model(
  modelId: string,
  inputModalities: readonly string[],
  supportedEndpointTypes: readonly string[] = TEXT_ENDPOINTS,
): OrcaCatalogModel {
  return { modelId, inputModalities, supportedEndpointTypes };
}

/** fixture 覆盖 text-only / image-input chat / embedding / image / video / rerank */
const CATALOG: readonly OrcaCatalogModel[] = [
  model("openai/gpt-5.5", ["text", "image"]),
  model("deepseek/deepseek-v4-pro", ["text"]),
  model("orcarouter/auto", ["text"]),
  model("acme/embed", ["text"], ["embeddings"]),
  model("acme/image-gen", [], ["image-generation"]),
  model("acme/video", [], ["openai-video"]),
  model("acme/rerank", ["text"], ["jina-rerank"]),
];

test("selector options：chat 只保留文本端点模型，排除 image/video/rerank 专用模型", () => {
  const options = selectOrcaModelOptions(CATALOG, { capability: "chat" });
  const ids = options.map((m) => m.modelId);
  assert.deepEqual(ids, ["openai/gpt-5.5", "deepseek/deepseek-v4-pro", "orcarouter/auto"]);
  assert.ok(!ids.includes("acme/embed"));
  assert.ok(!ids.includes("acme/image-gen"));
  assert.ok(!ids.includes("acme/video"));
  assert.ok(!ids.includes("acme/rerank"));
});

test("selector options：加图片附件后只剩显式声明 image 的 chat 模型", () => {
  const requirements = resolveOrcaSelectorRequirements({
    capability: "chat",
    hasImageAttachment: true,
  });
  assert.equal(requirements.requiredInputModality, "image");
  const options = selectOrcaModelOptions(CATALOG, requirements);
  assert.deepEqual(
    options.map((m) => m.modelId),
    ["openai/gpt-5.5"],
  );
});

test("selector options：embedding/image/video/rerank 按各自能力严格匹配", () => {
  assert.deepEqual(
    selectOrcaModelOptions(CATALOG, { capability: "embedding" }).map((m) => m.modelId),
    ["acme/embed"],
  );
  assert.deepEqual(
    selectOrcaModelOptions(CATALOG, { capability: "image" }).map((m) => m.modelId),
    ["acme/image-gen"],
  );
  assert.deepEqual(
    selectOrcaModelOptions(CATALOG, { capability: "video" }).map((m) => m.modelId),
    ["acme/video"],
  );
  assert.deepEqual(
    selectOrcaModelOptions(CATALOG, { capability: "rerank" }).map((m) => m.modelId),
    ["acme/rerank"],
  );
});

test("selector options：未声明能力的模型 fail closed，不按模型名猜能力", () => {
  const undocumented = [model("vendor/mystery", [], ["openai"])];
  assert.deepEqual(selectOrcaModelOptions(undocumented, { capability: "chat" }).length, 1);
  assert.deepEqual(
    selectOrcaModelOptions(undocumented, { capability: "chat", requiredInputModality: "image" })
      .length,
    0,
  );
});

test("reconcile：能力变化后不兼容的旧值被清空并提示重选", () => {
  // 先选一个 text-only 模型（chat 场景合法）。
  const chat = reconcileOrcaSelection({
    models: CATALOG,
    requirements: { capability: "chat" },
    selectedModelId: "deepseek/deepseek-v4-pro",
  });
  assert.equal(chat.cleared, false);
  assert.equal(chat.selectedModelId, "deepseek/deepseek-v4-pro");

  // 加入图片附件后该模型不再兼容：必须清空，不能静默保留。
  const withImage = reconcileOrcaSelection({
    models: CATALOG,
    requirements: { capability: "chat", requiredInputModality: "image" },
    selectedModelId: "deepseek/deepseek-v4-pro",
  });
  assert.equal(withImage.cleared, true);
  assert.equal(withImage.selectedModelId, null);
  assert.deepEqual(
    withImage.options.map((m) => m.modelId),
    ["openai/gpt-5.5"],
  );
});

test("reconcile：目录失败时传入的 fallback 已是唯一事实源，不退回自由输入", () => {
  // live 失败时 host 返回 verified seed；selector 只消费这份列表。
  const fallback = [model("openai/gpt-5.5", ["text", "image"]), model("orcarouter/auto", ["text"])];
  const options = selectOrcaModelOptions(fallback, {
    capability: "chat",
    requiredInputModality: "image",
  });
  assert.deepEqual(
    options.map((m) => m.modelId),
    ["openai/gpt-5.5"],
  );
  // 目录为空时 options 必须为空，绝不能合成自由输入值。
  assert.deepEqual(selectOrcaModelOptions([], { capability: "chat" }), []);
});

test("toOrcaModelRecords：保持 vendor/model 命名空间原样", () => {
  const records = toOrcaModelRecords([
    model("deepseek/deepseek-v4-flash-vision-exp", ["text", "image"]),
  ]);
  assert.equal(records[0]!.id, "deepseek/deepseek-v4-flash-vision-exp");
});

/**
 * OrcaRouter 模型目录的固定证据数据。
 *
 * 模型 id 与能力声明取自权威实时目录 `GET https://api.orcarouter.ai/v1/models`
 * （2026-10 观察值）。这里只保留渲染与断言需要的最小元数据，不含任何凭据。
 *
 * 同一份数据同时被浏览器端 main.tsx 的假服务与 node 端 run.mjs 的计数读取，
 * 避免两处漂移。
 */

export const CATALOG_SOURCE_URL = "https://api.orcarouter.ai/v1/models?capability=chat";

/** 权威目录中的所有 chat 模型（顺序即目录权威顺序）。 */
export const ORCA_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    modelId: "openai/gpt-5.5",
    inputModalities: Object.freeze(["text", "image"]),
    supportedEndpointTypes: Object.freeze(["openai", "openai-response", "anthropic", "gemini"]),
  }),
  Object.freeze({
    modelId: "anthropic/claude-opus-4.8",
    inputModalities: Object.freeze(["text", "image"]),
    supportedEndpointTypes: Object.freeze(["openai", "openai-response", "anthropic", "gemini"]),
  }),
  Object.freeze({
    modelId: "google/gemini-3.5-flash",
    inputModalities: Object.freeze(["text", "image"]),
    supportedEndpointTypes: Object.freeze(["openai", "openai-response", "anthropic", "gemini"]),
  }),
  Object.freeze({
    modelId: "deepseek/deepseek-v4-pro",
    inputModalities: Object.freeze(["text"]),
    supportedEndpointTypes: Object.freeze(["openai", "openai-response", "anthropic", "gemini"]),
  }),
  Object.freeze({
    modelId: "orcarouter/auto",
    inputModalities: Object.freeze(["text"]),
    supportedEndpointTypes: Object.freeze(["openai", "openai-response", "anthropic", "gemini"]),
  }),
  Object.freeze({
    modelId: "deepseek/deepseek-v4-flash-vision-exp",
    inputModalities: Object.freeze(["text", "image"]),
    supportedEndpointTypes: Object.freeze(["openai", "openai-response", "anthropic", "gemini"]),
  }),
]);

/**
 * 纯函数过滤：与 selector 的 fail-closed 规则一致。
 *
 * - capability 非 `chat`：返回空列表。
 * - `requiredInputModality === "image"`：只保留显式声明 `image` 输入的模型。
 */
export function listOrcaModels({ capability, requiredInputModality } = {}) {
  if (capability !== "chat") {
    return [];
  }
  if (requiredInputModality) {
    return ORCA_MODEL_CATALOG.filter((model) =>
      model.inputModalities.includes(requiredInputModality),
    );
  }
  return [...ORCA_MODEL_CATALOG];
}

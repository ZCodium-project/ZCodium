import assert from "node:assert/strict";
import test from "node:test";
import { filterOrcaModels, buildOrcaV1Base, resolveOrcaOrigins } from "@zcode/shared";
import type { ICredentialService } from "../src/credential/credential.js";
import { createOrcaCredentialStore } from "../src/orcarouter/credentialStore.js";
import { createOrcaCredentialProvider } from "../src/orcarouter/credentials.js";
import { createOrcaCatalogService } from "../src/orcarouter/catalog.js";

/**
 * Live 检查：必须经过本次实现的 provider 代码路径（createOrcaCatalogService），
 * 而不是单独 curl。密钥只从环境变量读取，绝不打印、绝不写入断言消息。
 */
const apiKey = process.env.ORCAROUTER_API_KEY?.trim() ?? "";
const hasKey = apiKey.length > 0;

const ORIGINS = Object.freeze({
  authBase: "https://www.orcarouter.ai",
  apiBase: "https://api.orcarouter.ai",
});

/**
 * 只在内存中承载真实密钥：绝不写盘、绝不打印。
 * 通过项目自己的 store.save() 注入，保证 live 请求走真实凭据读取路径。
 */
async function liveStore() {
  const records = new Map<string, string>();
  const service: Pick<ICredentialService, "load" | "save" | "delete"> = {
    async load(key) {
      return records.get(key) ?? null;
    },
    async save(key, value) {
      records.set(key, value);
    },
    async delete(key) {
      records.delete(key);
    },
  };
  const store = createOrcaCredentialStore({ credentialService: service });
  await store.save({ apiKey, source: "api-key" });
  return store;
}

test("live：真实目录为权威结果，chat 过滤只保留文本端点模型", { skip: !hasKey }, async () => {
  const catalog = createOrcaCatalogService({
    credentialStore: await liveStore(),
    origins: ORIGINS,
  });
  const result = await catalog.list({ capability: "chat" });

  assert.equal(result.source, "live");
  assert.equal(result.degraded, false);
  assert.ok(result.models.length > 0, "live 目录必须返回模型");

  const textEndpoints = new Set(["openai", "anthropic", "gemini", "openai-response"]);
  for (const model of result.models) {
    assert.ok(
      model.supportedEndpointTypes.some((type) => textEndpoints.has(type)),
      `chat 模型 ${model.id} 必须声明文本端点类型`,
    );
    assert.ok(!model.supportedEndpointTypes.includes("image-generation"));
    assert.ok(!model.supportedEndpointTypes.includes("openai-video"));
    assert.ok(!model.supportedEndpointTypes.includes("jina-rerank"));
  }
});

test("live：多模态过滤只保留显式声明 image 输入的 chat 模型", { skip: !hasKey }, async () => {
  const catalog = createOrcaCatalogService({
    credentialStore: await liveStore(),
    origins: ORIGINS,
  });
  const result = await catalog.list({ capability: "chat", requiredInputModality: "image" });

  assert.equal(result.source, "live");
  // 未声明能力必须 fail closed：结果里每个模型都要显式包含 image。
  for (const model of result.models) {
    assert.ok(model.inputModalities.includes("image"), `${model.id} 未声明 image 输入`);
  }
  // 过滤后不可能是全集（除非目录里所有 chat 模型都支持图片）。
  const chatOnly = await catalog.list({ capability: "chat" });
  assert.ok(result.models.length <= chatOnly.models.length);
});

test("live：非 chat 能力在本 workspace 无模型时返回空而不是报错", { skip: !hasKey }, async () => {
  const catalog = createOrcaCatalogService({
    credentialStore: await liveStore(),
    origins: ORIGINS,
  });
  const result = await catalog.list({ capability: "embedding" });
  assert.equal(result.source, "live");
  assert.deepEqual([...result.models], []);
});

test("live：真实推理请求经过本次实现的凭据 seam 与 base URL 构造", { skip: !hasKey }, async () => {
  const store = await liveStore();
  const origins = resolveOrcaOrigins({});
  const credentials = createOrcaCredentialProvider(store);
  const catalog = createOrcaCatalogService({ credentialStore: store, origins });
  const chat = await catalog.list({ capability: "chat" });

  // 必须从 live 目录里挑模型；403 model_access_denied 是权限问题，不是接线问题。
  const model = chat.models[chat.models.length - 1]?.id;
  assert.ok(model, "live 目录必须有可调用模型");

  const base = buildOrcaV1Base(origins.apiBase);
  assert.equal(base, "https://api.orcarouter.ai/v1");
  const key = await credentials.getApiKey();
  assert.ok(key, "凭据 seam 必须返回可用 key");
  // 密钥绝不能出现在断言消息里。
  assert.ok(!base.includes(key));

  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 16,
      stream: false,
    }),
  });
  assert.equal(response.status, 200, `真实推理必须成功（model ${model}）`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  assert.equal(typeof payload.choices?.[0]?.message?.content, "string");
});

test("live：filterOrcaModels 与 shared 合同一致，不按模型名猜能力", { skip: !hasKey }, () => {
  const records = [
    {
      id: "vendor/text-only",
      supportedEndpointTypes: ["openai"],
      inputModalities: ["text"],
    },
  ];
  assert.equal(filterOrcaModels(records, "chat").length, 1);
  assert.equal(filterOrcaModels(records, "chat", "image").length, 0);
});

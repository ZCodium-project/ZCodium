/**
 * providerBalanceTargetResolver 的目标解析测试。
 *
 * 契约：只有普通 `api-key` Provider 参与余额查询；官方账号
 * （zhipu-account）与套餐 Key（zhipu-coding-plan-api-key）属于官方链路，必须返回 null。
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IProviderSettingsService } from "../src/model-provider/providerFacadeServices.js";
import { createProviderBalanceTargetResolver } from "../src/usage-stats/providers/providerBalanceTargetResolver.js";

function makeProvider(overrides: Record<string, unknown>) {
  return {
    providerId: "custom-p1",
    providerName: "DeepSeek",
    enabled: true,
    executable: true,
    effectiveConfig: {
      access: { type: "api-key", apiKey: "sk-1" },
      api: { type: "openai-chat-completions", baseUrl: "https://api.deepseek.com/v1" },
    },
    issues: [],
    models: [],
    ...overrides,
  };
}

function makeResolver(providers: unknown[]) {
  const providerSettings = {
    async getView() {
      return {
        revision: 1,
        providerTemplates: [],
        providerOrder: providers.map((provider) => (provider as { providerId: string }).providerId),
        providers,
      };
    },
  } as unknown as Pick<IProviderSettingsService, "getView">;
  return createProviderBalanceTargetResolver(providerSettings);
}

test("普通 api-key Provider → 返回 providerId/名称/baseUrl/apiKey", async () => {
  const resolve = makeResolver([makeProvider({})]);
  const target = await resolve("custom-p1");
  assert.deepEqual(target, {
    providerId: "custom-p1",
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "sk-1",
  });
});

test("官方账号与套餐 Key 不参与余额查询", async () => {
  const resolve = makeResolver([
    makeProvider({
      providerId: "account:zai-start-plan",
      effectiveConfig: {
        access: { type: "zhipu-account", accountType: "zai", mode: "start-plan" },
      },
    }),
    makeProvider({
      providerId: "plan-key-p1",
      effectiveConfig: { access: { type: "zhipu-coding-plan-api-key", apiKey: "plan-key" } },
    }),
  ]);
  assert.equal(await resolve("account:zai-start-plan"), null);
  assert.equal(await resolve("plan-key-p1"), null);
});

test("不存在的 providerId → null", async () => {
  const resolve = makeResolver([makeProvider({})]);
  assert.equal(await resolve("missing"), null);
});

test("apiKey 缺失 → apiKey=null（由服务层判 not_configured）", async () => {
  const resolve = makeResolver([
    makeProvider({ effectiveConfig: { access: { type: "api-key" } } }),
  ]);
  const target = await resolve("custom-p1");
  assert.equal(target?.apiKey, null);
});

test("providerName 空白 → 回退 providerId；baseUrl 缺失 → null", async () => {
  const resolve = makeResolver([
    makeProvider({
      providerName: "  ",
      effectiveConfig: { access: { type: "api-key", apiKey: "k" } },
    }),
  ]);
  const target = await resolve("custom-p1");
  assert.equal(target?.providerName, "custom-p1");
  assert.equal(target?.baseUrl, null);
});

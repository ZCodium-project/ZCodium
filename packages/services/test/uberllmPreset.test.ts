import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";
import { describe, expect, it, vi } from "vitest";
import { createProviderRuntime } from "../src/model-provider/providerRuntime.js";

const bundledUrl = new URL("../../../config/provider/zcode-builtin.json", import.meta.url);
const baseUrl = "https://api.uberllm.dev/v1";

describe("UberLLM preset", () => {
  it("真实 Built-in schema 与通用模型规则解析出官方目录的 IDs/limits", async () => {
    const release = decodeZCodeBuiltinRelease(JSON.parse(await readFile(bundledUrl, "utf8")));
    const template = release.config.providerTemplates.get("uberllm")!;
    expect(template.config.toJSON()).toMatchObject({
      access: { type: "api-key", apiKeyManagementUrl: "https://uberllm.dev/dashboard/keys" },
      api: { type: "openai-chat-completions", baseUrl },
      builtinModelIds: ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3"],
      logo: { type: "builtin", key: "uberllm" },
    });
    for (const [modelId, contextWindow, maxOutputTokens] of [
      ["deepseek/deepseek-v4.1-flash", 1_000_000, 384_000],
      ["z-ai/glm-5.3", 1_000_000, 128_000],
    ] as const) {
      const input = {
        providerId: "fixture-provider",
        modelId,
        apiType: "openai-chat-completions",
        baseUrl,
      };
      const model = release.config.modelConfigRules.resolve({
        ...input,
        templateId: "uberllm",
      });
      const manual = release.config.modelConfigRules.resolve(input);
      expect(model.validateComplete(), modelId).toEqual([]);
      expect(model.enabled, modelId).toBe(true);
      expect(model.properties?.contextWindow, modelId).toBe(contextWindow);
      expect(model.optionSpecs?.maxOutputTokens?.max, modelId).toBe(maxOutputTokens);
      expect(model.properties?.toJSON(), modelId).toEqual(manual.properties?.toJSON());
      expect(model.optionSpecs?.toJSON(), modelId).toEqual(manual.optionSpecs?.toJSON());
    }
  });

  it("列模板、初始化 Registry 与无 Key 创建均不向供应商发网络，不默认可执行", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-uberllm-preset-"));
    const bundled = join(root, "bundled.json");
    await copyFile(bundledUrl, bundled);
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("测试禁止外部网络"));
    const runtime = createProviderRuntime({
      zcodeBuiltinFilePath: bundled,
      zcodeBuiltinActiveFilePath: join(root, "active.json"),
      personalFilePath: join(root, "personal.json"),
      personalPollingIntervalMs: false,
      watch: false,
    });
    try {
      const view = await runtime.providerSettings.getView();
      expect(view.providerTemplates.some((template) => template.templateId === "uberllm")).toBe(
        true,
      );
      expect(view.providers).toEqual([]);
      const created = await runtime.providerSettings.createPersonalProvider({
        templateId: "uberllm",
      });
      const provider = created.view.providers.find(
        (provider) => provider.providerId === created.providerId,
      )!;
      expect(provider.executable).toBe(false);
      expect(provider.effectiveConfig.access).toEqual({
        type: "api-key",
        apiKeyManagementUrl: "https://uberllm.dev/dashboard/keys",
      });
      expect(provider.models.map((model) => model.modelId)).toEqual([
        "deepseek/deepseek-v4.1-flash",
        "z-ai/glm-5.3",
      ]);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      runtime.dispose();
      fetch.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});

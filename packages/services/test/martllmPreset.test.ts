import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeZCodeBuiltinRelease } from "@zcode/provider-node";
import { describe, expect, it, vi } from "vitest";
import { createProviderRuntime } from "../src/model-provider/providerRuntime.js";

const bundledUrl = new URL("../../../config/provider/zcode-builtin.json", import.meta.url);
const baseUrl = "https://api.martllm.com/v1";

describe("MartLLM preset", () => {
  it("真实 Built-in schema 解析现行模板，站点规则只改变协议字段", async () => {
    const release = decodeZCodeBuiltinRelease(JSON.parse(await readFile(bundledUrl, "utf8")));
    expect(release.config.providerTemplates.has("uberllm")).toBe(false);
    const template = release.config.providerTemplates.get("martllm")!;
    expect(template.templateNameMap).toEqual({ "zh-CN": "MartLLM", "en-US": "MartLLM" });
    expect(template.config.toJSON()).toMatchObject({
      access: { type: "api-key", apiKeyManagementUrl: "https://martllm.com/dashboard/keys" },
      api: { type: "openai-chat-completions", baseUrl },
      builtinModelIds: ["deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3"],
    });
    expect(template.config.logo).toBeUndefined();
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
        templateId: "martllm",
      });
      const other = release.config.modelConfigRules.resolve({
        ...input,
        baseUrl: "https://fixture.invalid/v1",
      });
      expect(model.validateComplete(), modelId).toEqual([]);
      expect(model.enabled, modelId).toBe(true);
      expect(model.properties?.contextWindow, modelId).toBe(contextWindow);
      expect(model.optionSpecs?.maxOutputTokens?.max, modelId).toBe(maxOutputTokens);
      expect(model.properties?.toJSON(), modelId).toEqual(other.properties?.toJSON());
      expect(model.optionSpecs?.maxOutputTokens?.map, modelId).toContain('"max_tokens"');
      expect(other.optionSpecs?.maxOutputTokens?.map, modelId).toContain("max_completion_tokens");
    }
  });

  it("列模板、初始化 Registry 与无 Key 创建均不向供应商发网络，不默认可执行", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-martllm-preset-"));
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
      expect(view.providerTemplates.some((template) => template.templateId === "martllm")).toBe(
        true,
      );
      expect(view.providers).toEqual([]);
      const created = await runtime.providerSettings.createPersonalProvider({
        templateId: "martllm",
      });
      const provider = created.view.providers.find(
        (provider) => provider.providerId === created.providerId,
      )!;
      expect(provider.executable).toBe(false);
      expect(provider.effectiveConfig.access).toEqual({
        type: "api-key",
        apiKeyManagementUrl: "https://martllm.com/dashboard/keys",
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

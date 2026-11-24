import { readFile } from "node:fs/promises";
import type { ModelEvent } from "@zcode/contracts";
import {
  createRegistryModelConfig,
  createRegistryProviderConfig,
  parseProviderConfig,
  parseZCodeBuiltinModelConfigRules,
  parseZCodeBuiltinProviderConfigRules,
} from "@zcode/provider";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AiSdkModelAdapter } from "../src/model/runner.js";

const templateId = "standardcompute";
const baseUrl = "https://api.stdcmpt.com/v1";
const apiType = "openai-chat-completions";
const providerId = "standardcompute-fixture";
const modelIds = ["StandardCompute", "deepseek/deepseek-v4.1-flash", "z-ai/glm-5.3"];
let templates: ReturnType<typeof parseZCodeBuiltinProviderConfigRules>["providerTemplates"];
let rules: ReturnType<typeof parseZCodeBuiltinModelConfigRules>;

beforeAll(async () => {
  const { config } = JSON.parse(
    await readFile(
      new URL("../../../../../config/provider/zcode-builtin.json", import.meta.url),
      "utf8",
    ),
  );
  ({ providerTemplates: templates } = parseZCodeBuiltinProviderConfigRules(
    config.providerConfigRules,
  ));
  rules = parseZCodeBuiltinModelConfigRules(config.modelConfigRules);
});

afterEach(() => vi.unstubAllGlobals());

describe("Standard Compute 内置预设", () => {
  it("保留目录 ID 和 Key 页，只给实际站点上的三个模型应用试用预算", () => {
    const template = templates.get(templateId)!;
    expect(template.config.toJSON()).toMatchObject({
      access: {
        type: "api-key",
        apiKeyManagementUrl: "https://standardcompute.com/dashboard/api-keys",
      },
      api: { type: apiType, baseUrl },
      builtinModelIds: modelIds,
    });
    expect(template.config.logo).toBeUndefined();
    for (const [index, modelId] of modelIds.entries()) {
      const input = { providerId, modelId, apiType };
      const model = rules.resolve({ ...input, templateId, baseUrl });
      expect(model.validateComplete(), modelId).toEqual([]);
      expect(model.enabled, modelId).toBe(true);
      expect(model.properties?.contextWindow, modelId).toBe(500_000);
      expect(model.properties?.inputFormat.supportsImage, modelId).toBe(index === 1);
      expect(model.optionSpecs?.maxOutputTokens?.max, modelId).toBe(32_768);

      const other = rules.resolve({ ...input, templateId, baseUrl: "https://fixture.invalid/v1" });
      expect(other.properties?.contextWindow, modelId).toBe([200_000, 1_000_000, 1_000_000][index]);
      expect(other.optionSpecs?.maxOutputTokens?.max, modelId).toBe(
        [32_000, 384_000, 128_000][index],
      );
    }
  });

  it.each([
    ["StandardCompute", "default", undefined],
    ["StandardCompute", "high", "high"],
    ["deepseek/deepseek-v4.1-flash", "disabled", "none"],
    ["deepseek/deepseek-v4.1-flash", "high", "high"],
    ["z-ai/glm-5.3", "low", "low"],
  ])("%s/%s 走正式 SDK 并按试用上限发出 SSE 请求", async (modelId, reasoningLevel, effort) => {
    const template = templates.get(templateId)!;
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        ...template.config.toJSON(),
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture" },
      }),
    );
    const modelConfig = createRegistryModelConfig(
      rules.resolve({ providerId, modelId, templateId, apiType, baseUrl }),
    );
    if (!provider.ok || !modelConfig.ok) throw new Error("预设不可执行");
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe(`${baseUrl}/chat/completions`);
      expect(request.headers.get("authorization")).toBe("Bearer fixture");
      const body = await request.json();
      expect(body).toMatchObject({
        model: modelId,
        max_completion_tokens: 32_768,
        stream: true,
        stream_options: { include_usage: true },
        tools: [{ type: "function", function: { name: "lookup" } }],
      });
      expect(body.reasoning_effort).toBe(effort);
      expect(body).not.toHaveProperty("thinking");
      expect(body).not.toHaveProperty("max_tokens");
      const chunk = JSON.stringify({
        id: "fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: modelId,
        choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 },
      });
      return new Response(`data: ${chunk}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", transport);
    const model = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } }).createModel({
      providerId,
      modelId,
      providerConfig: provider.config,
      modelConfig: modelConfig.config,
      options: { reasoningLevel, maxOutputTokens: 32_768 },
    });
    const request = { messages: [{ role: "user" as const, content: "ping" }] };
    await expect(
      model.generateText({
        ...request,
        options: { maxOutputTokens: 32_769 },
      }),
    ).rejects.toThrow("maxOutputTokens is outside the model option range");
    expect(transport).not.toHaveBeenCalled();
    const events: ModelEvent[] = [];
    for await (const event of model.streamText({
      ...request,
      tools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }],
    })) {
      events.push(event);
    }
    expect(events).toContainEqual(expect.objectContaining({ type: "text_delta", text: "OK" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "finish",
        usage: expect.objectContaining({ inputTokens: 7, outputTokens: 2 }),
      }),
    );
    expect(transport).toHaveBeenCalledOnce();
  });
});

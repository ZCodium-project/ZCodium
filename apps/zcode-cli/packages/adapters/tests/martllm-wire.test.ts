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

const templateId = "martllm";
const providerId = "martllm-fixture";
const baseUrl = "https://api.martllm.com/v1";
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

describe("MartLLM 正式 SDK 请求", () => {
  it.each([
    ["deepseek/deepseek-v4.1-flash", "disabled", "none"],
    ["deepseek/deepseek-v4.1-flash", "high", "high"],
    ["z-ai/glm-5.3", "max", "max"],
  ])("%s/%s 发出站点约定字段并消费 SSE", async (modelId, reasoningLevel, effort) => {
    const template = templates.get(templateId)!;
    const provider = createRegistryProviderConfig(
      parseProviderConfig({
        ...template.config.toJSON(),
        group: "standard-personal",
        access: { type: "api-key", apiKey: "fixture" },
      }),
    );
    if (!provider.ok) throw new Error("预设不可执行");
    const modelConfig = createRegistryModelConfig(
      rules.resolve({
        providerId,
        modelId,
        templateId,
        apiType: provider.config.api.type,
        baseUrl: provider.config.api.baseUrl,
      }),
    );
    if (!modelConfig.ok) throw new Error("模型不可执行");
    const reasoning = effort !== "none";
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      expect(request.url).toBe(`${baseUrl}/chat/completions`);
      expect(request.headers.get("authorization")).toBe("Bearer fixture");
      const body = await request.json();
      expect(body).toMatchObject({
        model: modelId,
        max_tokens: 1024,
        reasoning_effort: effort,
        stream: true,
        stream_options: { include_usage: true },
        tools: [{ type: "function", function: { name: "lookup" } }],
      });
      expect(body).not.toHaveProperty("max_completion_tokens");
      expect(body).not.toHaveProperty("thinking");

      const call = {
        index: 0,
        id: "call_fixture",
        type: "function",
        function: { name: "lookup", arguments: "{}" },
      };
      const chunks = [
        ...(reasoning ? [{ choices: [{ index: 0, delta: { reasoning_content: "plan" } }] }] : []),
        { choices: [{ index: 0, delta: { content: "OK" } }] },
        { choices: [{ index: 0, delta: { tool_calls: [call] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } },
      ];
      const sse = chunks
        .map(
          (chunk) =>
            `data: ${JSON.stringify({
              id: "fixture",
              model: modelId,
              object: "chat.completion.chunk",
              created: 1,
              ...chunk,
            })}\n\n`,
        )
        .join("");
      return new Response(`: ping\n\n${sse}data: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", transport);

    const model = new AiSdkModelAdapter({ env: {}, retry: { maxAttempts: 1 } }).createModel({
      providerId,
      modelId,
      providerConfig: provider.config,
      modelConfig: modelConfig.config,
      options: { reasoningLevel, maxOutputTokens: 1024 },
    });
    const events: ModelEvent[] = [];
    for await (const event of model.streamText({
      messages: [{ role: "user", content: "ping" }],
      tools: [{ name: "lookup", inputSchema: { type: "object", properties: {} } }],
    })) {
      events.push(event);
    }
    expect(
      events.filter((event) => event.type === "reasoning_delta").map((event) => event.text),
    ).toEqual(reasoning ? ["plan"] : []);
    expect(events).toContainEqual(expect.objectContaining({ type: "text_delta", text: "OK" }));
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool_call",
        toolCall: expect.objectContaining({ name: "lookup", input: {} }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "finish",
        finishReason: "tool-calls",
        usage: expect.objectContaining({ inputTokens: 7, outputTokens: 3 }),
      }),
    );
    expect(transport).toHaveBeenCalledOnce();
  });
});

import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildRemoteModelListRequest,
  parseRemoteModelListPage,
  type RemoteModelCatalogRequest,
} from "@zcode/provider";
import { createRemoteModelCatalogExecutor } from "../src/model-provider/remoteModelCatalog.js";

function openAiRequest(overrides: Partial<RemoteModelCatalogRequest> = {}) {
  return {
    apiType: "openai-chat-completions" as const,
    baseUrl: "https://gateway.example/v1",
    apiKey: "sk-test",
    ...overrides,
  };
}

test("openai 系：baseURL 原样拼接 /models 并使用 Bearer 头", () => {
  const request = buildRemoteModelListRequest(openAiRequest());
  assert.equal(request.url, "https://gateway.example/v1/models");
  assert.equal(request.headers.Authorization, "Bearer sk-test");
  // 尾部斜杠被归一化，不产生 //models。
  const trailing = buildRemoteModelListRequest(
    openAiRequest({ baseUrl: "https://gateway.example/v1/" }),
  );
  assert.equal(trailing.url, "https://gateway.example/v1/models");
});

test("openai 系：不插入 /v1 前缀，与正式执行链的 baseURL 语义一致", () => {
  const request = buildRemoteModelListRequest(
    openAiRequest({ baseUrl: "https://gateway.example" }),
  );
  assert.equal(request.url, "https://gateway.example/models");
});

test("anthropic 系：补齐 /v1 前缀、limit 分页参数与 x-api-key/anthropic-version/Bearer 头", () => {
  const request = buildRemoteModelListRequest({
    apiType: "anthropic-messages",
    baseUrl: "https://gateway.example",
    apiKey: "sk-ant",
  });
  const url = new URL(request.url);
  assert.equal(url.pathname, "/v1/models");
  assert.equal(url.searchParams.get("limit"), "1000");
  assert.equal(request.headers["x-api-key"], "sk-ant");
  assert.equal(request.headers["anthropic-version"], "2023-06-01");
  assert.equal(request.headers.Authorization, "Bearer sk-ant");
});

test("anthropic 系：baseUrl 已带 /v1 时不重复追加", () => {
  const request = buildRemoteModelListRequest({
    apiType: "anthropic-messages",
    baseUrl: "https://gateway.example/v1/",
    apiKey: "sk-ant",
  });
  assert.equal(new URL(request.url).pathname, "/v1/models");
});

test("显式 Provider headers 优先级高于检测头", () => {
  const request = buildRemoteModelListRequest({
    apiType: "anthropic-messages",
    baseUrl: "https://gateway.example",
    apiKey: "sk-ant",
    headers: { "anthropic-Version": "2099-01-01", Authorization: "Bearer custom" },
  });
  // HTTP 头大小写不敏感；显式头保留原样传递（与正式执行链一致），断言按小写读取。
  const headers = Object.fromEntries(
    Object.entries(request.headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  assert.equal(headers["anthropic-version"], "2099-01-01");
  assert.equal(headers.authorization, "Bearer custom");
  // 显式 x-api-key 不存在时仍注入检测头。
  assert.equal(headers["x-api-key"], "sk-ant");
});

test("非法 Base URL 显式报错", () => {
  assert.throws(() => buildRemoteModelListRequest(openAiRequest({ baseUrl: "" })), /Base URL/);
  assert.throws(() =>
    buildRemoteModelListRequest(openAiRequest({ baseUrl: "ftp://gateway.example" })),
  );
});

test("响应解析：只接受 data 数组并过滤非字符串 id；has_more/last_id 形成游标", () => {
  const page = parseRemoteModelListPage({
    data: [{ id: " model-a " }, { id: 42 }, {}, { id: "model-b" }],
    has_more: true,
    last_id: "model-b",
  });
  assert.deepEqual(page.modelIds, ["model-a", "model-b"]);
  assert.equal(page.cursor, "model-b");

  const final = parseRemoteModelListPage({ data: [{ id: "model-c" }], has_more: false });
  assert.equal(final.cursor, undefined);

  assert.throws(() => parseRemoteModelListPage({ models: [{ id: "x" }] }));
  assert.throws(() => parseRemoteModelListPage("not-an-object"));
});

test("executor：聚合分页并按首次出现去重", async () => {
  const pages = [
    { body: { data: [{ id: "m1" }, { id: "m2" }], has_more: true, last_id: "m2" } },
    { body: { data: [{ id: "m2" }, { id: "m3" }], has_more: false } },
  ];
  const urls: string[] = [];
  const executor = createRemoteModelCatalogExecutor({
    fetch: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify(pages[urls.length - 1]!.body), { status: 200 });
    },
  });
  const result = await executor(openAiRequest());
  assert.equal(result.success, true);
  assert.deepEqual(result.success ? result.models : [], ["m1", "m2", "m3"]);
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]!).searchParams.get("after"), "m2");
});

test("executor：非 2xx 返回失败结果并携带状态码", async () => {
  const executor = createRemoteModelCatalogExecutor({
    fetch: async () => new Response("denied", { status: 401, statusText: "Unauthorized" }),
  });
  const result = await executor(openAiRequest());
  assert.equal(result.success, false);
  assert.match(
    result.success ? "" : result.message,
    /^Provider 返回 401 Unauthorized（请求：GET https:\/\/gateway\.example\/v1\/models）$/,
  );
});

test("executor：网络异常与无法解析的响应都转为失败结果", async () => {
  const networkError = createRemoteModelCatalogExecutor({
    fetch: async () => {
      throw new Error("connection refused");
    },
  });
  assert.deepEqual(await networkError(openAiRequest()), {
    success: false,
    message: "connection refused",
  });

  const badShape = createRemoteModelCatalogExecutor({
    fetch: async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 }),
  });
  const result = await badShape(openAiRequest());
  assert.equal(result.success, false);
  assert.match(result.success ? "" : result.message, /data/);
});

test("executor：真实 fetch 的非法鉴权头异常不得把草稿 Key 回显到 UI", async () => {
  const apiKey = "fixture-api-key\nprivate-tail";
  const executor = createRemoteModelCatalogExecutor({});
  const result = await executor(openAiRequest({ baseUrl: "http://127.0.0.1:9/v1", apiKey }));
  assert.equal(result.success, false);
  const message = result.success ? "" : result.message;
  assert.ok(!message.includes(apiKey));
  assert.ok(!message.includes("fixture-api-key"));
  assert.match(message, /header/i);
});

test("executor：自定义 header 的原文、JSON 转义和 URL 编码凭据都脱敏", async () => {
  const secret = "fixture-header\nprivate-tail";
  const executor = createRemoteModelCatalogExecutor({
    fetch: async () => {
      throw new Error(`${secret}; ${JSON.stringify(secret)}; ${encodeURIComponent(secret)}`);
    },
  });
  const result = await executor(openAiRequest({ headers: { "X-Fixture": secret } }));
  assert.deepEqual(result, { success: false, message: '[REDACTED]; "[REDACTED]"; [REDACTED]' });
});

test("executor：HTTP 错误不暴露 URL userinfo/query/fragment 或回显的请求头", async () => {
  const executor = createRemoteModelCatalogExecutor({
    fetch: async () => new Response(null, { status: 404, statusText: "fixture-header-secret" }),
  });
  const result = await executor(
    openAiRequest({
      baseUrl: "https://user:password@gateway.example/v1?api_key=query-secret#fragment-secret",
      headers: { "X-Fixture": "fixture-header-secret" },
    }),
  );
  assert.equal(result.success, false);
  const message = result.success ? "" : result.message;
  for (const secret of [
    "user:",
    "password",
    "query-secret",
    "fragment-secret",
    "fixture-header-secret",
  ]) {
    assert.ok(!message.includes(secret), `错误消息必须脱敏 ${secret}`);
  }
  assert.match(message, /GET https:\/\/gateway\.example\/v1\/models/);
  assert.match(message, /404/);
});

test("executor：显式 Authorization 被上游去掉 Bearer 前缀回显时仍脱敏", async () => {
  const executor = createRemoteModelCatalogExecutor({
    fetch: async () => {
      throw new Error("invalid credential: fixture-auth-token");
    },
  });
  assert.deepEqual(
    await executor(openAiRequest({ headers: { Authorization: "Bearer fixture-auth-token" } })),
    {
      success: false,
      message: "invalid credential: [REDACTED]",
    },
  );
});

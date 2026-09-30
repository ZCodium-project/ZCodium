/**
 * ProviderBalanceProvider 服务层状态机测试。
 *
 * 覆盖 fail-soft 契约：unsupported / not_configured / unauthorized / error / ok
 * 以及请求地址、鉴权头、超时和"未识别供应商不发网络请求"的边界。
 * 解析纯函数由 providerBalanceParsing.test.ts 覆盖，这里用最小 ApiClient 桩。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ProviderBalanceProvider } from "../src/usage-stats/providers/providerBalanceProvider.js";

type RequestRecord = {
  url: string;
  method: string;
  headers: Record<string, string>;
  timeoutMs?: number;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeApiClient(responder: () => Response) {
  const calls: RequestRecord[] = [];
  return {
    calls,
    client: {
      async request(
        input: string | URL,
        init?: { method?: string; headers?: unknown; timeoutMs?: number },
      ) {
        const url = typeof input === "string" ? input : input.toString();
        const headers = new Headers((init?.headers as HeadersInit) ?? {});
        calls.push({
          url,
          method: init?.method ?? "GET",
          headers: Object.fromEntries(headers.entries()),
          ...(init?.timeoutMs === undefined ? {} : { timeoutMs: init.timeoutMs }),
        });
        return responder();
      },
    },
  };
}

const deepseekTarget = {
  providerId: "custom-deepseek",
  providerName: "My DeepSeek",
  baseUrl: "https://api.deepseek.com/anthropic",
  apiKey: "sk-test-key",
};

test("未装配 resolveTarget → unsupported 且不发请求", async () => {
  const { calls, client } = makeApiClient(() => jsonResponse({}));
  const provider = new ProviderBalanceProvider({ apiClient: client });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "unsupported");
  assert.equal(calls.length, 0);
});

test("resolveTarget 抛错 → unsupported（不透传内部错误）", async () => {
  const { client } = makeApiClient(() => jsonResponse({}));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => {
      throw new Error("config broken");
    },
  });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "unsupported");
});

test("未知 baseUrl → unsupported 且不发网络请求", async () => {
  const { calls, client } = makeApiClient(() => jsonResponse({}));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => ({ ...deepseekTarget, baseUrl: "https://my-proxy.example.com/v1" }),
  });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "unsupported");
  assert.equal(calls.length, 0);
});

test("缺少 API Key → not_configured 且不发网络请求", async () => {
  const { calls, client } = makeApiClient(() => jsonResponse({}));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => ({ ...deepseekTarget, apiKey: "  " }),
  });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "not_configured");
  assert.equal(calls.length, 0);
});

test("401/403 → unauthorized", async () => {
  for (const status of [401, 403]) {
    const { client } = makeApiClient(() => jsonResponse({ error: "bad key" }, status));
    const provider = new ProviderBalanceProvider({
      apiClient: client,
      resolveTarget: async () => deepseekTarget,
    });
    const snapshot = await provider.getSnapshot({ providerId: "p1" });
    assert.equal(snapshot.status, "unauthorized", `status ${status}`);
  }
});

test("500 → error(request_failed)", async () => {
  const { client } = makeApiClient(() => jsonResponse({ error: "boom" }, 500));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => deepseekTarget,
  });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.message, "request_failed");
});

test("200 但非 JSON → error(request_failed)", async () => {
  const { client } = makeApiClient(() => new Response("not json", { status: 200 }));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => deepseekTarget,
  });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.message, "request_failed");
});

test("DeepSeek 有效响应 → ok，请求 URL/鉴权头/超时正确", async () => {
  const { calls, client } = makeApiClient(() =>
    jsonResponse({
      is_available: true,
      balance_infos: [{ currency: "CNY", total_balance: "12.5" }],
    }),
  );
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => deepseekTarget,
  });
  const snapshot = await provider.getSnapshot({ providerId: "custom-deepseek" });
  assert.equal(snapshot.status, "ok");
  assert.equal(snapshot.providerName, "My DeepSeek");
  assert.deepEqual(snapshot.balances, [
    { label: "CNY", unit: "CNY", remaining: 12.5, isAvailable: true },
  ]);
  assert.equal(calls[0]?.url, "https://api.deepseek.com/user/balance");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.headers.authorization, "Bearer sk-test-key");
  assert.equal(calls[0]?.headers.accept, "application/json");
  assert.equal(calls[0]?.timeoutMs, 15000);
});

test("空 JSON 响应 → error(empty_response)", async () => {
  const { client } = makeApiClient(() => jsonResponse({}));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => deepseekTarget,
  });
  const snapshot = await provider.getSnapshot({ providerId: "p1" });
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.message, "empty_response");
});

test("providerId 为空 → unsupported", async () => {
  const { client } = makeApiClient(() => jsonResponse({}));
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => deepseekTarget,
  });
  const snapshot = await provider.getSnapshot({ providerId: "   " });
  assert.equal(snapshot.status, "unsupported");
});

test("providerName 为空时回退 providerId", async () => {
  const { client } = makeApiClient(() =>
    jsonResponse({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: 1 }] }),
  );
  const provider = new ProviderBalanceProvider({
    apiClient: client,
    resolveTarget: async () => ({ ...deepseekTarget, providerName: "  " }),
  });
  const snapshot = await provider.getSnapshot({ providerId: "custom-x" });
  assert.equal(snapshot.providerName, "custom-x");
});

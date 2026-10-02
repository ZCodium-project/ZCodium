import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ICredentialService } from "../src/credential/credential.js";
import {
  ORCAROUTER_CREDENTIAL_KEY,
  createOrcaCredentialStore,
} from "../src/orcarouter/credentialStore.js";
import {
  OrcaConnectController,
  OrcaConnectError,
  createOrcaPkceMaterial,
  safeStateEquals,
} from "../src/orcarouter/connect.js";
import {
  createOrcaCredentialAdapters,
  validateOrcaApiKeyInput,
} from "../src/orcarouter/credentials.js";
import { createOrcaCatalogService } from "../src/orcarouter/catalog.js";

/** 内存版凭据存储；只用于测试，绝不接触真实凭据文件。 */
function createMemoryCredentialService(initial: Record<string, string> = {}) {
  const records = new Map<string, string>(Object.entries(initial));
  const writes: string[] = [];
  const service: Pick<ICredentialService, "load" | "save" | "delete"> = {
    async load(key) {
      return records.get(key) ?? null;
    },
    async save(key, value) {
      records.set(key, value);
      writes.push(value);
    },
    async delete(key) {
      records.delete(key);
    },
  };
  return { service, records, writes };
}

const ORIGINS = Object.freeze({
  authBase: "https://www.orcarouter.ai",
  apiBase: "https://api.orcarouter.ai",
});

function createHarness(initial: Record<string, string> = {}) {
  const memory = createMemoryCredentialService(initial);
  const store = createOrcaCredentialStore({ credentialService: memory.service });
  return { ...memory, store };
}

test("凭据存储：保存、读取、脱敏状态与清除", async () => {
  const harness = createHarness();
  assert.deepEqual(await harness.store.status(), {
    connected: false,
    masked: "",
    source: null,
    generation: 0,
    needsReauth: false,
  });

  const saved = await harness.store.save({ apiKey: "sk-orca-testkey0001", source: "api-key" });
  assert.equal(saved.generation, 1);
  const status = await harness.store.status();
  assert.equal(status.connected, true);
  assert.equal(status.source, "api-key");
  assert.equal(status.masked, "sk-orc…0001");
  assert.ok(!status.masked.includes("testkey"));

  assert.equal((await harness.store.loadUsable())?.apiKey, "sk-orca-testkey0001");
  await harness.store.clear();
  assert.equal(await harness.store.loadUsable(), null);
  assert.equal(await harness.store.read(), null);
});

test("凭据存储：更新递增 generation，损坏记录按未连接处理且不抛异常", async () => {
  const harness = createHarness();
  await harness.store.save({ apiKey: "sk-orca-first00001", source: "api-key" });
  const second = await harness.store.save({ apiKey: "sk-orca-second0002", source: "api-key" });
  assert.equal(second.generation, 2);

  const corrupt = createHarness({ [ORCAROUTER_CREDENTIAL_KEY]: "{not json" });
  assert.equal(await corrupt.store.read(), null);
  assert.equal(await corrupt.store.loadUsable(), null);
  assert.equal((await corrupt.store.status()).connected, false);
});

test("凭据存储：401 只标记精确账号与 generation，旧失败不污染新登录", async () => {
  const harness = createHarness();
  const first = await harness.store.save({
    apiKey: "sk-orca-account0001",
    source: "pkce",
    accountId: "user-1",
  });

  // 错误账号：不命中
  assert.equal(await harness.store.markNeedsReauth({ accountId: "user-2" }), false);
  // 过期 generation：不命中（新登录已完成时旧请求迟到）
  assert.equal(
    await harness.store.markNeedsReauth({ generation: first.generation, accountId: "user-1" }),
    true,
  );
  assert.equal((await harness.store.status()).needsReauth, true);
  assert.equal(await harness.store.loadUsable(), null);

  // 新登录成功后 reauth 标记清除，且旧 generation 的失败不再命中。
  const second = await harness.store.save({
    apiKey: "sk-orca-account0002",
    source: "pkce",
    accountId: "user-1",
  });
  assert.equal(second.generation, 2);
  assert.equal((await harness.store.status()).needsReauth, false);
  assert.equal(
    await harness.store.markNeedsReauth({ generation: first.generation, accountId: "user-1" }),
    false,
  );
  assert.equal((await harness.store.status()).needsReauth, false);
});

test("手填校验：空值表示清除，格式明显错误直接拒绝", () => {
  assert.equal(validateOrcaApiKeyInput("  "), null);
  assert.equal(validateOrcaApiKeyInput(" sk-orca-abcdef123456 "), "sk-orca-abcdef123456");
  assert.throws(() => validateOrcaApiKeyInput("sk-other-abcdef123456"), /sk-orca-/);
});

test("两个 adapter 产出同一种凭据结果，下游不关心来源", async () => {
  const harness = createHarness();
  const adapters = createOrcaCredentialAdapters({ store: harness.store });

  await assert.rejects(() => adapters.apiKey.acquire(), /尚未配置/);
  await assert.rejects(() => adapters.pkce.acquire(), /尚未完成/);

  await harness.store.save({ apiKey: "sk-orca-fromkey00001", source: "api-key" });
  assert.equal(await adapters.apiKey.acquire(), "sk-orca-fromkey00001");
  // API Key adapter 不接受 pkce 来源的凭据被当作手填。
  await assert.rejects(() => adapters.pkce.acquire(), /尚未完成/);

  await harness.store.save({ apiKey: "sk-orca-frompkce0001", source: "pkce", accountId: "u" });
  assert.equal(await adapters.pkce.acquire(), "sk-orca-frompkce0001");
  // 两个 adapter 指向同一条凭据 seam，产出同一种字符串形状；下游不区分来源。
  assert.equal(await adapters.apiKey.acquire(), "sk-orca-frompkce0001");
  assert.notEqual(adapters.apiKey.source, adapters.pkce.source);
  assert.equal(typeof (await adapters.apiKey.acquire()), typeof (await adapters.pkce.acquire()));
  assert.ok((await adapters.apiKey.acquire()).startsWith("sk-orca-"));
});

test("PKCE 材料：每次尝试新建 verifier/state，challenge 为无 padding base64url(sha256)", () => {
  const first = createOrcaPkceMaterial();
  const second = createOrcaPkceMaterial();
  assert.notEqual(first.verifier, second.verifier);
  assert.notEqual(first.state, second.state);
  assert.ok(!first.challenge.includes("="));
  assert.ok(!first.challenge.includes("+"));
  assert.ok(!first.challenge.includes("/"));
  assert.equal(first.verifier.length, 43);
  // challenge 必须等于 sha256(verifier) 的 base64url。
  const expected = createHashLike(first.verifier);
  assert.equal(first.challenge, expected);
});

function createHashLike(verifier: string): string {
  // 独立实现，避免直接用被测代码验证被测代码。
  return createHash("sha256").update(verifier).digest("base64url");
}

test("state 比较：恒定时间，长度不同即不等", () => {
  assert.equal(safeStateEquals("abc", "abc"), true);
  assert.equal(safeStateEquals("abc", "abd"), false);
  assert.equal(safeStateEquals("abc", "abcd"), false);
  assert.equal(safeStateEquals("", ""), true);
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createConnect(harness: ReturnType<typeof createHarness>, fetchImpl: typeof fetch) {
  const logs: string[] = [];
  const controller = new OrcaConnectController({
    credentialStore: harness.store,
    origins: ORIGINS,
    appName: "ZCodium",
    fetchImpl,
    log: (_level, message) => logs.push(message),
  });
  return { controller, logs };
}

test("PKCE 完整流程：authorize → 提交 code → exchange → 持久化", async () => {
  const harness = createHarness();
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return jsonResponse({ key: "sk-orca-pkce000001", user_id: "user-7", scope: "api" });
  }) as unknown as typeof fetch;

  const { controller, logs } = createConnect(harness, fetchImpl);
  const state = controller.begin();
  assert.equal(state.phase, "waiting");
  assert.equal(state.busy, true);
  const authorizeUrl = new URL(String(state.authorizeUrl));
  assert.equal(authorizeUrl.origin, "https://www.orcarouter.ai");
  assert.equal(authorizeUrl.pathname, "/auth");
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "S256");

  const credential = await controller.submitCode("CODE-123");
  assert.equal(credential.apiKey, "sk-orca-pkce000001");
  assert.equal(credential.source, "pkce");
  assert.equal(credential.grantedScope, "api");
  assert.equal(credential.accountId, "user-7");
  assert.equal(controller.getState().phase, "connected");
  assert.equal(controller.getState().busy, false);
  assert.equal(controller.getState().hint, null);

  // 交换只去 auth origin 的固定路径，且带上原始 verifier。
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://www.orcarouter.ai/api/v1/auth/keys");
  assert.equal(new URL(calls[0]!.url).pathname, "/api/v1/auth/keys");
  // 反例：交换绝不能落到推理 origin 的 /v1/auth/keys。
  assert.ok(!calls[0]!.url.startsWith("https://api.orcarouter.ai"));
  const body = calls[0]!.body as Record<string, string>;
  assert.equal(body.code_challenge_method, "S256");
  assert.ok(body.code_verifier);
  assert.equal(body.code, "CODE-123");

  // verifier 与密钥不得出现在日志里。
  const logText = logs.join("\n");
  assert.ok(!logText.includes(body.code_verifier));
  assert.ok(!logText.includes("sk-orca-pkce000001"));
  assert.ok(!harness.writes.some((value) => value.includes("CODE-123")));
});

test("PKCE：交换走 auth origin，推理与目录走 api origin", async () => {
  const harness = createHarness();
  const urls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    return jsonResponse({ key: "sk-orca-origin0001", user_id: "u", scope: "api" });
  }) as unknown as typeof fetch;
  const { controller } = createConnect(harness, fetchImpl);
  controller.begin();
  await controller.submitCode("CODE");

  const catalogUrls: string[] = [];
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    fetchImpl: (async (input: string | URL | Request) => {
      catalogUrls.push(String(input));
      return jsonResponse({
        data: [{ id: "openai/gpt-5.5", supported_endpoint_types: ["openai"] }],
      });
    }) as unknown as typeof fetch,
  });
  await catalog.list({ capability: "chat" });

  assert.deepEqual(urls, ["https://www.orcarouter.ai/api/v1/auth/keys"]);
  assert.deepEqual(catalogUrls, ["https://api.orcarouter.ai/v1/models"]);
});

test("PKCE：拒绝、过期/复用 code、403、429 与网络错误都安全结束", async () => {
  const cases: Array<[number, string]> = [
    [403, "exchange-rejected"],
    [400, "exchange-rejected"],
    [429, "rate-limited"],
    [500, "network"],
  ];
  for (const [status, kind] of cases) {
    const harness = createHarness();
    const { controller } = createConnect(
      harness,
      (async () => new Response("upstream error detail", { status })) as unknown as typeof fetch,
    );
    controller.begin();
    await assert.rejects(
      () => controller.submitCode("CODE"),
      (error: unknown) => {
        assert.ok(error instanceof OrcaConnectError);
        assert.equal(error.kind, kind);
        // 不泄露上游响应正文。
        assert.ok(!error.message.includes("upstream error detail"));
        assert.ok(!error.message.includes("sk-orca-"));
        return true;
      },
    );
    assert.equal(controller.getState().busy, false);
    assert.equal(controller.getState().hint, null);
    assert.equal(harness.records.has(ORCAROUTER_CREDENTIAL_KEY), false);
  }

  const harness = createHarness();
  const { controller } = createConnect(harness, (async () => {
    throw new Error("ECONNREFUSED 10.0.0.1");
  }) as unknown as typeof fetch);
  controller.begin();
  await assert.rejects(
    () => controller.submitCode("CODE"),
    (error: unknown) => {
      assert.ok(error instanceof OrcaConnectError);
      assert.equal(error.kind, "network");
      assert.ok(!error.message.includes("10.0.0.1"));
      return true;
    },
  );
});

test("PKCE：超时以 abort 分类，且不挂起", async () => {
  const harness = createHarness();
  const controller = new OrcaConnectController({
    credentialStore: harness.store,
    origins: ORIGINS,
    appName: "ZCodium",
    timeoutMs: 5,
    fetchImpl: ((_input: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      })) as unknown as typeof fetch,
  });
  controller.begin();
  await assert.rejects(
    () => controller.submitCode("CODE"),
    (error: unknown) => {
      assert.ok(error instanceof OrcaConnectError);
      assert.equal(error.kind, "timeout");
      return true;
    },
  );
  assert.equal(controller.getState().busy, false);
});

test("PKCE：scope 降级按失败处理，不写凭据", async () => {
  const harness = createHarness();
  const { controller } = createConnect(harness, (async () =>
    jsonResponse({
      key: "sk-orca-downgraded1",
      user_id: "u",
      scope: "connector",
    })) as unknown as typeof fetch);
  controller.begin();
  await assert.rejects(
    () => controller.submitCode("CODE"),
    (error: unknown) => {
      assert.ok(error instanceof OrcaConnectError);
      assert.equal(error.kind, "scope-downgraded");
      return true;
    },
  );
  assert.equal(harness.records.has(ORCAROUTER_CREDENTIAL_KEY), false);
  assert.equal(controller.getState().phase, "error");
});

test("PKCE：state 只与当前尝试匹配，Flow A 回调路径可恒定时间比较", () => {
  const harness = createHarness();
  const { controller } = createConnect(harness, (async () =>
    jsonResponse({})) as unknown as typeof fetch);
  controller.begin();
  const url = new URL(String(controller.getState().authorizeUrl));
  const state = url.searchParams.get("state");
  assert.ok(state);
  assert.equal(controller.matchesState(state), true);
  assert.equal(controller.matchesState("not-the-state"), false);
  controller.cancel();
  assert.equal(controller.matchesState(state), false);
});

test("PKCE：取消后可以立即开始第二次登录（不 remount）", () => {
  const harness = createHarness();
  const { controller } = createConnect(harness, (async () =>
    jsonResponse({})) as unknown as typeof fetch);
  const first = controller.begin();
  const firstUrl = first.authorizeUrl;
  controller.cancel();
  assert.equal(controller.getState().busy, false);
  assert.equal(controller.getState().hint, null);

  const second = controller.begin();
  assert.notEqual(second.authorizeUrl, firstUrl);
  assert.equal(second.phase, "waiting");
  assert.equal(second.busy, true);
});

test("PKCE：pagehide 同步清 busy/hint，且无需 remount 即可再次登录", () => {
  const harness = createHarness();
  const { controller } = createConnect(harness, (async () =>
    jsonResponse({})) as unknown as typeof fetch);
  const generationBefore = controller.currentGeneration();
  const first = controller.begin();
  assert.equal(first.busy, true);
  assert.ok(first.hint);

  const invalidated = controller.invalidateForPageHide();
  // 同步清理：busy 与 hint 必须立刻归零，不能等被 generation guard 拦下的 finally。
  assert.equal(invalidated.busy, false);
  assert.equal(invalidated.hint, null);
  assert.equal(invalidated.phase, "idle");
  assert.ok(controller.currentGeneration() > generationBefore);

  const second = controller.begin();
  assert.equal(second.busy, true);
  assert.notEqual(second.authorizeUrl, first.authorizeUrl);
});

test("PKCE：旧 generation 的迟到响应不覆盖新登录", async () => {
  const harness = createHarness();
  const gate: { release?: () => void } = {};
  const { controller } = createConnect(harness, (async () => {
    await new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    return jsonResponse({ key: "sk-orca-stale00001", user_id: "old", scope: "api" });
  }) as unknown as typeof fetch);

  controller.begin();
  const stale = controller.submitCode("OLD-CODE");
  // 新登录在旧请求返回前开始。
  controller.begin();
  gate.release?.();
  await assert.rejects(
    () => stale,
    (error: unknown) => {
      assert.ok(error instanceof OrcaConnectError);
      assert.equal(error.kind, "cancelled");
      return true;
    },
  );
  assert.equal(harness.records.has(ORCAROUTER_CREDENTIAL_KEY), false);
});

test("目录：live 成功即权威结果，seed 不混入", async () => {
  const harness = createHarness();
  await harness.store.save({ apiKey: "sk-orca-catalog0001", source: "api-key" });
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    fetchImpl: (async () =>
      jsonResponse({
        data: [
          {
            id: "openai/gpt-5.5",
            supported_endpoint_types: ["openai"],
            architecture: { input_modalities: ["text", "image"] },
          },
          {
            id: "deepseek/deepseek-v4-pro",
            supported_endpoint_types: ["openai"],
            architecture: { input_modalities: ["text"] },
          },
          { id: "acme/image-only", supported_endpoint_types: ["image-generation"] },
        ],
      })) as unknown as typeof fetch,
  });
  const result = await catalog.list({ capability: "chat" });
  assert.equal(result.source, "live");
  assert.equal(result.degraded, false);
  assert.deepEqual(
    result.models.map((m) => m.id),
    ["openai/gpt-5.5", "deepseek/deepseek-v4-pro"],
  );
  // seed 里的模型不在目录中，因此绝不能出现。
  assert.ok(!result.models.some((m) => m.id === "anthropic/claude-opus-4.8"));
});

test("目录：失败时回退到明确标注的已验证 seed，且不返回自由输入", async () => {
  const harness = createHarness();
  await harness.store.save({ apiKey: "sk-orca-catalog0002", source: "api-key" });
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    fetchImpl: (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch,
  });
  const result = await catalog.list({ capability: "chat" });
  assert.equal(result.source, "verified-seed");
  assert.equal(result.degraded, true);
  assert.deepEqual(
    result.models.map((m) => m.id),
    [
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.8",
      "google/gemini-3.5-flash",
      "deepseek/deepseek-v4-pro",
      "orcarouter/auto",
    ],
  );
  // 多模态入口在 seed 上也必须 fail closed。
  const multimodal = await catalog.list({ capability: "chat", requiredInputModality: "image" });
  assert.deepEqual(
    multimodal.models.map((m) => m.id),
    ["openai/gpt-5.5", "anthropic/claude-opus-4.8", "google/gemini-3.5-flash"],
  );
});

test("目录：last-known-good 优先于 seed，且仍标记 degraded", async () => {
  const harness = createHarness();
  await harness.store.save({ apiKey: "sk-orca-catalog0003", source: "api-key" });
  let failing = false;
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    ttlMs: 0,
    fetchImpl: (async () => {
      if (failing) throw new Error("offline");
      return jsonResponse({
        data: [{ id: "vendor/live-model", supported_endpoint_types: ["openai"] }],
      });
    }) as unknown as typeof fetch,
  });
  const live = await catalog.list({ capability: "chat" });
  assert.equal(live.source, "live");
  failing = true;
  const degraded = await catalog.list({ capability: "chat" });
  assert.equal(degraded.source, "last-known-good");
  assert.equal(degraded.degraded, true);
  assert.deepEqual(
    degraded.models.map((m) => m.id),
    ["vendor/live-model"],
  );
});

test("目录：未连接时不发请求，直接降级", async () => {
  const harness = createHarness();
  let called = false;
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    fetchImpl: (async () => {
      called = true;
      return jsonResponse({ data: [] });
    }) as unknown as typeof fetch,
  });
  const result = await catalog.list({ capability: "chat" });
  assert.equal(called, false);
  assert.equal(result.source, "verified-seed");
});

test("目录：401 后 loadUsable 为空，凭据不会继续被使用", async () => {
  const harness = createHarness();
  const saved = await harness.store.save({
    apiKey: "sk-orca-revoked0001",
    source: "pkce",
    accountId: "user-9",
  });
  await harness.store.markNeedsReauth({ generation: saved.generation, accountId: "user-9" });
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    fetchImpl: (async () => {
      throw new Error("should not be called");
    }) as unknown as typeof fetch,
  });
  const result = await catalog.list({ capability: "chat" });
  assert.equal(result.source, "verified-seed");
  assert.equal(await harness.store.loadUsable(), null);
  // 旧密钥没有被静默删除：新登录前仍保留在存储中。
  assert.ok(harness.records.has(ORCAROUTER_CREDENTIAL_KEY));
});

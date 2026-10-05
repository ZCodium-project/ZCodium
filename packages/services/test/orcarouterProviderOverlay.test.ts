import assert from "node:assert/strict";
import test from "node:test";
import { ORCAROUTER_PROVIDER_TEMPLATE_ID } from "@zcode/shared";
import type { ICredentialService } from "../src/credential/credential.js";
import { createOrcaCatalogService } from "../src/orcarouter/catalog.js";
import { OrcaConnectController } from "../src/orcarouter/connect.js";
import { createOrcaCredentialAdapters } from "../src/orcarouter/credentials.js";
import {
  ORCAROUTER_CREDENTIAL_KEY,
  createOrcaCredentialStore,
} from "../src/orcarouter/credentialStore.js";
import { createOrcaProviderCredentialBinding } from "../src/orcarouter/providerOverlay.js";
import { createOrcaRouterService } from "../src/orcarouter/service.js";

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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ============================================================
// P0：凭据必须真正到达 provider 推理路径
// ============================================================

/**
 * 伪 Provider Settings：只实现读取视图与 Personal Overlay 写入两个成员。
 *
 * 断言的是「写回写进 access.apiKey」，也就是 model-execution / balance resolver 真正读取的字段，
 * 而不是凭据文件本身。
 */
function createSettingsDouble(input: {
  readonly providerId: string;
  readonly templateId?: string;
  readonly personalConfig?: Record<string, unknown>;
  readonly providers?: readonly Record<string, unknown>[];
  readonly failWrites?: boolean;
}) {
  const templateId = input.templateId ?? ORCAROUTER_PROVIDER_TEMPLATE_ID;
  const writes: Array<{ providerId: string; config: Record<string, unknown> }> = [];
  let view = {
    revision: 1,
    providerTemplates: [],
    providerOrder: [input.providerId],
    providers: [
      {
        providerId: input.providerId,
        templateId,
        personalConfig: input.personalConfig ?? {
          access: { type: "api-key" },
          api: { type: "openai-chat-completions", baseUrl: "https://api.orcarouter.ai/v1" },
        },
        effectiveConfig: { access: { type: "api-key" } },
        enabled: true,
        executable: true,
        issues: [],
        models: [],
      },
      ...(input.providers ?? []),
    ],
  };
  return {
    writes,
    view: () => view,
    settings: {
      async getView() {
        return view as never;
      },
      async savePersonalProviderOverlay(providerId: string, config: Record<string, unknown>) {
        if (input.failWrites) throw new Error("write rejected");
        writes.push({ providerId, config });
        view = {
          ...view,
          revision: view.revision + 1,
          providers: view.providers.map((provider) =>
            provider.providerId === providerId
              ? { ...provider, personalConfig: structuredClone(config) }
              : provider,
          ),
        };
        return view as never;
      },
    },
  };
}

/** 与 model-execution / providerBalanceTargetResolver 相同的读取口径。 */
function readInferenceApiKey(overlay: { config: Record<string, unknown> }): string | null {
  const access = overlay.config.access as { type?: string; apiKey?: unknown } | undefined;
  if (!access || access.type !== "api-key") return null;
  return typeof access.apiKey === "string" && access.apiKey.trim() ? access.apiKey.trim() : null;
}

/**
 * 把回写的 Personal Overlay 叠加到真实 OrcaRouter 模板上，再经
 * `serializeRegistryProviderConfig` 投影。
 *
 * 这一步用的都是仓库真实的 `@zcode/provider` 实现（不是测试自造的读取函数），
 * 因此它证明的是「凭据真的到达了推理侧读取的那个字段」，而不只是写过某个对象。
 */
async function resolveRegistryAccessApiKey(
  overlay: Record<string, unknown>,
): Promise<string | null> {
  const { ProviderConfig, ApiKeyAccessConfig, ProviderApiConfig, serializeRegistryProviderConfig } =
    await import("@zcode/provider");
  const template = new ProviderConfig({
    group: "standard-personal",
    access: new ApiKeyAccessConfig({ type: "api-key" }),
    api: new ProviderApiConfig({
      type: "openai-chat-completions",
      baseUrl: "https://api.orcarouter.ai/v1",
    }),
    builtinModelIds: ["orcarouter/auto"],
  });
  const access = overlay.access as { type?: string; apiKey?: string | null } | undefined;
  const personal = new ProviderConfig({
    access: new ApiKeyAccessConfig({ type: "api-key", apiKey: access?.apiKey ?? undefined }),
  });
  const serialized = serializeRegistryProviderConfig(template.overlay(personal) as never) as {
    access: { type: string; apiKey?: string };
  };
  return serialized.access.type === "api-key" ? (serialized.access.apiKey ?? null) : null;
}

function createOrcaServiceHarness(
  input: {
    readonly settingsProviderId?: string;
    readonly templateId?: string;
    readonly personalConfig?: Record<string, unknown>;
    readonly failWrites?: boolean;
  } = {},
) {
  const harness = createHarness();
  const double = createSettingsDouble({
    providerId: input.settingsProviderId ?? "orcarouter-p1",
    templateId: input.templateId ?? ORCAROUTER_PROVIDER_TEMPLATE_ID,
    ...(input.personalConfig ? { personalConfig: input.personalConfig } : {}),
    ...(input.failWrites ? { failWrites: true } : {}),
  });
  const binding = createOrcaProviderCredentialBinding({
    store: harness.store,
    settings: double.settings as never,
  });
  const service = createOrcaRouterService({
    store: harness.store,
    adapters: createOrcaCredentialAdapters({ store: harness.store }),
    connect: new OrcaConnectController({
      credentialStore: harness.store,
      origins: ORIGINS,
      appName: "ZCodium",
    }),
    origins: ORIGINS,
    credentialBinding: binding,
  });
  return { ...harness, double, service };
}

test("P0：saveApiKey 把手填 key 写回 provider 推理配置（access.apiKey）", async () => {
  const harness = createOrcaServiceHarness();
  assert.equal(harness.double.writes.length, 0);

  await harness.service.saveApiKey({ apiKey: "sk-orca-apikey00001" });

  assert.equal(harness.double.writes.length, 1);
  const write = harness.double.writes[0]!;
  assert.equal(write.providerId, "orcarouter-p1");
  assert.equal(readInferenceApiKey(write), "sk-orca-apikey00001");
  // 其余 Personal 叶子不能被打散：baseUrl 必须保持原值。
  assert.equal(
    (write.config.api as { baseUrl?: string } | undefined)?.baseUrl,
    "https://api.orcarouter.ai/v1",
  );
});

test("P0：API Key 保存为空 / clearCredential 会清掉 provider 上的推理 key", async () => {
  const harness = createOrcaServiceHarness();
  await harness.service.saveApiKey({ apiKey: "sk-orca-apikey00002" });
  assert.equal(readInferenceApiKey(harness.double.writes.at(-1)!), "sk-orca-apikey00002");

  await harness.service.saveApiKey({ apiKey: "   " });
  assert.equal(readInferenceApiKey(harness.double.writes.at(-1)!), null);

  await harness.service.saveApiKey({ apiKey: "sk-orca-apikey00003" });
  await harness.service.clearCredential();
  assert.equal(readInferenceApiKey(harness.double.writes.at(-1)!), null);
});

test("P0：PKCE 换取成功后同一把 key 也写回 provider 推理配置", async () => {
  const harness = createHarness();
  const double = createSettingsDouble({ providerId: "orcarouter-p2" });
  const service = createOrcaRouterService({
    store: harness.store,
    adapters: createOrcaCredentialAdapters({ store: harness.store }),
    connect: new OrcaConnectController({
      credentialStore: harness.store,
      origins: ORIGINS,
      appName: "ZCodium",
      fetchImpl: (async () =>
        jsonResponse({
          key: "sk-orca-pkce000001",
          user_id: "42",
          scope: "api",
        })) as unknown as typeof fetch,
    }),
    origins: ORIGINS,
    credentialBinding: createOrcaProviderCredentialBinding({
      store: harness.store,
      settings: double.settings as never,
    }),
  });

  await service.beginConnect();
  const result = await service.submitConnectCode({ code: "real-code" });
  assert.equal(result.ok, true);
  assert.equal(double.writes.length, 1);
  assert.equal(readInferenceApiKey(double.writes[0]!), "sk-orca-pkce000001");
});

test("P0：两种 adapter 到达推理路径的是同一把 key，下游不关心来源", async () => {
  const harness = createOrcaServiceHarness();
  await harness.service.saveApiKey({ apiKey: "sk-orca-samesame0001" });
  const viaApiKey = readInferenceApiKey(harness.double.writes.at(-1)!);

  await harness.store.save({ apiKey: "sk-orca-samesame0001", source: "pkce" });
  await harness.service.reconcileProviderCredential();
  const viaPkce = readInferenceApiKey(harness.double.writes.at(-1)!);

  assert.equal(viaApiKey, viaPkce);
  // 推理路径只看 access.apiKey，凭据来源不进入该字段。
  const access = harness.double.writes.at(-1)!.config.access as Record<string, unknown>;
  assert.deepEqual(Object.keys(access).sort(), ["apiKey", "type"]);
});

test("P0：401 标记 needsReauth 后立即清除 provider 上的死 key，但不删除存储中的旧密钥", async () => {
  const harness = createOrcaServiceHarness();
  await harness.service.saveApiKey({ apiKey: "sk-orca-revoked00001" });
  const status = await harness.service.getCredentialStatus();

  const result = await harness.service.reportUnauthorized({ generation: status.generation });
  assert.equal(result.marked, true);
  // 推理路径不能继续使用已撤销的 key。
  assert.equal(readInferenceApiKey(harness.double.writes.at(-1)!), null);
  // 但存储里的旧记录不会被静默删除：新登录前仍可回退/展示。
  assert.ok(harness.records.has(ORCAROUTER_CREDENTIAL_KEY));
});

test("P0：旧 generation 的 401 不污染新登录，也不会清掉新 key", async () => {
  const harness = createOrcaServiceHarness();
  await harness.service.saveApiKey({ apiKey: "sk-orca-oldkey000001" });
  const oldGeneration = (await harness.service.getCredentialStatus()).generation;

  // 新登录完成：generation 递增，provider 写入新 key。
  await harness.service.saveApiKey({ apiKey: "sk-orca-newkey000002" });
  const writesBefore = harness.double.writes.length;

  const result = await harness.service.reportUnauthorized({ generation: oldGeneration });
  assert.equal(result.marked, false);
  // 迟到的旧 401 不得触发任何回写。
  assert.equal(harness.double.writes.length, writesBefore);
  assert.equal(
    await harness.service.resolveCredential({ source: "api-key" }).then((c) => c?.masked),
    "sk-orc…0002",
  );
});

test("P0：reconcile 启动对齐在重启后恢复推理 key（幂等，无多余写入）", async () => {
  const harness = createOrcaServiceHarness();
  await harness.store.save({ apiKey: "sk-orca-restart0001", source: "pkce" });

  const status = await harness.service.reconcileProviderCredential();
  assert.equal(status.connected, true);
  assert.equal(readInferenceApiKey(harness.double.writes.at(-1)!), "sk-orca-restart0001");

  const writes = harness.double.writes.length;
  await harness.service.reconcileProviderCredential();
  assert.equal(harness.double.writes.length, writes, "已对齐时不应重复写盘");
});

test("P0：未连接时 reconcile 不写入空 overlay", async () => {
  const harness = createOrcaServiceHarness();
  await harness.service.reconcileProviderCredential();
  assert.equal(harness.double.writes.length, 0);
});

test("P0：回写结果经真实 provider 解析后就是推理侧读取的 access.apiKey", async () => {
  const harness = createOrcaServiceHarness();

  // 两种入口分别写入，随后都用仓库真实的 @zcode/provider 叠加+序列化一次。
  await harness.service.saveApiKey({ apiKey: "sk-orca-registry0001" });
  assert.equal(
    await resolveRegistryAccessApiKey(harness.double.writes.at(-1)!.config),
    "sk-orca-registry0001",
  );

  await harness.store.save({ apiKey: "sk-orca-registry0002", source: "pkce" });
  await harness.service.reconcileProviderCredential();
  assert.equal(
    await resolveRegistryAccessApiKey(harness.double.writes.at(-1)!.config),
    "sk-orca-registry0002",
  );

  // 清除后推理侧必须读到空 key，而不是继续持有上一把。
  await harness.service.clearCredential();
  assert.equal(await resolveRegistryAccessApiKey(harness.double.writes.at(-1)!.config), null);
});

test("P0：目标 provider 不存在时静默跳过，不抛错、不误写别的 provider", async () => {
  const harness = createHarness();
  const double = createSettingsDouble({
    providerId: "other-p1",
    templateId: "some-other-template",
  });
  const service = createOrcaRouterService({
    store: harness.store,
    adapters: createOrcaCredentialAdapters({ store: harness.store }),
    connect: new OrcaConnectController({
      credentialStore: harness.store,
      origins: ORIGINS,
      appName: "ZCodium",
    }),
    origins: ORIGINS,
    credentialBinding: createOrcaProviderCredentialBinding({
      store: harness.store,
      settings: double.settings as never,
    }),
  });
  await service.saveApiKey({ apiKey: "sk-orca-notarget0001" });
  assert.equal(double.writes.length, 0);
});

test("P0：overlay 写入失败不影响凭据保存结果，且错误经 onError 上报", async () => {
  const harness = createHarness();
  const double = createSettingsDouble({ providerId: "orcarouter-p3", failWrites: true });
  const errors: unknown[] = [];
  const service = createOrcaRouterService({
    store: harness.store,
    adapters: createOrcaCredentialAdapters({ store: harness.store }),
    connect: new OrcaConnectController({
      credentialStore: harness.store,
      origins: ORIGINS,
      appName: "ZCodium",
    }),
    origins: ORIGINS,
    credentialBinding: createOrcaProviderCredentialBinding({
      store: harness.store,
      settings: double.settings as never,
      onError: (error) => errors.push(error),
    }),
  });
  const status = await service.saveApiKey({ apiKey: "sk-orca-durable00001" });
  assert.equal(status.connected, true);
  assert.equal(errors.length, 1);
});

// ============================================================
// 目录缓存世代：invalidate 必须让在途请求失效
// ============================================================

test("目录：invalidate() 使在途请求的结果不写回缓存", async () => {
  const harness = createHarness();
  await harness.store.save({ apiKey: "sk-orca-epoch000001", source: "api-key" });

  let release: ((response: Response) => void) | undefined;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    ttlMs: 0,
    fetchImpl: (async () => gate) as unknown as typeof fetch,
  });

  const inFlight = catalog.list({ capability: "chat" });
  // 保存/清除 key 会调用 invalidate()：旧账号的目录不得再被服务。
  catalog.invalidate();
  release!(
    jsonResponse({ data: [{ id: "old/account-model", supported_endpoint_types: ["openai"] }] }),
  );

  const result = await inFlight;
  assert.notEqual(result.source, "live");
  assert.ok(!result.models.some((m) => m.id === "old/account-model"));
});

test("目录：响应上限按 UTF-8 字节计，非 ASCII 不放大有效上限", async () => {
  const harness = createHarness();
  await harness.store.save({ apiKey: "sk-orca-bytes000001", source: "api-key" });
  // 2000 个三字节字符：按 UTF-16 长度算只有 2000，按字节算是 6000。
  const oversized = "測".repeat(2000);
  const catalog = createOrcaCatalogService({
    credentialStore: harness.store,
    origins: ORIGINS,
    maxResponseBytes: 4096,
    fetchImpl: (async () =>
      new Response(`{"data":[{"id":"${oversized}","supported_endpoint_types":["openai"]}]}`, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch,
  });
  const result = await catalog.list({ capability: "chat" });
  // 超过字节上限 → 降级，而不是把超大目录当成 live 权威结果。
  assert.notEqual(result.source, "live");
  assert.ok(result.error?.includes("上限"));
});

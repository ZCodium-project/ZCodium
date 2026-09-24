import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { transpileModule, ModuleKind } from "typescript";
const root = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
async function load(path, imports = {}) {
  const exports = {};
  new Function(
    "require",
    "exports",
    transpileModule(await read(path), {
      compilerOptions: { module: ModuleKind.CommonJS },
    }).outputText,
  )((name) => {
    assert.ok(name in imports, `unexpected import ${name}`);
    return imports[name];
  }, exports);
  return exports;
}
async function sources(dir) {
  const entries = await readdir(new URL(dir, root), { withFileTypes: true });
  return (
    await Promise.all(
      entries
        .filter((e) => !/^(tests?|dist|node_modules)$/.test(e.name))
        .map((e) =>
          e.isDirectory()
            ? sources(`${dir}/${e.name}`)
            : /\.(ts|tsx|js)$/.test(e.name) && !/\.test\./.test(e.name)
              ? [`${dir}/${e.name}`]
              : [],
        ),
    )
  ).flat();
}
test("runtime official URL literals are restricted to identity and user-opened links", async () => {
  const allowed = new Set([
    "packages/shared/src/zcodeEndpoint.ts",
    "packages/ui/src/lib/productDocs.ts",
    "packages/web/src/share/ConversationShareLandingPage.tsx",
    // 官方插件市场来源：只在 officialServices.marketplace 开关开启（Desktop env 投影或 CLI env）时
    // 才进入默认市场集合，网络出口仍受 assertOfficialPlatformAccessible 与开关裁决。
    "packages/shared/src/plugin-marketplaces.ts",
  ]);
  for (const dir of [
    "packages/services/src",
    "packages/desktop/src",
    "packages/ui/src",
    "packages/web/src",
    "packages/shared/src",
    "apps/zcode-cli/packages",
  ]) {
    for (const file of await sources(dir)) {
      if (!allowed.has(file))
        assert.doesNotMatch(
          await read(file),
          /https?:\/\/(?:[\w.-]+\.)?(?:zcode\.z\.ai|cdn-zcode\.z\.ai)(?:[/:]|\b)/,
          file,
        );
    }
  }
});
test("audit policy is unconditional and distinguishes platform from model providers", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  assert.equal(policy.isOfficialPlatformEnabled(), false);
  assert.throws(() => policy.assertOfficialPlatformAvailable(), /ZCodium/);
  for (const host of ["zcode.z.ai", "cdn-zcode.z.ai", "test.zcode.z.ai", "ZCODE.Z.AI."]) {
    assert.throws(() => policy.assertNoOfficialPlatformUrl(`https://${host}/api/v1`));
  }
  for (const url of [
    "https://api.z.ai/api/anthropic",
    "https://open.bigmodel.cn/api/paas/v4",
    "http://localhost:8000/v1",
    "https://example.com/v1",
  ])
    policy.assertNoOfficialPlatformUrl(url);
});
test("user model requests keep URL, credentials and body without the official gateway", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const gateway = await load(
    "apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts",
    { "@zcode/shared": policy },
  );
  let calls = 0;
  const input = new Request("https://open.bigmodel.cn/api/anthropic/v1/messages", {
    method: "POST",
    headers: { authorization: "Bearer test" },
    body: "{}",
  });
  const fetch = gateway.createOfficialCodingPlanGatewayFetch({
    fetch: async (actual, init) => {
      calls++;
      assert.equal(actual, input);
      assert.equal(init, undefined);
      return new Response("ok");
    },
  });
  assert.equal((await fetch(input)).status, 200);
  assert.equal(calls, 1);
  await assert.rejects(fetch("https://zcode.z.ai/api/v1/zcode-plan"), /ZCodium/);
  assert.equal(calls, 1);
});
test("client config is local and cannot invoke injected network or endpoint resolver", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const { createClientConfigService } = await load(
    "packages/services/src/client-config/clientConfigService.ts",
    { "@zcode/shared": policy },
  );
  const unexpected = () => {
    throw new Error("network/resolver must not run");
  };
  assert.deepEqual(
    await createClientConfigService({
      apiClient: { request: unexpected },
      resolveRequestContext: unexpected,
    }).getSnapshot({ forceRefresh: true }),
    { pluginStoreOrder: null },
  );
});

test("CLI OAuth cannot call even an injected HTTP client", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const oauth = await load("apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts", {
    "@zcode/shared": policy,
    "node:crypto": await import("node:crypto"),
  });
  const client = oauth.createCliOAuthClient({
    providerId: "zai",
    baseUrl: "https://example.com",
    httpClient: { request: () => assert.fail("must not request") },
  });
  await assert.rejects(client.init({ pollToken: "test" }), /ZCodium/);
  await assert.rejects(client.poll({ pollToken: "test", flowId: "test" }), /ZCodium/);
});

test("Electron policy cancels cached resources and redirects in every created session", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const handlers = [];
  const target = { webRequest: { onBeforeRequest: (handler) => handlers.push(handler) } };
  let onSession;
  const { installOfficialPlatformNetworkPolicy } = await load(
    "packages/desktop/src/main/desktopOfficialPlatformPolicy.ts",
    {
      "@zcode/shared": policy,
      electron: {
        app: {
          on: (name, handler) => {
            assert.equal(name, "session-created");
            onSession = handler;
          },
          whenReady: () => Promise.resolve(),
        },
        session: { defaultSession: target },
      },
    },
  );
  installOfficialPlatformNetworkPolicy();
  await Promise.resolve();
  onSession(target);
  assert.equal(handlers.length, 2);
  for (const handler of handlers) {
    handler({ url: "https://cdn-zcode.z.ai/cached/icon.png" }, (decision) =>
      assert.equal(decision.cancel, true),
    );
    handler({ url: "http://localhost:5173/" }, (decision) => assert.equal(decision.cancel, false));
  }
});

test("Web and desktop reject cached official icons while keeping third party images", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const { isTrustedImageUrl } = await load("packages/ui/src/lib/trustedImageUrl.ts", {
    "@zcode/shared": policy,
  });
  assert.equal(isTrustedImageUrl("https://cdn-zcode.z.ai/icon.png"), false);
  assert.equal(isTrustedImageUrl("https://example.com/icon.png"), true);
});

test("all platform service boundaries guard before touching credentials, state or network", async () => {
  const ts = await import("typescript");
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const cases = [
    [
      "packages/services/src/oauth/oauthService.ts",
      ["startOAuth", "startOAuthWithPolling", "refreshToken"],
      "reject",
    ],
    [
      "packages/services/src/oauth/oauthService.ts",
      ["restoreSession", "pollPendingOAuth", "handleCallback"],
      null,
    ],
    [
      "packages/services/src/oauth/oauthService.ts",
      ["restoreCachedSessionState"],
      { status: "signed-out" },
    ],
    [
      "packages/services/src/conversation-share/conversationShareService.ts",
      ["preflight", "publish", "importShare"],
      "reject",
    ],
    ["packages/services/src/feedback/feedbackHttpClient.ts", ["request"], "reject"],
    [
      "packages/services/src/coding-plan-subscription/bigmodelCodingPlanSubscriptionProvider.ts",
      ["readCodingPlanApiJson"],
      "reject",
    ],
    [
      "packages/services/src/bigmodel/codingPlanEntitlement.ts",
      ["fetchPersonalCodingPlanEntitlement", "fetchTeamCodingPlanEntitlement"],
      "reject",
    ],
    [
      "packages/services/src/bigmodel/teamPlanApiKey.ts",
      ["ensureBigModelTeamPlanProjectApiKeyWithStatus", "copyBigModelTeamPlanProjectApiKeySecret"],
      "reject",
    ],
    ["packages/services/src/session/offPeakServerClient.ts", ["request"], "reject"],
    [
      "packages/services/src/session/offPeakRuntimeModel.ts",
      ["resolveOffPeakCredentials"],
      "reject",
    ],
    [
      "packages/services/src/model-provider/accountProviderApiClient.ts",
      ["fetchRemoteData"],
      "reject",
    ],
    [
      "packages/services/src/model-provider/accountProviderTeamPlanRequestKey.ts",
      ["resolveAccountTeamPlanRuntimeApiKey"],
      "reject",
    ],
    [
      "packages/services/src/official-mcp/officialMcpCredentials.ts",
      ["resolveOfficialMcpCredentials"],
      { ok: false },
    ],
  ];
  for (const [file, names, expected] of cases) {
    const ast = ts.createSourceFile(file, await read(file), ts.ScriptTarget.Latest, true);
    const bodies = new Map();
    function visit(node) {
      if (node.body && ts.isBlock(node.body) && node.name && names.includes(node.name.getText(ast)))
        bodies.set(node.name.getText(ast), node.body.getText(ast));
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const name of names) {
      assert.ok(bodies.has(name), `${file}: ${name}`);
      // 执行真实方法体，不提供 this/凭证/网络依赖；若短路被移至副作用之后即失败。
      const body = ts.transpileModule(`async function boundary() ${bodies.get(name)}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText;
      const run = new Function(
        "assertOfficialPlatformAvailable",
        "isOfficialPlatformEnabled",
        "fail",
        `${body}; return boundary;`,
      )(policy.assertOfficialPlatformAvailable, policy.isOfficialPlatformEnabled, () => ({
        ok: false,
      }));
      if (expected === "reject") await assert.rejects(run(), /ZCodium/, `${file}: ${name}`);
      else assert.deepEqual(await run(), expected, `${file}: ${name}`);
    }
  }
});

test("historical built-in platform model endpoints cannot escape the model transport", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const gateway = await load(
    "apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts",
    { "@zcode/shared": policy },
  );
  const fetch = gateway.createOfficialCodingPlanGatewayFetch({
    fetch: () => assert.fail("must not request"),
  });
  const config = JSON.parse(await read("config/provider/zcode-builtin.json"));
  const urls = [];
  function visit(value) {
    if (typeof value === "string" && policy.isOfficialPlatformUrl(value)) urls.push(value);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  visit(config);
  assert.ok(urls.length > 0);
  for (const url of urls) await assert.rejects(fetch(url), /ZCodium/);
});

test("Node API blocks official endpoints before resolving settings or calling fetch", async () => {
  const policy = await load("packages/shared/src/officialPlatformPolicy.ts");
  const { NodeApiClient } = await load("packages/services/src/providers/api/nodeApiClient.ts", {
    "@zcode/shared": {
      ...policy,
      DEFAULT_ZCODE_ENDPOINT_ORIGIN: "https://zcode.z.ai",
      ApiError: Error,
    },
    "#src/logger/serviceLogger.js": { createServiceLogger: () => ({}) },
    "../sourceHeaders.js": {},
    "./requestIdHeaders.js": {},
  });
  const unexpected = () => assert.fail("must not resolve or request");
  const client = new NodeApiClient({
    resolveZCodeEndpointOrigin: unexpected,
    fetchImpl: unexpected,
  });
  await assert.rejects(client.request("https://zcode.z.ai/api/v1/client/configs"), /ZCodium/);
});

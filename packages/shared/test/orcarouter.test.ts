import assert from "node:assert/strict";
import test from "node:test";
import {
  ORCAROUTER_DEFAULT_API_BASE,
  ORCAROUTER_DEFAULT_AUTH_BASE,
  buildOrcaAuthorizeUrl,
  buildOrcaExchangeBody,
  buildOrcaModelsUrl,
  buildOrcaV1Base,
  filterOrcaModels,
  looksLikeOrcaApiKey,
  maskOrcaSecret,
  normalizeOrcaOrigin,
  parseOrcaCatalog,
  parseOrcaExchangeResult,
  parseOrcaModelRecord,
  resolveOrcaOrigins,
  supportsTextChat,
  type OrcaModelRecord,
} from "../src/orcarouter.js";

function record(id: string, endpoints: string[], modalities: string[] = []): OrcaModelRecord {
  return Object.freeze({
    id,
    supportedEndpointTypes: Object.freeze(endpoints),
    inputModalities: Object.freeze(modalities),
  });
}

test("origin 解析：auth 与 api 是两个独立 origin，默认值互不推导", () => {
  const origins = resolveOrcaOrigins({});
  assert.equal(origins.authBase, ORCAROUTER_DEFAULT_AUTH_BASE);
  assert.equal(origins.apiBase, ORCAROUTER_DEFAULT_API_BASE);
  assert.equal(buildOrcaV1Base(origins.apiBase), "https://api.orcarouter.ai/v1");
  assert.equal(buildOrcaModelsUrl(origins.apiBase), "https://api.orcarouter.ai/v1/models");
  // 推理路径绝不挂在 auth origin 下，交换路径也绝不出现在 api origin 下。
  assert.ok(!buildOrcaModelsUrl(origins.apiBase).startsWith(origins.authBase));
});

test("origin 解析：显式覆盖优先于共享基址，共享基址优先于默认值", () => {
  const explicit = resolveOrcaOrigins({
    ORCA_AUTH_BASE_URL: "https://auth.internal.example/",
    ORCA_API_BASE_URL: "https://api.internal.example/",
    ORCA_BASE_URL: "https://shared.internal.example",
  });
  assert.equal(explicit.authBase, "https://auth.internal.example");
  assert.equal(explicit.apiBase, "https://api.internal.example");

  const shared = resolveOrcaOrigins({ ORCA_BASE_URL: "https://shared.internal.example/" });
  assert.equal(shared.authBase, "https://shared.internal.example");
  assert.equal(shared.apiBase, "https://shared.internal.example");

  const partial = resolveOrcaOrigins({
    ORCA_BASE_URL: "https://shared.internal.example",
    ORCA_API_BASE_URL: "https://api.only.example",
  });
  assert.equal(partial.authBase, "https://shared.internal.example");
  assert.equal(partial.apiBase, "https://api.only.example");
});

test("origin 校验：远端必须 https，http 只允许 loopback", () => {
  assert.throws(() => normalizeOrcaOrigin("http://evil.example", "Origin"), /loopback/);
  assert.equal(normalizeOrcaOrigin("http://127.0.0.1:8080", "Origin"), "http://127.0.0.1:8080");
  assert.equal(normalizeOrcaOrigin("http://localhost:5000/", "Origin"), "http://localhost:5000");
  assert.throws(() => normalizeOrcaOrigin("https://user:pass@a.example", "Origin"), /用户信息/);
  assert.throws(() => normalizeOrcaOrigin("ftp://a.example", "Origin"), /http/);
});

test("授权 URL：固定 S256、固定 /auth、OOB 回调，且不含 verifier", () => {
  const url = buildOrcaAuthorizeUrl({
    authBase: ORCAROUTER_DEFAULT_AUTH_BASE,
    callbackUrl: "oob",
    codeChallenge: "CHALLENGE_VALUE",
    state: "STATE_VALUE",
    appName: "ZCodium",
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://www.orcarouter.ai");
  assert.equal(parsed.pathname, "/auth");
  assert.equal(parsed.searchParams.get("callback_url"), "oob");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.equal(parsed.searchParams.get("code_challenge"), "CHALLENGE_VALUE");
  assert.equal(parsed.searchParams.get("state"), "STATE_VALUE");
  assert.equal(parsed.searchParams.get("scope"), "api");
  // verifier 从不进入授权 URL。
  assert.ok(!url.includes("code_verifier"));
});

test("换取请求体：固定走 S256，只携带 code 与 verifier", () => {
  const body = buildOrcaExchangeBody("CODE", "VERIFIER");
  assert.deepEqual(Object.keys(body).sort(), ["code", "code_challenge_method", "code_verifier"]);
  assert.equal(body.code_challenge_method, "S256");
  assert.equal(body.code_verifier, "VERIFIER");
});

test("换取响应：读取实际授予 scope，降级时失败而不是假定获得", () => {
  const ok = parseOrcaExchangeResult({ key: "sk-orca-abc123", user_id: "42", scope: "api" });
  assert.equal(ok.key, "sk-orca-abc123");
  assert.equal(ok.userId, "42");
  assert.equal(ok.scope, "api");

  assert.throws(
    () => parseOrcaExchangeResult({ key: "sk-orca-abc123", scope: "connector" }),
    /connector/,
  );
  assert.throws(() => parseOrcaExchangeResult({ scope: "api" }), /缺少 key/);
  assert.throws(() => parseOrcaExchangeResult({ key: "k", scope: "" }), /范围/);
});

test("目录解析：保留 vendor/model 命名空间，缺失字段按空数组 fail closed", () => {
  const parsed = parseOrcaModelRecord({
    id: "openai/gpt-5.5",
    supported_endpoint_types: ["openai", "anthropic"],
    architecture: { input_modalities: ["text", "image"] },
  });
  assert.ok(parsed);
  assert.equal(parsed.id, "openai/gpt-5.5");
  assert.deepEqual(parsed.supportedEndpointTypes, ["openai", "anthropic"]);
  assert.deepEqual(parsed.inputModalities, ["text", "image"]);

  const bare = parseOrcaModelRecord({ id: "orcarouter/auto" });
  assert.ok(bare);
  assert.deepEqual(bare.inputModalities, []);
  assert.deepEqual(bare.supportedEndpointTypes, []);
  assert.equal(parseOrcaModelRecord({}), null);
  assert.equal(parseOrcaModelRecord(null), null);
});

test("目录解析：条目数有上界，非对象条目被丢弃", () => {
  const data = Array.from({ length: 10 }, (_, index) => ({ id: `m/${index}` }));
  const bounded = parseOrcaCatalog({ data }, 3);
  assert.equal(bounded.length, 3);
  assert.deepEqual(
    parseOrcaCatalog({ data: [{ id: "a" }, null, 5, { id: "b" }] }).map((m) => m.id),
    ["a", "b"],
  );
  assert.throws(() => parseOrcaCatalog({}), /data/);
});

test("能力过滤：chat 排除图片生成/视频/rerank 专用模型", () => {
  assert.equal(supportsTextChat(record("a", ["openai"])), true);
  assert.equal(supportsTextChat(record("a", ["gemini"])), true);
  assert.equal(supportsTextChat(record("a", ["embeddings"])), false);

  const models = [
    record("text", ["openai"]),
    record("vision", ["openai"], ["text", "image"]),
    record("image-gen", ["image-generation", "openai"]),
    record("video", ["openai-video", "openai"]),
    record("rerank", ["jina-rerank", "openai"]),
    record("embed", ["embeddings"]),
    record("unknown", []),
  ];
  assert.deepEqual(
    filterOrcaModels(models, "chat").map((m) => m.id),
    ["text", "vision"],
  );
  assert.deepEqual(
    filterOrcaModels(models, "embedding").map((m) => m.id),
    ["embed"],
  );
  assert.deepEqual(
    filterOrcaModels(models, "image").map((m) => m.id),
    ["image-gen"],
  );
  assert.deepEqual(
    filterOrcaModels(models, "video").map((m) => m.id),
    ["video"],
  );
  assert.deepEqual(
    filterOrcaModels(models, "rerank").map((m) => m.id),
    ["rerank"],
  );
});

test("多模态过滤：未显式声明 image 输入的模型 fail closed", () => {
  const models = [
    record("declared", ["openai"], ["text", "image"]),
    record("text-only", ["openai"], ["text"]),
    record("undeclared", ["openai"]),
  ];
  assert.deepEqual(
    filterOrcaModels(models, "chat", "image").map((m) => m.id),
    ["declared"],
  );
  assert.deepEqual(
    filterOrcaModels(models, "chat").map((m) => m.id),
    ["declared", "text-only", "undeclared"],
  );
});

test("凭据脱敏：只保留前缀与末四位，短值整体隐藏", () => {
  assert.equal(maskOrcaSecret("sk-orca-abcdefghijklmnop"), "sk-orc…mnop");
  assert.equal(maskOrcaSecret("short"), "••••");
  assert.equal(maskOrcaSecret(""), "");
  assert.equal(maskOrcaSecret(null), "");
  assert.ok(!maskOrcaSecret("sk-orca-abcdefghijklmnop").includes("defghijk"));
});

test("API Key 轻量格式检查：前缀只是提示，不是有效性证明", () => {
  assert.equal(looksLikeOrcaApiKey("sk-orca-abcdef123456"), true);
  assert.equal(looksLikeOrcaApiKey("sk-orca-"), false);
  assert.equal(looksLikeOrcaApiKey("sk-other-abcdef123456"), false);
  assert.equal(looksLikeOrcaApiKey(""), false);
});

/**
 * 官方服务开关探针：用真实 settingService / officialPlatformPolicy 执行单个场景，
 * 由 packages/desktop/tests/official-service-switches.test.mjs 以子进程方式驱动。
 *
 * 用法：node --import tsx official-service-switches-probe.mjs <baseline|write|read|close|effects>
 * 环境：ZCODE_DESKTOP_HOME_DIR 指向临时 home（探针只读写该目录下的 setting.json）。
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.ZCODE_DESKTOP_HOME_DIR?.trim();
const mode = process.argv[2];
if (!home) {
  throw new Error("ZCODE_DESKTOP_HOME_DIR is required");
}

const { createSettingService } = await import(
  new URL("../../../services/src/setting/settingService.ts", import.meta.url).href
);
const policy = await import(
  new URL("../../../shared/src/officialPlatformPolicy.ts", import.meta.url).href
);
const { appSettingsSchema } = await import(
  new URL("../../../shared/src/validationAppSettings.ts", import.meta.url).href
);
const { resolveDefaultPluginMarketplaces } = await import(
  new URL("../../../shared/src/plugin-marketplaces.ts", import.meta.url).href
);

// 只剩仍在册的两个开关：account / feedback / codingPlan / officialMcp / offPeak 随去智谱化下线。
const ALL_OFF = { marketplace: false, clientConfig: false };
const ALL_ON = { marketplace: true, clientConfig: true };
// 存量用户磁盘上仍可能存在的已下线字段，用于验证写盘时被 zod strip。
const LEGACY_KEYS = {
  account: true,
  feedback: true,
  codingPlan: true,
  officialMcp: true,
  offPeak: true,
};
const LEGACY_STORED = { ...ALL_ON, ...LEGACY_KEYS };
// 持久化场景只需要 marketplace 开启，另带 5 个已下线字段。
const WRITE_PATCH = { marketplace: true, clientConfig: false, ...LEGACY_KEYS };

const service = createSettingService();
const result = { mode };

function doesNotThrow(run) {
  try {
    run();
    return true;
  } catch {
    return false;
  }
}

function throwsError(run) {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

function errorMessage(run) {
  try {
    run();
    return "";
  } catch (error) {
    return String(error?.message ?? error);
  }
}

// 业务入口多为 async：拒绝会变成 rejected promise，必须 await 才能拿到文案，
// 否则会漏成 unhandled rejection 直接把探针进程带崩。
async function rejectionMessage(run) {
  try {
    await run();
    return "";
  } catch (error) {
    return String(error?.message ?? error);
  }
}

const PROBE_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * 逐项验证仍在册开关的真实业务功能：同一份服务在关闭态应明确拒绝（不碰凭证/网络），
 * 打开后应真的进入各自功能（拉客户端配置 / 出现 CDN 下载源）。
 * 同时验证已下线功能无论开关如何都拒绝，并给出“已下线”而不是“未开启”的文案。
 */
async function runFunctionalEffects() {
  const { createClientConfigService } = await import(
    new URL("../../../services/src/client-config/clientConfigService.ts", import.meta.url).href
  );
  const { resolveRemoteCdnBaseUrls } = await import(
    new URL("../../../desktop/src/main/remoteCdn.ts", import.meta.url).href
  );
  const { createOffPeakServerClient } = await import(
    new URL("../../../services/src/session/offPeakServerClient.ts", import.meta.url).href
  );
  const { FeedbackHttpClient } = await import(
    new URL("../../../services/src/feedback/feedbackHttpClient.ts", import.meta.url).href
  );

  process.env.ZCODE_CDN_BASE_URL = "https://mock-cdn.example";

  async function inspect() {
    const snapshot = {};

    // clientConfig：关闭时返回本地兜底且不调网络；打开后请求客户端配置并返回远端排序。
    let clientConfigCalls = 0;
    const clientConfigService = createClientConfigService({
      apiClient: {
        request: async (url) => {
          clientConfigCalls += 1;
          return {
            ok: true,
            url: String(url),
            json: async () => ({
              code: 0,
              data: {
                configs: { pluginStoreOrder: { work: { categoryOrder: ["probe-plugin"] } } },
              },
            }),
          };
        },
      },
      resolveRequestContext: () => ({
        endpointOrigin: "https://mock-zcode.example",
        appVersion: "0.0.0",
        platform: "probe",
      }),
    });
    const clientConfigSnapshot = await clientConfigService.getSnapshot({ forceRefresh: true });
    snapshot.clientConfigCalls = clientConfigCalls;
    snapshot.clientConfigOrder =
      clientConfigSnapshot.pluginStoreOrder?.work?.categoryOrder?.[0] ?? null;

    // marketplace：关闭时远程 CDN 来源为空；打开后出现可下载的 CDN 源。
    snapshot.remoteCdnCount = resolveRemoteCdnBaseUrls({ version: "0.0.0" }).length;

    // 自建源：显式覆盖地址是用户自有源，先于官方开关判断，开关状态不得阻断或改写它。
    snapshot.remoteCdnOverrideUrl =
      resolveRemoteCdnBaseUrls({
        version: "0.0.0",
        overrideBaseUrl: "https://github.com/probe/repo/releases/download/v0.0.0",
      })[0] ?? null;

    // 内置发布源：发布构建注入的自有源同样不受官方开关影响（安装版开箱即用）。
    snapshot.remoteCdnBundledUrl =
      resolveRemoteCdnBaseUrls({
        version: "0.0.0",
        bundledBaseUrl: "https://github.com/probe/repo/releases/download/v0.0.0",
      })[0] ?? null;

    // 优先级：显式覆盖必须优先于内置源。
    snapshot.remoteCdnOverrideWins =
      resolveRemoteCdnBaseUrls({
        version: "0.0.0",
        overrideBaseUrl: "https://mirror.example/remote",
        bundledBaseUrl: "https://github.com/probe/repo/releases/download/v0.0.0",
      })[0] ?? null;

    // offPeak：能力已下线 → 恒拒绝，且不得触达凭证/网络。
    let offPeakFetchCalls = 0;
    const offPeakClient = createOffPeakServerClient({
      resolveOrigin: () => "https://mock-offpeak.example",
      resolveCredentials: async () => ({
        jwt: "probe-jwt",
        codingPlanApiKey: "probe-key",
        kind: "bigmodel-personal",
        providerFamily: "bigmodel",
        providerId: "probe-provider",
      }),
      fetchImpl: async () => {
        offPeakFetchCalls += 1;
        return new Response(JSON.stringify({ can_take_number: true }), { status: 200 });
      },
      logger: PROBE_LOGGER,
    });
    snapshot.offPeakMessage = await rejectionMessage(() =>
    offPeakClient.getTakeNumberAvailability(),
  );
    snapshot.offPeakRejected = Boolean(snapshot.offPeakMessage);
    snapshot.offPeakFetchCalls = offPeakFetchCalls;

    // feedback：能力已下线 → 恒拒绝，且不得触达凭证/网络。
    let feedbackCalls = 0;
    let feedbackAuthCalls = 0;
    const feedbackClient = new FeedbackHttpClient({
      baseUrl: "https://mock-feedback.example",
      apiClient: {
        request: async () => {
          feedbackCalls += 1;
          throw new Error("probe feedback network reached");
        },
      },
      getAuthHeaders: async () => {
        feedbackAuthCalls += 1;
        return {};
      },
      logger: PROBE_LOGGER,
    });
    snapshot.feedbackMessage = await rejectionMessage(() => feedbackClient.list());
    snapshot.feedbackRejected = Boolean(snapshot.feedbackMessage);
    snapshot.feedbackCalls = feedbackCalls;
    snapshot.feedbackAuthCalls = feedbackAuthCalls;

    return snapshot;
  }

  const closed = await inspect();
  await service.update({ officialServices: LEGACY_STORED });
  const opened = await inspect();
  return { closed, opened };
}

if (mode === "baseline") {
  // 不读取设置：进程策略应保持默认全关。
  result.enabled = policy.isOfficialPlatformEnabled();
  result.assertRejects = throwsError(() => policy.assertOfficialServiceAvailable("marketplace"));
  result.removedRejects = throwsError(() => policy.assertOfficialServiceRemoved("account"));
} else if (mode === "write") {
  result.storageSchemaMarketplace = appSettingsSchema.parse({
    officialServices: WRITE_PATCH,
  }).officialServices?.marketplace;
  // 存量用户磁盘上的已下线字段必须在写盘时被 zod strip。
  result.storageSchemaStrippedAccount = appSettingsSchema.parse({
    officialServices: WRITE_PATCH,
  }).officialServices?.account;
  await service.update({ officialServices: WRITE_PATCH });
  const disk = JSON.parse(readFileSync(join(home, ".zcodium", "v2", "setting.json"), "utf8"));
  result.diskMarketplace = disk.officialServices?.marketplace;
  result.diskClientConfig = disk.officialServices?.clientConfig;
  result.diskAccount = disk.officialServices?.account;
  const readBack = await service.get();
  result.readBackMarketplace = readBack.officialServices?.marketplace;
  result.readBackAccount = readBack.officialServices?.account;
  result.enabledMarketplace = policy.isOfficialServiceEnabled("marketplace");
  result.enabledClientConfig = policy.isOfficialServiceEnabled("clientConfig");
  result.assertMarketplacePasses = doesNotThrow(() =>
    policy.assertOfficialServiceAvailable("marketplace"),
  );
  result.assertClientConfigRejects = throwsError(() =>
    policy.assertOfficialServiceAvailable("clientConfig"),
  );
  // 已下线功能：开关打开与否都恒拒绝，且理由是“已下线”而不是“未开启”。
  result.removedAccountMessage = errorMessage(() => policy.assertOfficialServiceRemoved("account"));
  result.blockedMarketplaceUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://cdn-zcode.z.ai/icon.png",
  );
  result.blockedClientConfigUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://zcode.z.ai/api/v1/client/configs",
  );
  result.blockedRemovedAccountUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://zcode.z.ai/api/v1/oauth/cli/init",
  );
  result.blockedRemovedClaimUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://zcode.z.ai/api/v1/client/claim",
  );
  result.blockedRemovedPlanUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://zcode.z.ai/api/v1/coding-plan/usage",
  );
  result.resolvedRemovedAccount = policy.resolveOfficialServiceForUrl(
    "https://zcode.z.ai/api/v1/oauth/cli/init",
  );
  result.resolvedRemovedClaim = policy.resolveOfficialServiceForUrl(
    "https://zcode.z.ai/api/v1/client/claim",
  );
  result.removedClaimMessage = errorMessage(() =>
    policy.assertOfficialPlatformAccessible("https://zcode.z.ai/api/v1/client/claim"),
  );
} else if (mode === "read") {
  // 新进程：不执行 update，只读取已落盘的设置。
  const readBack = await service.get();
  result.readMarketplace = readBack.officialServices?.marketplace;
  result.readClientConfig = readBack.officialServices?.clientConfig;
  result.enabledMarketplace = policy.isOfficialServiceEnabled("marketplace");
  result.enabledClientConfig = policy.isOfficialServiceEnabled("clientConfig");
  result.assertMarketplacePasses = doesNotThrow(() =>
    policy.assertOfficialServiceAvailable("marketplace"),
  );
  result.assertClientConfigRejects = throwsError(() =>
    policy.assertOfficialServiceAvailable("clientConfig"),
  );
  result.blockedMarketplaceUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://cdn-zcode.z.ai/icon.png",
  );
  result.blockedClientConfigUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://zcode.z.ai/api/v1/client/configs",
  );
} else if (mode === "close") {
  await service.update({ officialServices: ALL_OFF });
  const readBack = await service.get();
  result.readBackMarketplace = readBack.officialServices?.marketplace;
  result.enabledMarketplace = policy.isOfficialServiceEnabled("marketplace");
  result.assertRejects = throwsError(() => policy.assertOfficialServiceAvailable("marketplace"));
  result.blockedMarketplaceUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://cdn-zcode.z.ai/icon.png",
  );
} else if (mode === "effects") {
  result.functional = await runFunctionalEffects();
} else if (mode === "projection") {
  // Desktop 设置 → agent env 的单一映射，以及官方市场集合按开关过滤。
  const closedPatch = policy.buildOfficialServiceEnvPatch(undefined);
  result.closedEnvKeys = Object.keys(closedPatch).length;
  result.closedEnvValues = [...new Set(Object.values(closedPatch))].sort();
  result.closedDefaults = resolveDefaultPluginMarketplaces().length;

  await service.update({ officialServices: { ...ALL_OFF, marketplace: true } });
  const openedPatch = policy.buildOfficialServiceEnvPatch({ ...ALL_OFF, marketplace: true });
  result.openedMarketplaceEnv = openedPatch.ZCODIUM_ENABLE_OFFICIAL_MARKETPLACE;
  result.openedClientConfigEnv = openedPatch.ZCODIUM_ENABLE_OFFICIAL_CLIENT_CONFIG;
  // 已下线功能不再有环境变量：留着会让 shell 残留的 =1 看起来还能放行。
  result.removedEnvKeys = Object.keys(openedPatch).filter((key) =>
    /ACCOUNT|FEEDBACK|CODING_PLAN|_MCP|OFFPEAK/.test(key),
  );
  const defaults = resolveDefaultPluginMarketplaces();
  result.openedDefaults = defaults.length;
  result.openedDefaultSource = defaults[0]?.source ?? null;
} else if (mode === "overview-filter") {
  // Host 的公开市场投影：关闭时官方市场/候选插件从 overview 过滤且注入标记，已安装列表保留。
  const { createPluginManagementService } = await import(
    new URL("../../../services/src/plugins/pluginManagementService.ts", import.meta.url).href
  );
  const officialMarketplace = {
    id: "zcode-plugins-official",
    name: "zcode-plugins-official",
    source: { source: "url", url: "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json" },
    pluginCount: 28,
  };
  const personalMarketplace = {
    id: "probe-market",
    name: "Probe Market",
    source: { source: "url", url: "https://example.com/market.json" },
    pluginCount: 1,
  };
  const installed = [
    {
      id: "github@zcode-plugins-official",
      name: "Github",
      marketplace: "zcode-plugins-official",
      version: "1.0.0",
      installPath: "/tmp/probe",
      installedAt: "2026-01-01T00:00:00.000Z",
      scope: "user",
    },
  ];
  const agent = {
    getPluginsOverview: async () => ({
      marketplaces: [officialMarketplace, personalMarketplace],
      availablePlugins: [
        {
          id: "github@zcode-plugins-official",
          name: "Github",
          marketplace: "zcode-plugins-official",
          installed: false,
        },
        {
          id: "probe@probe-market",
          name: "Probe",
          marketplace: "probe-market",
          installed: false,
        },
      ],
      installedPlugins: installed,
      restorableBuiltins: [],
      diagnostics: [],
      capability: { supported: true },
    }),
    listPlugins: async () => ({ plugins: [], diagnostics: [] }),
  };
  const pluginManagementService = createPluginManagementService({ zcodeAgentService: agent });

  const closed = await pluginManagementService.getPluginsOverview({ workspacePath: home });
  result.closedMarketplaces = closed.marketplaces.map((item) => item.id);
  result.closedAvailable = closed.availablePlugins.map((item) => item.id);
  result.closedInstalled = closed.installedPlugins.map((item) => item.id);
  result.closedFlag = closed.officialMarketplaceEnabled;

  await service.update({ officialServices: { ...ALL_OFF, marketplace: true } });
  const opened = await pluginManagementService.getPluginsOverview({ workspacePath: home });
  result.openedMarketplaces = opened.marketplaces.map((item) => item.id);
  result.openedAvailable = opened.availablePlugins.map((item) => item.id);
  result.openedFlag = opened.officialMarketplaceEnabled;
} else if (mode === "marketplace-seed") {
  // agent 实际 seed 行为：关闭时不写官方市场；env 打开（Desktop 投影路径）后写入官方 CDN 来源。
  const { ensureDefaultPluginMarketplaces, loadKnownMarketplacesSync } = await import(
    new URL(
      "../../../../apps/zcode-cli/packages/adapters/src/plugins/marketplace.ts",
      import.meta.url,
    ).href
  );
  const storageRoot = join(home, "plugin-storage");
  mkdirSync(storageRoot, { recursive: true });

  ensureDefaultPluginMarketplaces(storageRoot);
  const closedRecords = loadKnownMarketplacesSync(storageRoot);
  result.closedRecords = closedRecords.length;
  result.closedHasOfficial = closedRecords.some((record) => record.id === "zcode-plugins-official");

  process.env.ZCODIUM_ENABLE_OFFICIAL_MARKETPLACE = "1";
  policy.setOfficialServiceSwitches(policy.readOfficialServiceSwitchesFromEnv(process.env));
  ensureDefaultPluginMarketplaces(storageRoot);
  const openedRecords = loadKnownMarketplacesSync(storageRoot);
  const official = openedRecords.find((record) => record.id === "zcode-plugins-official");
  result.openedHasOfficial = Boolean(official);
  result.openedOfficialSource = official?.source?.url ?? null;
} else {
  throw new Error(`unknown probe mode: ${mode}`);
}

console.log(`PROBE_RESULT ${JSON.stringify(result)}`);

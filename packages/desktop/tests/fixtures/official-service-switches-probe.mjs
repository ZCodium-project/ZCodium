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

const ALL_OFF = {
  account: false,
  codingPlan: false,
  feedback: false,
  officialMcp: false,
  offPeak: false,
  marketplace: false,
  clientConfig: false,
};
const OPENED = {
  ...ALL_OFF,
  account: true,
  offPeak: true,
  marketplace: true,
};

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

const PROBE_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * 逐项验证开关的真实业务功能：同一份服务在关闭态应明确拒绝（不碰凭证/网络），
 * 打开后应真的进入各自功能（拉客户端配置 / 出现 CDN 下载源 / 发出取号请求 / 发出反馈请求）。
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

    // offPeak：关闭时取号在凭证/网络前拒绝；打开后真的发出取号请求并解析结果。
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
    try {
      const availability = await offPeakClient.getTakeNumberAvailability();
      snapshot.offPeakRejected = false;
      snapshot.offPeakCanTake = availability.canTakeNumber === true;
    } catch (error) {
      snapshot.offPeakRejected = String(error?.message ?? error).includes("未开启");
      snapshot.offPeakCanTake = false;
    }
    snapshot.offPeakFetchCalls = offPeakFetchCalls;

    // feedback：关闭时提交在请求前拒绝；打开后真的发出反馈请求（mock 网络触达即失败）。
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
    try {
      await feedbackClient.list();
      snapshot.feedbackRejected = false;
      snapshot.feedbackNetworkReached = false;
    } catch (error) {
      const message = String(error?.message ?? error);
      snapshot.feedbackRejected = message.includes("未开启");
      snapshot.feedbackNetworkReached = message.includes("probe feedback network reached");
    }
    snapshot.feedbackCalls = feedbackCalls;
    snapshot.feedbackAuthCalls = feedbackAuthCalls;

    return snapshot;
  }

  const closed = await inspect();
  await service.update({
    officialServices: {
      account: true,
      codingPlan: true,
      feedback: true,
      officialMcp: true,
      offPeak: true,
      marketplace: true,
      clientConfig: true,
    },
  });
  const opened = await inspect();
  return { closed, opened };
}

if (mode === "baseline") {
  // 不读取设置：进程策略应保持默认全关。
  result.enabled = policy.isOfficialPlatformEnabled();
  result.assertRejects = throwsError(() => policy.assertOfficialServiceAvailable("account"));
} else if (mode === "write") {
  result.storageSchemaAccount = appSettingsSchema.parse({
    officialServices: OPENED,
  }).officialServices?.account;
  await service.update({ officialServices: OPENED });
  const disk = JSON.parse(readFileSync(join(home, ".zcode", "v2", "setting.json"), "utf8"));
  result.diskAccount = disk.officialServices?.account;
  result.diskClientConfig = disk.officialServices?.clientConfig;
  const readBack = await service.get();
  result.readBackAccount = readBack.officialServices?.account;
  result.enabledAccount = policy.isOfficialServiceEnabled("account");
  result.enabledOffPeak = policy.isOfficialServiceEnabled("offPeak");
  result.enabledClientConfig = policy.isOfficialServiceEnabled("clientConfig");
  result.assertAccountPasses = doesNotThrow(() => policy.assertOfficialServiceAvailable("account"));
  result.assertClientConfigRejects = throwsError(() =>
    policy.assertOfficialServiceAvailable("clientConfig"),
  );
  result.blockedMarketplaceUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://cdn-zcode.z.ai/icon.png",
  );
  result.blockedClientConfigUrl = policy.shouldBlockOfficialPlatformUrl(
    "https://zcode.z.ai/api/v1/client/configs",
  );
} else if (mode === "read") {
  // 新进程：不执行 update，只读取已落盘的设置。
  const readBack = await service.get();
  result.readAccount = readBack.officialServices?.account;
  result.readClientConfig = readBack.officialServices?.clientConfig;
  result.enabledAccount = policy.isOfficialServiceEnabled("account");
  result.enabledOffPeak = policy.isOfficialServiceEnabled("offPeak");
  result.enabledClientConfig = policy.isOfficialServiceEnabled("clientConfig");
  result.assertOffPeakPasses = doesNotThrow(() => policy.assertOfficialServiceAvailable("offPeak"));
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
  result.readBackAccount = readBack.officialServices?.account;
  result.enabledAccount = policy.isOfficialServiceEnabled("account");
  result.assertRejects = throwsError(() => policy.assertOfficialServiceAvailable("account"));
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

  await service.update({
    officialServices: { ...ALL_OFF, marketplace: true },
  });
  const openedPatch = policy.buildOfficialServiceEnvPatch({
    ...ALL_OFF,
    marketplace: true,
  });
  result.openedMarketplaceEnv = openedPatch.ZCODIUM_ENABLE_OFFICIAL_MARKETPLACE;
  result.openedAccountEnv = openedPatch.ZCODIUM_ENABLE_OFFICIAL_ACCOUNT;
  const defaults = resolveDefaultPluginMarketplaces();
  result.openedDefaults = defaults.length;
  result.openedDefaultSource = defaults[0]?.source ?? null;
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

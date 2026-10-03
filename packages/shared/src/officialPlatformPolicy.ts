/** ZCodium 审计版：官方平台功能开关。
 *
 * 每个仍在册的官方功能一个开关，默认全部关闭；关闭时应用不发起任何官方平台请求（凭证读取与网络请求前短路）。
 * 用户可以在设置的“官方服务”里单独开启需要的功能。
 *
 * 有两类能力不提供开关，开启任何开关都不会恢复：
 * - 对话分享：早已整体下线；
 * - account / feedback / codingPlan / officialMcp / offPeak：随「去智谱化」把智谱套餐与
 *   官方账号体系一并移除，能力已不存在，只保留 key 让调用点与文案能说清「已下线」而不是含糊拒绝。
 */

export type OfficialServiceKey = "marketplace" | "clientConfig";

/** 随去智谱化移除的官方功能：没有开关，恒定不可用。 */
export type RemovedOfficialServiceKey =
  | "account"
  | "feedback"
  | "codingPlan"
  | "officialMcp"
  | "offPeak";

export interface OfficialServiceSwitches {
  marketplace: boolean;
  clientConfig: boolean;
}

export const OFFICIAL_SERVICE_KEYS: readonly OfficialServiceKey[] = ["marketplace", "clientConfig"];

export function createDefaultOfficialServiceSwitches(): OfficialServiceSwitches {
  return {
    marketplace: false,
    clientConfig: false,
  };
}

/** 进程级开关状态：宿主启动时从设置加载，设置变更时调用 setOfficialServiceSwitches 刷新。 */
let officialServiceSwitches: OfficialServiceSwitches = createDefaultOfficialServiceSwitches();

export function normalizeOfficialServiceSwitches(input: unknown): OfficialServiceSwitches {
  const next = createDefaultOfficialServiceSwitches();
  if (input && typeof input === "object") {
    const source = input as Record<string, unknown>;
    for (const key of OFFICIAL_SERVICE_KEYS) {
      if (source[key] === true) {
        next[key] = true;
      }
    }
  }
  return next;
}

/**
 * 环境变量键 → 功能开关的单一映射。
 * CLI/headless 读取与 Desktop 的 agent env 投影共用，禁止在两处手写键名。
 * 已下线功能不留环境变量：留了会让 shell 残留的 =1 看起来还能放行，实际调用点恒拒绝。
 */
export const OFFICIAL_SERVICE_ENV_KEYS: Readonly<Record<string, OfficialServiceKey>> = {
  ZCODIUM_ENABLE_OFFICIAL_MARKETPLACE: "marketplace",
  ZCODIUM_ENABLE_OFFICIAL_CLIENT_CONFIG: "clientConfig",
};

/** CLI/headless 用环境变量开启官方功能；键名见上方映射，值为 "1" 时开启。 */
export function readOfficialServiceSwitchesFromEnv(
  env: Record<string, string | undefined> = {},
): Partial<OfficialServiceSwitches> {
  const result: Partial<OfficialServiceSwitches> = {};
  for (const [key, feature] of Object.entries(OFFICIAL_SERVICE_ENV_KEYS)) {
    if (env[key]?.trim() === "1") {
      result[feature] = true;
    }
  }
  return result;
}

/**
 * Desktop 运行时的 agent env 投影：按设置输出完整键集（开启=1、关闭=0）。
 *
 * 必须写完整键集：用户 shell 里可能残留 `ZCODIUM_ENABLE_OFFICIAL_*=1`，
 * Desktop 的设置是唯一事实源，关闭项要显式覆盖为 0，不能依赖“缺键=关闭”。
 */
export function buildOfficialServiceEnvPatch(input: unknown): Record<string, string> {
  const switches = normalizeOfficialServiceSwitches(input);
  const patch: Record<string, string> = {};
  for (const [key, feature] of Object.entries(OFFICIAL_SERVICE_ENV_KEYS)) {
    patch[key] = switches[feature] ? "1" : "0";
  }
  return patch;
}

export function setOfficialServiceSwitches(input: unknown): void {
  officialServiceSwitches = normalizeOfficialServiceSwitches(input);
}

export function getOfficialServiceSwitches(): OfficialServiceSwitches {
  return { ...officialServiceSwitches };
}

export function isOfficialServiceEnabled(key: OfficialServiceKey): boolean {
  return officialServiceSwitches[key] === true;
}

/** 任一官方功能开启即视为平台可用；用于不区分功能的历史判断。 */
export function isOfficialPlatformEnabled(): boolean {
  return OFFICIAL_SERVICE_KEYS.some((key) => officialServiceSwitches[key] === true);
}

export function assertOfficialServiceAvailable(key: OfficialServiceKey): void {
  if (!isOfficialServiceEnabled(key)) {
    throw new Error(
      `ZCodium 默认不连接官方平台，此功能未开启。可在设置的“官方服务”里打开；反馈请访问 ${ZCODIUM_ISSUES_URL}`,
    );
  }
}

/** 对话分享已下线：不提供开关，任何组合都不能恢复。 */
export function isConversationShareAvailable(): boolean {
  return false;
}

export function assertConversationShareRemoved(): void {
  throw new Error(`对话分享已在 ZCodium 下线。反馈请访问 ${ZCODIUM_ISSUES_URL}`);
}

export const ZCODIUM_ISSUES_URL = "https://github.com/ZCodium-project/ZCodium/issues";

/**
 * 已下线功能的中文名：只用于报错文案。
 * 报错不能直接印英文 key——用户看到 "codingPlan 未开启" 无从判断是什么功能，
 * 而这批能力在设置页里原本显示的就是这些中文名。
 */
const REMOVED_OFFICIAL_SERVICE_LABELS: Readonly<Record<RemovedOfficialServiceKey, string>> = {
  account: "官方账号登录",
  feedback: "官方反馈通道",
  codingPlan: "官方套餐与额度",
  officialMcp: "官方 MCP 凭证",
  offPeak: "官方闲时任务",
};

function isRemovedOfficialServiceKey(
  key: OfficialServiceKey | RemovedOfficialServiceKey,
): key is RemovedOfficialServiceKey {
  return key in REMOVED_OFFICIAL_SERVICE_LABELS;
}

/**
 * 该功能是否已下线。
 *
 * 仍需保留 dormant 代码的调用点用它做前置短路，而不是直接写无条件 return：
 * 无条件 return 会让后续 dormant 代码整体落入 TypeScript 的不可达区，而 TS 在不可达区
 * 不做类型收窄，会把整段账号/套餐流程打成上百个类型错误。账号子系统的物理删除另开 issue 跟踪，
 * 本轮只摘掉开关依赖、保留代码形状，因此这里保留条件判断的写法。
 */
export function isOfficialServiceRemoved(key: OfficialServiceKey | RemovedOfficialServiceKey): boolean {
  return isRemovedOfficialServiceKey(key);
}

/** 已下线功能：恒抛异常，与对话分享同构——不存在“开关打开后恢复”的路径。 */
export function assertOfficialServiceRemoved(key: RemovedOfficialServiceKey): void {
  throw new Error(
    `“${REMOVED_OFFICIAL_SERVICE_LABELS[key]}”功能已在 ZCodium 下线，无法再开启。反馈请访问 ${ZCODIUM_ISSUES_URL}`,
  );
}

export function assertOfficialPlatformAvailable(): void {
  if (!isOfficialPlatformEnabled()) {
    throw new Error(
      `ZCodium 默认不连接官方平台，此功能未开启。可在设置的“官方服务”里打开；反馈请访问 ${ZCODIUM_ISSUES_URL}`,
    );
  }
}

/** 仅阻断平台域名，保留用户自配的模型 API、代理和本地地址。 */
export function isOfficialPlatformUrl(input: string | URL): boolean {
  try {
    const host = new URL(String(input)).hostname.toLowerCase().replace(/\.$/, "");
    return ["zcode.z.ai", "cdn-zcode.z.ai"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

/** 仍在开关控制下的平台路径；命中即代表该请求归属某个可开启功能。 */
const OFFICIAL_SERVICE_PATH_RULES: ReadonlyArray<{
  key: OfficialServiceKey;
  patterns: readonly RegExp[];
}> = [
  {
    key: "marketplace",
    patterns: [/^\/api\/v1\/(plugin|marketplace|scenes|preview|models)/, /^\/deps\//],
  },
  {
    key: "clientConfig",
    patterns: [
      /^\/api\/v1\/(client|configs|bootstrap|event|releases|manifest|report|remote-control|server-info)/,
    ],
  },
];

/**
 * 已下线功能的原路径规则，正则原样保留。
 * 删掉它们会让这些 URL 落到“已下线或未登记”的含糊文案，调用方无法分辨是下线还是没登记；
 * 保留则是为了让拦截理由精确指向具体功能。
 */
const REMOVED_OFFICIAL_SERVICE_PATH_RULES: ReadonlyArray<{
  key: RemovedOfficialServiceKey;
  patterns: readonly RegExp[];
}> = [
  {
    key: "account",
    patterns: [
      /^\/api\/v1\/(oauth|login|logout|token|authorize|user|users|account|customer|organization|client\/claim)/,
    ],
  },
  { key: "feedback", patterns: [/^\/api\/v1\/feedback/] },
  {
    key: "codingPlan",
    patterns: [
      /^\/api\/v1\/(coding-plan|subscription|balance|billing|order|orders|claim|enterprise|pay|usage|zcode-plan)/,
    ],
  },
  { key: "officialMcp", patterns: [/^\/api\/v1\/mcp/] },
  { key: "offPeak", patterns: [/^\/api\/v1\/off-peak/, /\/off-peak/] },
];

/**
 * 官方 URL 归属的功能键；返回 null 表示不归属任何登记功能——分享与未知路径
 * 永远拒绝，只有明确登记的路径才可能放行。
 *
 * 已下线表必须先匹配：account 的 `client/claim` 会被 clientConfig 的 `client` 前缀吞掉，
 * 若按“先保留表后已移除表”匹配，这条套餐认领路径会在 clientConfig 开启时被误放行，
 * 与“已下线功能的 URL 恒被拦截”这条审计不变量冲突。两表其余路径互不重叠。
 */
export function resolveOfficialServiceForUrl(
  input: string | URL,
): OfficialServiceKey | RemovedOfficialServiceKey | null {
  let url: URL;
  try {
    url = new URL(String(input));
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const isCdn = host === "cdn-zcode.z.ai" || host.endsWith(".cdn-zcode.z.ai");
  const isPlatform = host === "zcode.z.ai" || host.endsWith(".zcode.z.ai");
  if (!isCdn && !isPlatform) {
    return null;
  }
  if (isCdn) {
    return "marketplace";
  }
  const path = url.pathname.toLowerCase();
  // 对话分享已下线：无论开关如何都拒绝。
  if (/(^|\/)share(\/|$)/.test(path)) {
    return null;
  }
  for (const rule of REMOVED_OFFICIAL_SERVICE_PATH_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(path))) {
      return rule.key;
    }
  }
  for (const rule of OFFICIAL_SERVICE_PATH_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(path))) {
      return rule.key;
    }
  }
  return null;
}

/**
 * 出口拦截判断：非平台 URL 放行；平台 URL 按功能开关放行，未登记路径一律拒绝。
 * 命中已下线功能时恒拦截：没有开关可以打开它，留着判断只会让旧设置或 shell 残留看起来仍能放行。
 */
export function shouldBlockOfficialPlatformUrl(input: string | URL): boolean {
  if (!isOfficialPlatformUrl(input)) {
    return false;
  }
  const key = resolveOfficialServiceForUrl(input);
  if (key === null) {
    return true;
  }
  if (isRemovedOfficialServiceKey(key)) {
    return true;
  }
  return !isOfficialServiceEnabled(key);
}

export function assertNoOfficialPlatformUrl(input: string | URL): void {
  if (isOfficialPlatformUrl(input)) assertOfficialPlatformAvailable();
}

/** 出口断言：官方 URL 按功能开关放行；已下线与未登记路径（含已下线的分享）永远拒绝。 */
export function assertOfficialPlatformAccessible(input: string | URL): void {
  if (!shouldBlockOfficialPlatformUrl(input)) {
    return;
  }
  const key = resolveOfficialServiceForUrl(input);
  if (key !== null && isRemovedOfficialServiceKey(key)) {
    throw new Error(
      `“${REMOVED_OFFICIAL_SERVICE_LABELS[key]}”功能已在 ZCodium 下线，该官方平台地址不能访问。反馈请访问 ${ZCODIUM_ISSUES_URL}`,
    );
  }
  if (key) {
    throw new Error(
      `ZCodium 默认不连接官方平台，${key} 功能未开启。可在设置的“官方服务”里打开；反馈请访问 ${ZCODIUM_ISSUES_URL}`,
    );
  }
  throw new Error(`该官方平台地址在 ZCodium 已下线或未登记，不能访问。反馈请访问 ${ZCODIUM_ISSUES_URL}`);
}

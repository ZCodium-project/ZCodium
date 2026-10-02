/**
 * P1a 对外契约环境变量改名（ZCODE_ → ZCODIUM_）的兼容层。
 *
 * 名单见 docs/specs/p1a-external-env-renames.md；仅覆盖用户/CI/文档/安装器
 * 真实会设置的对外变量。进程间内部传递的其余 ~330 个 ZCODE_* 变量不在本
 * 兼容层内（P2 转独立维护时处理）。
 */

/** 读改名变量：ZCODIUM_ 新名优先，旧 ZCODE_ 名兜底（弃用兼容期）。 */
export function readExternalEnvVar(
  env: Record<string, string | undefined>,
  legacyName: string,
): string | undefined {
  const newName = (RENAMED_EXTERNAL_ENV_KEYS as Record<string, string | undefined>)[legacyName];
  if (!newName) return env[legacyName]?.trim() || undefined;
  const newValue = env[newName]?.trim();
  if (newValue) return newValue;
  const legacyValue = env[legacyName]?.trim();
  if (legacyValue) {
    emitLegacyEnvDeprecation(legacyName, newName);
    return legacyValue;
  }
  return undefined;
}

/** 新名 + 旧名双写：覆盖新旧二进制混布（如 SSH 远端旧 agent 仍读旧名）。 */
export function writeExternalEnvVar(
  env: Record<string, string | undefined>,
  legacyName: string,
  value: string | undefined,
): void {
  const newName = (RENAMED_EXTERNAL_ENV_KEYS as Record<string, string | undefined>)[legacyName];
  if (value === undefined) {
    if (newName) delete env[newName];
    delete env[legacyName];
    return;
  }
  if (newName) env[newName] = value;
  env[legacyName] = value;
}

const warnedLegacyEnvKeys = new Set<string>();

export function emitLegacyEnvDeprecation(legacyName: string, newName: string): void {
  if (warnedLegacyEnvKeys.has(legacyName)) return;
  warnedLegacyEnvKeys.add(legacyName);
  // 无统一 logger 可用的早期路径（bootstrap 前）也允许输出；进程级去重。
  console.warn(
    `[env] 环境变量 ${legacyName} 已更名为 ${newName}，旧名本版本仍兼容，请尽快迁移`,
  );
}

export const RENAMED_EXTERNAL_ENV_KEYS = {
  ZCODE_DATA_BASE_DIR: "ZCODIUM_DATA_BASE_DIR",
  ZCODE_BASE_URL: "ZCODIUM_BASE_URL",
  ZCODE_CDN_BASE_URL: "ZCODIUM_CDN_BASE_URL",
  ZCODE_DEPS_BASE_URL: "ZCODIUM_DEPS_BASE_URL",
  ZCODE_DIST_BASE_URL: "ZCODIUM_DIST_BASE_URL",
  ZCODE_REMOTE_ASSET_CDN_BASE_URL: "ZCODIUM_REMOTE_ASSET_CDN_BASE_URL",
  ZCODE_CONVERSATION_SHARE_WEB_URL: "ZCODIUM_CONVERSATION_SHARE_WEB_URL",
  ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: "ZCODIUM_BUILTIN_PROVIDER_CONFIG_FILE",
  ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: "ZCODIUM_PERSONAL_PROVIDER_CONFIG_FILE",
  ZCODE_STORAGE_DIR: "ZCODIUM_STORAGE_DIR",
  ZCODE_SERVER_WORKSPACE: "ZCODIUM_SERVER_WORKSPACE",
  ZCODE_SERVER_AUTH_TOKEN: "ZCODIUM_SERVER_AUTH_TOKEN",
  ZCODE_PROJECT_DIR: "ZCODIUM_PROJECT_DIR",
  ZCODE_DIST_HOME: "ZCODIUM_DIST_HOME",
  ZCODE_DIST_BIN_DIR: "ZCODIUM_DIST_BIN_DIR",
  ZCODE_PLUGIN_ROOT: "ZCODIUM_PLUGIN_ROOT",
  ZCODE_PLUGIN_DATA: "ZCODIUM_PLUGIN_DATA",
} as const;

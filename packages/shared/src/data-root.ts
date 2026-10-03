/**
 * ZCodium 用户级数据根（~/.zcodium）与归属文件契约。
 *
 * 与官方 ZCode 客户端的 ~/.zcode 命名空间隔离，双方互不读写。
 * 旧值 .zcode 仅供一次性迁移逻辑使用；工作区项目级 .zcode 目录
 * （项目内 skills/commands/plugins/config）属于项目命名空间，不受本常量影响。
 *
 * 归属文件 {base}/.zcodium/.zcodium-root.json 是数据根合法性的唯一依据：
 * - 存在、可解析、product 匹配、schemaVersion 支持 → 复用；
 * - 缺失 / product 不匹配 → unowned（先备份让路）；
 * - 不可解析 / schemaVersion 过新 → corrupt（不静默复用）。
 */
export const ZCODE_DATA_ROOT_DIR_NAME = ".zcodium";
export const LEGACY_ZCODE_DATA_ROOT_DIR_NAME = ".zcode";

/** 归属文件名；放在数据根目录（不放 v2/），清除数据不会重置归属。 */
export const DATA_ROOT_MANIFEST_FILE_NAME = ".zcodium-root.json";

/** 归属文件/布局格式版本。读取到更高版本时按 corrupt 处理（禁止降级读取）。 */
export const DATA_ROOT_MANIFEST_SCHEMA_VERSION = 1;

/**
 * 归属文件的产品家族标识。
 *
 * 取产品 appId 家族值（不含 Preview 渠道后缀）：Preview 与正式版共用数据根且
 * 归属互认，渠道隔离不在本期范围（见 docs/specs/zcodium-data-root.md）。
 */
export const DATA_ROOT_PRODUCT_ID = "dev.zcodium.app";

export type DataRootManifestCreatedBy = "desktop" | "cli" | "server";

export interface DataRootManifestMigration {
  /** 迁移来源的旧根绝对路径（仅用于诊断，展示时需脱敏用户主目录前缀）。 */
  from: string;
  at: string;
  mode: "copy" | "import";
}

export interface DataRootManifest {
  product: string;
  schemaVersion: number;
  createdBy: DataRootManifestCreatedBy;
  createdAt: string;
  firstSeenVersion: string;
  migration?: DataRootManifestMigration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * 解析并校验归属文件内容（纯函数，无 IO）。
 * 返回 null 表示不可解析 / 字段非法（调用方按 corrupt 处理）。
 */
export function parseDataRootManifest(raw: string): DataRootManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (!isNonEmptyString(parsed["product"])) return null;
  if (typeof parsed["schemaVersion"] !== "number" || !Number.isInteger(parsed["schemaVersion"])) {
    return null;
  }
  const createdBy = parsed["createdBy"];
  if (createdBy !== "desktop" && createdBy !== "cli" && createdBy !== "server") return null;
  if (!isNonEmptyString(parsed["createdAt"])) return null;
  if (!isNonEmptyString(parsed["firstSeenVersion"])) return null;
  const migration = parsed["migration"];
  if (migration !== undefined) {
    if (!isRecord(migration)) return null;
    if (!isNonEmptyString(migration["from"])) return null;
    if (!isNonEmptyString(migration["at"])) return null;
    if (migration["mode"] !== "copy" && migration["mode"] !== "import") return null;
  }
  return {
    product: parsed["product"],
    schemaVersion: parsed["schemaVersion"],
    createdBy,
    createdAt: parsed["createdAt"],
    firstSeenVersion: parsed["firstSeenVersion"],
    ...(isRecord(migration)
      ? {
          migration: {
            from: migration["from"] as string,
            at: migration["at"] as string,
            mode: migration["mode"] as "copy" | "import",
          },
        }
      : {}),
  };
}

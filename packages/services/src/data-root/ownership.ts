/**
 * 数据根归属文件（{base}/.zcodium/.zcodium-root.json）读写与冲突目录备份。
 *
 * 分层规则：本文件是唯一允许直接读写归属文件的位置；其它模块通过
 * initializer 暴露的接口获取状态，不得自行解析归属文件。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATA_ROOT_MANIFEST_FILE_NAME,
  DATA_ROOT_MANIFEST_SCHEMA_VERSION,
  DATA_ROOT_PRODUCT_ID,
  ZCODE_DATA_ROOT_DIR_NAME,
  parseDataRootManifest,
  type DataRootManifest,
} from "@zcode/shared";
import type { DataRootStatus } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 数据根目录绝对路径（{base}/.zcodium）。 */
export function resolveDataRootDir(baseDir: string): string {
  return join(baseDir, ZCODE_DATA_ROOT_DIR_NAME);
}

/**
 * 判定 base 下数据根的合法性。
 *
 * - normal：归属文件存在、可解析、product 匹配、schemaVersion 支持；
 * - absent：数据根目录不存在；
 * - corrupt：归属文件不可解析，或 schemaVersion 高于当前支持（禁止降级读取）；
 * - unowned：无归属文件，或 product 不匹配（其它产品/分支遗留）。
 */
export function readDataRootStatus(baseDir: string): DataRootStatus {
  const rootDir = resolveDataRootDir(baseDir);
  if (!existsSync(rootDir)) {
    return { kind: "absent" };
  }
  const manifestPath = join(rootDir, DATA_ROOT_MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    return { kind: "unowned", reason: "manifest-missing", rootDir };
  }
  let raw: string;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch {
    return { kind: "corrupt", reason: "manifest-unreadable", rootDir };
  }
  const manifest = parseDataRootManifest(raw);
  if (!manifest) {
    return { kind: "corrupt", reason: "manifest-unreadable", rootDir };
  }
  if (manifest.schemaVersion > DATA_ROOT_MANIFEST_SCHEMA_VERSION) {
    return { kind: "corrupt", reason: "schema-unsupported", rootDir };
  }
  if (manifest.product !== DATA_ROOT_PRODUCT_ID) {
    return { kind: "unowned", reason: "product-mismatch", rootDir };
  }
  return { kind: "normal", manifest };
}

/**
 * 原子写归属文件到指定数据根目录（rootDir）。
 * 迁移时先把归属写进 staging 目录，随 rename 一起落位，避免出现无归属的合法根。
 */
export function writeDataRootManifestIntoRoot(rootDir: string, manifest: DataRootManifest): string {
  mkdirSync(rootDir, { recursive: true });
  const manifestPath = join(rootDir, DATA_ROOT_MANIFEST_FILE_NAME);
  const tmpPath = `${manifestPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    renameSync(tmpPath, manifestPath);
  } finally {
    rmSync(tmpPath, { force: true });
  }
  return manifestPath;
}

/**
 * 原子写归属文件到 {base}/.zcodium；归属文件已存在时覆盖（升级/导入场景由调用方决定语义）。
 */
export function writeDataRootManifest(baseDir: string, manifest: DataRootManifest): string {
  return writeDataRootManifestIntoRoot(resolveDataRootDir(baseDir), manifest);
}

/** 生成备份目录名后缀：yyyyMMdd-HHmmss（Windows 文件名安全，不含冒号）。 */
function formatBackupTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

/**
 * 把 {base}/.zcodium 整体备份为 {base}/.zcodium.<label>-<ts>，不删除、不合并。
 * 返回备份落点；目录不存在返回 null。
 */
export function forfeitDataRootByLabel(baseDir: string, label: string): string | null {
  const rootDir = join(baseDir, ZCODE_DATA_ROOT_DIR_NAME);
  if (!existsSync(rootDir)) return null;
  const stamp = formatBackupTimestamp(new Date());
  let target = join(baseDir, `${ZCODE_DATA_ROOT_DIR_NAME}.${label}-${stamp}`);
  let attempt = 1;
  while (existsSync(target)) {
    target = join(baseDir, `${ZCODE_DATA_ROOT_DIR_NAME}.${label}-${stamp}-${attempt}`);
    attempt += 1;
    if (attempt > 100) {
      throw new Error(`无法为冲突数据根生成唯一备份目录: ${rootDir}`);
    }
  }
  renameSync(rootDir, target);
  return target;
}

/**
 * unowned/corrupt 冲突目录整体备份让路：重命名为 .zcodium.unowned-<ts> /
 * .zcodium.corrupt-<ts>，不删除、不合并。返回备份落点；目录不存在返回 null。
 */
export function forfeitConflictingDataRoot(
  baseDir: string,
  status: Extract<DataRootStatus, { kind: "unowned" | "corrupt" }>,
): string | null {
  const kindLabel = status.kind === "corrupt" ? "corrupt" : "unowned";
  return forfeitDataRootByLabel(baseDir, kindLabel);
}

/** 读取旧 setting.json 里的 dataBaseDir（仅用于发现附加迁移源，不应用）。 */
export function readLegacyDataBaseDirFromSettings(legacyRoot: string): string | null {
  const settingsPath = join(legacyRoot, "v2", "setting.json");
  if (!existsSync(settingsPath)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(settingsPath, "utf8"));
    if (!isRecord(parsed)) return null;
    const value = parsed["dataBaseDir"];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  } catch {
    return null;
  }
}

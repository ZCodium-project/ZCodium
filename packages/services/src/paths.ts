/* path 规则集中维护：旧 task 快照与 provider 配置路径仍在这里收口。 */
import { lstatSync } from "node:fs";
import { readExternalEnvVar } from "@zcode/shared";
import { cpSync, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, win32 } from "node:path";
import { homedir } from "node:os";
import {
  DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
  LEGACY_MIGRATION_MARKER_FILE,
  LEGACY_ZCODE_DATA_ROOT_DIR_NAME,
  ZCODE_DATA_ROOT_DIR_NAME,
} from "@zcode/shared";

let _dataBaseDir: string | null = null;
export const ZCODE_WINDOWS_APP_INSTALL_DIR_ENV = "ZCODE_WINDOWS_APP_INSTALL_DIR";
const envDataBaseDir = readExternalEnvVar(process.env, "ZCODE_DATA_BASE_DIR") ?? null;
const defaultDataBaseDir = process.env.HOME?.trim() || homedir();

/**
 * 显式注入的 ZCODE_DATA_BASE_DIR 是 dev test / e2e 的数据目录隔离硬边界：
 * 一旦生效，设置文件里发现的自定义 dataBaseDir（来自真实 HOME）不得再把
 * 运行时拉回真实数据目录，否则隔离实例会读写开发者的真实凭据与配置。
 */
export function isDataBaseDirEnvOverrideActive(): boolean {
  return envDataBaseDir !== null;
}

interface DataBaseDirTargetValidationOptions {
  platform?: NodeJS.Platform | string;
  env?: Record<string, string | undefined>;
  appInstallDir?: string | null;
}

type DataBaseDirTargetValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: typeof DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE;
      forbiddenDir: string;
    };

/** Set the base directory for app data (replaces homedir() prefix). */
export function setDataBaseDir(dir: string | null): void {
  // 环境变量生效时本函数是 no-op：隔离运行不得被设置文件 bootstrap 或设置页改写目录。
  if (isDataBaseDirEnvOverrideActive()) return;
  _dataBaseDir = dir?.trim() || null;
}

/** Get the current base directory. Priority: env ZCODE_DATA_BASE_DIR > setDataBaseDir() > homedir(). */
export function getDataBaseDir(): string {
  if (_dataBaseDir) return _dataBaseDir;
  if (envDataBaseDir) return envDataBaseDir;
  // 服务实例会启动后台刷新任务；若每次调用都动态读取 HOME，
  // 测试或宿主切换环境变量后，旧实例可能把数据写到新实例目录。
  return defaultDataBaseDir;
}

/** {dataBaseDir}/.zcodium —— 与官方 ZCode 客户端的 ~/.zcode 命名空间隔离。 */
export function getZCodeDataRootDir(): string {
  return join(getDataBaseDir(), ZCODE_DATA_ROOT_DIR_NAME);
}

/** 非项目对话共享的真实工作目录；默认 ~/.zcodium/workspace/default。 */
export function getConversationWorkspaceDir(): string {
  return join(getZCodeDataRootDir(), "workspace", "default");
}

/** {dataBaseDir}/.zcodium/v2 */
export function getAppConfigDir(): string {
  return join(getZCodeDataRootDir(), "v2");
}

/**
 * 把旧数据根 {base}/.zcode 一次性复制到 {base}/.zcodium。
 *
 * - 复制而非移动：官方 ZCode 客户端可能仍在使用旧根，不能使其中断；
 * - 旧根写入 .migrated-to-zcodium 标记，用户删除新根视为重置，不重复灌入；
 * - 经同卷临时目录 + rename 原子落位，并发启动时后到方发现目标已存在即退出；
 * - 任何失败不阻断启动，无标记时下次启动自动重试。
 */
export function migrateLegacyZCodeDataRoot(): void {
  const baseDir = getDataBaseDir();
  const legacyRoot = join(baseDir, LEGACY_ZCODE_DATA_ROOT_DIR_NAME);
  const nextRoot = getZCodeDataRootDir();
  try {
    if (nextRoot === legacyRoot) return;
    if (existsSync(nextRoot)) return;
    if (!existsSync(legacyRoot)) return;
    if (existsSync(join(legacyRoot, LEGACY_MIGRATION_MARKER_FILE))) return;
    const stagingRoot = join(baseDir, `${ZCODE_DATA_ROOT_DIR_NAME}.migrating-${process.pid}`);
    try {
      rmSync(stagingRoot, { recursive: true, force: true });
      cpSync(legacyRoot, stagingRoot, { recursive: true });
      try {
        renameSync(stagingRoot, nextRoot);
      } catch {
        // 并发进程可能已完成迁移；目标存在即视为成功，否则向调用方暴露真实错误。
        if (!existsSync(nextRoot)) throw new Error("迁移数据根时目标目录创建失败");
      }
      writeFileSync(join(legacyRoot, LEGACY_MIGRATION_MARKER_FILE), new Date().toISOString());
    } finally {
      rmSync(stagingRoot, { recursive: true, force: true });
    }
  } catch (error) {
    // 早期 bootstrap 阶段尚无 service logger；失败不阻断启动，且未写标记、下次启动重试。
    console.error("[paths] 迁移旧数据根 ~/.zcode → ~/.zcodium 失败，将继续使用新根:", error);
  }
}

function readEnvValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const direct = env[key]?.trim();
  if (direct) {
    return direct;
  }

  const lowerKey = key.toLowerCase();
  for (const [candidateKey, value] of Object.entries(env)) {
    if (candidateKey.toLowerCase() !== lowerKey) {
      continue;
    }
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return undefined;
}

function normalizeWindowsComparablePath(pathValue: string): string | null {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = win32.normalize(trimmed).replace(/[\\/]+$/, "");
  if (!normalized) {
    return null;
  }

  return win32
    .resolve(normalized)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

function isWindowsPathEqualOrInside(pathValue: string, rootValue: string): boolean {
  const normalizedPath = normalizeWindowsComparablePath(pathValue);
  const normalizedRoot = normalizeWindowsComparablePath(rootValue);
  if (!normalizedPath || !normalizedRoot) {
    return false;
  }

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

function collectWindowsForbiddenAppInstallDirs(
  options: Required<Pick<DataBaseDirTargetValidationOptions, "env">> &
    Pick<DataBaseDirTargetValidationOptions, "appInstallDir">,
): string[] {
  const env = options.env;
  const programFiles = readEnvValue(env, "ProgramFiles");
  const programFilesX86 = readEnvValue(env, "ProgramFiles(x86)");
  const programW6432 = readEnvValue(env, "ProgramW6432");
  const localAppData = readEnvValue(env, "LOCALAPPDATA");
  const candidates = [
    options.appInstallDir,
    readEnvValue(env, ZCODE_WINDOWS_APP_INSTALL_DIR_ENV),
    programFiles ? win32.join(programFiles, "ZCode") : null,
    programFilesX86 ? win32.join(programFilesX86, "ZCode") : null,
    programW6432 ? win32.join(programW6432, "ZCode") : null,
    localAppData ? win32.join(localAppData, "Programs", "ZCode") : null,
  ];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized =
      typeof candidate === "string" ? normalizeWindowsComparablePath(candidate) : null;
    if (!candidate || !normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(candidate);
  }

  return result;
}

export function validateDataBaseDirTarget(
  targetBaseDir: string,
  options: DataBaseDirTargetValidationOptions = {},
): DataBaseDirTargetValidationResult {
  if ((options.platform ?? process.platform) !== "win32") {
    return { ok: true };
  }

  for (const forbiddenDir of collectWindowsForbiddenAppInstallDirs({
    env: options.env ?? process.env,
    appInstallDir: options.appInstallDir ?? null,
  })) {
    if (isWindowsPathEqualOrInside(targetBaseDir, forbiddenDir)) {
      return {
        ok: false,
        code: DATA_BASE_DIR_FORBIDDEN_WINDOWS_INSTALL_DIR_ERROR_CODE,
        forbiddenDir,
      };
    }
  }

  return { ok: true };
}

export function getExportLogStageDir(): string {
  return join(getZCodeDataRootDir(), "export-log-stage");
}

export function getExportLogDir(): string {
  return join(getZCodeDataRootDir(), "export-log");
}

export function getFeedbackRootDir(): string {
  return join(getZCodeDataRootDir(), "feedback");
}

export function getFeedbackAttachmentDir(): string {
  return join(getFeedbackRootDir(), "attachments");
}

export function getFeedbackLogArchiveDir(): string {
  return join(getFeedbackRootDir(), "logs");
}

export function getGitCheckpointIndexRootDir(): string {
  return join(getZCodeDataRootDir(), "git-checkpoint-index");
}

/** ~/.zcodium/v2/tasks-index.sqlite */
export function getTasksIndexDatabasePath(): string {
  return join(getAppConfigDir(), "tasks-index.sqlite");
}

/** workspace 级身份键：远程优先使用 workspaceIdentity，本地回退 workspacePath。 */
function getWorkspaceKey(workspacePath: string, workspaceIdentity?: string): string {
  return workspaceIdentity?.trim() || workspacePath;
}

/** 与 ZCode session 持久化一致：使用 workspaceKey 的 SHA-256 前 12 位 */
export function getWorkspaceHash(workspacePath: string, workspaceIdentity?: string): string {
  return createHash("sha256")
    .update(getWorkspaceKey(workspacePath, workspaceIdentity))
    .digest("hex")
    .slice(0, 12);
}

/** ~/.zcodium/v2/sessions/{workspaceHash} */
function getTaskSessionDir(workspacePath: string, workspaceIdentity?: string): string {
  return join(getAppConfigDir(), "sessions", getWorkspaceHash(workspacePath, workspaceIdentity));
}

/** ~/.zcodium/v2/sessions/{workspaceHash}/{taskId}.json */
export function getLegacyTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.json`);
}

/** ~/.zcodium/v2/sessions/{workspaceHash}/{taskId}.deleted.json */
export function getLegacyDeletedTaskSessionSnapshotPath(
  workspacePath: string,
  taskId: string,
  workspaceIdentity?: string,
): string {
  return join(getTaskSessionDir(workspacePath, workspaceIdentity), `${taskId}.deleted.json`);
}

/**
 * Copy the .zcode/v2 data directory from one base dir to another.
 * Excludes setting.json and its transient atomic-write siblings — bootstrap
 * state must only live at the default homedir location.
 */
export async function copyDataDirectory(oldBaseDir: string, newBaseDir: string): Promise<void> {
  const oldDir = join(oldBaseDir, ZCODE_DATA_ROOT_DIR_NAME, "v2");
  const newDir = join(newBaseDir, ZCODE_DATA_ROOT_DIR_NAME, "v2");
  await cp(oldDir, newDir, {
    recursive: true,
    force: false,
    filter: (source) => {
      const sourceName = basename(source);
      if (sourceName === "setting.json" || sourceName.startsWith("setting.json.")) {
        // setting.json.lock 和 setting.json.*.tmp 由原子写入短暂创建/删除，
        // 复制过程中扫描到已消失的 lock 会触发 ENOENT，并让数据目录迁移失败。
        // 这些文件都属于 bootstrap 写入中间态，不能迁移到新数据根。
        return false;
      }
      // Windows 非提权环境下 fs.cp 无法复制符号链接（EPERM）。
      // 跳过符号链接可避免 Windows 非提权环境下 fs.cp 报 EPERM。
      try {
        if (lstatSync(source).isSymbolicLink()) return false;
      } catch {
        // lstat 失败时放行，让 cp 自行处理
      }
      return true;
    },
  });
}

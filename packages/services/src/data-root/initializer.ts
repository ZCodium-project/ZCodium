/**
 * 数据根初始化器：唯一负责合法性判定、归属文件落盘、冲突备份与迁移编排。
 *
 * 规则（详见 docs/specs/zcodium-data-root.md）：
 * - 归属文件落盘前，正式根零写入：pending 时所有数据根路径重定向到进程诊断根；
 * - 桌面交互：absent+旧根 / unowned / corrupt → pending，由决策窗口处置；
 * - CLI / server：非交互，按 ZCODIUM_DATA_ROOT_ACTION（fresh|migrate|fail）处置；
 * - 冲突目录整体备份让路，不删除、不合并。
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATA_ROOT_MANIFEST_SCHEMA_VERSION,
  DATA_ROOT_PRODUCT_ID,
  type DataRootManifest,
  type DataRootManifestCreatedBy,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import { getDataBaseDir, setDataRootPathOverride } from "../paths.js";
import {
  discoverLegacyDataRootCandidates,
  executeDataRootCopyMigration,
  cleanupStaleMigrationStaging,
} from "./migration.js";
import { forfeitConflictingDataRoot, forfeitDataRootByLabel, readDataRootStatus, writeDataRootManifest } from "./ownership.js";
import type {
  DataRootInitResult,
  DataRootMigrationProgress,
  DataRootNonInteractiveAction,
  LegacyDataRootCandidate,
} from "./types.js";

const log = createServiceLogger("data-root");

/** 诊断根超过该年龄后清理（上次进程可能被强杀）。 */
const DIAGNOSTIC_ROOT_TTL_MS = 24 * 60 * 60 * 1000;

let activeDiagnosticRoot: string | null = null;

/** 当前进程的 pending 诊断根（决策前所有正式根写入的重定向目标）。 */
export function getActiveDiagnosticRoot(): string | null {
  return activeDiagnosticRoot;
}

function cleanupStaleDiagnosticRoots(): void {
  const parent = join(tmpdir(), "zcodium-startup");
  try {
    const now = Date.now();
    for (const name of readdirSync(parent)) {
      const entryPath = join(parent, name);
      try {
        const entryStat = statSync(entryPath);
        if (now - entryStat.mtimeMs > DIAGNOSTIC_ROOT_TTL_MS) {
          rmSync(entryPath, { recursive: true, force: true });
        }
      } catch {
        // 单条目清理失败不阻断。
      }
    }
  } catch {
    // 目录不存在或不可读时无需清理。
  }
}

/**
 * 进入 pending：创建/复用诊断根并把数据根解析重定向过去，保证归属文件落盘前
 * 任何模块都写不到正式根。
 */
function enterPendingDiagnosticMode(): string {
  if (!activeDiagnosticRoot) {
    cleanupStaleDiagnosticRoots();
    const root = join(tmpdir(), "zcodium-startup", String(process.pid));
    mkdirSync(root, { recursive: true });
    activeDiagnosticRoot = root;
  }
  setDataRootPathOverride(activeDiagnosticRoot);
  return activeDiagnosticRoot;
}

/** 退出 pending：恢复正常数据根解析（fresh 初始化完成或进程即将 relaunch）。 */
export function releasePendingDiagnosticMode(): void {
  if (!activeDiagnosticRoot) return;
  activeDiagnosticRoot = null;
  setDataRootPathOverride(null);
}

export interface InitializeDataRootInput {
  baseDir?: string;
  createdBy: DataRootManifestCreatedBy;
  appVersion: string;
}

function buildManifest(input: {
  createdBy: DataRootManifestCreatedBy;
  appVersion: string;
  migration?: DataRootManifest["migration"];
}): DataRootManifest {
  return {
    product: DATA_ROOT_PRODUCT_ID,
    schemaVersion: DATA_ROOT_MANIFEST_SCHEMA_VERSION,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    firstSeenVersion: input.appVersion,
    ...(input.migration ? { migration: input.migration } : {}),
  };
}

/**
 * 全新初始化：必要时先备份冲突目录，再写归属文件。
 * 返回备份落点（未发生冲突时为 undefined）。
 */
export function initializeFreshDataRoot(input: InitializeDataRootInput): {
  baseDir: string;
  manifestPath: string;
  forfeitedRoot?: string;
} {
  const baseDir = input.baseDir ?? getDataBaseDir();
  const status = readDataRootStatus(baseDir);
  let forfeitedRoot: string | undefined;
  if (status.kind === "unowned" || status.kind === "corrupt") {
    forfeitedRoot = forfeitConflictingDataRoot(baseDir, status) ?? undefined;
  }
  const manifestPath = writeDataRootManifest(baseDir, buildManifest(input));
  return { baseDir, manifestPath, ...(forfeitedRoot ? { forfeitedRoot } : {}) };
}

/**
 * 桌面交互初始化判定（同步，模块加载期调用）：
 * - normal → ready；
 * - absent 且无旧根 → 直接初始化（initialized）；
 * - absent+有旧根 / unowned / corrupt → pending（进入诊断模式，等决策窗口）。
 */
export function initializeDataRootInteractive(
  input: InitializeDataRootInput,
): Extract<DataRootInitResult, { state: "ready" | "initialized" | "pending" }> {
  const baseDir = input.baseDir ?? getDataBaseDir();
  cleanupStaleMigrationStaging(baseDir);
  const status = readDataRootStatus(baseDir);
  if (status.kind === "normal") {
    releasePendingDiagnosticMode();
    return { state: "ready", baseDir, status };
  }
  if (status.kind === "absent") {
    const candidates = discoverLegacyDataRootCandidates(baseDir);
    if (candidates.length === 0) {
      const { forfeitedRoot } = initializeFreshDataRoot({ ...input, baseDir });
      releasePendingDiagnosticMode();
      return {
        state: "initialized",
        baseDir,
        initializedBy: "fresh",
        ...(forfeitedRoot ? { forfeitedRoot } : {}),
      };
    }
    enterPendingDiagnosticMode();
    return { state: "pending", baseDir, status };
  }
  // unowned / corrupt：不静默复用，进入决策。
  enterPendingDiagnosticMode();
  return { state: "pending", baseDir, status };
}

export interface InitializeDataRootNonInteractiveInput extends InitializeDataRootInput {
  action?: DataRootNonInteractiveAction;
}

/**
 * 非交互入口策略：ZCODIUM_DATA_ROOT_ACTION=migrate|fresh|fail，缺省 fresh。
 * 非法值回退 fresh 并记录日志（不因环境变量拼写阻塞启动）。
 */
export function resolveDataRootActionFromEnv(
  env: Record<string, string | undefined> = process.env,
): DataRootNonInteractiveAction {
  const raw = env["ZCODIUM_DATA_ROOT_ACTION"]?.trim().toLowerCase();
  if (raw === "migrate" || raw === "fail" || raw === "fresh") return raw;
  if (raw) {
    log.warn(undefined, `未知 ZCODIUM_DATA_ROOT_ACTION=${raw}，按 fresh 处理`);
  }
  return "fresh";
}

/**
 * 非交互初始化（CLI / server / 远端）：
 * - normal → ready；
 * - absent / unowned / corrupt → 按 action：
 *   fresh（默认）：备份让路 + 全新初始化；
 *   migrate：复制旧根（unowned/corrupt 先备份让路）；无候选时回退 fresh；
 *   fail：抛出错误，不写任何状态。
 */
export async function initializeDataRootNonInteractive(
  input: InitializeDataRootNonInteractiveInput,
): Promise<Extract<DataRootInitResult, { state: "ready" | "initialized" }>> {
  const baseDir = input.baseDir ?? getDataBaseDir();
  const action = input.action ?? "fresh";
  cleanupStaleMigrationStaging(baseDir);

  const status = readDataRootStatus(baseDir);
  if (status.kind === "normal") {
    releasePendingDiagnosticMode();
    return { state: "ready", baseDir, status };
  }

  const candidates = discoverLegacyDataRootCandidates(baseDir);
  if (action === "fail") {
    throw new Error(
      `数据根 ${baseDir} 状态异常（${status.kind}），ZCODIUM_DATA_ROOT_ACTION=fail 下拒绝启动`,
    );
  }

  if (action === "migrate" && candidates.length > 0) {
    const result = await executeDataRootCopyMigration({
      candidates,
      createdBy: input.createdBy,
      appVersion: input.appVersion,
      mode: "copy",
    });
    if (!result.ok) {
      throw new Error(`旧数据迁移失败: ${result.error}`);
    }
    const migratedStatus = readDataRootStatus(baseDir);
    if (migratedStatus.kind !== "normal") {
      throw new Error(`迁移完成但数据根未合法化: ${baseDir}`);
    }
    releasePendingDiagnosticMode();
    return { state: "initialized", baseDir, initializedBy: "migration" };
  }

  const { forfeitedRoot } = initializeFreshDataRoot({ ...input, baseDir });
  releasePendingDiagnosticMode();
  return {
    state: "initialized",
    baseDir,
    initializedBy: "fresh",
    ...(forfeitedRoot ? { forfeitedRoot } : {}),
  };
}

export interface ExecuteDesktopMigrationInput {
  baseDir: string;
  candidates: readonly LegacyDataRootCandidate[];
  createdBy: DataRootManifestCreatedBy;
  appVersion: string;
  onProgress?: (progress: DataRootMigrationProgress) => void;
  isCancelled?: () => boolean;
}

/** 决策窗口确认迁移：执行复制；结果由调用方决定 relaunch 或展示错误。 */
export async function executeDesktopDataRootMigration(input: ExecuteDesktopMigrationInput) {
  return executeDataRootCopyMigration({
    candidates: input.candidates,
    createdBy: input.createdBy,
    appVersion: input.appVersion,
    mode: "copy",
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    ...(input.isCancelled ? { isCancelled: input.isCancelled } : {}),
  });
}

/** 决策窗口确认全新开始：备份冲突目录 + 全新初始化。 */
export function executeDesktopFreshStart(input: InitializeDataRootInput) {
  return initializeFreshDataRoot(input);
}

/**
 * 设置页再次导入：先备份现有根（整体改名 .zcodium.import-<ts>），
 * 再把旧根复制为新根（mode=import）。备份保留供回退。
 */
export async function executeDataRootImport(
  input: ExecuteDesktopMigrationInput,
): Promise<
  | { ok: true; backupRoot: string | null; migratedBases: string[] }
  | { ok: false; error: string; cancelled: boolean }
> {
  const baseDir = input.baseDir;
  let backupRoot: string | null = null;
  try {
    backupRoot = forfeitDataRootByLabel(baseDir, "import");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      cancelled: false,
    };
  }
  const result = await executeDataRootCopyMigration({
    candidates: input.candidates,
    createdBy: input.createdBy,
    appVersion: input.appVersion,
    mode: "import",
    ...(input.onProgress ? { onProgress: input.onProgress } : {}),
    ...(input.isCancelled ? { isCancelled: input.isCancelled } : {}),
  });
  if (!result.ok) {
    return { ok: false, error: result.error, cancelled: result.cancelled };
  }
  return { ok: true, backupRoot, migratedBases: result.migratedBases };
}

/** 测试用：重置诊断模式与模块级状态。 */
export function resetDataRootInitializerForTest(): void {
  releasePendingDiagnosticMode();
  activeDiagnosticRoot = null;
}

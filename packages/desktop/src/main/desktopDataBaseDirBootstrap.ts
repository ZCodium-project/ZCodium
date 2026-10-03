import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  initializeDataRootInteractive,
  initializeFreshDataRoot,
  isDataBaseDirEnvOverrideActive,
  releasePendingDiagnosticMode,
  setDataBaseDir,
  type DataRootStatus,
} from "@zcode/services/node";
import { ZCODE_VERSION } from "@zcode/shared";

type DataRootPendingStatus = Extract<DataRootStatus, { kind: "absent" | "unowned" | "corrupt" }>;

/**
 * 桌面启动的数据根判定结果：
 * - ready：数据根合法，正常启动；
 * - initialized：已完成全新初始化（无决策需求）；
 * - pending：需要决策窗口（冲突目录 / 存在旧根），主窗口与 Host 必须延后。
 */
export type DesktopDataRootStartupResult =
  | { state: "ready"; baseDir: string }
  | { state: "initialized"; baseDir: string; forfeitedRoot?: string }
  | { state: "pending"; baseDir: string; status: DataRootPendingStatus };

function resolveBootstrapSettingsFile(homePath: string = homedir()): string {
  return join(homePath, ".zcodium", "v2", "setting.json");
}

function extractBootstrapDataBaseDir(rawValue: unknown): string | null {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const dataBaseDir = (rawValue as { dataBaseDir?: unknown }).dataBaseDir;
  if (typeof dataBaseDir !== "string") {
    return null;
  }

  const trimmed = dataBaseDir.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBootstrapDataBaseDirFromDisk(
  settingsFile: string = resolveBootstrapSettingsFile(),
): string | null {
  if (!existsSync(settingsFile)) {
    return null;
  }

  try {
    const raw = readFileSync(settingsFile, "utf-8");
    return extractBootstrapDataBaseDir(JSON.parse(raw));
  } catch {
    return null;
  }
}

function isAutomatedTestRun(): boolean {
  return process.env["ZCODE_ENV"]?.trim().toLowerCase() === "test";
}

/**
 * E2E/dev 无人值守：pending 时不做决策窗口，直接备份让路 + 全新初始化。
 * 隔离 base 正常情况下不会有旧根；此处兜底避免测试卡在决策窗口。
 */
function settlePendingForAutomatedTest(
  baseDir: string,
): Extract<DesktopDataRootStartupResult, { state: "initialized" }> {
  const { forfeitedRoot } = initializeFreshDataRoot({
    createdBy: "desktop",
    appVersion: ZCODE_VERSION,
    baseDir,
  });
  releasePendingDiagnosticMode();
  return {
    state: "initialized",
    baseDir,
    ...(forfeitedRoot ? { forfeitedRoot } : {}),
  };
}

/**
 * 启动早期数据根判定（模块加载期同步执行，先于 logger / 窗口 / Host）：
 *
 * 1. 对默认 base（HOME，尊重 ZCODE_DATA_BASE_DIR）完成合法性判定或初始化；
 * 2. normal 且设置里有自定义 dataBaseDir 时，切换到该 base 再判定一次；
 * 3. 任一环节 pending → 进入诊断模式，由 index.ts 打开决策窗口并推迟主窗口/Host。
 *
 * 归属文件落盘前正式根零写入：pending 时 initializeDataRootInteractive 已把数据根
 * 解析重定向到进程诊断根，logger 等早期模块即使执行也写不到正式根。
 */
export function applyEarlyDataBaseDirBootstrap(): DesktopDataRootStartupResult {
  const homeResult = initializeDataRootInteractive({
    createdBy: "desktop",
    appVersion: ZCODE_VERSION,
  });
  if (homeResult.state === "pending") {
    return isAutomatedTestRun()
      ? settlePendingForAutomatedTest(homeResult.baseDir)
      : {
          state: "pending",
          baseDir: homeResult.baseDir,
          status: homeResult.status,
        };
  }

  // ZCODE_DATA_BASE_DIR 显式注入时是隔离硬边界：真实 HOME 的 setting.json 里若带
  // dataBaseDir 会把隔离实例拉回真实数据目录（曾把 dev 实例写进开发者真实凭据），直接跳过。
  if (isDataBaseDirEnvOverrideActive()) {
    return homeResult.state === "ready"
      ? { state: "ready", baseDir: homeResult.baseDir }
      : { state: "initialized", baseDir: homeResult.baseDir };
  }

  const dataBaseDir = readBootstrapDataBaseDirFromDisk();
  if (!dataBaseDir) {
    return homeResult.state === "ready"
      ? { state: "ready", baseDir: homeResult.baseDir }
      : { state: "initialized", baseDir: homeResult.baseDir };
  }

  // 启动早期就把 dataBaseDir 注入进来，避免 logger / crashReporter 先按默认 HOME 建目录。
  setDataBaseDir(dataBaseDir);
  const customResult = initializeDataRootInteractive({
    createdBy: "desktop",
    appVersion: ZCODE_VERSION,
  });
  if (customResult.state === "pending") {
    return isAutomatedTestRun()
      ? settlePendingForAutomatedTest(customResult.baseDir)
      : {
          state: "pending",
          baseDir: customResult.baseDir,
          status: customResult.status,
        };
  }
  return customResult.state === "ready"
    ? { state: "ready", baseDir: customResult.baseDir }
    : { state: "initialized", baseDir: customResult.baseDir };
}

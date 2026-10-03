/**
 * 数据根决策/导入流程编排。
 *
 * - startup：启动决策（主窗口与 Host 之前运行），出口为迁移/全新/退出；
 * - import：设置页“从旧数据目录再次导入”，出口为导入/取消（不退出应用）；
 * - 两种模式复用同一决策窗口、preload 与 IPC 通道；所有文件操作都在 main 完成。
 */
import { app, ipcMain } from "electron";
import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import {
  DataRootDecisionChannels,
  ZCODE_VERSION,
  type DataRootDecisionAction,
  type DataRootDecisionCandidate,
  type DataRootDecisionResult,
  type DataRootDecisionState,
  type DataRootDecisionStatus,
  type Locale,
} from "@zcode/shared";
import {
  collectLegacyCandidateStats,
  discoverLegacyDataRootCandidates,
  executeDataRootImport,
  executeDesktopDataRootMigration,
  executeDesktopFreshStart,
  getDataBaseDir,
  readDataRootStatus,
  type DataRootMigrationProgress,
  type DataRootStatus,
  type LegacyDataRootCandidate,
} from "@zcode/services/node";
import { resolveSystemApplicationLocale } from "./desktopApplicationMenu.js";
import { logger } from "./logger.js";
import {
  createDataRootDecisionWindow,
  getDataRootDecisionWindow,
} from "./desktopDataRootDecisionWindow.js";

type PendingStatus = Extract<DataRootStatus, { kind: "absent" | "unowned" | "corrupt" }>;

export interface DataRootDecisionFlowInput {
  baseDir: string;
  status: PendingStatus;
  locale: Locale;
}

interface Session {
  mode: "startup" | "import";
  baseDir: string;
  locale: Locale;
  status: PendingStatus;
  candidates: LegacyDataRootCandidate[];
  state: DataRootDecisionState;
  deciding: boolean;
}

const LOG_SCOPE = "[data-root-decision]";

function toDisplayPath(path: string): string {
  const home = homedir();
  if (path === home) return "~";
  if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function toDecisionStatus(status: PendingStatus, baseDir: string): DataRootDecisionStatus {
  if (status.kind === "absent") {
    return { kind: "absent-with-legacy", baseDir: toDisplayPath(baseDir) };
  }
  return {
    kind: status.kind,
    reason: status.reason,
    baseDir: toDisplayPath(baseDir),
    conflictingRoot: toDisplayPath(status.rootDir),
  };
}

function buildState(session: {
  mode: Session["mode"];
  baseDir: string;
  status: PendingStatus;
  locale: Locale;
  candidates: readonly LegacyDataRootCandidate[];
  stats?: ReadonlyMap<string, { sizeBytes: number; modifiedAt: string | null }>;
  diskFreeBytes?: number | null;
}): DataRootDecisionState {
  const decisionCandidates: DataRootDecisionCandidate[] = session.candidates.map((candidate) => {
    const stats = session.stats?.get(candidate.legacyRoot);
    return {
      baseDir: toDisplayPath(candidate.baseDir),
      legacyRoot: toDisplayPath(candidate.legacyRoot),
      sizeBytes: stats?.sizeBytes ?? null,
      modifiedAt: stats?.modifiedAt ?? null,
      isPrimaryBase: candidate.isPrimaryBase,
    };
  });
  const requiredBytes = session.stats
    ? [...session.stats.values()].reduce((total, stats) => total + stats.sizeBytes, 0)
    : null;
  return {
    mode: session.mode,
    status: toDecisionStatus(session.status, session.baseDir),
    candidates: decisionCandidates,
    diskFreeBytes: session.diskFreeBytes ?? null,
    requiredBytes,
    locale: session.locale,
  };
}

function pushState(session: Session): void {
  const window = getDataRootDecisionWindow();
  if (window) {
    window.webContents.send(DataRootDecisionChannels.StateChanged, session.state);
  }
}

function scheduleRelaunch(): void {
  // 留出 IPC 返回与 UI 反馈时间，然后重启进入正常启动流程。
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 300);
}

function unregisterDecisionHandlers(): void {
  ipcMain.removeHandler(DataRootDecisionChannels.GetState);
  ipcMain.removeHandler(DataRootDecisionChannels.Decide);
}

async function handleAction(
  session: Session,
  action: DataRootDecisionAction,
): Promise<DataRootDecisionResult> {
  if (session.deciding) {
    return { ok: false, error: "已有操作正在进行" };
  }
  if (action === "quit") {
    if (session.mode === "startup") {
      app.quit();
    } else {
      // 导入模式的“取消”：只关闭窗口，应用继续运行。
      getDataRootDecisionWindow()?.close();
    }
    return { ok: true, action: "quit" };
  }
  if (action === "fresh" && session.mode === "import") {
    return { ok: false, error: "导入模式不支持全新开始" };
  }
  session.deciding = true;
  try {
    if (action === "fresh") {
      const result = executeDesktopFreshStart({
        baseDir: session.baseDir,
        createdBy: "desktop",
        appVersion: ZCODE_VERSION,
      });
      logger.info(`${LOG_SCOPE} fresh start completed`, result.forfeitedRoot ?? "");
      scheduleRelaunch();
      return { ok: true, action: "fresh" };
    }
    if (action === "migrate") {
      if (session.candidates.length === 0) {
        session.deciding = false;
        return {
          ok: false,
          error: session.mode === "import" ? "没有可导入的旧数据目录" : "没有可迁移的旧数据目录",
        };
      }
      const onProgress = (progress: DataRootMigrationProgress): void => {
        const window = getDataRootDecisionWindow();
        if (window) {
          window.webContents.send(DataRootDecisionChannels.Progress, progress);
        }
      };
      if (session.mode === "import") {
        const result = await executeDataRootImport({
          baseDir: session.baseDir,
          candidates: session.candidates,
          createdBy: "desktop",
          appVersion: ZCODE_VERSION,
          onProgress,
        });
        if (!result.ok) {
          session.deciding = false;
          logger.error(`${LOG_SCOPE} import failed`, result.error, result.backupRoot ?? "");
          // 现有根在导入前已整体备份；失败时把备份落点告诉用户，便于手动恢复。
          const backupHint = result.backupRoot
            ? `（原数据已备份到 ${toDisplayPath(result.backupRoot)}）`
            : "";
          return { ok: false, error: `${result.error}${backupHint}` };
        }
        logger.info(`${LOG_SCOPE} import completed`, result.migratedBases.join(", "));
        scheduleRelaunch();
        return { ok: true, action: "migrate" };
      }
      const result = await executeDesktopDataRootMigration({
        baseDir: session.baseDir,
        candidates: session.candidates,
        createdBy: "desktop",
        appVersion: ZCODE_VERSION,
        onProgress,
      });
      if (!result.ok) {
        session.deciding = false;
        logger.error(`${LOG_SCOPE} migration failed`, result.error);
        return { ok: false, error: result.error };
      }
      logger.info(`${LOG_SCOPE} migration completed`, result.migratedBases.join(", "));
      scheduleRelaunch();
      return { ok: true, action: "migrate" };
    }
    session.deciding = false;
    return { ok: false, error: `未知操作: ${String(action)}` };
  } catch (error) {
    session.deciding = false;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`${LOG_SCOPE} ${action} failed`, error);
    return { ok: false, error: message };
  }
}

function startSession(input: {
  mode: Session["mode"];
  baseDir: string;
  status: PendingStatus;
  locale: Locale;
}): void {
  const candidates = discoverLegacyDataRootCandidates(input.baseDir);
  const session: Session = {
    mode: input.mode,
    baseDir: input.baseDir,
    locale: input.locale,
    status: input.status,
    candidates,
    state: buildState({ ...input, candidates }),
    deciding: false,
  };

  createDataRootDecisionWindow({
    onClosed: () => {
      unregisterDecisionHandlers();
      // 启动决策关闭 = 退出且不写状态；导入窗口关闭 = 取消，应用继续运行。
      if (input.mode === "startup") {
        app.quit();
      }
    },
    logger,
  });

  unregisterDecisionHandlers();
  ipcMain.handle(DataRootDecisionChannels.GetState, () => session.state);
  ipcMain.handle(DataRootDecisionChannels.Decide, (_event, action: unknown) =>
    handleAction(session, action as DataRootDecisionAction),
  );

  // 后台统计候选大小与磁盘空闲空间；完成后推送 StateChanged。
  void (async () => {
    const stats = new Map<string, { sizeBytes: number; modifiedAt: string | null }>();
    for (const candidate of candidates) {
      try {
        stats.set(candidate.legacyRoot, await collectLegacyCandidateStats(candidate.legacyRoot));
      } catch (error) {
        logger.warn(`${LOG_SCOPE} 统计旧数据目录失败`, candidate.legacyRoot, error);
      }
    }
    let diskFreeBytes: number | null = null;
    try {
      const fsStat = await statfs(input.baseDir);
      diskFreeBytes = Number(fsStat.bavail) * Number(fsStat.bsize);
    } catch (error) {
      logger.warn(`${LOG_SCOPE} 读取磁盘空闲空间失败`, error);
    }
    session.state = buildState({ ...input, candidates, stats, diskFreeBytes });
    pushState(session);
  })();

  pushState(session);
  logger.info(`${LOG_SCOPE} session started`, {
    mode: input.mode,
    baseDir: input.baseDir,
    status: input.status.kind,
    candidates: candidates.length,
  });
}

/**
 * 启动决策流程。Promise 永不 resolve：进程在用户选择后 quit / relaunch。
 * @returns never
 */
export function runDesktopDataRootDecisionFlow(input: DataRootDecisionFlowInput): Promise<never> {
  startSession({
    mode: "startup",
    baseDir: input.baseDir,
    status: input.status,
    locale: input.locale,
  });
  return new Promise<never>(() => {
    // 流程由 decide / 窗口关闭终止，永不 resolve。
  });
}

/**
 * 设置页“从旧数据目录再次导入”：打开独立窗口（单例）。
 * 旧数据候选来自当前 base 与旧 setting.json；确认后备份现有根并复制导入，随后 relaunch。
 */
export function openDataRootImportWindow(): void {
  const existing = getDataRootDecisionWindow();
  if (existing) {
    existing.focus();
    return;
  }
  const baseDir = getDataBaseDir();
  const status = readDataRootStatus(baseDir);
  startSession({
    mode: "import",
    baseDir,
    // import 模式只看旧数据候选；unowned/corrupt 仍展示冲突提示。
    status: status.kind === "unowned" || status.kind === "corrupt" ? status : { kind: "absent" },
    locale: resolveSystemApplicationLocale(),
  });
}

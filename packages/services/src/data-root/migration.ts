/**
 * 旧数据根（{base}/.zcode）探测与复制迁移。
 *
 * 迁移只在用户确认（桌面决策/再次导入）或显式非交互策略（ZCODIUM_DATA_ROOT_ACTION=migrate）
 * 下执行；复制而非移动，旧根保留。复制先进入同卷 staging，成功后 rename 原子落位。
 */
import { randomUUID } from "node:crypto";
import { existsSync, renameSync } from "node:fs";
import { chmod, copyFile, mkdir, opendir, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  DATA_ROOT_MANIFEST_FILE_NAME,
  DATA_ROOT_MANIFEST_SCHEMA_VERSION,
  DATA_ROOT_PRODUCT_ID,
  LEGACY_ZCODE_DATA_ROOT_DIR_NAME,
  ZCODE_DATA_ROOT_DIR_NAME,
  type DataRootManifest,
  type DataRootManifestCreatedBy,
} from "@zcode/shared";
import { createServiceLogger } from "../logger/serviceLogger.js";
import {
  forfeitConflictingDataRoot,
  readDataRootStatus,
  readLegacyDataBaseDirFromSettings,
  resolveDataRootDir,
  writeDataRootManifestIntoRoot,
} from "./ownership.js";
import type {
  DataRootMigrationProgress,
  DataRootMigrationResult,
  LegacyDataRootCandidate,
  LegacyDataRootCandidateStats,
} from "./types.js";

const log = createServiceLogger("data-root-migration");

/** staging 目录超过该年龄视为残留（上次进程被强杀），启动时可清理。 */
const STAGING_STALE_MS = 60 * 60 * 1000;

class DataRootMigrationCancelled extends Error {
  constructor() {
    super("data root migration cancelled");
    this.name = "DataRootMigrationCancelled";
  }
}

function expandHomeDir(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return join(homedir(), value.slice(2));
  }
  return value;
}

/**
 * 探测可迁移的旧数据根候选：
 * 1. 当前 base 的 {base}/.zcode（主候选）；
 * 2. 旧根 setting.json 中 dataBaseDir 指向的其它 base（一层，不递归）。
 */
export function discoverLegacyDataRootCandidates(baseDir: string): LegacyDataRootCandidate[] {
  const candidates: LegacyDataRootCandidate[] = [];
  const seen = new Set<string>();
  const primaryLegacyRoot = join(baseDir, LEGACY_ZCODE_DATA_ROOT_DIR_NAME);
  if (existsSync(primaryLegacyRoot)) {
    candidates.push({ baseDir, legacyRoot: primaryLegacyRoot, isPrimaryBase: true });
    seen.add(resolve(primaryLegacyRoot));
  }
  // 旧版设置里的自定义数据目录：其 .zcode 同样是用户真实数据，纳入候选。
  const configuredBaseDir = readLegacyDataBaseDirFromSettings(primaryLegacyRoot);
  if (configuredBaseDir) {
    const customBase = resolve(expandHomeDir(configuredBaseDir));
    const customLegacyRoot = join(customBase, LEGACY_ZCODE_DATA_ROOT_DIR_NAME);
    if (!seen.has(resolve(customLegacyRoot)) && existsSync(customLegacyRoot)) {
      candidates.push({ baseDir: customBase, legacyRoot: customLegacyRoot, isPrimaryBase: false });
      seen.add(resolve(customLegacyRoot));
    }
  }
  return candidates;
}

/** 递归统计候选目录大小/最后修改时间；单项失败按 0 计，不阻断。 */
export async function collectLegacyCandidateStats(
  legacyRoot: string,
): Promise<LegacyDataRootCandidateStats> {
  let sizeBytes = 0;
  let itemCount = 0;
  let latestMtimeMs = 0;

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await opendir(dir);
    } catch {
      return;
    }
    for await (const entry of entries) {
      const entryPath = join(dir, entry.name);
      itemCount += 1;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const fileStat = await stat(entryPath);
        sizeBytes += fileStat.size;
        latestMtimeMs = Math.max(latestMtimeMs, fileStat.mtimeMs);
      } catch {
        // 复制阶段会暴露真实错误；统计阶段忽略不可读项。
      }
    }
  };

  await walk(legacyRoot);
  try {
    const rootStat = await stat(legacyRoot);
    latestMtimeMs = Math.max(latestMtimeMs, rootStat.mtimeMs);
  } catch {
    // 根目录不可读时维持子项统计。
  }
  return {
    sizeBytes,
    itemCount,
    modifiedAt: latestMtimeMs > 0 ? new Date(latestMtimeMs).toISOString() : null,
  };
}

interface CopyTreeOptions {
  isCancelled?: () => boolean;
  onBytes: (bytes: number) => void;
}

async function copyTree(srcDir: string, destDir: string, options: CopyTreeOptions): Promise<void> {
  await mkdir(destDir, { recursive: true });
  const entries = await opendir(srcDir);
  for await (const entry of entries) {
    if (options.isCancelled?.()) throw new DataRootMigrationCancelled();
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isSymbolicLink()) {
      // Windows 非提权环境无法创建符号链接（EPERM）；跳过而非整体失败。
      continue;
    }
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath, options);
      await inheritSourceMode(srcPath, destPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (shouldSkipTransientFile(entry.name)) {
      continue;
    }
    let size = 0;
    let sourceMode: number | null = null;
    try {
      const sourceStat = await stat(srcPath);
      size = sourceStat.size;
      sourceMode = sourceStat.mode;
    } catch {
      // stat 失败时按 0 计，copyFile 会给出真实错误。
    }
    await copyFile(srcPath, destPath);
    if (sourceMode !== null) {
      await inheritSourceMode(srcPath, destPath, sourceMode);
    }
    options.onBytes(size);
  }
}

/**
 * 复制后对齐源权限：凭据等敏感文件（0600）不得在迁移中放宽为 umask 默认值。
 * 权限保留失败不阻断迁移（Windows 与非 POSIX 文件系统的 mode 语义有限）。
 */
async function inheritSourceMode(
  srcPath: string,
  destPath: string,
  knownSourceMode?: number,
): Promise<void> {
  try {
    const sourceMode = knownSourceMode ?? (await stat(srcPath)).mode;
    await chmod(destPath, sourceMode & 0o777);
  } catch {
    // 权限不是迁移的阻塞条件。
  }
}

function shouldSkipTransientFile(name: string): boolean {
  if (name === ".DS_Store") return true;
  if (name.endsWith(".lock")) return true;
  // setting.json.<x>.tmp / setting.json.lock 由原子写入短暂创建，复制时可能已消失。
  return name.startsWith("setting.json.");
}

/** 清理本 base 下残留的迁移 staging（超过 STAGING_STALE_MS）。 */
export function cleanupStaleMigrationStaging(baseDir: string): void {
  void (async () => {
    try {
      const entries = await opendir(baseDir);
      for await (const entry of entries) {
        if (
          !entry.isDirectory() ||
          !entry.name.startsWith(`${ZCODE_DATA_ROOT_DIR_NAME}.migrating-`)
        ) {
          continue;
        }
        const stagingPath = join(baseDir, entry.name);
        try {
          const stagingStat = await stat(stagingPath);
          if (Date.now() - stagingStat.mtimeMs < STAGING_STALE_MS) continue;
          await rm(stagingPath, { recursive: true, force: true });
          log.info(undefined, "清理残留迁移目录", stagingPath);
        } catch {
          // 清理失败不阻断启动。
        }
      }
    } catch {
      // base 不可读时无需清理。
    }
  })();
}

export interface ExecuteDataRootCopyMigrationInput {
  candidates: readonly LegacyDataRootCandidate[];
  createdBy: DataRootManifestCreatedBy;
  appVersion: string;
  /** 迁移后的归属文件记录模式；再次导入用 import。 */
  mode?: "copy" | "import";
  onProgress?: (progress: DataRootMigrationProgress) => void;
  isCancelled?: () => boolean;
}

/**
 * 执行复制迁移：逐候选 staging 复制 → 写归属 → 冲突备份 → rename 落位。
 *
 * 取消只可能发生在复制阶段，此时目标目录未被触碰；落位阶段（备份 + rename）不可取消。
 */
export async function executeDataRootCopyMigration(
  input: ExecuteDataRootCopyMigrationInput,
): Promise<DataRootMigrationResult> {
  const candidates = input.candidates;
  if (candidates.length === 0) {
    return { ok: false, error: "没有可迁移的旧数据目录", cancelled: false };
  }
  const mode = input.mode ?? "copy";
  const stagingPaths: string[] = [];
  const migratedBases: string[] = [];
  const manifestPaths: string[] = [];

  try {
    // 先统计总量用于进度展示；统计失败按未知处理。
    let totalBytes = 0;
    let totalKnown = true;
    for (const candidate of candidates) {
      try {
        totalBytes += (await collectLegacyCandidateStats(candidate.legacyRoot)).sizeBytes;
      } catch {
        totalKnown = false;
      }
    }
    let copiedBytes = 0;

    for (const candidate of candidates) {
      if (input.isCancelled?.()) throw new DataRootMigrationCancelled();
      const targetRoot = resolveDataRootDir(candidate.baseDir);
      const stagingRoot = join(
        candidate.baseDir,
        `${ZCODE_DATA_ROOT_DIR_NAME}.migrating-${randomUUID()}`,
      );
      stagingPaths.push(stagingRoot);

      input.onProgress?.({
        phase: "preparing",
        copiedBytes,
        totalBytes: totalKnown ? totalBytes : null,
        currentBaseDir: candidate.baseDir,
      });

      await rm(stagingRoot, { recursive: true, force: true });
      await copyTree(candidate.legacyRoot, stagingRoot, {
        isCancelled: input.isCancelled,
        onBytes: (bytes) => {
          copiedBytes += bytes;
          input.onProgress?.({
            phase: "copying",
            copiedBytes,
            totalBytes: totalKnown ? totalBytes : null,
            currentBaseDir: candidate.baseDir,
          });
        },
      });

      const manifest: DataRootManifest = {
        product: DATA_ROOT_PRODUCT_ID,
        schemaVersion: DATA_ROOT_MANIFEST_SCHEMA_VERSION,
        createdBy: input.createdBy,
        createdAt: new Date().toISOString(),
        firstSeenVersion: input.appVersion,
        migration: {
          from: candidate.legacyRoot,
          at: new Date().toISOString(),
          mode,
        },
      };
      writeDataRootManifestIntoRoot(stagingRoot, manifest);

      input.onProgress?.({
        phase: "finalizing",
        copiedBytes,
        totalBytes: totalKnown ? totalBytes : null,
        currentBaseDir: candidate.baseDir,
      });

      // 落位前处理冲突：其它产品/损坏目录先备份让路；已合法则视为并发方完成。
      const status = readDataRootStatus(candidate.baseDir);
      if (status.kind === "normal") {
        await rm(stagingRoot, { recursive: true, force: true });
        continue;
      }
      if (status.kind === "unowned" || status.kind === "corrupt") {
        forfeitConflictingDataRoot(candidate.baseDir, status);
      }
      try {
        renameSync(stagingRoot, targetRoot);
      } catch (error) {
        // 并发方可能刚好落位：目标已合法则接受其结果，否则暴露错误。
        const afterStatus = readDataRootStatus(candidate.baseDir);
        if (afterStatus.kind !== "normal") throw error;
        await rm(stagingRoot, { recursive: true, force: true });
        continue;
      }
      migratedBases.push(targetRoot);
      manifestPaths.push(join(targetRoot, DATA_ROOT_MANIFEST_FILE_NAME));
    }

    return { ok: true, migratedBases, manifestPaths };
  } catch (error) {
    for (const stagingPath of stagingPaths) {
      try {
        await rm(stagingPath, { recursive: true, force: true });
      } catch {
        // 清理失败保留给下次启动清理。
      }
    }
    if (error instanceof DataRootMigrationCancelled) {
      return { ok: false, error: "迁移已取消", cancelled: true };
    }
    log.error(undefined, "数据根迁移失败:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      cancelled: false,
    };
  }
}

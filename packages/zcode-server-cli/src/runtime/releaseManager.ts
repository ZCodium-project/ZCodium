import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { releaseManifestSchema, type ReleaseManifest } from "../contracts.js";
import type { ServerLayout } from "./paths.js";
import { ensureServerInstallOwnership } from "./installationOwnership.js";

interface UpdateTransaction {
  previous: ReleaseManifest | null;
}

async function renameWithWindowsRetry(temporary: string, path: string): Promise<void> {
  // 并发写各自持有唯一临时文件，但 rename 替换同一目标时 Windows 的
  // 目标文件会短暂处于替换中状态，后到的 rename 报 EPERM（POSIX 原子替换无此竞争）。
  // 语义上并发写本来就允许"后写覆盖先写"，对 EPERM/EBUSY 做有界退避重试即可收敛；
  // POSIX 宿主不触发重试，行为不变。
  const maxAttempts = process.platform === "win32" ? 5 : 1;
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(temporary, path);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (attempt >= maxAttempts || (code !== "EPERM" && code !== "EBUSY")) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // 同进程内两个 lifecycle 操作可能在同一毫秒写同一个临时文件，先完成
  // rename 的写入会让另一个写入以 ENOENT 失败。随机后缀保证每次原子写独占临时路径。
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await renameWithWindowsRetry(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export class ReleaseManager {
  public constructor(private readonly layout: ServerLayout) {}

  public async ensure(): Promise<void> {
    await Promise.all([
      mkdir(this.layout.serverRoot, { recursive: true, mode: 0o700 }),
      mkdir(this.layout.releasesDir, { recursive: true, mode: 0o700 }),
      mkdir(this.layout.runDir, { recursive: true, mode: 0o700 }),
    ]);
    await ensureServerInstallOwnership(this.layout);
  }

  public async beginUpdate(previous: ReleaseManifest | null): Promise<void> {
    await atomicWriteJson(this.layout.updateTransactionFile, { previous });
  }

  public async completeUpdate(): Promise<void> {
    await rm(this.layout.updateTransactionFile, { force: true });
  }

  public async applyPendingWithTransaction(
    previous: ReleaseManifest | null,
  ): Promise<ReleaseManifest> {
    await this.beginUpdate(previous);
    return await this.applyPending();
  }

  public async recoverInterruptedUpdate(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.layout.updateTransactionFile, "utf8");
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    let transaction: UpdateTransaction;
    try {
      const parsed = JSON.parse(raw) as { previous?: unknown };
      transaction = {
        previous: parsed.previous === null ? null : releaseManifestSchema.parse(parsed.previous),
      };
    } catch (error: unknown) {
      throw new Error(`Update transaction is invalid: ${this.layout.updateTransactionFile}`, {
        cause: error,
      });
    }
    // applyPending 先切换 current，再删除 pending；若进程在 Core ready 前退出，
    // current 可能指向未成功启动的 release。
    // 启动时优先恢复事务中的旧指针，恢复失败则保留 marker，让后续启动继续 fail-closed。
    await this.restoreCurrent(transaction.previous);
    await this.completeUpdate();
  }

  public async readCurrent(): Promise<ReleaseManifest | null> {
    return await this.readManifest(this.layout.currentFile);
  }

  public async readCurrentForExecution(): Promise<ReleaseManifest | null> {
    const manifest = await this.readCurrent();
    if (!manifest) return null;
    // current.json 的写入路径都会校验 releaseDir，但本地残留或外部篡改仍可能
    // 让启动侧读到越界指针。执行 Core 前再次校验边界，避免把恢复/更新元数据读取误当成执行授权。
    await this.assertReleaseDir(manifest);
    return manifest;
  }

  public async readPending(): Promise<ReleaseManifest | null> {
    return await this.readManifest(this.layout.pendingFile);
  }

  public async removePending(): Promise<void> {
    await rm(this.layout.pendingFile, { force: true });
  }

  /**
   * 标记只在 releaseId 等于 current.json 时有效：之后的升级或失败回滚到其他 release
   * 会让它自然失效，读取方不需要依赖额外的清理时序。
   */
  public async markDowngrade(target: ReleaseManifest, fromVersion: string): Promise<void> {
    await atomicWriteJson(this.layout.downgradeMarkerFile, {
      releaseId: target.releaseId,
      fromVersion,
    });
  }

  public async writePending(manifest: ReleaseManifest): Promise<void> {
    const parsed = releaseManifestSchema.parse({
      ...manifest,
      releaseDir: resolve(manifest.releaseDir),
    });
    await this.assertReleaseDir(parsed);
    await atomicWriteJson(this.layout.pendingFile, parsed);
  }

  public async applyPending(): Promise<ReleaseManifest> {
    const pending = await this.readPending();
    if (!pending) {
      throw new Error("No pending release is prepared");
    }
    await this.assertReleaseDir(pending);
    await atomicWriteJson(this.layout.currentFile, pending);
    await rm(this.layout.pendingFile, { force: true });
    return pending;
  }

  public async restoreCurrent(manifest: ReleaseManifest | null): Promise<void> {
    if (manifest) {
      await this.assertReleaseDir(manifest);
      await atomicWriteJson(this.layout.currentFile, manifest);
      return;
    }
    await rm(this.layout.currentFile, { force: true });
  }

  private async readManifest(path: string): Promise<ReleaseManifest | null> {
    try {
      const raw = await readFile(path, "utf8");
      return releaseManifestSchema.parse(JSON.parse(raw));
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  private async assertReleaseDir(manifest: ReleaseManifest): Promise<void> {
    const releaseDir = resolve(manifest.releaseDir);
    // canonical server root 会把 /var 等符号链接收敛到物理路径，但旧 manifest
    // 仍可能保存别名路径。校验边界时也 canonicalize，避免合法的历史 release 被误判越界。
    const canonicalReleaseDir = await realpath(releaseDir).catch(() => releaseDir);
    const canonicalReleasesDir = await realpath(this.layout.releasesDir).catch(() =>
      resolve(this.layout.releasesDir),
    );
    if (
      !canonicalReleaseDir.startsWith(
        `${canonicalReleasesDir}${process.platform === "win32" ? "\\" : "/"}`,
      )
    ) {
      throw new Error("Release directory must be inside the server releases directory");
    }
    const releaseStat = await stat(releaseDir).catch(() => null);
    if (!releaseStat?.isDirectory()) {
      throw new Error(`Release directory does not exist: ${releaseDir}`);
    }
  }
}

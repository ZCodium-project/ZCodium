import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { serverRuntimeManifestSchema, type ServerTarget } from "./manifest.js";

export interface ReleaseIdentity {
  archiveSha256: string;
  target: ServerTarget;
  version: string;
}

interface ReleaseIntegrity extends ReleaseIdentity {
  contentSha256: string;
}

export const RELEASE_INTEGRITY_FILE = ".release-integrity.json";

async function hashReleaseTree(root: string, relativeRoot = ""): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (relativeDirectory: string): Promise<void> => {
    const entries = await readdir(join(root, relativeDirectory), { withFileTypes: true });
    entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    for (const entry of entries) {
      const relativePath = join(relativeDirectory, entry.name);
      if (relativePath === RELEASE_INTEGRITY_FILE) continue;
      const normalizedPath = relativePath.replaceAll("\\", "/");
      if (entry.isDirectory()) {
        hash.update(`directory\0${normalizedPath}\0`);
        await visit(relativePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported release entry: ${normalizedPath}`);
      const fileStat = await stat(join(root, relativePath));
      hash.update(`file\0${normalizedPath}\0${fileStat.mode & 0o777}\0`);
      for await (const chunk of createReadStream(join(root, relativePath))) hash.update(chunk);
    }
  };
  await visit(relativeRoot);
  return hash.digest("hex");
}

function immutableReleaseConflict(releaseDir: string, error: unknown): Error {
  return new Error(
    `Existing immutable release conflict at ${releaseDir}: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/**
 * 已存在的同 id release 只有两种合法结论：与本次 archive 一致可复用，或是本次 archive 的损坏副本。
 * Bug 原因（A2）：旧实现把“完整性记录与本次 archive 一致、但磁盘内容已偏离记录”也判成冲突，
 * 同一 archive 强制重装永远失败，用户只能手动删除 releases/<id>。记录缺失或指向别的身份时
 * 无法证明它是本 release 的副本，仍按冲突失败。
 */
async function inspectExistingRelease(
  releaseDir: string,
  expected: ReleaseIntegrity,
): Promise<"match" | "damaged"> {
  let integrity: Partial<ReleaseIntegrity>;
  try {
    integrity = JSON.parse(
      await readFile(join(releaseDir, RELEASE_INTEGRITY_FILE), "utf8"),
    ) as Partial<ReleaseIntegrity>;
  } catch (error) {
    throw immutableReleaseConflict(releaseDir, error);
  }
  if (
    integrity.archiveSha256 !== expected.archiveSha256 ||
    integrity.contentSha256 !== expected.contentSha256 ||
    integrity.target !== expected.target ||
    integrity.version !== expected.version
  ) {
    throw immutableReleaseConflict(releaseDir, "identity mismatch");
  }
  try {
    const runtimeManifest = serverRuntimeManifestSchema.parse(
      JSON.parse(await readFile(join(releaseDir, "manifest.json"), "utf8")),
    );
    if (
      runtimeManifest.target !== expected.target ||
      runtimeManifest.appVersion !== expected.version
    ) {
      return "damaged";
    }
    return (await hashReleaseTree(releaseDir)) === expected.contentSha256 ? "match" : "damaged";
  } catch {
    return "damaged";
  }
}

async function assertExistingReleaseMatches(
  releaseDir: string,
  expected: ReleaseIntegrity,
): Promise<void> {
  if ((await inspectExistingRelease(releaseDir, expected)) !== "match") {
    throw immutableReleaseConflict(releaseDir, "content does not match its integrity record");
  }
}

async function replaceDamagedRelease(incomingDir: string, targetDir: string): Promise<void> {
  // 调用方持有 update.lock；先把损坏副本移到同目录的隐藏名，再 rename 已校验的 incoming，
  // 两步都是同一文件系统内的 rename。第二步失败时移回，保持与修复前相同的磁盘状态。
  const damagedDir = join(
    dirname(targetDir),
    `.damaged-${basename(targetDir)}-${process.pid}-${randomUUID()}`,
  );
  await rename(targetDir, damagedDir);
  try {
    await rename(incomingDir, targetDir);
  } catch (error) {
    try {
      await rename(damagedDir, targetDir);
    } catch (rollbackError) {
      // Bug 原因（CR-01）：移回失败曾被吞掉，只报第二步错误；此时 releases/<id> 已缺失而
      // current.json 仍指向它，用户看不到目录缺失和损坏副本位置。两步之间没有原子交换，
      // 不能保证旧目录回到原位，只能如实报告；再次重装时目标不存在，走普通 promote 恢复。
      throw new AggregateError(
        [error, rollbackError],
        `Failed to replace damaged release ${targetDir}: ${error instanceof Error ? error.message : String(error)}; ` +
          `restoring it also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}. ` +
          `The damaged copy is kept at ${damagedDir}; reinstall to recover.`,
      );
    }
    throw error;
  }
  await rm(damagedDir, { recursive: true, force: true }).catch(() => undefined);
}

async function existingPathKind(path: string): Promise<"directory" | "other" | null> {
  try {
    return (await stat(path)).isDirectory() ? "directory" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function promoteImmutableReleaseDirectory(options: {
  incomingDir: string;
  targetDir: string;
  identity: ReleaseIdentity;
}): Promise<void> {
  if (!/^[a-f0-9]{64}$/iu.test(options.identity.archiveSha256)) {
    throw new Error(`Invalid release archive SHA-256: ${options.identity.archiveSha256}`);
  }
  const integrity: ReleaseIntegrity = {
    ...options.identity,
    archiveSha256: options.identity.archiveSha256.toLowerCase(),
    contentSha256: await hashReleaseTree(options.incomingDir),
  };
  await writeFile(
    join(options.incomingDir, RELEASE_INTEGRITY_FILE),
    `${JSON.stringify(integrity, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  let promoted = false;
  try {
    const existingKind = await existingPathKind(options.targetDir);
    if (existingKind !== null) {
      if (existingKind !== "directory") {
        throw new Error(
          `Existing immutable release conflict at ${options.targetDir}: target is not a directory`,
        );
      }
      if ((await inspectExistingRelease(options.targetDir, integrity)) === "match") return;
      await replaceDamagedRelease(options.incomingDir, options.targetDir);
      promoted = true;
      return;
    }
    try {
      await rename(options.incomingDir, options.targetDir);
      promoted = true;
    } catch (error) {
      // 并发发布可能都先看到目标不存在。rename 失败后仅当目标确实已由
      // 另一发布者创建时才进入校验复用；Windows 的普通 EPERM 不能伪装成命中。
      const racedKind = await existingPathKind(options.targetDir);
      if (racedKind !== "directory") throw error;
      await assertExistingReleaseMatches(options.targetDir, integrity);
    }
  } finally {
    // 复用和失败都不会消费 incoming，必须统一清理，避免每次重试留下完整 release。
    if (!promoted) await rm(options.incomingDir, { recursive: true, force: true });
  }
}

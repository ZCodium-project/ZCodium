import { normalizeRemoteConnectionError } from "@zcode/shared";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, isAbsolute, join } from "node:path";
import {
  SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME,
  ZCODE_VERSION,
  normalizeRemoteAssetInstallMode,
  sourceServerReleaseDescriptorSchema,
  remoteRuntimeAssetSettingsSchema,
  type OfflineRuntimeImportResult,
  type RemoteTarget,
  type SourceServerReleaseArchive,
  type SourceServerReleaseDescriptor,
} from "@zcode/shared";
import {
  buildReleaseAssetUrlCandidates,
  buildReleaseBaseCandidates,
  assertRemoteCdnBaseVersionMatches,
} from "@zcode/server/remote/remoteAssetCdn.js";
import {
  resolveRemoteAssetFetch,
  type RemoteAssetNetworkPort,
} from "@zcode/server/remote/remoteAssetNetwork.js";
import type { ServerReleaseAsset, SourceServerProbeResult } from "@zcode/server/source-server";
import type { WindowRemoteAssetDirs } from "./windowRemoteConnectionRegistry.js";

interface ResolvedDescriptor {
  descriptor: SourceServerReleaseDescriptor;
  releaseBases: string[];
}

async function pathExists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyArchive(path: string, archive: SourceServerReleaseArchive): Promise<boolean> {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat?.isFile() || fileStat.size !== archive.sizeBytes) return false;
  return (await sha256File(path)) === archive.sha256;
}

function readDescriptor(text: string): SourceServerReleaseDescriptor {
  const descriptor = sourceServerReleaseDescriptorSchema.parse(JSON.parse(text));
  if (descriptor.version !== ZCODE_VERSION) {
    throw new Error(
      `Source Server descriptor version mismatch: expected ${ZCODE_VERSION}, received ${descriptor.version}`,
    );
  }
  return descriptor;
}

function findArchive(
  descriptor: SourceServerReleaseDescriptor,
  target: string,
): SourceServerReleaseArchive {
  const archive = descriptor.archives.find((candidate) => candidate.target === target);
  if (!archive) throw new Error(`Source Server descriptor is missing target: ${target}`);
  return archive;
}

function resolveArchiveUrls(releaseBases: string[], archive: SourceServerReleaseArchive): string[] {
  const allowedOrigins = new Set(releaseBases.map((base) => new URL(base).origin));
  // 显式镜像不能被 descriptor 内的绝对 URL 绕回另一个公网源。
  const absolute = archive.urls.filter(
    (url) => /^https?:\/\//u.test(url) && allowedOrigins.has(new URL(url).origin),
  );
  const relative = archive.urls.filter((url) => !/^https?:\/\//u.test(url));
  return Array.from(
    new Set([
      ...absolute,
      ...buildReleaseAssetUrlCandidates(releaseBases, [...relative, archive.fileName]),
    ]),
  );
}

async function writeTextAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function resolveLocalDescriptor(
  releaseDir: string,
  target: string,
): Promise<{ archive: SourceServerReleaseArchive; archivePath: string } | null> {
  const descriptorPath = join(releaseDir, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME);
  if (!(await pathExists(descriptorPath))) return null;
  const descriptor = readDescriptor(await readFile(descriptorPath, "utf8"));
  const archive = findArchive(descriptor, target);
  const archivePath = join(releaseDir, archive.fileName);
  if (!(await verifyArchive(archivePath, archive))) {
    throw new Error(`Source Server local archive failed descriptor verification: ${archivePath}`);
  }
  return { archive, archivePath };
}

/** #68：导入与部署共同使用同一严格校验器；提交指针之前绝不改写原有可用代。 */
export async function importOfflineRuntime(
  directory: string,
  remoteCacheDir: string,
): Promise<OfflineRuntimeImportResult> {
  if (typeof directory !== "string" || !isAbsolute(directory) || !remoteCacheDir) {
    throw new Error("Offline runtime requires an absolute directory and a local cache");
  }
  const descriptorPath = join(directory, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME);
  const info = await lstat(descriptorPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) {
    throw new Error("Invalid offline runtime descriptor file");
  }
  const sourceDescriptor = readDescriptor(await readFile(descriptorPath, "utf8"));
  const cacheRoot = join(remoteCacheDir, "source-server", ZCODE_VERSION);
  const staging = join(cacheRoot, "offline", `.staging-${randomUUID()}`);
  const archives: SourceServerReleaseArchive[] = [];
  await mkdir(staging, { recursive: true });
  try {
    for (const archive of sourceDescriptor.archives) {
      const source = join(directory, archive.fileName);
      const fileInfo = await lstat(source).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      // 发布描述文件列出所有平台，但用户可以只下载自己需要的平台。
      if (!fileInfo) continue;
      if (
        !fileInfo.isFile() ||
        fileInfo.isSymbolicLink() ||
        !(await verifyArchive(source, archive))
      ) {
        throw new Error(`Offline runtime verification failed: ${archive.target}`);
      }
      const destination = join(staging, archive.fileName);
      await copyFile(source, destination);
      // 用户选中的目录仍可能被外部修改；复验副本，避免校验与复制之间的文件替换。
      if (!(await verifyArchive(destination, archive))) {
        throw new Error(`Offline runtime copy verification failed: ${archive.target}`);
      }
      archives.push(archive);
    }
    if (!archives.length) throw new Error("Offline runtime directory contains no platform archive");
    const descriptorText = JSON.stringify({ ...sourceDescriptor, archives });
    const descriptorHash = createHash("sha256").update(descriptorText).digest("hex");
    const generation = `${descriptorHash}-${randomUUID()}`;
    await writeTextAtomic(
      join(staging, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME),
      descriptorText,
    );
    await rename(staging, join(cacheRoot, "offline", generation));
    // 并发窗口各写独立代，最后原子发布；读取者永远不会看到半导入状态。
    await writeTextAtomic(join(cacheRoot, "offline-active.json"), JSON.stringify({ generation }));
    return { version: ZCODE_VERSION, targets: archives.map((archive) => archive.target) };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

async function resolveImportedArchive(cacheRoot: string, target: string) {
  const pointer = join(cacheRoot, "offline-active.json");
  if (!(await pathExists(pointer))) return null;
  const { generation } = JSON.parse(await readFile(pointer, "utf8")) as { generation: unknown };
  if (typeof generation !== "string" || !/^[a-f0-9]{64}-[a-f0-9-]{36}$/u.test(generation)) {
    throw new Error("Invalid offline runtime generation");
  }
  const releaseDir = join(cacheRoot, "offline", generation);
  const descriptor = readDescriptor(
    await readFile(join(releaseDir, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME), "utf8"),
  );
  if (!descriptor.archives.some((archive) => archive.target === target)) return null;
  return resolveLocalDescriptor(releaseDir, target);
}

async function resolveRemoteDescriptor(
  remoteAssets: WindowRemoteAssetDirs,
  cacheRoot: string | null,
  remoteAssetNetwork?: RemoteAssetNetworkPort,
): Promise<ResolvedDescriptor> {
  const releaseBases = buildReleaseBaseCandidates(
    remoteAssets.remoteCdnBaseUrls ??
      (remoteAssets.remoteCdnBaseUrl ? [remoteAssets.remoteCdnBaseUrl] : []),
    ZCODE_VERSION,
  );
  const descriptorUrls = buildReleaseAssetUrlCandidates(releaseBases, [
    SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME,
  ]);
  const cachedDescriptorPath = cacheRoot
    ? join(cacheRoot, SOURCE_SERVER_RELEASE_DESCRIPTOR_FILE_NAME)
    : null;
  let lastError: unknown;
  const fetchImpl = resolveRemoteAssetFetch(remoteAssetNetwork);
  for (const url of descriptorUrls) {
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const descriptor = readDescriptor(text);
      if (cachedDescriptorPath) await writeTextAtomic(cachedDescriptorPath, text);
      return { descriptor, releaseBases };
    } catch (error) {
      lastError = error;
    }
  }
  if (cachedDescriptorPath && (await pathExists(cachedDescriptorPath))) {
    return {
      descriptor: readDescriptor(await readFile(cachedDescriptorPath, "utf8")),
      releaseBases,
    };
  }
  throw new Error("Unable to resolve Source Server release descriptor", { cause: lastError });
}

async function downloadArchive(
  archive: SourceServerReleaseArchive,
  urls: string[],
  cacheRoot: string,
  remoteAssetNetwork?: RemoteAssetNetworkPort,
): Promise<string> {
  await mkdir(cacheRoot, { recursive: true });
  const cached = join(cacheRoot, archive.fileName);
  if (await verifyArchive(cached, archive)) return cached;
  await rm(cached, { force: true });
  let lastError: unknown;
  const fetchImpl = resolveRemoteAssetFetch(remoteAssetNetwork);
  for (const url of urls) {
    const temporary = `${cached}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const response = await fetchImpl(url);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await pipeline(
        Readable.fromWeb(response.body as never),
        createWriteStream(temporary, { mode: 0o600 }),
      );
      if (!(await verifyArchive(temporary, archive))) {
        throw new Error(`Source Server archive checksum mismatch: ${archive.fileName}`);
      }
      await rename(temporary, cached);
      return cached;
    } catch (error) {
      lastError = error;
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  throw new Error(`Unable to download Source Server release ${archive.fileName}`, {
    cause: lastError,
  });
}

export async function resolveSourceServerReleaseAsset(
  ...args: Parameters<typeof resolveReleaseAsset>
): Promise<ServerReleaseAsset> {
  try {
    return await resolveReleaseAsset(...args);
  } catch (error) {
    const failure = normalizeRemoteConnectionError(error, "download");
    throw Object.assign(error instanceof Error ? error : new Error(failure.message), failure);
  }
}

async function resolveReleaseAsset(
  probe: SourceServerProbeResult,
  remoteAssets: WindowRemoteAssetDirs,
  remoteTarget: Exclude<RemoteTarget, { kind: "server" }>,
  remoteAssetNetwork?: RemoteAssetNetworkPort,
  options: { metadataOnly?: boolean } = {},
): Promise<ServerReleaseAsset> {
  if (
    (probe.platform !== "linux" && probe.platform !== "darwin") ||
    (probe.arch !== "x64" && probe.arch !== "arm64")
  ) {
    throw new Error(`Unsupported Source Server release target: ${probe.platform}-${probe.arch}`);
  }
  const target = `${probe.platform}-${probe.arch}`;
  const settings = remoteRuntimeAssetSettingsSchema.parse(
    remoteAssets.runtimeAssetSettings ?? { mode: "online" },
  );
  if (settings.mode !== "offline" && settings.baseUrl) {
    assertRemoteCdnBaseVersionMatches([settings.baseUrl], ZCODE_VERSION);
  }
  const installMode =
    remoteTarget.kind === "ssh"
      ? normalizeRemoteAssetInstallMode(remoteTarget.assetInstallMode)
      : "local-download-upload";
  const cacheRoot = remoteAssets.remoteCacheDir
    ? join(remoteAssets.remoteCacheDir, "source-server", ZCODE_VERSION)
    : null;

  const asLocalRelease = (
    local: NonNullable<Awaited<ReturnType<typeof resolveLocalDescriptor>>>,
  ) => ({
    localArchivePath: local.archivePath,
    target,
    version: ZCODE_VERSION,
    sha256: local.archive.sha256,
    sizeBytes: local.archive.sizeBytes,
    urls: [],
  });
  // 离线是硬网络边界，必须早于 fetch、metadata preview、开发态分支和 remote-download。
  if (settings.mode === "offline") {
    const local =
      cacheRoot &&
      ((await resolveImportedArchive(cacheRoot, target)) ??
        (await resolveLocalDescriptor(cacheRoot, target)));
    if (!local)
      throw new Error(
        `Source Server offline runtime missing for ${ZCODE_VERSION}/${target}; import the matching runtime first`,
      );
    return asLocalRelease(local);
  }

  if (
    remoteTarget.kind === "ssh" &&
    remoteAssets.sourceServerArtifactPolicy === "development-content-addressed"
  ) {
    if (!remoteAssets.mockCdnDir) {
      throw new Error(
        "Development Source Server release is unavailable; run pnpm bootstrap:with-remote",
      );
    }
    const releaseDir = join(remoteAssets.mockCdnDir, "releases", ZCODE_VERSION);
    const local = await resolveLocalDescriptor(releaseDir, target);
    if (!local) {
      // Bug 原因：开发态回退 CDN 会把 bootstrap 失败伪装成连接成功，并继续运行同版本旧代码。
      // 内容寻址开发策略只能消费本轮本地 descriptor/archive，缺失时必须明确失败。
      throw new Error(
        "Development Source Server release descriptor is unavailable; run pnpm bootstrap:with-remote",
      );
    }
    return {
      localArchivePath: local.archivePath,
      target,
      version: ZCODE_VERSION,
      sha256: local.archive.sha256,
      sizeBytes: local.archive.sizeBytes,
      urls: local.archive.urls,
    };
  }

  if (installMode === "local-download-upload") {
    // 已验证的完整本地缓存无需先请求公网描述文件；这也是内网复用缓存的关键。
    if (cacheRoot) {
      const imported = await resolveImportedArchive(cacheRoot, target);
      if (imported) return asLocalRelease(imported);
      const cached = await resolveLocalDescriptor(cacheRoot, target).catch(() => null);
      if (cached) return asLocalRelease(cached);
    }
    // Bug 原因：开发态曾直接信任 gitignore 的 dist-release；同版本源码变化后仍会部署旧包。
    // 现在只接受本轮 staging 写入 mock-cdn 且通过 descriptor SHA/size 校验的本地产物。
    const localReleaseDirs = remoteAssets.mockCdnDir
      ? [join(remoteAssets.mockCdnDir, "releases", ZCODE_VERSION)]
      : [];
    for (const releaseDir of localReleaseDirs) {
      const local = await resolveLocalDescriptor(releaseDir, target);
      if (!local) continue;
      return {
        localArchivePath: local.archivePath,
        target,
        version: ZCODE_VERSION,
        sha256: local.archive.sha256,
        sizeBytes: local.archive.sizeBytes,
        urls: local.archive.urls,
      };
    }
  }

  const resolvedDescriptor = await resolveRemoteDescriptor(
    settings.baseUrl
      ? {
          ...remoteAssets,
          remoteCdnBaseUrls: [settings.baseUrl],
          remoteCdnBaseUrl: settings.baseUrl,
        }
      : remoteAssets,
    cacheRoot,
    remoteAssetNetwork,
  );
  const archive = findArchive(resolvedDescriptor.descriptor, target);
  const urls = resolveArchiveUrls(resolvedDescriptor.releaseBases, archive);
  if (installMode === "remote-download" || options.metadataOnly) {
    return {
      target,
      version: ZCODE_VERSION,
      sha256: archive.sha256,
      sizeBytes: archive.sizeBytes,
      urls,
    };
  }
  if (!cacheRoot)
    throw new Error(`Source Server release cache is unavailable: ${archive.fileName}`);
  return {
    localArchivePath: await downloadArchive(archive, urls, cacheRoot, remoteAssetNetwork),
    target,
    version: ZCODE_VERSION,
    sha256: archive.sha256,
    sizeBytes: archive.sizeBytes,
    urls,
  };
}

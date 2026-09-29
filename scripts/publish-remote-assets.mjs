#!/usr/bin/env node
/**
 * 把 mock-cdn 的目录式 remote 资源布局转换为 GitHub Release 扁平资产布局。
 *
 * mock-cdn（prepare-prebuilds.mjs 产出）：
 *   releases/<version>/manifest-<arch>.json
 *   components/<platform>/<component>/<version+sha>.tar.gz
 *
 * GitHub Release（本脚本产出，供 gh release upload 使用）：
 *   manifest-<arch>.json                                  # artifactPath 重写为扁平名
 *   <platform>__<component>__<version 中 + 替换为 ->.tar.gz
 *
 * GitHub Release 的 asset 名不允许 "/"；"+" 在下载 URL 里会被编码成 %2B，不同托管端的
 * 解码行为不一致，因此组件统一压成单段安全文件名。manifest 其它字段保持不变，客户端
 * 只按 artifactPath 拼下载 URL（见 packages/desktop/specs/remote-assets-github-release.md）。
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSourceDir = join(repoRoot, "packages/desktop/mock-cdn");
const defaultOutDir = join(repoRoot, "dist/remote-assets-github");
const MANIFEST_PREFIX = "manifest-";
const MANIFEST_SUFFIX = ".json";
// GitHub Release 的资产列表按名称（忽略大小写）排序，与上传顺序无关。
// 统一前缀把 remote assets 沉到发布页最后（"zz-" 排在 "zcodium-*" 之后），
// 让安装包与更新元数据保持在前面。
const REMOTE_ASSET_DISPLAY_PREFIX = "zz-";

export function toGithubArtifactName(platformArch, componentId, version) {
  const safeVersion = String(version).replace(/[+/\\]/gu, "-");
  return `${REMOTE_ASSET_DISPLAY_PREFIX}${platformArch}__${componentId}__${safeVersion}.tar.gz`;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listManifestPlatforms(releaseDir) {
  return readdirSync(releaseDir)
    .filter((name) => name.startsWith(MANIFEST_PREFIX) && name.endsWith(MANIFEST_SUFFIX))
    .map((name) => name.slice(MANIFEST_PREFIX.length, -MANIFEST_SUFFIX.length))
    .sort((left, right) => left.localeCompare(right, "en"));
}

function assertSafeOutDir(outDir, sourceDir) {
  // 输出目录会被整体重建；拒绝会误删仓库、源目录或其祖先的路径。
  if ((repoRoot + sep).startsWith(outDir + sep)) {
    throw new Error(`[publish-remote-assets] refusing to clean output directory: ${outDir}`);
  }
  if ((sourceDir + sep).startsWith(outDir + sep)) {
    throw new Error(
      `[publish-remote-assets] output directory must not contain the mock-cdn source: ${outDir}`,
    );
  }
}

export function buildGithubAssetLayout(options = {}) {
  const sourceDir = resolve(options.sourceDir ?? defaultSourceDir);
  const outDir = resolve(options.outDir ?? defaultOutDir);
  const expectedVersion = options.expectedVersion?.trim();
  if (!expectedVersion) {
    throw new Error("[publish-remote-assets] expectedVersion is required");
  }

  const releaseDir = join(sourceDir, "releases", expectedVersion);
  if (!existsSync(releaseDir)) {
    throw new Error(
      `[publish-remote-assets] mock-cdn release directory not found: ${releaseDir}. ` +
        "Run `pnpm prepare:remote-assets` for this version first.",
    );
  }

  const platforms =
    options.platforms && options.platforms.length > 0
      ? [...options.platforms]
      : listManifestPlatforms(releaseDir);
  if (platforms.length === 0) {
    throw new Error(`[publish-remote-assets] no manifest found under ${releaseDir}`);
  }

  assertSafeOutDir(outDir, sourceDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const files = [];
  const usedNames = new Set();
  let totalBytes = 0;

  for (const platformArch of platforms) {
    const sourceManifestName = `${MANIFEST_PREFIX}${platformArch}${MANIFEST_SUFFIX}`;
    const manifestPath = join(releaseDir, sourceManifestName);
    if (!existsSync(manifestPath)) {
      throw new Error(`[publish-remote-assets] manifest not found: ${manifestPath}`);
    }
    const manifest = readJsonFile(manifestPath);
    if (manifest.appVersion !== expectedVersion) {
      throw new Error(
        `[publish-remote-assets] manifest appVersion mismatch for ${platformArch}: ` +
          `expected=${expectedVersion}, actual=${String(manifest.appVersion)}`,
      );
    }
    if (manifest.platformArch !== platformArch) {
      throw new Error(
        `[publish-remote-assets] manifest platformArch mismatch: expected=${platformArch}, ` +
          `actual=${String(manifest.platformArch)}`,
      );
    }

    const components = manifest.components.map((component) => {
      const artifactName = toGithubArtifactName(platformArch, component.id, component.version);
      if (usedNames.has(artifactName)) {
        throw new Error(`[publish-remote-assets] duplicate artifact name: ${artifactName}`);
      }
      usedNames.add(artifactName);

      const sourcePath = join(sourceDir, ...String(component.artifactPath).split("/"));
      if (!existsSync(sourcePath)) {
        throw new Error(
          `[publish-remote-assets] component artifact missing: ${sourcePath} ` +
            `(component=${component.id})`,
        );
      }
      // 发布的是内容寻址制品：复制前必须复验 manifest.sha256，避免把损坏或被替换的
      // 文件以“同名可信制品”发出去，客户端到下载时才发现 sha 不匹配。
      const actualSha256 = sha256File(sourcePath);
      if (actualSha256 !== String(component.sha256).toLowerCase()) {
        throw new Error(
          `[publish-remote-assets] component sha256 mismatch: ${sourcePath} ` +
            `(expected=${String(component.sha256)}, actual=${actualSha256})`,
        );
      }
      copyFileSync(sourcePath, join(outDir, artifactName));
      totalBytes += statSync(sourcePath).size;
      files.push(artifactName);
      return { ...component, artifactPath: artifactName };
    });

    const outputManifestName = `${REMOTE_ASSET_DISPLAY_PREFIX}${sourceManifestName}`;
    writeFileSync(
      join(outDir, outputManifestName),
      `${JSON.stringify({ ...manifest, components }, null, 2)}\n`,
      "utf8",
    );
    files.push(outputManifestName);
  }

  return { sourceDir, outDir, version: expectedVersion, platforms, files, totalBytes };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--source") {
      args.sourceDir = argv[++index];
    } else if (token === "--out") {
      args.outDir = argv[++index];
    } else if (token === "--platforms") {
      args.platforms = (argv[++index] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (token === "--version") {
      args.expectedVersion = argv[++index];
    } else {
      throw new Error(`[publish-remote-assets] unknown argument: ${token}`);
    }
  }
  return args;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = buildGithubAssetLayout({
    ...args,
    expectedVersion: args.expectedVersion ?? readJsonFile(join(repoRoot, "package.json")).version,
  });
  const megabytes = (result.totalBytes / (1024 * 1024)).toFixed(1);
  console.log(
    `[publish-remote-assets] ${result.version}: ${result.platforms.length} platform(s), ` +
      `${result.files.length} file(s), ${megabytes} MB -> ${result.outDir}`,
  );
}

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse, stringify } from "yaml";

const targets = ["mac-arm64", "mac-x64", "win-x64", "linux-x64", "linux-arm64"];
const metadataNames = [
  "latest-mac.yml",
  "latest.yml",
  "latest-linux.yml",
  "latest-linux-arm64.yml",
];

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function flatName(value) {
  requireValue(
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value),
    `Invalid flat asset URL/name: ${value}`,
  );
  return value;
}

function validVersion(version) {
  requireValue(
    typeof version === "string" && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/u.test(version),
    "Invalid release version",
  );
}

function layout(platform, arch, version) {
  validVersion(version);
  requireValue(
    targets.includes(`${platform}-${arch}`),
    `Unsupported release target: ${platform}-${arch}`,
  );
  const prefix = `ZCodium-${version}`;
  if (platform === "mac")
    return {
      metadata: "latest-mac.yml",
      names: [`${prefix}-mac-${arch}.zip`, `${prefix}-mac-${arch}.dmg`],
    };
  if (platform === "win") return { metadata: "latest.yml", names: [`${prefix}-win-x64.exe`] };
  return {
    metadata: arch === "x64" ? "latest-linux.yml" : "latest-linux-arm64.yml",
    names: [`${prefix}-linux-${arch === "x64" ? "x86_64" : arch}.AppImage`],
  };
}

function validDigest(value, algorithm) {
  if (algorithm === "sha256") return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
  return (
    typeof value === "string" &&
    Buffer.from(value, "base64").length === 64 &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

async function regularFile(path, limit = Infinity) {
  const info = await lstat(path);
  requireValue(
    info.isFile() && !info.isSymbolicLink() && info.size <= limit,
    `Expected regular file: ${path}`,
  );
  return info;
}

async function readSmallFile(path) {
  await regularFile(path, 1024 * 1024);
  return readFile(path, "utf8");
}

async function digestFile(path) {
  await regularFile(path);
  const sha256 = createHash("sha256"),
    sha512 = createHash("sha512");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    sha256.update(chunk);
    sha512.update(chunk);
  }
  return { size, sha256: sha256.digest("hex"), sha512: sha512.digest("base64") };
}

function readManifestFiles(manifest, version) {
  requireValue(manifest?.version === version, `Metadata version mismatch: expected ${version}`);
  requireValue(
    Array.isArray(manifest.files) && manifest.files.length > 0,
    "Missing metadata files",
  );
  const files = new Map();
  for (const file of manifest.files) {
    const name = flatName(file?.url);
    requireValue(!files.has(name), `Duplicate metadata URL: ${name}`);
    requireValue(
      Number.isSafeInteger(file.size) && file.size > 0 && validDigest(file.sha512, "sha512"),
      `Invalid metadata size/SHA-512: ${name}`,
    );
    if (file.blockMapSize !== undefined)
      requireValue(
        Number.isSafeInteger(file.blockMapSize) &&
          file.blockMapSize > 0 &&
          file.blockMapSize <= file.size,
        `Invalid blockMapSize: ${name}`,
      );
    files.set(name, {
      url: name,
      sha512: file.sha512,
      size: file.size,
      ...(file.blockMapSize === undefined ? {} : { blockMapSize: file.blockMapSize }),
    });
  }
  requireValue(
    typeof manifest.releaseDate === "string" && Number.isFinite(Date.parse(manifest.releaseDate)),
    "Invalid metadata releaseDate",
  );
  requireValue(
    files.has(flatName(manifest.path)) && files.get(manifest.path).sha512 === manifest.sha512,
    "Invalid legacy metadata path/SHA-512",
  );
  return files;
}

/** #76：构建端只产出架构隔离片段；必需安装包缺失不能当作可过滤的 Linux 附加格式。 */
export async function stageUpdateMetadata({ directory, outDirectory, platform, arch, version }) {
  const spec = layout(platform, arch, version);
  const original = parse(await readSmallFile(join(directory, spec.metadata)));
  const originalFiles = readManifestFiles(original, version);
  const files = [],
    assets = [];
  for (const name of spec.names) {
    const file = originalFiles.get(name);
    requireValue(file, `Missing required metadata asset: ${name}`);
    const digests = await digestFile(join(directory, name));
    requireValue(digests.size === file.size, `Metadata size mismatch: ${name}`);
    requireValue(digests.sha512 === file.sha512, `Metadata SHA-512 mismatch: ${name}`);
    files.push(file);
    assets.push({ name, ...digests });
    const blockmap = `${name}.blockmap`;
    const blockmapInfo = await lstat(join(directory, blockmap)).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (blockmapInfo)
      assets.push({ name: blockmap, ...(await digestFile(join(directory, blockmap))) });
  }
  const fragment = {
    schemaVersion: 1,
    version,
    platform,
    arch,
    releaseDate: original.releaseDate,
    files,
    assets,
  };
  await mkdir(outDirectory, { recursive: true });
  await writeFile(join(outDirectory, "fragment.json"), `${JSON.stringify(fragment, null, 2)}\n`);
  await writeFile(
    join(outDirectory, "upload-paths.txt"),
    `${assets.map((asset) => resolve(directory, asset.name)).join("\n")}\n`,
  );
  await writeFile(
    join(outDirectory, "checksums.txt"),
    `${assets
      .filter((asset) => spec.names.includes(asset.name))
      .map((asset) => `${asset.sha256}  ${asset.name}`)
      .join("\n")}\n`,
  );
  return fragment;
}

async function loadFragments(directory, depth = 0) {
  const fragments = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name === "fragment.json") fragments.push(JSON.parse(await readSmallFile(path)));
    else if (entry.isDirectory() && depth < 2)
      fragments.push(...(await loadFragments(path, depth + 1)));
  }
  return fragments;
}

function releaseAssets(release, version) {
  requireValue(
    release?.tagName === `v${version}` && Array.isArray(release.assets),
    "Release tag/assets mismatch",
  );
  const assets = new Map();
  for (const asset of release.assets) {
    const name = flatName(asset.name);
    requireValue(!assets.has(name), `Duplicate published asset: ${name}`);
    assets.set(name, asset);
  }
  return assets;
}

function verifyUploadedAsset(assets, name, size, sha256) {
  const actual = assets.get(name);
  requireValue(actual, `Missing published asset: ${name}`);
  requireValue(
    actual.state === "uploaded" && actual.size === size && actual.digest === `sha256:${sha256}`,
    `Published size/digest mismatch: ${name}`,
  );
}

async function buildMetadataPlan({ fragmentsDirectory, version, release }) {
  validVersion(version);
  const published = releaseAssets(release, version);
  const fragments = await loadFragments(fragmentsDirectory);
  const byTarget = new Map(),
    seenAssets = new Set();
  for (const fragment of fragments) {
    requireValue(
      fragment?.schemaVersion === 1 && fragment.version === version,
      "Fragment schema/version mismatch",
    );
    const spec = layout(fragment.platform, fragment.arch, version);
    const target = `${fragment.platform}-${fragment.arch}`;
    requireValue(!byTarget.has(target), `Duplicate target fragment: ${target}`);
    requireValue(
      typeof fragment.releaseDate === "string" && Number.isFinite(Date.parse(fragment.releaseDate)),
      "Invalid fragment releaseDate",
    );
    requireValue(
      Array.isArray(fragment.files) &&
        fragment.files.length === spec.names.length &&
        Array.isArray(fragment.assets),
      `Incomplete fragment: ${target}`,
    );
    const inventory = new Map();
    for (const asset of fragment.assets) {
      const name = flatName(asset.name);
      // 架构片段只能声明自己实际上传的文件，不能靠另一个架构/版本的同名记录兜底。
      requireValue(
        spec.names.includes(name) || spec.names.some((base) => name === `${base}.blockmap`),
        `Unexpected fragment asset: ${name}`,
      );
      requireValue(!seenAssets.has(name), `Duplicate fragment asset: ${name}`);
      seenAssets.add(name);
      requireValue(
        Number.isSafeInteger(asset.size) &&
          asset.size > 0 &&
          validDigest(asset.sha256, "sha256") &&
          validDigest(asset.sha512, "sha512"),
        `Invalid fragment digest/size: ${name}`,
      );
      verifyUploadedAsset(published, name, asset.size, asset.sha256);
      inventory.set(name, asset);
    }
    const files = readManifestFiles(
      {
        version,
        releaseDate: fragment.releaseDate,
        path: fragment.files[0]?.url,
        sha512: fragment.files[0]?.sha512,
        files: fragment.files,
      },
      version,
    );
    for (const name of spec.names) {
      const file = files.get(name),
        asset = inventory.get(name);
      requireValue(
        file && asset && file.size === asset.size && file.sha512 === asset.sha512,
        `Fragment metadata/inventory mismatch: ${name}`,
      );
    }
    byTarget.set(target, { ...fragment, files: [...files.values()] });
  }
  for (const target of targets)
    requireValue(byTarget.has(target), `Missing target fragment: ${target}`);
  requireValue(byTarget.size === targets.length, "Unexpected target fragment count");
  const manifests = {};
  for (const [name, sourceTargets] of [
    ["latest-mac.yml", ["mac-x64", "mac-arm64"]],
    ["latest.yml", ["win-x64"]],
    ["latest-linux.yml", ["linux-x64"]],
    ["latest-linux-arm64.yml", ["linux-arm64"]],
  ]) {
    const sources = sourceTargets.map((target) => byTarget.get(target));
    const files = sources
      .flatMap((source) => source.files)
      .sort((a, b) => a.url.localeCompare(b.url, "en"));
    const primary = sources[0].files.find(
      (file) => file.url === layout(sources[0].platform, sources[0].arch, version).names[0],
    );
    manifests[name] = {
      version,
      files,
      path: primary.url,
      sha512: primary.sha512,
      releaseDate: sources[0].releaseDate,
    };
  }
  return { manifests, published };
}

/** #76：全部片段和远端摘要验证完成后才生成最终清单，不再由并行 job last-writer-wins。 */
export async function mergeUpdateMetadata(options) {
  const { manifests } = await buildMetadataPlan(options);
  await mkdir(options.outDirectory, { recursive: true });
  for (const [name, manifest] of Object.entries(manifests))
    await writeFile(join(options.outDirectory, name), stringify(manifest));
  return { manifests };
}

/** 上传后核对实际清单本身的 digest；也支持对既有 Release 的只读演练。 */
export async function verifyUpdateMetadata(options) {
  const { manifests, published } = await buildMetadataPlan(options);
  for (const name of metadataNames) {
    const path = join(options.directory, name);
    const actual = parse(await readSmallFile(path)),
      expected = manifests[name];
    const files = readManifestFiles(actual, options.version);
    requireValue(
      actual.path === expected.path &&
        actual.sha512 === expected.sha512 &&
        actual.releaseDate === expected.releaseDate,
      `Published metadata legacy fields mismatch: ${name}`,
    );
    const sorted = [...files.values()].sort((a, b) => a.url.localeCompare(b.url, "en"));
    requireValue(
      JSON.stringify(sorted) === JSON.stringify(expected.files),
      `Published metadata file set mismatch: ${name}`,
    );
    const digest = await digestFile(path);
    verifyUploadedAsset(published, name, digest.size, digest.sha256);
  }
  return { verifiedManifests: metadataNames.length };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      ["directory", "out", "fragments", "platform", "arch", "version", "release-json"].map(
        (key) => [key, { type: "string" }],
      ),
    ),
  });
  requireValue(
    positionals.length === 1,
    "Usage: release-update-metadata.mjs <stage|merge|verify> --version <version> ...",
  );
  const options = {
    directory: values.directory,
    outDirectory: values.out,
    fragmentsDirectory: values.fragments,
    platform: values.platform,
    arch: values.arch,
    version: values.version,
  };
  if (values["release-json"])
    options.release = JSON.parse(await readSmallFile(values["release-json"]));
  const command = {
    stage: stageUpdateMetadata,
    merge: mergeUpdateMetadata,
    verify: verifyUpdateMetadata,
  }[positionals[0]];
  requireValue(command, "Unknown metadata command");
  console.log(JSON.stringify(await command(options), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

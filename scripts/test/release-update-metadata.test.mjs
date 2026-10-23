import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const repoRoot = resolve(import.meta.dirname, "../..");
const desktopRequire = createRequire(join(repoRoot, "packages/desktop/package.json"));
const YAML = desktopRequire("yaml");
const version = "9.8.7-audit.20261023.2";
const releaseDate = "2026-10-23T12:00:00.000Z";
const targets = [
  { platform: "mac", arch: "arm64", extensions: ["dmg", "zip"], manifest: "latest-mac.yml" },
  { platform: "mac", arch: "x64", extensions: ["dmg", "zip"], manifest: "latest-mac.yml" },
  { platform: "win", arch: "x64", extensions: ["exe"], manifest: "latest.yml" },
  { platform: "linux", arch: "x64", extensions: ["AppImage"], manifest: "latest-linux.yml" },
  {
    platform: "linux",
    arch: "arm64",
    extensions: ["AppImage"],
    manifest: "latest-linux-arm64.yml",
  },
];
const manifestNames = [
  "latest-linux-arm64.yml",
  "latest-linux.yml",
  "latest-mac.yml",
  "latest.yml",
];
const metadataModule = () => import("../release-update-metadata.mjs");
const hash = (data, algorithm, encoding = "hex") =>
  createHash(algorithm).update(data).digest(encoding);
const targetKey = ({ platform, arch }) => `${platform}-${arch}`;
const packageName = ({ platform, arch }, extension) =>
  `ZCodium-${version}-${platform}-${platform === "linux" && arch === "x64" ? "x86_64" : arch}.${extension}`;
const sorted = (values) => [...values].sort();

async function temporaryDirectory(t) {
  const parent = join(tmpdir(), "opencode");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "release-update-metadata-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function writeYaml(path, data) {
  await writeFile(path, YAML.stringify(data));
}

async function createBuild(root, target, { blockmaps = true } = {}) {
  const directory = join(root, "builds", targetKey(target));
  const outDirectory = join(root, "fragments", `artifact-${targetKey(target)}`, "payload");
  await mkdir(directory, { recursive: true });
  const files = [];
  const assets = [];
  for (const extension of target.extensions) {
    const name = packageName(target, extension);
    const data = Buffer.from(`synthetic installer ${name}\n`.repeat(64));
    await writeFile(join(directory, name), data);
    files.push({
      url: name,
      sha512: hash(data, "sha512", "base64"),
      size: data.length,
      ...(extension === "exe" || extension === "AppImage" ? { blockMapSize: 17 } : {}),
    });
    assets.push({
      name,
      size: data.length,
      sha256: hash(data, "sha256"),
      sha512: hash(data, "sha512", "base64"),
    });
    if (blockmaps) {
      const blockmapName = `${name}.blockmap`;
      const blockmap = Buffer.from(`synthetic blockmap ${name}\n`);
      await writeFile(join(directory, blockmapName), blockmap);
      assets.push({
        name: blockmapName,
        size: blockmap.length,
        sha256: hash(blockmap, "sha256"),
        sha512: hash(blockmap, "sha512", "base64"),
      });
    }
  }
  const legacy = files.find((file) => file.url.endsWith(".zip")) ?? files[0];
  const raw = {
    version,
    files,
    path: legacy.url,
    sha512: legacy.sha512,
    releaseDate,
  };
  if (target.platform === "linux") {
    // builder 会引用本流水线不分发的包；即使本地没有这些包，也不能误判为缺必需资产。
    for (const extension of ["deb", "rpm", "pacman"]) {
      raw.files.push({
        url: packageName(target, extension),
        sha512: hash(extension, "sha512", "base64"),
        size: 123,
      });
    }
  }
  await writeFile(join(directory, "unrelated.zip.blockmap"), "must not be uploaded");
  const manifestPath = join(directory, target.manifest);
  await writeYaml(manifestPath, raw);
  return { target, directory, outDirectory, manifestPath, raw, assets };
}

async function stageBuild(build) {
  const { stageUpdateMetadata } = await metadataModule();
  return stageUpdateMetadata({
    directory: build.directory,
    outDirectory: build.outDirectory,
    platform: build.target.platform,
    arch: build.target.arch,
    version,
  });
}

function githubAsset(asset) {
  return {
    name: asset.name,
    size: asset.size,
    digest: `sha256:${asset.sha256}`,
    state: "uploaded",
  };
}

async function fixture(t, { blockmaps = true } = {}) {
  const root = await temporaryDirectory(t);
  const builds = [];
  const fragments = [];
  for (const target of targets) {
    const build = await createBuild(root, target, { blockmaps });
    builds.push(build);
    fragments.push(await stageBuild(build));
  }
  const release = {
    tagName: `v${version}`,
    assets: builds.flatMap((build) => build.assets.map(githubAsset)),
  };
  // 其它发布链路的资产不是桌面清单输入，不应被拒绝或写入 latest。
  release.assets.push(
    githubAsset({ name: "unrelated-cli.tar.gz", size: 1, sha256: "a".repeat(64) }),
  );
  return {
    root,
    builds,
    fragments,
    fragmentsDirectory: join(root, "fragments"),
    outDirectory: join(root, "merged"),
    version,
    release,
  };
}

async function merge(f) {
  const { mergeUpdateMetadata } = await metadataModule();
  return mergeUpdateMetadata(f);
}

async function updateFragment(f, index, update) {
  const fragment = structuredClone(f.fragments[index]);
  update(fragment);
  await writeFile(join(f.builds[index].outDirectory, "fragment.json"), JSON.stringify(fragment));
}

async function directoryContents(directory) {
  const contents = {};
  for (const name of (await readdir(directory)).sort()) {
    contents[name] = await readFile(join(directory, name), "utf8");
  }
  return contents;
}

async function manifestRelease(f) {
  const release = structuredClone(f.release);
  for (const name of manifestNames) {
    const data = await readFile(join(f.outDirectory, name));
    release.assets.push(githubAsset({ name, size: data.length, sha256: hash(data, "sha256") }));
  }
  return release;
}

async function verify(f, release) {
  const { verifyUpdateMetadata } = await metadataModule();
  return verifyUpdateMetadata({ ...f, directory: f.outDirectory, release });
}

test("stage 对五个平台校验安装包，产出独立片段、上传列表与校验片段", async (t) => {
  const f = await fixture(t);
  for (const [index, build] of f.builds.entries()) {
    const fragment = f.fragments[index];
    assert.equal(fragment.schemaVersion, 1);
    assert.equal(fragment.version, version);
    assert.equal(fragment.platform, build.target.platform);
    assert.equal(fragment.arch, build.target.arch);
    assert.equal(fragment.releaseDate, releaseDate);
    assert.deepEqual(
      sorted(fragment.assets.map((asset) => asset.name)),
      sorted(build.assets.map((a) => a.name)),
    );
    for (const asset of fragment.assets) {
      assert.deepEqual(
        asset,
        build.assets.find((expected) => expected.name === asset.name),
      );
    }
    assert.deepEqual(
      [...fragment.files].sort((a, b) => a.url.localeCompare(b.url)),
      build.raw.files
        .filter((file) =>
          build.target.extensions.some((extension) => file.url.endsWith(`.${extension}`)),
        )
        .sort((a, b) => a.url.localeCompare(b.url)),
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(build.outDirectory, "fragment.json"), "utf8")),
      fragment,
    );
    const uploadPaths = (await readFile(join(build.outDirectory, "upload-paths.txt"), "utf8"))
      .trim()
      .split(/\r?\n/);
    assert.deepEqual(
      sorted(uploadPaths.map((path) => basename(path))),
      sorted(build.assets.map((asset) => asset.name)),
    );
    assert.equal(new Set(uploadPaths).size, uploadPaths.length);
    const checksums = (await readFile(join(build.outDirectory, "checksums.txt"), "utf8"))
      .trim()
      .split(/\r?\n/);
    for (const asset of build.assets.filter((asset) => !asset.name.endsWith(".blockmap"))) {
      assert.ok(
        checksums.includes(`${asset.sha256}  ${asset.name}`),
        `缺少 ${asset.name} 的真实 SHA-256`,
      );
    }
    assert.ok(checksums.every((line) => !/\.(?:deb|rpm|pacman|yml)$/.test(line)));
  }
});

test("stage 允许没有可选 blockmap，不上传旁路文件", async (t) => {
  const f = await fixture(t, { blockmaps: false });
  assert.ok(
    f.fragments.every((fragment) =>
      fragment.assets.every((asset) => !asset.name.endsWith(".blockmap")),
    ),
  );
});

test("stage 可从公开合并 mac 清单提取本机架构，不要求另一架构安装包存在", async (t) => {
  const root = await temporaryDirectory(t);
  const builds = await Promise.all(targets.slice(0, 2).map((target) => createBuild(root, target)));
  const combined = builds.flatMap((build) => build.raw.files);
  const x64Zip = combined.find((file) => file.url.endsWith("x64.zip"));
  for (const build of builds) {
    build.raw.files = combined;
    build.raw.path = x64Zip.url;
    build.raw.sha512 = x64Zip.sha512;
    await writeYaml(build.manifestPath, build.raw);
    const result = await stageBuild(build);
    assert.equal(result.files.length, 2);
    assert.ok(result.files.every((file) => file.url.includes(`-${build.target.arch}.`)));
  }
});

const stageFailures = {
  "坏 SHA-512": async (build) => {
    build.raw.files[0].sha512 = hash("wrong", "sha512", "base64");
  },
  大小不匹配: async (build) => {
    build.raw.files[0].size += 1;
  },
  "重复 URL": async (build) => {
    build.raw.files.push({ ...build.raw.files[0] });
  },
  原始版本不匹配: async (build) => {
    build.raw.version = "9.8.6";
  },
  必需文件缺失: async (build) => {
    await rm(join(build.directory, build.raw.files[0].url));
  },
  必需文件是目录: async (build) => {
    const path = join(build.directory, build.raw.files[0].url);
    await rm(path);
    await mkdir(path);
  },
  必需文件是符号链接: async (build) => {
    const path = join(build.directory, build.raw.files[0].url);
    await copyFile(path, `${path}.real`);
    await rm(path);
    await symlink(`${path}.real`, path);
  },
  "可选 blockmap 是符号链接": async (build) => {
    const path = join(build.directory, `${build.raw.files[0].url}.blockmap`);
    await copyFile(path, `${path}.real`);
    await rm(path);
    await symlink(`${path}.real`, path);
  },
  "legacy path 越界": async (build) => {
    build.raw.path = `../${build.raw.path}`;
  },
};

for (const [name, mutate] of Object.entries(stageFailures)) {
  test(`stage 拒绝${name}，失败不生成可上传片段`, async (t) => {
    const build = await createBuild(await temporaryDirectory(t), targets[0]);
    await mutate(build);
    await writeYaml(build.manifestPath, build.raw);
    await assert.rejects(() => stageBuild(build));
    await assert.rejects(readFile(join(build.outDirectory, "fragment.json")), { code: "ENOENT" });
  });
}

for (const unsafe of ["../", "nested/", "nested\\", "/", "https://example.invalid/", "%2e%2e%2f"]) {
  test(`stage 拒绝非安全扁平 URL：${unsafe}`, async (t) => {
    const build = await createBuild(await temporaryDirectory(t), targets[2]);
    build.raw.files[0].url = `${unsafe}${build.raw.files[0].url}`;
    await writeYaml(build.manifestPath, build.raw);
    await assert.rejects(() => stageBuild(build));
  });
}

for (const target of targets) {
  test(`stage 不静默过滤 ${targetKey(target)} 缺少的必需清单条目`, async (t) => {
    const build = await createBuild(await temporaryDirectory(t), target);
    build.raw.files.shift();
    await writeYaml(build.manifestPath, build.raw);
    await assert.rejects(() => stageBuild(build));
  });
}

test("五片段 stage → merge → verify 只生成四份有效清单，verify 保持输入只读", async (t) => {
  const f = await fixture(t);
  const { manifests } = await merge(f);
  assert.deepEqual(sorted(Object.keys(manifests)), manifestNames);
  assert.deepEqual(sorted(await readdir(f.outDirectory)), manifestNames);
  for (const [name, manifest] of Object.entries(manifests)) {
    assert.deepEqual(YAML.parse(await readFile(join(f.outDirectory, name), "utf8")), manifest);
    assert.equal(manifest.version, version);
    assert.equal(manifest.releaseDate, releaseDate);
    const matching = f.fragments.filter(
      (fragment) =>
        targets.find((target) => targetKey(target) === targetKey(fragment)).manifest === name,
    );
    const expectedFiles = matching.flatMap((fragment) => fragment.files);
    assert.deepEqual(
      sorted(manifest.files.map((file) => file.url)),
      sorted(expectedFiles.map((file) => file.url)),
    );
    assert.equal(new Set(manifest.files.map((file) => file.url)).size, manifest.files.length);
    for (const file of manifest.files) {
      assert.deepEqual(
        file,
        expectedFiles.find((expected) => expected.url === file.url),
      );
      assert.ok(f.release.assets.some((asset) => asset.name === file.url));
    }
    const legacy = manifest.files.find((file) => file.url === manifest.path);
    assert.ok(legacy);
    assert.equal(manifest.sha512, legacy.sha512);
  }
  assert.match(manifests["latest-mac.yml"].path, /-x64\.zip$/);
  assert.equal(manifests["latest-mac.yml"].files.length, 4);
  for (const name of ["latest-linux.yml", "latest-linux-arm64.yml"]) {
    assert.equal(manifests[name].files.length, 1);
    assert.match(manifests[name].files[0].url, /\.AppImage$/);
  }
  const release = await manifestRelease(f);
  const beforeRelease = structuredClone(release);
  const beforeFiles = await directoryContents(f.outDirectory);
  const beforeFragments = await Promise.all(
    f.builds.map((build) => readFile(join(build.outDirectory, "fragment.json"), "utf8")),
  );
  assert.deepEqual(await verify(f, release), { verifiedManifests: 4 });
  assert.deepEqual(release, beforeRelease);
  assert.deepEqual(await directoryContents(f.outDirectory), beforeFiles);
  assert.deepEqual(
    await Promise.all(
      f.builds.map((build) => readFile(join(build.outDirectory, "fragment.json"), "utf8")),
    ),
    beforeFragments,
  );
});

test("merge 的 YAML 字节不受 artifact 目录、片段内 files/assets 或远端资产顺序影响", async (t) => {
  const f = await fixture(t);
  await merge(f);
  const first = await directoryContents(f.outDirectory);
  const fragmentsDirectory = join(f.root, "reordered-fragments");
  for (const [index, original] of [...f.fragments].reverse().entries()) {
    const directory = join(fragmentsDirectory, `artifact-${index}`, "nested");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "fragment.json"),
      JSON.stringify({
        ...original,
        files: [...original.files].reverse(),
        assets: [...original.assets].reverse(),
      }),
    );
  }
  const reordered = {
    ...f,
    fragmentsDirectory,
    outDirectory: join(f.root, "reordered-output"),
    release: { ...f.release, assets: [...f.release.assets].reverse() },
  };
  await merge(reordered);
  assert.deepEqual(await directoryContents(reordered.outDirectory), first);
});

const mergeFailures = [
  [
    "缺少平台",
    async (f) => {
      await rm(f.builds[4].outDirectory, { recursive: true });
    },
  ],
  [
    "重复片段",
    async (f) => {
      const directory = join(f.fragmentsDirectory, "duplicate", "payload");
      await mkdir(directory, { recursive: true });
      await copyFile(
        join(f.builds[0].outDirectory, "fragment.json"),
        join(directory, "fragment.json"),
      );
    },
  ],
  [
    "重复平台架构",
    async (f) => {
      await updateFragment(f, 4, (fragment) => {
        fragment.arch = "x64";
      });
    },
  ],
  [
    "片段版本不匹配",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.version = "9.8.6";
      });
    },
  ],
  [
    "Release tag 不匹配",
    async (f) => {
      f.release.tagName = "v9.8.6";
    },
  ],
  [
    "不支持的 schemaVersion",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.schemaVersion = 2;
      });
    },
  ],
  [
    "重复资产名",
    async (f) => {
      await updateFragment(f, 4, (fragment) => {
        fragment.assets.push(f.fragments[0].assets[0]);
      });
    },
  ],
  [
    "片段重复 URL",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.files.push({ ...fragment.files[0] });
      });
    },
  ],
  [
    "片段 URL 越界",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.files[0].url = `../${fragment.files[0].url}`;
      });
    },
  ],
  [
    "片段资产名越界",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.assets[0].name = `../${fragment.assets[0].name}`;
      });
    },
  ],
  [
    "files 与 assets 的 SHA-512 不一致",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.files[0].sha512 = hash("changed", "sha512", "base64");
      });
    },
  ],
  [
    "files 与 assets 大小不一致",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        fragment.files[0].size += 1;
      });
    },
  ],
  [
    "缺少对应资产记录",
    async (f) => {
      await updateFragment(f, 0, (fragment) => {
        const name = fragment.files[0].url;
        fragment.assets = fragment.assets.filter((asset) => asset.name !== name);
      });
    },
  ],
  [
    "缺少真实安装包",
    async (f) => {
      f.release.assets.splice(0, 1);
    },
  ],
  [
    "缺少真实 blockmap",
    async (f) => {
      const index = f.release.assets.findIndex((asset) => asset.name.endsWith(".blockmap"));
      f.release.assets.splice(index, 1);
    },
  ],
  [
    "真实资产大小不匹配",
    async (f) => {
      f.release.assets[0].size += 1;
    },
  ],
  [
    "真实资产 digest 不匹配",
    async (f) => {
      f.release.assets[0].digest = `sha256:${"0".repeat(64)}`;
    },
  ],
  [
    "真实资产 digest 缺失",
    async (f) => {
      delete f.release.assets[0].digest;
    },
  ],
  [
    "真实资产 digest 算法不符",
    async (f) => {
      f.release.assets[0].digest = `sha512:${"0".repeat(128)}`;
    },
  ],
  [
    "真实资产尚未 uploaded",
    async (f) => {
      f.release.assets[0].state = "starter";
    },
  ],
];

for (const [name, mutate] of mergeFailures) {
  test(`merge 拒绝${name}，全部校验前不覆盖已有输出`, async (t) => {
    const f = await fixture(t);
    await mkdir(f.outDirectory);
    await writeFile(join(f.outDirectory, "sentinel.txt"), "keep this unrelated file\n");
    await writeFile(join(f.outDirectory, "latest.yml"), "do not partially overwrite\n");
    const before = await directoryContents(f.outDirectory);
    await mutate(f);
    await assert.rejects(() => merge(f));
    assert.deepEqual(await directoryContents(f.outDirectory), before);
  });
}

test("merge 保留各平台片段 releaseDate，而不是合并时生成时间", async (t) => {
  const f = await fixture(t);
  const date = "2026-10-22T10:00:00.000Z";
  await updateFragment(f, 4, (fragment) => {
    fragment.releaseDate = date;
  });
  const { manifests } = await merge(f);
  assert.equal(manifests["latest-linux-arm64.yml"].releaseDate, date);
  assert.equal(manifests["latest-linux.yml"].releaseDate, releaseDate);
});

test("真实 electron-updater 的 MacUpdater 架构过滤与 Provider.findFile 各选本机 zip", async (t) => {
  const f = await fixture(t);
  const { manifests } = await merge(f);
  const provider = desktopRequire("electron-updater/out/providers/Provider.js");
  const macPath = desktopRequire.resolve("electron-updater/out/MacUpdater.js");
  const source = await readFile(macPath, "utf8");
  const requireMac = createRequire(macPath);
  const info = manifests["latest-mac.yml"];
  for (const [arch, rosetta, expectedArch] of [
    ["arm64", false, "arm64"],
    ["x64", false, "x64"],
    ["x64", true, "arm64"],
  ]) {
    const exports = {};
    // 不复制 updater 的筛选算法：运行已安装的真实源码，仅替换系统探测和下载边界，绝不启动 Electron。
    runInNewContext(
      source,
      {
        exports,
        process: { arch },
        require: (name) => {
          if (name === "./AppUpdater") return { AppUpdater: class {} };
          if (name === "child_process")
            return {
              execFileSync: (command) =>
                command === "sysctl"
                  ? `sysctl.proc_translated: ${rosetta ? 1 : 0}`
                  : arch === "arm64"
                    ? "Darwin ARM64"
                    : "Darwin X86_64",
            };
          return requireMac(name);
        },
      },
      { filename: macPath },
    );
    const resolved = provider.resolveFiles(
      info,
      new URL(`https://example.invalid/releases/v${version}/`),
    );
    const selected = await exports.MacUpdater.prototype.doDownloadUpdate.call(
      {
        _logger: { info() {}, warn() {} },
        debug() {},
        executeDownload: async ({ fileInfo }) => fileInfo,
      },
      { updateInfoAndProvider: { info, provider: { resolveFiles: () => resolved } } },
    );
    assert.match(selected.url.pathname, new RegExp(`-${expectedArch}\\.zip$`));
    assert.equal(
      selected.info.sha512,
      info.files.find((file) => file.url.endsWith(`-${expectedArch}.zip`)).sha512,
    );
  }
});

test("verify 接受 files 顺序不同但语义完全一致的已上传清单", async (t) => {
  const f = await fixture(t);
  const { manifests } = await merge(f);
  const mac = manifests["latest-mac.yml"];
  mac.files.reverse();
  await writeYaml(join(f.outDirectory, "latest-mac.yml"), mac);
  assert.deepEqual(await verify(f, await manifestRelease(f)), { verifiedManifests: 4 });
});

const verifyFailures = {
  "安装包 SHA-512 错误": (manifest) => {
    manifest.files[0].sha512 = hash("bad", "sha512", "base64");
  },
  "安装包 size 错误": (manifest) => {
    manifest.files[0].size += 1;
  },
  "重复 URL": (manifest) => {
    manifest.files.push({ ...manifest.files[0] });
  },
  "mac 清单被另一架构覆盖": (manifest) => {
    manifest.files = manifest.files.filter((file) => file.url.includes("-x64."));
  },
  额外非分发包: (manifest) => {
    manifest.files.push({
      url: `ZCodium-${version}-linux-x86_64.deb`,
      sha512: hash("deb", "sha512", "base64"),
      size: 3,
    });
  },
  "legacy path 指向 arm64 zip": (manifest) => {
    const file = manifest.files.find((file) => file.url.endsWith("-arm64.zip"));
    manifest.path = file.url;
    manifest.sha512 = file.sha512;
  },
  "legacy SHA-512 不匹配": (manifest) => {
    manifest.sha512 = hash("bad", "sha512", "base64");
  },
  版本错误: (manifest) => {
    manifest.version = "9.8.6";
  },
  "releaseDate 不是片段日期": (manifest) => {
    manifest.releaseDate = "2026-10-24T12:00:00.000Z";
  },
};

for (const [name, mutate] of Object.entries(verifyFailures)) {
  test(`verify 即使清单自身远端 digest 正确，也拒绝${name}`, async (t) => {
    const f = await fixture(t);
    const { manifests } = await merge(f);
    const manifest = manifests["latest-mac.yml"];
    mutate(manifest);
    await writeYaml(join(f.outDirectory, "latest-mac.yml"), manifest);
    const before = await directoryContents(f.outDirectory);
    const release = await manifestRelease(f);
    await assert.rejects(() => verify(f, release));
    assert.deepEqual(await directoryContents(f.outDirectory), before);
  });
}

test("verify 按实际 YAML 字节核对上传 digest，不把相同语义当作相同上传内容", async (t) => {
  const f = await fixture(t);
  await merge(f);
  const release = await manifestRelease(f);
  const path = join(f.outDirectory, "latest-mac.yml");
  await writeFile(path, `${await readFile(path, "utf8")}\n`);
  await assert.rejects(() => verify(f, release));
});

for (const mutation of ["missing", "symlink", "remote-digest", "remote-asset"]) {
  test(`verify 拒绝最终清单异常：${mutation}`, async (t) => {
    const f = await fixture(t);
    await merge(f);
    const release = await manifestRelease(f);
    const path = join(f.outDirectory, "latest-linux-arm64.yml");
    if (mutation === "missing") await rm(path);
    if (mutation === "symlink") {
      const target = join(f.root, "manifest-real.yml");
      await copyFile(path, target);
      await rm(path);
      await symlink(target, path);
    }
    const assetIndex = release.assets.findIndex((asset) => asset.name === "latest-linux-arm64.yml");
    if (mutation === "remote-digest")
      release.assets[assetIndex].digest = `sha256:${"0".repeat(64)}`;
    if (mutation === "remote-asset") release.assets.splice(assetIndex, 1);
    await assert.rejects(() => verify(f, release));
  });
}

test("Windows matrix 的 stage 显式使用 Bash，不能用 PowerShell 展开 $VERSION", async () => {
  const workflow = YAML.parse(
    await readFile(join(repoRoot, ".github/workflows/release.yml"), "utf8"),
  );
  assert.ok(
    workflow.jobs.desktop.strategy.matrix.include.some((target) => target.target === "win"),
  );
  const stage = workflow.jobs.desktop.steps.find((step) =>
    /release-update-metadata\.mjs\s+stage\b/.test(step.run ?? ""),
  );
  assert.equal(stage?.shell, "bash");
});

test("release workflow 仅 update-metadata 上传最终清单，publish 显式等待校验成功", async () => {
  const workflow = YAML.parse(
    await readFile(join(repoRoot, ".github/workflows/release.yml"), "utf8"),
  );
  const jobs = workflow.jobs;
  const metadata = jobs["update-metadata"];
  assert.ok(metadata, "必须存在唯一的 update-metadata owner");
  const needs = Array.isArray(metadata.needs) ? metadata.needs : [metadata.needs];
  assert.ok(needs.includes("desktop"));
  assert.ok(needs.includes("release"));
  const runSteps = (job) => job.steps.filter((step) => typeof step.run === "string");
  const executable = (run) =>
    run
      .split("\n")
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
  const desktopRuns = runSteps(jobs.desktop).map((step) => executable(step.run));
  assert.ok(desktopRuns.some((run) => /release-update-metadata\.mjs\s+stage\b/.test(run)));
  const desktopUploads = desktopRuns.filter((run) => /gh\s+release\s+upload\b/.test(run));
  assert.ok(desktopUploads.length > 0);
  assert.ok(
    desktopUploads.every((run) => !/latest[^\s]*\.yml/.test(run)),
    "matrix 不能再上传同名 latest",
  );
  assert.ok(
    desktopUploads.some((run) => /upload-paths\.txt/.test(run)),
    "matrix 必须使用 stage 的准入上传列表",
  );
  const metadataRuns = runSteps(metadata).map((step) => executable(step.run));
  assert.ok(metadataRuns.some((run) => /release-update-metadata\.mjs\s+merge\b/.test(run)));
  assert.ok(metadataRuns.some((run) => /release-update-metadata\.mjs\s+verify\b/.test(run)));
  const manifestOwners = Object.entries(jobs)
    .filter(([, job]) =>
      runSteps(job).some((step) => {
        const run = executable(step.run);
        return /gh\s+release\s+upload\b/.test(run) && /(?:latest[^\s]*\.yml|\*\.yml)/.test(run);
      }),
    )
    .map(([name]) => name);
  assert.deepEqual(manifestOwners, ["update-metadata"]);
  assert.ok(jobs.publish.needs.includes("update-metadata"));
  const expression = jobs.publish.if.replace(/^\s*\$\{\{/, "").replace(/\}\}\s*$/, "");
  const allowsPublish = new Function("needs", "inputs", "always", `return (${expression});`);
  const results = Object.fromEntries(
    jobs.publish.needs.map((name) => [name, { result: "success" }]),
  );
  for (const result of ["success", "failure", "cancelled", "skipped"]) {
    results["update-metadata"].result = result;
    assert.equal(
      Boolean(allowsPublish(results, { keep_draft: false, build_artifacts: true }, () => true)),
      result === "success",
      `build_artifacts=true 时 update-metadata=${result} 的发布门禁错误`,
    );
  }
  results["update-metadata"].result = "success";
  assert.equal(
    Boolean(allowsPublish(results, { keep_draft: true, build_artifacts: true }, () => true)),
    false,
  );
  for (const [name, result] of Object.entries(results))
    if (name !== "release") result.result = "skipped";
  assert.equal(
    Boolean(allowsPublish(results, { keep_draft: false, build_artifacts: false }, () => true)),
    true,
  );
});

/**
 * 远程资源 GitHub Release 发布链路回归：
 * 1) 发布脚本把 mock-cdn 目录式布局转成扁平资产（asset 名无 "/"、无 "+"）；
 * 2) 加载器（ensureRemoteReleaseDirFromCdn）能按扁平 manifest 下载、校验并物化。
 *
 * 运行：node --import tsx --test packages/desktop/tests/remote-assets-github-release.test.mjs
 * 契约见 packages/desktop/specs/remote-assets-github-release.md。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildGithubAssetLayout,
  toGithubArtifactName,
} from "../../../scripts/publish-remote-assets.mjs";
import { packSourceAsDeterministicTarGzip } from "../../../scripts/deterministic-tar-archive.mjs";

const VERSION = "9.9.9";

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function addPlatformFixture(sourceDir, platform, { componentVersion, binaryContent }) {
  const contentDir = join(sourceDir, "..", "fixture-content", platform);
  mkdirSync(contentDir, { recursive: true });
  writeFileSync(join(contentDir, "rg"), binaryContent);

  const componentDir = join(sourceDir, "components", platform, "ripgrep");
  mkdirSync(componentDir, { recursive: true });
  const archivePath = join(componentDir, `${componentVersion}.tar.gz`);
  packSourceAsDeterministicTarGzip(contentDir, archivePath);

  const releaseDir = join(sourceDir, "releases", VERSION);
  mkdirSync(releaseDir, { recursive: true });
  const manifestPath = join(releaseDir, `manifest-${platform}.json`);
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { schemaVersion: 1, appVersion: VERSION, platformArch: platform, components: [] };
  manifest.components.push({
    id: "ripgrep",
    version: componentVersion,
    sha256: sha256File(archivePath),
    artifactPath: `components/${platform}/ripgrep/${componentVersion}.tar.gz`,
    mount: `tools/${platform}/ripgrep`,
  });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { archivePath, componentVersion };
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "zcode-remote-assets-"));
  const sourceDir = join(root, "mock-cdn");
  addPlatformFixture(sourceDir, "linux-x64", {
    componentVersion: "v9.9.9+aaa111bbb222",
    binaryContent: "linux-x64 binary\n",
  });
  addPlatformFixture(sourceDir, "darwin-arm64", {
    componentVersion: "v9.9.9+ccc333ddd444",
    binaryContent: "darwin-arm64 binary\n",
  });
  return { root, sourceDir };
}

test("publish script converts mock-cdn into flat GitHub release layout", () => {
  const { root, sourceDir } = createFixture();
  const outDir = join(root, "out");
  const result = buildGithubAssetLayout({ sourceDir, outDir, expectedVersion: VERSION });

  assert.deepEqual(result.platforms, ["darwin-arm64", "linux-x64"]);
  const manifest = JSON.parse(readFileSync(join(outDir, "zz-manifest-linux-x64.json"), "utf8"));
  const expectedArtifactName = toGithubArtifactName("linux-x64", "ripgrep", "v9.9.9+aaa111bbb222");
  assert.equal(expectedArtifactName, "zz-linux-x64__ripgrep__v9.9.9-aaa111bbb222.tar.gz");
  assert.equal(
    manifest.components[0].artifactPath,
    expectedArtifactName,
    "artifactPath 必须重写为扁平名",
  );
  assert.equal(
    manifest.components[0].version,
    "v9.9.9+aaa111bbb222",
    "version 字段保持原值供身份判断",
  );
  assert.equal(
    sha256File(join(outDir, manifest.components[0].artifactPath)),
    manifest.components[0].sha256,
    "扁平化不得改变文件内容与 sha256",
  );

  for (const name of readdirSync(outDir)) {
    assert.ok(name.startsWith("zz-"), `发布资产必须带 zz- 排序前缀: ${name}`);
    assert.ok(!name.includes("/"), `asset 名不得含 /: ${name}`);
    assert.ok(!name.includes("+"), `asset 名不得含 +: ${name}`);
  }
  for (const manifestName of readdirSync(outDir).filter((name) =>
    name.startsWith("zz-manifest-"),
  )) {
    const current = JSON.parse(readFileSync(join(outDir, manifestName), "utf8"));
    for (const component of current.components) {
      assert.ok(
        existsSync(join(outDir, component.artifactPath)),
        `manifest 引用的资产必须存在: ${component.artifactPath}`,
      );
    }
  }
});

test("publish script supports platform filtering", () => {
  const { root, sourceDir } = createFixture();
  const outDir = join(root, "out");
  const result = buildGithubAssetLayout({
    sourceDir,
    outDir,
    expectedVersion: VERSION,
    platforms: ["linux-x64"],
  });

  assert.deepEqual(result.platforms, ["linux-x64"]);
  assert.ok(existsSync(join(outDir, "zz-manifest-linux-x64.json")));
  assert.ok(!existsSync(join(outDir, "zz-manifest-darwin-arm64.json")));
});

test("publish script rejects missing component artifacts", () => {
  const { root, sourceDir } = createFixture();
  rmSync(join(sourceDir, "components", "linux-x64", "ripgrep", "v9.9.9+aaa111bbb222.tar.gz"));

  assert.throws(
    () =>
      buildGithubAssetLayout({ sourceDir, outDir: join(root, "out"), expectedVersion: VERSION }),
    /component artifact missing/u,
  );
});

test("publish script rejects component sha256 mismatch", () => {
  const { root, sourceDir } = createFixture();
  const manifestPath = join(sourceDir, "releases", VERSION, "manifest-linux-x64.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.components[0].sha256 = "0".repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  assert.throws(
    () =>
      buildGithubAssetLayout({ sourceDir, outDir: join(root, "out"), expectedVersion: VERSION }),
    /sha256 mismatch/u,
  );
});

test("client manifest candidates prefer the zz- layout and keep the legacy fallback", async () => {
  const { buildRemoteAssetManifestFileCandidates } =
    await import("../../server/src/remote/remoteAssetCache.ts");
  assert.deepEqual(buildRemoteAssetManifestFileCandidates("linux-x64"), [
    "zz-manifest-linux-x64.json",
    "manifest-linux-x64.json",
  ]);
});

test("flat layout downloads and materializes through the remote asset loader", async () => {
  const { root, sourceDir } = createFixture();
  const outDir = join(root, "out");
  buildGithubAssetLayout({
    sourceDir,
    outDir,
    expectedVersion: VERSION,
    platforms: ["linux-x64"],
  });

  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const target = join(outDir, ...pathname.split("/").filter(Boolean));
    if (!target.startsWith(outDir) || !existsSync(target) || !statSync(target).isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/octet-stream" });
    response.end(readFileSync(target));
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const { ensureRemoteReleaseDirFromCdn } =
      await import("../../server/src/remote/remoteAssetCache.ts");
    const cacheDir = join(root, "cache");
    const releaseDir = await ensureRemoteReleaseDirFromCdn(
      {
        remoteCdnBaseUrls: [`http://127.0.0.1:${address.port}`],
        remoteCacheDir: cacheDir,
        version: VERSION,
        platformArch: "linux-x64",
        componentIds: ["ripgrep"],
        manifestRequestTimeoutMs: 10_000,
      },
      { log() {}, logWarn() {} },
    );

    assert.equal(releaseDir, join(cacheDir, "releases", VERSION, "linux-x64"));
    assert.equal(
      readFileSync(join(releaseDir, "tools", "linux-x64", "ripgrep", "rg"), "utf8"),
      "linux-x64 binary\n",
      "组件必须按 mount 物化到 release 目录",
    );
  } finally {
    await new Promise((resolveClose, rejectClose) =>
      server.close((error) => (error ? rejectClose(error) : resolveClose())),
    );
  }
});

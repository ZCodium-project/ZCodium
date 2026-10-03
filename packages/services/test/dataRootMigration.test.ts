import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_ROOT_MANIFEST_FILE_NAME } from "@zcode/shared";

// 迁移函数单测：候选探测、大小统计、复制落位、取消清理。
// 所有操作只发生在临时目录；不触碰真实 HOME 与 /.zcode。

async function loadMigration() {
  return import("../src/data-root/migration.js");
}

function makeBase() {
  return mkdtempSync(join(tmpdir(), "zcodium-migration-"));
}

function seedLegacy(base: string): string {
  const legacy = join(base, ".zcode");
  mkdirSync(join(legacy, "v2"), { recursive: true });
  mkdirSync(join(legacy, "cli", "db"), { recursive: true });
  writeFileSync(join(legacy, "v2", "setting.json"), '{"marker":"legacy"}');
  writeFileSync(join(legacy, "cli", "db", "db.sqlite"), "db-bytes");
  return legacy;
}

test("discoverLegacyDataRootCandidates：主 base + 旧 setting.json 的自定义目录", async () => {
  const migration = await loadMigration();
  const base = makeBase();
  const customBase = mkdtempSync(join(tmpdir(), "zcodium-custom-base-"));
  try {
    const legacy = seedLegacy(base);
    const customLegacy = seedLegacy(customBase);
    // 旧 setting.json 指向自定义数据目录。
    writeFileSync(join(legacy, "v2", "setting.json"), JSON.stringify({ dataBaseDir: customBase }));
    const candidates = migration.discoverLegacyDataRootCandidates(base);
    assert.equal(candidates.length, 2);
    assert.equal(candidates[0]?.isPrimaryBase, true);
    assert.equal(candidates[0]?.legacyRoot, legacy);
    assert.equal(candidates[1]?.legacyRoot, customLegacy);
    assert.equal(candidates[1]?.baseDir, customBase);
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(customBase, { recursive: true, force: true });
  }
});

test("collectLegacyCandidateStats：统计大小与最后修改时间", async () => {
  const migration = await loadMigration();
  const base = makeBase();
  try {
    const legacy = seedLegacy(base);
    const stats = await migration.collectLegacyCandidateStats(legacy);
    assert.equal(stats.sizeBytes > 0, true);
    assert.ok(stats.modifiedAt);
    assert.equal(stats.itemCount >= 4, true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("executeDataRootCopyMigration：完整复制、跳过快照文件、旧根保留、归属含 migration", async () => {
  const migration = await loadMigration();
  const base = makeBase();
  try {
    const legacy = seedLegacy(base);
    // 原子写中间态与锁文件不应被带入新根。
    writeFileSync(join(legacy, "v2", "setting.json.lock"), "lock");
    writeFileSync(join(legacy, "v2", "setting.json.123.tmp"), "tmp");
    // 符号链接在 Windows 非提权环境会复制失败，统一跳过。
    try {
      symlinkSync(join(legacy, "v2", "setting.json"), join(legacy, "v2", "link.json"));
    } catch {
      // 平台不支持时跳过该构造。
    }

    const phases: string[] = [];
    const result = await migration.executeDataRootCopyMigration({
      candidates: [{ baseDir: base, legacyRoot: legacy, isPrimaryBase: true }],
      createdBy: "desktop",
      appVersion: "3.15.0",
      onProgress: (progress) => phases.push(progress.phase),
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const nextRoot = join(base, ".zcodium");
    assert.equal(readFileSync(join(nextRoot, "v2", "setting.json"), "utf8"), '{"marker":"legacy"}');
    assert.equal(readFileSync(join(nextRoot, "cli", "db", "db.sqlite"), "utf8"), "db-bytes");
    assert.equal(existsSync(join(nextRoot, "v2", "setting.json.lock")), false);
    assert.equal(existsSync(join(nextRoot, "v2", "setting.json.123.tmp")), false);
    // 复制而非移动：旧根原样保留。
    assert.equal(existsSync(join(legacy, "v2", "setting.json")), true);
    const manifest = JSON.parse(readFileSync(join(nextRoot, DATA_ROOT_MANIFEST_FILE_NAME), "utf8"));
    assert.equal(manifest.migration.mode, "copy");
    assert.equal(manifest.migration.from, legacy);
    assert.equal(phases.includes("copying"), true);
    assert.equal(phases.includes("finalizing"), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("executeDataRootCopyMigration：取消时清理 staging 且目标不落位", async () => {
  const migration = await loadMigration();
  const base = makeBase();
  try {
    const legacy = seedLegacy(base);
    let checks = 0;
    const result = await migration.executeDataRootCopyMigration({
      candidates: [{ baseDir: base, legacyRoot: legacy, isPrimaryBase: true }],
      createdBy: "desktop",
      appVersion: "3.15.0",
      isCancelled: () => {
        checks += 1;
        return checks > 1;
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.cancelled, true);
    assert.equal(existsSync(join(base, ".zcodium")), false);
    assert.equal(
      readdirSync(base).some((name) => name.startsWith(".zcodium.migrating-")),
      false,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "executeDataRootCopyMigration：保留源文件权限（凭据 0600 不放宽）",
  { skip: process.platform === "win32" && "Windows 无 POSIX 权限位" },
  async () => {
    const migration = await loadMigration();
    const base = makeBase();
    try {
      const legacy = seedLegacy(base);
      const credentialsPath = join(legacy, "v2", "credentials.json");
      writeFileSync(credentialsPath, '{"secret":"encrypted"}');
      chmodSync(credentialsPath, 0o600);
      const result = await migration.executeDataRootCopyMigration({
        candidates: [{ baseDir: base, legacyRoot: legacy, isPrimaryBase: true }],
        createdBy: "desktop",
        appVersion: "3.15.0",
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      const copiedPath = join(base, ".zcodium", "v2", "credentials.json");
      assert.equal(statSync(copiedPath).mode & 0o777, 0o600);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },
);

import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";

// 迁移逻辑按 getDataBaseDir() 相对运作；测试用 setDataBaseDir 指向独立临时 base，
// 不依赖 env、不触碰真实 HOME。node:test 每文件独立进程，互不影响。

async function loadPaths() {
  return import("../src/paths.js");
}

function makeBase() {
  return mkdtempSync(join(tmpdir(), "zcodium-migrate-"));
}

test("旧根存在时整体复制到 .zcodium，旧根保留并写入标记", async () => {
  const { setDataBaseDir, migrateLegacyZCodeDataRoot, getZCodeDataRootDir } = await loadPaths();
  const base = makeBase();
  try {
    const legacy = join(base, ".zcode");
    mkdirSync(join(legacy, "v2"), { recursive: true });
    mkdirSync(join(legacy, "cli", "db"), { recursive: true });
    writeFileSync(join(legacy, "v2", "setting.json"), '{"marker":"legacy"}');
    writeFileSync(join(legacy, "cli", "db", "db.sqlite"), "db-bytes");
    setDataBaseDir(base);
    migrateLegacyZCodeDataRoot();
    const nextRoot = getZCodeDataRootDir();
    assert.equal(nextRoot, join(base, ".zcodium"));
    assert.equal(readFileSync(join(nextRoot, "v2", "setting.json"), "utf8"), '{"marker":"legacy"}');
    assert.equal(readFileSync(join(nextRoot, "cli", "db", "db.sqlite"), "utf8"), "db-bytes");
    // 复制而非移动：官方 ZCode 客户端可能仍依赖旧根。
    assert.equal(existsSync(join(legacy, "v2", "setting.json")), true);
    assert.equal(existsSync(join(legacy, ".migrated-to-zcodium")), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("用户删除新根视为重置：标记生效，不再重新灌入", async () => {
  const { setDataBaseDir, migrateLegacyZCodeDataRoot, getZCodeDataRootDir } = await loadPaths();
  const base = makeBase();
  try {
    const legacy = join(base, ".zcode");
    mkdirSync(join(legacy, "v2"), { recursive: true });
    writeFileSync(join(legacy, "v2", "x"), "x");
    setDataBaseDir(base);
    migrateLegacyZCodeDataRoot();
    rmSync(getZCodeDataRootDir(), { recursive: true, force: true });
    migrateLegacyZCodeDataRoot();
    assert.equal(existsSync(join(base, ".zcodium")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("无旧根或新根已存在时为 no-op", async () => {
  const { setDataBaseDir, migrateLegacyZCodeDataRoot } = await loadPaths();
  const base = makeBase();
  try {
    setDataBaseDir(base);
    migrateLegacyZCodeDataRoot();
    assert.equal(existsSync(join(base, ".zcodium")), false);
    // 新根已存在时不被覆盖。
    mkdirSync(join(base, ".zcodium"), { recursive: true });
    writeFileSync(join(base, ".zcodium", "keep"), "keep");
    mkdirSync(join(base, ".zcode"), { recursive: true });
    writeFileSync(join(base, ".zcode", "legacy"), "legacy");
    migrateLegacyZCodeDataRoot();
    assert.equal(existsSync(join(base, ".zcodium", "legacy")), false);
    assert.equal(readFileSync(join(base, ".zcodium", "keep"), "utf8"), "keep");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("base 未显式设置时默认解析到 HOME（回归保护）", async () => {
  const { setDataBaseDir, getDataBaseDir } = await loadPaths();
  setDataBaseDir(null);
  assert.equal(getDataBaseDir(), process.env.HOME?.trim() || homedir());
});

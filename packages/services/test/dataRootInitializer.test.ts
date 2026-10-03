import assert from "node:assert/strict";
import test from "node:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_ROOT_MANIFEST_FILE_NAME, DATA_ROOT_PRODUCT_ID } from "@zcode/shared";

// 初始化器状态机测试：interactive（桌面决策）与非交互（CLI/server）两条路径。
// pending 会把数据根解析重定向到进程诊断根，测试结束必须 reset，避免污染后续用例。

async function loadInitializer() {
  return import("../src/data-root/initializer.js");
}

async function loadPaths() {
  return import("../src/paths.js");
}

function makeBase() {
  return mkdtempSync(join(tmpdir(), "zcodium-initializer-"));
}

function seedLegacyRoot(base: string): string {
  const legacy = join(base, ".zcode");
  mkdirSync(join(legacy, "v2"), { recursive: true });
  mkdirSync(join(legacy, "cli", "db"), { recursive: true });
  writeFileSync(join(legacy, "v2", "setting.json"), '{"marker":"legacy"}');
  writeFileSync(join(legacy, "cli", "db", "db.sqlite"), "db-bytes");
  writeFileSync(join(legacy, "v2", "telemetry-state.json"), '{"deviceMid":"legacy-device"}');
  return legacy;
}

test("interactive：正常根直接复用", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    init.initializeFreshDataRoot({ baseDir: base, createdBy: "desktop", appVersion: "3.15.0" });
    const result = init.initializeDataRootInteractive({
      baseDir: base,
      createdBy: "desktop",
      appVersion: "3.15.0",
    });
    assert.equal(result.state, "ready");
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test("interactive：absent 且无旧根直接初始化", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    const result = init.initializeDataRootInteractive({
      baseDir: base,
      createdBy: "desktop",
      appVersion: "3.15.0",
    });
    assert.equal(result.state, "initialized");
    assert.equal(existsSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME)), true);
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test("interactive：absent + 旧根 → pending，正式根零写入且路径重定向到诊断根", async () => {
  const init = await loadInitializer();
  const paths = await loadPaths();
  const base = makeBase();
  try {
    seedLegacyRoot(base);
    const result = init.initializeDataRootInteractive({
      baseDir: base,
      createdBy: "desktop",
      appVersion: "3.15.0",
    });
    assert.equal(result.state, "pending");
    // 正式根没有产生任何写入（归属文件落盘前零写入）。
    assert.equal(existsSync(join(base, ".zcodium")), false);
    const diagnosticRoot = init.getActiveDiagnosticRoot();
    assert.ok(diagnosticRoot);
    assert.equal(paths.getZCodeDataRootDir(), diagnosticRoot);
    assert.equal(paths.getZCodeDataRootDir().startsWith(base), false);
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "pending：诊断根目录权限为 0700（仅当前用户可访问）",
  { skip: process.platform === "win32" && "Windows 无 POSIX 权限位" },
  async () => {
    const init = await loadInitializer();
    const base = makeBase();
    try {
      seedLegacyRoot(base);
      const result = init.initializeDataRootInteractive({
        baseDir: base,
        createdBy: "desktop",
        appVersion: "3.15.0",
      });
      assert.equal(result.state, "pending");
      const diagnosticRoot = init.getActiveDiagnosticRoot();
      assert.ok(diagnosticRoot);
      assert.equal(statSync(diagnosticRoot).mode & 0o777, 0o700);
    } finally {
      init.resetDataRootInitializerForTest();
      rmSync(base, { recursive: true, force: true });
    }
  },
);

test("interactive：unowned 不静默复用", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    mkdirSync(join(base, ".zcodium", "v2"), { recursive: true });
    const result = init.initializeDataRootInteractive({
      baseDir: base,
      createdBy: "desktop",
      appVersion: "3.15.0",
    });
    assert.equal(result.state, "pending");
    if (result.state === "pending") {
      assert.equal(result.status.kind, "unowned");
    }
    // pending 阶段不备份、不写入：冲突处置只发生在用户做出选择之后。
    assert.equal(existsSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME)), false);
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test("nonInteractive：unowned 备份让路 + 全新初始化", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    mkdirSync(join(base, ".zcodium", "v2"), { recursive: true });
    writeFileSync(join(base, ".zcodium", "v2", "other.json"), "other");
    const result = await init.initializeDataRootNonInteractive({
      baseDir: base,
      createdBy: "cli",
      appVersion: "3.15.0",
      action: "fresh",
    });
    assert.equal(result.state, "initialized");
    assert.ok(result.forfeitedRoot);
    assert.equal(readFileSync(join(result.forfeitedRoot, "v2", "other.json"), "utf8"), "other");
    const manifest = JSON.parse(
      readFileSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME), "utf8"),
    );
    assert.equal(manifest.createdBy, "cli");
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test("nonInteractive：action=fail 时拒绝启动且不写状态", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    mkdirSync(join(base, ".zcodium", "v2"), { recursive: true });
    await assert.rejects(
      init.initializeDataRootNonInteractive({
        baseDir: base,
        createdBy: "server",
        appVersion: "3.15.0",
        action: "fail",
      }),
      /拒绝启动/u,
    );
    assert.equal(existsSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME)), false);
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test("nonInteractive：action=migrate 复制旧数据并写 migration 归属", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    const legacy = seedLegacyRoot(base);
    const result = await init.initializeDataRootNonInteractive({
      baseDir: base,
      createdBy: "cli",
      appVersion: "3.15.0",
      action: "migrate",
    });
    assert.equal(result.state, "initialized");
    assert.equal(result.initializedBy, "migration");
    // 数据完整 + deviceMid 带入 + 旧根保留。
    assert.equal(
      readFileSync(join(base, ".zcodium", "cli", "db", "db.sqlite"), "utf8"),
      "db-bytes",
    );
    assert.equal(
      JSON.parse(readFileSync(join(base, ".zcodium", "v2", "telemetry-state.json"), "utf8"))
        .deviceMid,
      "legacy-device",
    );
    assert.equal(existsSync(join(legacy, "v2", "setting.json")), true);
    const manifest = JSON.parse(
      readFileSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME), "utf8"),
    );
    assert.equal(manifest.product, DATA_ROOT_PRODUCT_ID);
    assert.equal(manifest.migration.mode, "copy");
    assert.equal(manifest.migration.from, legacy);
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test("executeDataRootImport：备份现有根后以 import 模式导入", async () => {
  const init = await loadInitializer();
  const base = makeBase();
  try {
    const legacy = seedLegacyRoot(base);
    // 现有合法根，含用户新数据。
    init.initializeFreshDataRoot({ baseDir: base, createdBy: "desktop", appVersion: "3.15.0" });
    mkdirSync(join(base, ".zcodium", "v2"), { recursive: true });
    writeFileSync(join(base, ".zcodium", "v2", "current.json"), "current");
    const result = await init.executeDataRootImport({
      baseDir: base,
      candidates: [{ baseDir: base, legacyRoot: legacy, isPrimaryBase: true }],
      createdBy: "desktop",
      appVersion: "3.15.0",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(result.backupRoot);
    assert.equal(readFileSync(join(result.backupRoot, "v2", "current.json"), "utf8"), "current");
    const manifest = JSON.parse(
      readFileSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME), "utf8"),
    );
    assert.equal(manifest.migration.mode, "import");
  } finally {
    init.resetDataRootInitializerForTest();
    rmSync(base, { recursive: true, force: true });
  }
});

test(
  "import：迁移失败时返回备份落点（现有根可恢复）",
  {
    skip:
      process.platform === "win32"
        ? "依赖 POSIX 权限位模拟复制失败"
        : typeof process.getuid === "function" && process.getuid() === 0
          ? "root 可读任意文件，无法用权限位模拟复制失败"
          : false,
  },
  async () => {
    const init = await loadInitializer();
    const base = makeBase();
    try {
      // 现有合法根：导入前会被整体备份。
      init.initializeFreshDataRoot({
        baseDir: base,
        createdBy: "desktop",
        appVersion: "3.15.0",
      });
      const legacy = seedLegacyRoot(base);
      const blocked = join(legacy, "v2", "blocked.bin");
      writeFileSync(blocked, "blocked");
      chmodSync(blocked, 0o000);
      const result = await init.executeDataRootImport({
        baseDir: base,
        candidates: [{ baseDir: base, legacyRoot: legacy, isPrimaryBase: true }],
        createdBy: "desktop",
        appVersion: "3.15.0",
      });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.ok(result.backupRoot, "失败时必须返回备份落点");
      assert.equal(existsSync(result.backupRoot), true);
      // 现有根已让位到备份；正式根等待用户手动恢复或重新初始化。
      assert.equal(existsSync(join(base, ".zcodium")), false);
    } finally {
      init.resetDataRootInitializerForTest();
      rmSync(base, { recursive: true, force: true });
    }
  },
);

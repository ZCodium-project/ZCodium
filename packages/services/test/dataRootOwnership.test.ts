import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DATA_ROOT_MANIFEST_FILE_NAME,
  DATA_ROOT_MANIFEST_SCHEMA_VERSION,
  DATA_ROOT_PRODUCT_ID,
} from "@zcode/shared";

// 归属判定与备份让路的单测：只操作临时目录，不触碰真实 HOME。

async function loadOwnership() {
  return import("../src/data-root/ownership.js");
}

function makeBase() {
  return mkdtempSync(join(tmpdir(), "zcodium-ownership-"));
}

function writeManifestFile(base: string, raw: string): void {
  const root = join(base, ".zcodium");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, DATA_ROOT_MANIFEST_FILE_NAME), raw);
}

function validManifest(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    product: DATA_ROOT_PRODUCT_ID,
    schemaVersion: DATA_ROOT_MANIFEST_SCHEMA_VERSION,
    createdBy: "desktop",
    createdAt: new Date().toISOString(),
    firstSeenVersion: "3.15.0",
    ...overrides,
  });
}

test("absent：数据根目录不存在", async () => {
  const { readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    assert.equal(readDataRootStatus(base).kind, "absent");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("normal：合法归属文件", async () => {
  const { readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    writeManifestFile(base, validManifest());
    const status = readDataRootStatus(base);
    assert.equal(status.kind, "normal");
    if (status.kind === "normal") {
      assert.equal(status.manifest.product, DATA_ROOT_PRODUCT_ID);
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("unowned：有目录但没有归属文件", async () => {
  const { readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    mkdirSync(join(base, ".zcodium", "v2"), { recursive: true });
    const status = readDataRootStatus(base);
    assert.equal(status.kind, "unowned");
    if (status.kind === "unowned") {
      assert.equal(status.reason, "manifest-missing");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("unowned：归属文件 product 不匹配", async () => {
  const { readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    writeManifestFile(base, validManifest({ product: "dev.some-other.app" }));
    const status = readDataRootStatus(base);
    assert.equal(status.kind, "unowned");
    if (status.kind === "unowned") {
      assert.equal(status.reason, "product-mismatch");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("corrupt：归属文件不可解析", async () => {
  const { readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    writeManifestFile(base, "{ not-json");
    const status = readDataRootStatus(base);
    assert.equal(status.kind, "corrupt");
    if (status.kind === "corrupt") {
      assert.equal(status.reason, "manifest-unreadable");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("corrupt：schemaVersion 过新（降级场景）", async () => {
  const { readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    writeManifestFile(
      base,
      validManifest({ schemaVersion: DATA_ROOT_MANIFEST_SCHEMA_VERSION + 1 }),
    );
    const status = readDataRootStatus(base);
    assert.equal(status.kind, "corrupt");
    if (status.kind === "corrupt") {
      assert.equal(status.reason, "schema-unsupported");
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("writeDataRootManifest 原子写：内容完整且不残留临时文件", async () => {
  const { readDataRootStatus, writeDataRootManifest } = await loadOwnership();
  const base = makeBase();
  try {
    const manifest = {
      product: DATA_ROOT_PRODUCT_ID,
      schemaVersion: DATA_ROOT_MANIFEST_SCHEMA_VERSION,
      createdBy: "cli" as const,
      createdAt: new Date().toISOString(),
      firstSeenVersion: "3.15.0",
    };
    writeDataRootManifest(base, manifest);
    assert.equal(readDataRootStatus(base).kind, "normal");
    const rootFiles = readdirSync(join(base, ".zcodium"));
    assert.equal(
      rootFiles.some((name) => name.endsWith(".tmp")),
      false,
    );
    const parsed = JSON.parse(
      readFileSync(join(base, ".zcodium", DATA_ROOT_MANIFEST_FILE_NAME), "utf8"),
    );
    assert.equal(parsed.createdBy, "cli");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("forfeitConflictingDataRoot：整体备份且原目录内容保留", async () => {
  const { forfeitConflictingDataRoot, readDataRootStatus } = await loadOwnership();
  const base = makeBase();
  try {
    mkdirSync(join(base, ".zcodium", "v2"), { recursive: true });
    writeFileSync(join(base, ".zcodium", "v2", "other-product.json"), "keep-me");
    const status = readDataRootStatus(base);
    assert.equal(status.kind, "unowned");
    if (status.kind !== "unowned") return;
    const backup = forfeitConflictingDataRoot(base, status);
    assert.ok(backup);
    assert.equal(existsSync(join(base, ".zcodium")), false);
    assert.equal(readFileSync(join(backup, "v2", "other-product.json"), "utf8"), "keep-me");
    assert.match(backup, /\.zcodium\.unowned-/u);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

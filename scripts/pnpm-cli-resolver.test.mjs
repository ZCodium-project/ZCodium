import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { isJsEntryPath, resolvePnpmCliPath } from "./pnpm-cli-resolver.mjs";

test("isJsEntryPath 只认 .cjs/.mjs/.js 形态", () => {
  assert.equal(isJsEntryPath("tools/pnpm/bin/pnpm.cjs"), true);
  assert.equal(isJsEntryPath("tools\\pnpm\\pnpm.mjs"), true);
  assert.equal(isJsEntryPath("tools/pnpm/10.33.2/pnpm"), false);
  assert.equal(isJsEntryPath("tools/pnpm/10.33.2/pnpm.EXE"), false);
});

test("npm_execpath 指向原生 pnpm.exe（mise 独立版）时不得作为 JS 入口候选", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pnpm-resolver-"));
  try {
    // join 的分隔符随平台变化，但两种形态都命中 npm_execpath 的 \pnpm\ / /pnpm/ 判定，
    // 再由扩展名校验拒绝：这正是 #54 里 mise 独立版 pnpm 的实际形态。
    const env = { npm_execpath: join(dir, "installs", "pnpm", "10.33.2", "pnpm.exe"), PATH: "" };
    assert.equal(resolvePnpmCliPath(env), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("npm_execpath 为 JS 形态时原样采用", () => {
  const windowsStyle = { npm_execpath: "X:\\tools\\pnpm\\10.33.2\\pnpm.cjs", PATH: "" };
  assert.equal(resolvePnpmCliPath(windowsStyle), windowsStyle.npm_execpath);
  const posixStyle = { npm_execpath: "/home/dev/.local/share/pnpm/pnpm.cjs", PATH: "" };
  assert.equal(resolvePnpmCliPath(posixStyle), posixStyle.npm_execpath);
});

test("npm_execpath 缺席或非法时回退 PATH 上的 node_modules/pnpm/bin/pnpm.cjs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pnpm-resolver-"));
  try {
    const candidate = join(dir, "node_modules", "pnpm", "bin", "pnpm.cjs");
    await mkdir(join(dir, "node_modules", "pnpm", "bin"), { recursive: true });
    await writeFile(candidate, "// pnpm cli stub\n");

    const withBadExecPath = { npm_execpath: join(dir, "pnpm.exe"), PATH: dir };
    assert.equal(resolvePnpmCliPath(withBadExecPath), candidate);
    assert.equal(resolvePnpmCliPath({ PATH: dir }), candidate);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import test from "node:test";

// 本文件必须在 ZCODE_DATA_BASE_DIR 已设置的前提下加载 paths 模块：
// 模块加载期捕获 env，动态 import 保证捕获顺序。node:test 每个文件独立进程，
// 不会污染其他测试文件的模块状态。

process.env.ZCODE_DATA_BASE_DIR = "/isolated-data-root";

test("ZCODE_DATA_BASE_DIR 生效时 setDataBaseDir 是 no-op（隔离硬边界）", async () => {
  const paths = await import("../src/paths.js");
  assert.equal(paths.isDataBaseDirEnvOverrideActive(), true);
  // 曾发生的事故：桌面 bootstrap 用真实 HOME 的 setting.json 覆盖隔离目录，
  // dev 实例把真实 credentials.json 重写。此处钉死 env 优先于任何编程式覆盖。
  paths.setDataBaseDir("/real-home-data");
  assert.equal(paths.getDataBaseDir(), "/isolated-data-root");
  paths.setDataBaseDir(null);
  assert.equal(paths.getDataBaseDir(), "/isolated-data-root");
});

test("env 锁定后派生路径全部落在隔离目录内", async () => {
  const paths = await import("../src/paths.js");
  assert.equal(paths.getZCodeDataRootDir().replaceAll("\\", "/"), "/isolated-data-root/.zcode");
});

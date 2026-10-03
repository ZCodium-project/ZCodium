import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";

// 未注入 ZCODE_DATA_BASE_DIR 时保持既有语义：设置文件发现的 dataBaseDir
// （setDataBaseDir）继续生效，正式用户重定位数据目录的能力不受影响。
// node:test 每个文件独立进程，本文件不会读到其他文件设置的 env。

test("未设置 env 时 setDataBaseDir 与重置保持原有行为", async () => {
  const { setDataBaseDir, getDataBaseDir, isDataBaseDirEnvOverrideActive } =
    await import("../src/paths.js");
  assert.equal(isDataBaseDirEnvOverrideActive(), false);
  setDataBaseDir("/relocated-data");
  assert.equal(getDataBaseDir(), "/relocated-data");
  setDataBaseDir(null);
  // 模块加载期捕获的默认值：HOME 优先，其次 OS homedir。
  assert.equal(getDataBaseDir(), process.env.HOME?.trim() || homedir());
});

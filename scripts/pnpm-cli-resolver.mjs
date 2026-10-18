// resolvePnpmCliPath 的独立模块：run-affected-unit-tests.mjs 顶层即执行 main()，
// 无法被测试直接导入，这里抽出纯函数便于单测覆盖（scripts 测试走 node --test）。
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

// 候选会被 process.execPath 当作 JS 入口执行，只接受 JS 形态的文件：
// mise 独立版 pnpm 的 npm_execpath 指向原生 pnpm.exe（MZ 头二进制），
// 直接喂给 node 会以 SyntaxError 崩溃（#54），此时应回落到 PATH 搜索或 shell 兜底。
const JS_ENTRY_PATH = /\.(?:cjs|mjs|js)$/iu;

export function isJsEntryPath(file) {
  return JS_ENTRY_PATH.test(file);
}

export function resolvePnpmCliPath(env) {
  const npmExecPath = env.npm_execpath;
  if (
    npmExecPath &&
    (npmExecPath.toLowerCase().includes("\\pnpm\\") ||
      npmExecPath.toLowerCase().includes("/pnpm/")) &&
    isJsEntryPath(npmExecPath)
  ) {
    return npmExecPath;
  }

  const pathEntries = (env.PATH ?? env.Path ?? "")
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const pathEntry of pathEntries) {
    const candidate = join(pathEntry, "node_modules", "pnpm", "bin", "pnpm.cjs");
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

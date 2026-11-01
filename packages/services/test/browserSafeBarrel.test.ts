import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const servicesSrcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const sharedSrcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../shared/src");

/**
 * 根 barrel（src/index.ts）必须保持 browser-safe：renderer 对 @zcode/services、
 * @zcode/shared 的值导入会把 barrel 的整条相对导入链拉进浏览器模块图，任何一层
 * 顶层触达 node:* 都会让 renderer 模块图整体死亡。这一约束在两个根入口的注释里
 * 已有声明（"根入口必须保持 browser-safe，避免 renderer 解析到 node:* 模块"），
 * 但此前只是注释，没有可执行守护——本文件把它固化成测试。
 *
 * 守卫口径（保守优先，宁误报不漏报）：
 * - 沿根 barrel 的值 re-export（`export type` 编译期擦除，豁免）对相对导入做传递
 *   闭包，闭包内任何模块出现 node:* 触达即失败；
 * - 动态 import() 同样算触达：顶层 `await import("node:fs")` 与函数内延迟 import
 *   都按保守口径拦截，不做顶层/函数内区分（外置化配置下 renderer 解析 node: 说明符
 *   直接抛错）；类型位置的 `import("...")` 类型查询虽编译期擦除，也按保守口径计入；
 * - 单引号与双引号等价：守卫不依赖格式化风格；
 * - 源码用 NodeNext 风格说明符，".js"/".mjs" 指向同名的 ".ts"/".mts" 源文件。
 *
 * shared 的 Node 侧能力走 `@zcode/shared/node` 独立入口，不在根 barrel 的值导出
 * 闭包内，两个 barrel 分别断言、互不掩盖。
 */

interface BrowserSafeClosureTarget {
  /** 浏览器侧值导入的入口 barrel（绝对路径）。 */
  entryFile: string;
  /** 失败信息里显示的包名。 */
  packageName: string;
}

function stripCommentsAndTypeStatements(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/(?:import|export)\s+type\s+[^;]*?;/g, "");
}

function collectRelativeSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  // 静态 from 子句（export ... from / import ... from），单双引号都收。
  for (const match of source.matchAll(/from\s*(["'])(\.[^"']+)\1/g)) {
    specifiers.push(match[2] ?? "");
  }
  // 裸 side-effect import（import "./x.js"）。
  for (const match of source.matchAll(/import\s*(["'])(\.[^"']+)\1/g)) {
    specifiers.push(match[2] ?? "");
  }
  // 动态 import("<相对说明符>")：运行时动态导入与类型位置查询都按保守口径计入闭包。
  for (const match of source.matchAll(/import\s*\(\s*(["'])(\.[^"']+)\1/g)) {
    specifiers.push(match[2] ?? "");
  }
  return specifiers;
}

function findNodeSpecifier(source: string): string | null {
  // from 子句 / 动态 import() / 裸 side-effect import / require()，单双引号等价。
  // import( 形态必须排在 import\s* 之前，否则动态导入只被当作裸 import 丢掉括号。
  const hit = source.match(/(?:from|import\s*\(|import\s*|require\s*\()\s*(["'])node:[^"']*\1/);
  return hit ? (hit[0].trim() ?? null) : null;
}

function resolveModule(spec: string, fromDir: string): string {
  const literal = resolve(fromDir, spec);
  // NodeNext 风格说明符：".js"/".mjs" 指向同名的 ".ts"/".mts" 源文件。
  const candidates = [literal];
  if (literal.endsWith(".js")) candidates.push(literal.slice(0, -3) + ".ts");
  if (literal.endsWith(".mjs")) candidates.push(literal.slice(0, -4) + ".mts");
  return candidates.find((candidate) => existsSync(candidate)) ?? literal;
}

function collectBrowserSafeClosureViolations(target: BrowserSafeClosureTarget): string[] {
  const queue = [target.entryFile];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    expect(existsSync(file), `守卫解析到的模块不存在：${file}`).toBe(true);

    const source = stripCommentsAndTypeStatements(readFileSync(file, "utf8"));
    const nodeHit = findNodeSpecifier(source);
    if (nodeHit) {
      violations.push(`${file} → ${nodeHit}`);
      continue;
    }
    for (const spec of collectRelativeSpecifiers(source)) {
      queue.push(resolveModule(spec, dirname(file)));
    }
  }
  return violations;
}

function assertBrowserSafeClosure(target: BrowserSafeClosureTarget): void {
  const violations = collectBrowserSafeClosureViolations(target);
  expect(
    violations,
    `${target.packageName} 根 barrel 的值导出闭包触达了 node:* 模块（renderer 会因此无法挂载）；\n` +
      `值导出一律走模块路径或 node 入口，勿加回根 barrel：\n${violations.join("\n")}`,
  ).toEqual([]);
}

describe("browser-safe barrel 守卫", () => {
  it("@zcode/services 根 barrel 及其值导出闭包不含 node:* 顶层依赖", () => {
    assertBrowserSafeClosure({
      entryFile: resolve(servicesSrcDir, "index.ts"),
      packageName: "@zcode/services",
    });
  });

  it("@zcode/shared 根 barrel 及其值导出闭包不含 node:* 顶层依赖（独立约束）", () => {
    assertBrowserSafeClosure({
      entryFile: resolve(sharedSrcDir, "index.ts"),
      packageName: "@zcode/shared",
    });
  });
});

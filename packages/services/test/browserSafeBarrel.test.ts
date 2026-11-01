import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ServiceChannels } from "@zcode/shared";
import { IOrcaRouterService } from "../src/orcarouter/service.js";

const servicesSrcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const sharedSrcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../shared/src");

/**
 * 根 barrel 必须保持 browser-safe。具体合同和证明范围见
 * docs/specs/browser-safe-root-barrels.md；此守卫验证源码可达性，不替代浏览器构建。
 *
 * 守卫口径（保守优先，宁误报不漏报）：
 * - AST 排除整条 type-only 语句、类型查询、注释和字符串中的伪代码；
 * - 私有 import、动态 import、require、相对路径与内部别名都计入传递闭包；
 * - NodeNext 解析处理 .js/.mjs 到 .ts/.mts，以及 package imports/exports；
 * - node:*、裸 Node 内置模块、Electron 和原生扩展一律拒绝。
 *
 * shared 的 Node 侧能力走 `@zcode/shared/node` 独立入口，不在根 barrel 的值导出
 * 闭包内，两个 barrel 分别断言、互不掩盖。
 */

interface BrowserSafeClosureTarget {
  /** 浏览器侧值导入的入口 barrel（绝对路径）。 */
  entryFile: string;
  /** 失败信息里显示的包名。 */
  packageName: string;
  /** 默认仓库根；独立夹具显式传自己的根，避免误遍历第三方安装。 */
  root?: string;
}

function collectRuntimeSpecifiers(file: string, source: string): Array<string | null> {
  const specifiers: Array<string | null> = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function add(node: ts.Node | undefined): void {
    specifiers.push(node && ts.isStringLiteralLike(node) ? node.text : null);
  }
  function visit(node: ts.Node): void {
    if (ts.isImportDeclaration(node)) {
      // verbatimModuleSyntax 下 import { type X } 仍发射 import {}，不能当作整条擦除。
      if (!node.importClause?.isTypeOnly) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (!node.isTypeOnly) add(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return [...new Set(specifiers)];
}

async function collectBrowserSafeClosureViolations(
  target: BrowserSafeClosureTarget,
): Promise<string[]> {
  const root = await realpath(target.root ?? resolve(servicesSrcDir, "../../.."));
  const queue = [target.entryFile];
  const visited = new Set<string>();
  const violations: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || visited.has(file)) continue;
    visited.add(file);
    const source = await readFile(file, "utf8");
    for (const spec of collectRuntimeSpecifiers(file, source)) {
      if (
        spec === null ||
        spec.startsWith("node:") ||
        isBuiltin(spec) ||
        spec === "electron" ||
        spec.endsWith(".node")
      ) {
        violations.push(`${file} → ${spec ?? "无法静态解析的动态导入"}`);
        continue;
      }
      // 修复依据：仅按相对路径/正则匹配会漏掉 fs、#src 和 workspace 别名；
      // 使用编译器的 NodeNext 解析，内部模块无法解析时必须失败，不能自我通过。
      const resolved = ts.resolveModuleName(
        spec,
        file,
        {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
        },
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (!resolved) {
        if (spec.startsWith(".") || spec.startsWith("#") || spec.startsWith("@zcode/")) {
          violations.push(`${file} → 无法解析内部模块 ${spec}`);
        }
        continue;
      }
      const path = relative(root, await realpath(resolved));
      if (
        path !== ".." &&
        !path.startsWith(`..${sep}`) &&
        !isAbsolute(path) &&
        !path.split(sep).includes("node_modules")
      ) {
        queue.push(resolved);
      }
    }
  }
  return violations;
}

async function assertBrowserSafeClosure(target: BrowserSafeClosureTarget): Promise<void> {
  const violations = await collectBrowserSafeClosureViolations(target);
  expect(
    violations,
    `${target.packageName} 根 barrel 的值导出闭包不满足 browser-safe 合同；\n` +
      `值导出一律走模块路径或 node 入口，勿加回根 barrel：\n${violations.join("\n")}`,
  ).toEqual([]);
}

describe("browser-safe barrel 守卫", () => {
  it("原 OrcaRouter 描述符与客户端引用的共享常量同源同值", () => {
    expect(IOrcaRouterService.channelName).toBe(ServiceChannels.OrcaRouter);
  });

  it("@zcode/services 根 barrel 及其值导出闭包不含 Node 依赖", async () => {
    await assertBrowserSafeClosure({
      entryFile: resolve(servicesSrcDir, "index.ts"),
      packageName: "@zcode/services",
    });
  });

  it("@zcode/shared 根 barrel 及其值导出闭包不含 Node 依赖（独立约束）", async () => {
    await assertBrowserSafeClosure({
      entryFile: resolve(sharedSrcDir, "index.ts"),
      packageName: "@zcode/shared",
    });
  });
});

async function withFixture(
  files: Record<string, string>,
  check: (root: string) => void | Promise<void>,
): Promise<void> {
  const root = await mkdtemp(resolve(tmpdir(), "browser-safe-barrel-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const path = resolve(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    }
    await check(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("browser-safe 守卫的独立负测试", () => {
  it.each(["node:fs", "fs", "fs/promises", "crypto", "electron", "./native.node"])(
    "拒绝原生说明符 %s",
    async (specifier) => {
      await withFixture({ "index.ts": `export * from '${specifier}';` }, async (root) => {
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain(specifier);
      });
    },
  );

  it.each([
    'import "./private.js";',
    'export const load = () => import("./private.js");',
    'export const load = () => require("./private.js");',
    'import hidden = require("./private.js");',
    'export * from "./private.js";',
  ])("沿私有运行时边继续遍历：%s", async (edge) => {
    await withFixture(
      { "index.ts": edge, "private.ts": 'export { readFile } from "node:fs";' },
      async (root) => {
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain("node:fs");
      },
    );
  });

  it("包内 #imports 不能绕过守卫", async () => {
    await withFixture(
      {
        "package.json": JSON.stringify({ type: "module", imports: { "#private/*": "./src/*" } }),
        "index.ts": 'import "#private/hidden.js";',
        "src/hidden.ts": 'import "node:crypto";',
      },
      async (root) => {
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain("node:crypto");
      },
    );
  });

  it("type-only、注释和字符串不会创建运行时边", async () => {
    await withFixture(
      {
        "index.ts": [
          'import type { Hidden } from "./hidden.js";',
          'export type { Hidden } from "./hidden.js";',
          'export type Query = import("./hidden.js").Hidden;',
          'export type NativeQuery = import("node:fs").Stats;',
          '// import "node:fs";',
          'export const comment = "/*";',
          'export const text = `import "node:fs"`;',
        ].join("\n"),
        "hidden.ts": 'import "node:fs"; export type Hidden = number; export type Other = number;',
      },
      async (root) => {
        expect(
          await collectBrowserSafeClosureViolations({
            entryFile: resolve(root, "index.ts"),
            packageName: "fixture",
            root,
          }),
        ).toEqual([]);
      },
    );
  });

  it("字符串中的注释标记不能遮蔽真实 Node 导入", async () => {
    await withFixture(
      { "index.ts": 'const begin = "/*"; import "node:fs"; const end = "*/";' },
      async (root) => {
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain("node:fs");
      },
    );
  });

  it.each([
    'export { type Hidden } from "./hidden.js";',
    'import { type Hidden } from "./hidden.js";',
  ])("inline type 说明符保留模块副作用：%s", async (source) => {
    await withFixture(
      {
        "index.ts": source,
        "hidden.ts": 'import "node:fs"; export type Hidden = number;',
      },
      async (root) => {
        expect(
          ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
          }).outputText,
        ).toContain('from "./hidden.js"');
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain("node:fs");
      },
    );
  });

  it("workspace 包别名必须继续遍历，而不是当作第三方跳过", async () => {
    await withFixture(
      {
        "package.json": '{"type":"module"}',
        "index.ts": 'export * from "@zcode/fixture";',
        "packages/fixture/package.json": JSON.stringify({
          name: "@zcode/fixture",
          type: "module",
          exports: "./index.ts",
        }),
        "packages/fixture/index.ts": 'export * from "fs/promises";',
      },
      async (root) => {
        await mkdir(resolve(root, "node_modules/@zcode"), { recursive: true });
        await symlink(
          resolve(root, "packages/fixture"),
          resolve(root, "node_modules/@zcode/fixture"),
          "junction",
        );
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain("fs/promises");
      },
    );
  });

  it("NodeNext .mjs→.mts 映射和循环依赖可以终止", async () => {
    await withFixture(
      {
        "index.ts": 'export * from "./cycle.mjs";',
        "cycle.mts": 'import "./index.js"; export const safe = true;',
      },
      async (root) => {
        expect(
          await collectBrowserSafeClosureViolations({
            entryFile: resolve(root, "index.ts"),
            packageName: "fixture",
            root,
          }),
        ).toEqual([]);
      },
    );
  });

  it.each(['import "./missing.js";', "export const load = (name: string) => import(name);"])(
    "无法解析的内部运行时边必须失败：%s",
    async (source) => {
      await withFixture({ "index.ts": source }, async (root) => {
        const violations = await collectBrowserSafeClosureViolations({
          entryFile: resolve(root, "index.ts"),
          packageName: "fixture",
          root,
        });
        expect(violations.join("\n")).toContain("无法");
      });
    },
  );
});

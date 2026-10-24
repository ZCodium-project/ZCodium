import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
import enUS from "@/i18n/locales/en-US.js";
import zhCN from "@/i18n/locales/zh-CN.js";

const uiSource = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory()
        ? sources(path)
        : /\.tsx?$/u.test(path) && !/\.(?:test|example)\.tsx?$/u.test(path)
          ? [path]
          : [];
    }),
  );
  return nested.flat();
}

it("同步后的项目/设备/完整视图 UI 的静态消息键在中英文都存在", async () => {
  const missing: string[] = [];
  for (const module of ["project-sidebar", "source-server-settings", "side-pane-full-view"]) {
    for (const file of await sources(join(uiSource, module))) {
      const ast = ts.createSourceFile(
        file,
        await readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === "formatMessage" &&
          node.arguments[0] &&
          ts.isObjectLiteralExpression(node.arguments[0])
        ) {
          for (const prop of node.arguments[0].properties) {
            if (
              !ts.isPropertyAssignment(prop) ||
              prop.name.getText(ast) !== "id" ||
              !ts.isStringLiteralLike(prop.initializer)
            )
              continue;
            const key = prop.initializer.text;
            for (const [locale, messages] of [
              ["en-US", enUS],
              ["zh-CN", zhCN],
            ] as const) {
              if (typeof messages[key] !== "string")
                missing.push(`${locale}: ${key} (${file.slice(uiSource.length + 1)})`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  }
  expect([...new Set(missing)]).toEqual([]);
});

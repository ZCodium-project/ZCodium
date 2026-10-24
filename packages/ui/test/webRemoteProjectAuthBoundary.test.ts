import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it } from "vitest";

it("项目桥接鉴权失效只提示重新配对，不进入官方账号流程", async () => {
  const file = new URL("../src/WebRemoteControlDialog.tsx", import.meta.url);
  const text = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file.pathname, text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "getFailureDescription",
  );
  expect(declaration).toBeDefined();
  const code = ts.transpileModule(declaration!.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const describe = new Function(`${code};return getFailureDescription;`)() as (
    failure: { reason: string },
    format: (input: { id: string }) => string,
  ) => string;
  expect(describe({ reason: "auth-required" }, ({ id }) => id)).toBe(
    "webRemoteControl.failure.invalidMobileConnection",
  );
});

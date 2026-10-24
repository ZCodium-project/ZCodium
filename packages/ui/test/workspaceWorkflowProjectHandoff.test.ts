import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it, vi } from "vitest";

async function actualCreateCallback(readOnly: string | null, create: ReturnType<typeof vi.fn>) {
  const path = fileURLToPath(new URL("../src/app-shell/WorkspaceShellLayout.tsx", import.meta.url));
  const source = await readFile(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(ast) === "handleCreateAutomationInChat" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    )
      callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(callback).toBeDefined();
  const code = ts.transpileModule(`const handler = ${callback!.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    "handleCreateTaskInChat",
    "workspaceReadOnlyReason",
    `${code}; return handler;`,
  )(create, readOnly) as (
    prompt: string,
    target?: { projectId?: string | null; hostId?: string; workspacePath: string },
  ) => void;
}

it("保存工作流从非当前项目创建任务时，Frame 不丢 projectId/hostId 顶层准入", async () => {
  const create = vi.fn();
  const handler = await actualCreateCallback("current is read-only", create);
  handler("workflow prompt", {
    projectId: "other-project",
    hostId: "other-host",
    workspacePath: "/same-cwd",
  });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      initialPrompt: "workflow prompt",
      projectId: "other-project",
      hostId: "other-host",
      targetWorkspace: expect.objectContaining({ workspacePath: "/same-cwd" }),
    }),
  );
});

it("工作流显式未归类 null 不能继承当前项目，未指定目标仍保持原只读保护", async () => {
  const create = vi.fn();
  const handler = await actualCreateCallback("read-only", create);
  handler("blocked");
  expect(create).not.toHaveBeenCalled();
  handler("unclassified", { projectId: null, hostId: "local", workspacePath: "/scratch" });
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: null, hostId: "local" }),
  );
});

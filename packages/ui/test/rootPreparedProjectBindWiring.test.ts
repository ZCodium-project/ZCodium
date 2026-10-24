import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it, vi } from "vitest";

async function fixture() {
  const file = new URL("../src/Root.tsx", import.meta.url);
  const source = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
  let bind: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(ast) === "attachRemoteProjectWorkspace"
    ) {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const prop of options.properties) {
          if (ts.isPropertyAssignment(prop) && prop.name.getText(ast) === "bind")
            bind = prop.initializer;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(bind).toBeDefined();
  const ports = {
    identity: "server:qa-source:/repo",
    target: { projectId: "qa-project", onWorkspaceActivated: vi.fn() },
    remoteDraftIntent: { current: null as { projectId: string; workspaceIdentity: string } | null },
    handleSelectRemoteProject: vi.fn(async (..._args: unknown[]) => undefined),
    getRemoteWorkspaceSession: vi.fn(() => ({ workspaceIdentity: "server:qa-source:/repo" })),
  };
  const code = ts.transpileModule(`const bind = ${bind!.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    ports,
    bind: new Function(...Object.keys(ports), `${code}; return bind;`)(...Object.values(ports)) as (
      sessionId: string,
      path: string,
      guard?: () => boolean | Promise<boolean>,
    ) => Promise<void>,
  };
}

it("prepared 项目绑定把 canonical identity、原 guard 与同步激活端口交给唯一 owner", async () => {
  const { bind, ports } = await fixture();
  const guard = vi.fn(async () => true);
  await bind("logical-session", "/repo", guard);
  expect(ports.handleSelectRemoteProject).toHaveBeenCalledWith(
    "logical-session",
    "/repo",
    undefined,
    ports.identity,
    guard,
    ports.target.onWorkspaceActivated,
  );
  expect(ports.remoteDraftIntent.current).toBeNull();
});

it("prepared 资格已失效时不写临时意图、不绑定", async () => {
  const { bind, ports } = await fixture();
  await expect(bind("old", "/repo", () => false)).rejects.toThrow("project.navigation-cancelled");
  expect(ports.handleSelectRemoteProject).not.toHaveBeenCalled();
  expect(ports.remoteDraftIntent.current).toBeNull();
});

it("旧 bind 的 finally 不能清除后来调用的项目意图", async () => {
  const { bind, ports } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  ports.handleSelectRemoteProject.mockImplementation(async () => {
    await gate;
  });
  const opening = bind("old", "/repo");
  await vi.waitFor(() => expect(ports.handleSelectRemoteProject).toHaveBeenCalledOnce());
  const newer = { projectId: "newer-project", workspaceIdentity: "newer-identity" };
  ports.remoteDraftIntent.current = newer;
  release();
  await opening;
  expect(ports.remoteDraftIntent.current).toBe(newer);
});

it("Host 返回不同 identity 时不放行，并清理本轮临时意图", async () => {
  const { bind, ports } = await fixture();
  ports.getRemoteWorkspaceSession.mockReturnValue({ workspaceIdentity: "another-identity" });
  await expect(bind("logical-session", "/repo")).rejects.toThrow(
    "project.workspace-identity-mismatch",
  );
  expect(ports.remoteDraftIntent.current).toBeNull();
});

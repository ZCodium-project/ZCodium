import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it, vi } from "vitest";

async function handler(deviceManagement = true, current = true) {
  const file = new URL("../src/Root.tsx", import.meta.url);
  const source = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleWizardConnect")
      expression = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  expect(expression).toBeDefined();
  const finish = vi.fn(async () => undefined);
  const ports = {
    remoteConnectionOpenPreference: deviceManagement
      ? { completion: "device-management", returnTarget: { isCurrent: () => current, finish } }
      : undefined,
    handleConnectRemote: vi.fn(async () => "qa-logical-session"),
    getRemoteWorkspaceSession: () => ({ sourceServerId: "qa-source" }),
    handleCancelRemoteProject: vi.fn(async () => undefined),
    remoteConnectionCompleted: { current: false },
    setRemoteConnectionDialogOpen: vi.fn(),
    setRemoteConnectionOpenPreference: vi.fn(),
    setRemoteConnectionInProgress: vi.fn(),
    setRemoteConnectionRequestId: vi.fn(),
    setRemoteConnectionDisplayGeneration: vi.fn(),
  };
  const code = ts.transpileModule(`const connect = ${expression!.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const connect = new Function(...Object.keys(ports), `${code};return connect;`)(
    ...Object.values(ports),
  ) as (...args: unknown[]) => Promise<string>;
  return { ports, connect, finish };
}

it("设备管理完成后重置向导展示，不释放已交接连接或自动创建项目", async () => {
  const f = await handler();
  await expect(f.connect({ kind: "ssh" }, "request")).resolves.toBe("qa-logical-session");
  expect(f.finish).toHaveBeenCalledWith({ kind: "connected", sourceServerId: "qa-source" });
  expect(f.ports.setRemoteConnectionDialogOpen).toHaveBeenCalledWith(false);
  expect(f.ports.setRemoteConnectionInProgress).toHaveBeenCalledWith(false);
  expect(f.ports.setRemoteConnectionRequestId).toHaveBeenCalledWith(null);
  expect(f.ports.setRemoteConnectionDisplayGeneration).toHaveBeenCalledOnce();
  expect(f.ports.handleCancelRemoteProject).not.toHaveBeenCalled();
});

it("迟到完成只释放旧逻辑连接，不能重置新意图或投递完成回执", async () => {
  const f = await handler(true, false);
  await expect(f.connect()).rejects.toThrow("project.creation-cancelled");
  expect(f.ports.handleCancelRemoteProject).toHaveBeenCalledWith("qa-logical-session");
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.ports.setRemoteConnectionDisplayGeneration).not.toHaveBeenCalled();
});

it("普通项目连接仍交接目录选择，不借设备完成分支清理其 UI", async () => {
  const f = await handler(false);
  await expect(f.connect()).resolves.toBe("qa-logical-session");
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.ports.setRemoteConnectionDisplayGeneration).not.toHaveBeenCalled();
});

it("连接/安装准入失败原样拒绝，不伪造设备完成或批准安装", async () => {
  const f = await handler();
  f.ports.handleConnectRemote.mockRejectedValue(
    new Error("explicit install confirmation required"),
  );
  await expect(f.connect()).rejects.toThrow("explicit install confirmation required");
  expect(f.finish).not.toHaveBeenCalled();
  expect(f.ports.setRemoteConnectionDisplayGeneration).not.toHaveBeenCalled();
});

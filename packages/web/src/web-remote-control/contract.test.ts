import { expect, it } from "vitest";
import { projectRootIdentity } from "./contract.example.js";
it("项目 Root 使用 Host bridge 返回的真实执行身份", () => {
  expect(
    projectRootIdentity({
      bridge: {
        kind: "local",
        workspacePath: "/host/project",
        workspaceKey: "/host/project",
        bridgeSessionId: "bridge",
      },
      services: {} as never,
      composerClientNamespace: "mobile:device",
    }),
  ).toBe("/host/project");
});

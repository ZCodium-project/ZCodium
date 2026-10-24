import { expect, it } from "vitest";
import {
  getPluginWorkspaceKey,
  isPluginScopeWorkspaceConnected,
} from "@/settings/PluginScopeMenu.js";

it("配置菜单接受无 tab 的在线 Source root；同路径不同 Host 身份独立", () => {
  const local = { workspacePath: "/same", label: "local" };
  const remote = {
    workspacePath: "/same",
    workspaceIdentity: "remote:server:one:/same",
    label: "remote",
    configOnline: true,
  };
  expect(isPluginScopeWorkspaceConnected(remote)).toBe(true);
  expect(getPluginWorkspaceKey(remote)).not.toBe(getPluginWorkspaceKey(local));
  expect(isPluginScopeWorkspaceConnected({ ...remote, configOnline: false })).toBe(false);
  expect(
    isPluginScopeWorkspaceConnected({ ...local, availability: "unavailable-local-directory" }),
  ).toBe(false);
});

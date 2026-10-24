import { describe, expect, it } from "vitest";
import {
  findAutomationWorkspaceOptionByKey,
  reconcileAutomationWorkspaceSelectionKey,
  resolveAutomationWorkspaceSelectionKey,
} from "@/settings/automationWorkspaceOptions.js";

describe("automation project selection", () => {
  const options = [
    { projectId: "one", hostId: "local", workspacePath: "/same", label: "one" },
    { projectId: "two", hostId: "local", workspacePath: "/same", label: "two" },
    { projectId: "two", hostId: "remote:server:two", workspacePath: "/same", label: "remote" },
  ];

  it("同 cwd、跨 Host 的项目选择分别隔离", () => {
    const keys = options.map(resolveAutomationWorkspaceSelectionKey);
    expect(new Set(keys).size).toBe(3);
    expect(findAutomationWorkspaceOptionByKey(options, keys[1]!)).toBe(options[1]);
    expect(findAutomationWorkspaceOptionByKey(options, keys[2]!)).toBe(options[2]);
  });

  it("有效当前选择保留，失效时依次回落默认项目、首项目或 null", () => {
    const firstKey = resolveAutomationWorkspaceSelectionKey(options[0]!);
    const secondKey = resolveAutomationWorkspaceSelectionKey(options[1]!);
    expect(reconcileAutomationWorkspaceSelectionKey(options, firstKey, options[1])).toBe(firstKey);
    expect(reconcileAutomationWorkspaceSelectionKey(options, null, options[1])).toBe(secondKey);
    expect(reconcileAutomationWorkspaceSelectionKey(options, "removed")).toBe(firstKey);
    expect(reconcileAutomationWorkspaceSelectionKey([], "removed")).toBeNull();
  });

  it("已有未归类任务保持真实 cwd identity，不伪造项目或改绑定目录", () => {
    expect(
      resolveAutomationWorkspaceSelectionKey({
        projectId: null,
        workspacePath: "/old",
        workspaceIdentity: "remote:server:one:/old",
      }),
    ).toBe("remote:server:one:/old");
  });
});

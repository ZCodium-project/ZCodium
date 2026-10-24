import { describe, expect, it } from "vitest";
import type { VirtualProject } from "@zcode/services";
import { resolveAutomationProjectOptions } from "@/hooks/useAutomationProjectOptions.js";
import {
  resolveAutomationWorkspaceSelectionKey,
  findAutomationWorkspaceOptionByKey,
} from "@/settings/automationWorkspaceOptions.js";

const project = (
  id: string,
  paths: string[],
  overrides: Partial<VirtualProject> = {},
): VirtualProject => ({
  id,
  hostId: "local",
  name: id,
  nameOverridden: false,
  position: 0,
  pinned: false,
  deleted: false,
  createdAt: 1,
  updatedAt: 1,
  roots: paths.map((rootPath, i) => ({ rootPath, isPrimary: i === 0, position: i })),
  ...overrides,
});

describe("automation project boundaries", () => {
  it("枚举 Host 的未打开项目与空项目，只排除已删除和远端项目", () => {
    expect(
      resolveAutomationProjectOptions([
        project("unopened", ["/repo"]),
        project("empty", []),
        project("deleted", ["/removed"], { deleted: true }),
        project("remote", ["/repo"], { hostId: "remote:server:one" }),
      ]),
    ).toEqual([
      { projectId: "unopened", hostId: "local", workspacePath: "/repo", label: "unopened" },
      { projectId: "empty", hostId: "local", workspacePath: "", label: "empty" },
    ]);
  });

  it("同 cwd 的不同项目按 projectId 隔离，改主要目录不改变选择身份", () => {
    const options = resolveAutomationProjectOptions([
      project("a", ["/same"]),
      project("b", ["/same"]),
    ]);
    const keyA = resolveAutomationWorkspaceSelectionKey(options[0]!);
    const keyB = resolveAutomationWorkspaceSelectionKey(options[1]!);
    expect(keyA).not.toBe(keyB);
    expect(findAutomationWorkspaceOptionByKey(options, keyB)?.projectId).toBe("b");
    const changed = resolveAutomationProjectOptions([project("b", ["/new"])]);
    expect(resolveAutomationWorkspaceSelectionKey(changed[0]!)).toBe(keyB);
  });
});

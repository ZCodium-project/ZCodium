// @vitest-environment jsdom
import { createElement, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSidebar } from "@/WorkspaceSidebar.js";

vi.mock("@/project-sidebar/index.js", () => ({
  ProjectSidebar: ({ onOpenFileManager }: { onOpenFileManager: (target: unknown) => void }) => {
    const [expanded, setExpanded] = useState(false);
    return createElement(
      "div",
      null,
      createElement(
        "button",
        { onClick: () => setExpanded(!expanded) },
        expanded ? "expanded" : "collapsed",
      ),
      createElement(
        "button",
        {
          onClick: () => onOpenFileManager({ workspacePath: "/fixture", workspaceName: "fixture" }),
        },
        "files",
      ),
    );
  },
}));
vi.mock("@/WorkspaceFileTree.js", () => ({
  WorkspaceFileTree: ({ onClose }: { onClose: () => void }) =>
    createElement(
      "section",
      { "data-testid": "tree" },
      createElement("button", { onClick: onClose }, "Back to tasks"),
    ),
}));
afterEach(cleanup);

describe("#104 文件树返回与标题栏隔离", () => {
  it.each([
    { isDesktop: true, isWindowsDesktop: true },
    { isDesktop: true },
    { isDesktop: true, isMacDesktop: true },
    {},
    { isWebRemoteControl: true },
  ])("%j 预留与列表相同的标题栏空间，返回只关闭树且保留项目展开态", (platform) => {
    render(createElement(WorkspaceSidebar, platform as never));
    fireEvent.click(screen.getByRole("button", { name: "collapsed" }));
    fireEvent.click(screen.getByRole("button", { name: "files" }));
    const header = screen.getByTestId("sidebar-file-tree-titlebar");
    expect(header.classList.contains("h-12")).toBe(true);
    expect(header.classList.contains("shrink-0")).toBe(true);
    expect(header.classList.contains("max-md:hidden")).toBe("isWebRemoteControl" in platform);
    const tree = screen.getByTestId("tree");
    expect(header.nextElementSibling?.contains(tree)).toBe(true);
    expect(tree.parentElement?.classList.contains("[app-region:no-drag]")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
    expect(screen.queryByTestId("tree")).toBeNull();
    expect(screen.getByRole("button", { name: "expanded" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "files" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to tasks" }));
    expect(screen.queryByTestId("tree")).toBeNull();
    expect(screen.getByRole("button", { name: "expanded" })).toBeTruthy();
  });
});

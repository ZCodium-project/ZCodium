// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsPageConfig } from "@/settings/settingsPageConfig.js";
import {
  consumePendingSettingsSection,
  readLastSettingsSectionPreference,
  setPendingSettingsSection,
  writeLastSettingsSectionPreference,
} from "@/lib/settingsNavigation.js";
import { ArchiveManagement } from "@/project-sidebar/ArchiveManagement.js";
import type { ProjectTask } from "@/project-sidebar/contract.js";

const { directory, controller, confirm, removeTaskState } = vi.hoisted(() => ({
  directory: {
    tree: { projects: [], tasks: [] as ProjectTask[] },
    directory: { hosts: [] },
    loading: false,
    error: null,
    refresh: vi.fn(async () => undefined),
  },
  controller: { mutateTask: vi.fn(async () => undefined) },
  confirm: vi.fn(async () => false),
  removeTaskState: vi.fn(),
}));
vi.mock("@/project-sidebar/ProjectDirectoryProvider.js", () => ({
  ProjectDirectoryProvider: ({ children }: { children: ReactNode }) => children,
  useProjectDirectory: () => directory,
}));
vi.mock("@/project-sidebar/RemoteHostSection.js", () => ({ remoteHostLabel: () => undefined }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useBaseWorkspaceServices: () => ({ windowControllerService: controller }),
}));
vi.mock("@/hooks/useResolvedRemoteWorkspaceSessionId.js", () => ({
  resolveRemoteWorkspaceSessionIdForTarget: () => undefined,
}));
vi.mock("@/store/remoteWorkspaceSessionStore.js", () => ({
  useRemoteWorkspaceSessionStore: { getState: () => ({}) },
}));
vi.mock("@/store/zcodeSessionStore.js", () => ({
  useZCodeSessionStore: (selector: (state: unknown) => unknown) => selector({ removeTaskState }),
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => confirm }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "en-US",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  directory.tree.tasks = ["restore", "delete"].map((id) => ({
    taskId: id,
    title: id,
    hostId: "local",
    projectId: null,
    workspacePath: "/navigation-fixture",
    pinned: false,
    archived: true,
    mode: "build",
    traceId: id,
    createdAt: 1,
    updatedAt: 2,
  }));
  confirm.mockResolvedValue(false);
});
afterEach(cleanup);

describe("#99 归档入口与既有管理路径", () => {
  it.each([{}, { isDesktop: true }, { isWindowsDesktop: true }, { isMacDesktop: true }])(
    "设置数据与统计在 %j 注册归档管理，导航意图和重启偏好不丢失",
    (options) => {
      const config = createSettingsPageConfig(options);
      expect(config.settingsSectionGroups.find((g) => g.id === "dataAndStats")?.sections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "archives", titleId: "archives.nav" }),
        ]),
      );
      writeLastSettingsSectionPreference("archives");
      expect(readLastSettingsSectionPreference()).toBe("archives");
      setPendingSettingsSection("archives");
      expect(consumePendingSettingsSection()).toBe("archives");
    },
  );

  it("搜索/展开后取消归档沿用完整任务地址和 Host mutation，刷新后该行消失", async () => {
    const view = render(createElement(ArchiveManagement));
    fireEvent.change(screen.getByTestId("archive-search"), { target: { value: "restore" } });
    fireEvent.click(screen.getByTestId("archive-group-toggle"));
    expect(screen.getAllByTestId("archive-task")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("archive-unarchive"));
    await waitFor(() => expect(directory.refresh).toHaveBeenCalledOnce());
    expect(controller.mutateTask).toHaveBeenCalledExactlyOnceWith({
      address: {
        workspacePath: "/navigation-fixture",
        workspaceIdentity: undefined,
        taskId: "restore",
      },
      mutation: { kind: "archive", archived: false },
    });
    expect(removeTaskState).not.toHaveBeenCalled();
    directory.tree = {
      ...directory.tree,
      tasks: directory.tree.tasks.map((task) =>
        task.taskId === "restore" ? { ...task, archived: false } : task,
      ),
    };
    view.rerender(createElement(ArchiveManagement));
    expect(screen.queryByTestId("archive-task")).toBeNull();
  });

  it("取消删除不发命令，确认后只删除目标并清理该会话 UI", async () => {
    render(createElement(ArchiveManagement));
    fireEvent.click(screen.getByTestId("archive-group-toggle"));
    const row = screen.getAllByTestId("archive-task").find((el) => el.dataset.taskId === "delete")!;
    fireEvent.click(within(row).getByTestId("archive-delete"));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(within(row).getByTestId("archive-delete").hasAttribute("disabled")).toBe(false),
    );
    expect(controller.mutateTask).not.toHaveBeenCalled();
    confirm.mockResolvedValueOnce(true);
    fireEvent.click(within(row).getByTestId("archive-delete"));
    await waitFor(() => expect(directory.refresh).toHaveBeenCalledOnce());
    expect(controller.mutateTask).toHaveBeenCalledExactlyOnceWith({
      address: {
        workspacePath: "/navigation-fixture",
        workspaceIdentity: undefined,
        taskId: "delete",
      },
      mutation: { kind: "delete" },
    });
    expect(removeTaskState).toHaveBeenCalledExactlyOnceWith(
      "/navigation-fixture",
      "delete",
      undefined,
    );
  });
});

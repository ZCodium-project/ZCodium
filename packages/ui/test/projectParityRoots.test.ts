// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectEditor } from "@/project-sidebar/ProjectEditor.js";
import type { IProjectService, VirtualProject } from "@/project-sidebar/contract.js";

const native = vi.hoisted(() => ({ select: vi.fn<() => Promise<string[]>>() }));
vi.mock("@/hooks/usePlatform.js", () => ({
  useOptionalPlatform: () => ({ selectDirectories: native.select }),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => null,
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => vi.fn(async () => true) }));
vi.mock("@/project-sidebar/ProjectDirectoryProvider.js", () => ({
  useOptionalProjectDirectory: () => null,
}));
vi.mock("@/DirectoryBrowser.js", () => ({ DirectoryBrowser: () => null }));
afterEach(() => {
  cleanup();
  native.select.mockReset();
});

const project: VirtualProject = {
  id: "p",
  hostId: "local",
  name: "Project",
  nameOverridden: true,
  pinned: false,
  deleted: false,
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  roots: [
    { rootPath: "/source/one", position: 0, isPrimary: true },
    { rootPath: "/source/two", position: 1, isPrimary: false },
  ],
};
function editor(value: VirtualProject | null = project) {
  const saveProject = vi.fn(async () => project);
  const onClose = vi.fn();
  const onSaved = vi.fn(async () => {});
  render(
    createElement(ProjectEditor, {
      project: value,
      projects: [],
      service: { saveProject } as unknown as IProjectService,
      onClose,
      onSaved,
    }),
  );
  return { saveProject, onClose, onSaved };
}

it("ZUP01: native multi-select deduplicates local roots and commits only after trust confirmation", async () => {
  native.select.mockResolvedValue(["/source/one", "/source/two", "/source/one"]);
  const { saveProject } = editor(null);
  fireEvent.click(screen.getByTestId("virtual-project-browse"));
  await screen.findByTitle("/source/two");
  expect(screen.getAllByTestId("virtual-project-root-row")).toHaveLength(2);
  expect(saveProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("virtual-project-save"));
  fireEvent.click(await screen.findByTestId("project-folder-trust-confirm"));
  await waitFor(() =>
    expect(saveProject).toHaveBeenCalledWith(
      expect.objectContaining({
        roots: ["/source/one", "/source/two"],
        primaryRoot: "/source/one",
      }),
    ),
  );
});

it("ZUP02: primary changes belong to the editor draft until save; cancel never mutates the Host", async () => {
  const { saveProject, onClose } = editor();
  fireEvent.click(screen.getByRole("button", { name: "project.setPrimary" }));
  expect(
    within(screen.getAllByTestId("virtual-project-root-row")[1]!).getByTestId(
      "virtual-project-primary",
    ),
  ).toBeTruthy();
  expect(saveProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "project.cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(saveProject).not.toHaveBeenCalled();
});

it("ZUP02: saving the edited primary preserves project identity and all roots", async () => {
  const { saveProject, onSaved } = editor();
  fireEvent.click(screen.getByRole("button", { name: "project.setPrimary" }));
  fireEvent.click(screen.getByTestId("virtual-project-save"));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(project));
  expect(saveProject).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "p",
      hostId: "local",
      roots: ["/source/one", "/source/two"],
      primaryRoot: "/source/two",
    }),
  );
});

it("ZUP07: an existing remote project's single root cannot be changed using the local picker", () => {
  editor({ ...project, hostId: "remote:server:source", roots: [project.roots[0]!] });
  expect(screen.queryByTestId("virtual-project-browse")).toBeNull();
  expect(screen.queryByTestId("virtual-project-remove-folder")).toBeNull();
  expect(native.select).not.toHaveBeenCalled();
});

it("ZUP01: a pending native selection prevents save and preserves draft on picker failure", async () => {
  let reject!: (error: Error) => void;
  native.select.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const { saveProject } = editor();
  fireEvent.click(screen.getByTestId("virtual-project-browse"));
  expect(screen.getByTestId("virtual-project-save").hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByTestId("virtual-project-save"));
  expect(saveProject).not.toHaveBeenCalled();
  await act(async () => reject(new Error("picker failure")));
  expect((await screen.findByRole("alert")).textContent).toContain("picker failure");
  expect(screen.getAllByTestId("virtual-project-root-row")).toHaveLength(2);
});

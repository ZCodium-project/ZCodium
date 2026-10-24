import { readFile } from "node:fs/promises";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateTaskOptions } from "@/app-shell/types.js";
import type { useRootWorkspaceActions } from "@/root/useRootWorkspaceActions.js";
import { selectRemoteWorkspaceProjectFromDialog } from "@/root/useRemoteWorkspaceHistory.js";
import { attachRemoteProjectWorkspace } from "@/project-sidebar/remote-navigation.js";
import type { ProjectSidebarProps } from "@/project-sidebar/contract.js";
import { createTabStore } from "@/store/tabStore.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { createTaskNavigationHistory } from "@/lib/taskNavigationHistory.js";
import * as composerDrafts from "@/v4/composer/composerDraftStore.js";
import {
  stageV4ComposerDraftAttachments,
  consumeV4ComposerDraftAttachments,
} from "@/v4/composer/composerDraftWorkspaceTransfer.js";

// 执行源码中的实际 callback；仅注入 Host/平台边界，不复制被测导航算法。
async function callback<T>(file: string, name: string, ports: Record<string, unknown>): Promise<T> {
  const path = new URL(file, import.meta.url);
  const source = await readFile(path, "utf8");
  const ast = ts.createSourceFile(path.pathname, source, ts.ScriptTarget.Latest, true);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      expression = ts.isCallExpression(node.initializer)
        ? node.initializer.arguments[0]
        : node.initializer;
    }
    if (
      name === "returnedCallback" &&
      ts.isReturnStatement(node) &&
      node.expression &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(ast) === "useCallback"
    )
      expression = node.expression.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  if (!expression) throw new Error(`Missing callback: ${name}`);
  const compiled = ts.transpileModule(`const handler = ${expression.getText(ast)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(ports), `${compiled};return handler;`)(
    ...Object.values(ports),
  ) as T;
}

type HistoryNavigation = (
  sessionId: string,
  path: string,
  localWorkspacePath?: string,
  identity?: string,
  current?: () => boolean | Promise<boolean>,
  onWorkspaceActivated?: () => void,
) => Promise<void>;
type RootActions = ReturnType<typeof useRootWorkspaceActions>;
type RemoteTarget = Parameters<
  NonNullable<Parameters<typeof useRootWorkspaceActions>[0]["openRemoteProjectWorkspace"]>
>[0];

const path = "/project-navigation-commit";
const identity = `remote:server:qa:${path}`;
const hostId = "remote:server:qa";
const projectId = "navigation-project";

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  useZCodeSessionStore.setState({
    workspaces: {},
    taskNavHistory: createTaskNavigationHistory(),
  });
  composerDrafts.clearV4ComposerDraft(
    path,
    identity,
    composerDrafts.V4_DRAFT_SCOPE_ROOT,
    composerDrafts.resolveComposerScope(projectId, identity, "desktop"),
  );
});

afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const tabs = createTabStore(null);
  tabs.getState().addTab("/origin");
  useZCodeSessionStore.getState().setActiveTaskId("/origin", "origin-task");
  const activation = await callback<RootActions["startDraftInWorkspace"]>(
    "../src/root/useRootWorkspaceActions.ts",
    "startDraftInWorkspace",
    {
      ...composerDrafts,
      composerClientNamespace: "desktop",
      workbenchGroupClientMode: "desktop-continuous",
      useWorkbenchGroupStore: { getState: () => ({ deactivateActiveGroup() {} }) },
      usePaneLayoutStore: { getState: () => ({ resetToPrimaryPane() {} }) },
      useZCodeSessionStore,
      stageV4ComposerDraftAttachments,
    },
  );
  const startDraft = vi.fn(activation);
  const entered = Promise.withResolvers<void>();
  const refresh = Promise.withResolvers<void>();
  const session = {
    sessionId: "qa-session",
    sourceServerId: "qa",
    target: { kind: "ssh", host: "qa.test", username: "fixture" },
    workspacePath: path,
    workspaceIdentity: identity,
  };
  const host = { id: hostId, target: session.target };
  const remoteService = {
    readDirectory: vi.fn(async () => ({ hosts: [host] })),
    connectHost: vi.fn(async () => host),
  };
  const history = vi.fn(
    await callback<HistoryNavigation>(
      "../src/root/useRemoteWorkspaceHistory.ts",
      "handleSelectRemoteProject",
      {
        projectSelectionLeases: { current: new Map() },
        canUseRemoteWorkspace: true,
        intl: { formatMessage: () => "loading" },
        pendingConnectionTargetsBySessionIdRef: { current: new Map() },
        remoteWorkspaceSessionsRef: { current: [] },
        selectRemoteWorkspaceProjectFromDialog,
        getRemoteWorkspaceSession: () => session,
        tabStoreApi: tabs,
        resolveRemoteWorkspaceCanonicalPath: vi.fn(async () => "/must-not-resolve-prepared"),
        activateTabByPath: tabs.getState().activateTabByPath,
        handleCancelRemoteProject: vi.fn(async () => {}),
        bindRemoteWorkspaceSessionContext: vi.fn(async () => {}),
        commitRemoteWorkspaceSessionMutation: async (mutation: { entry: unknown }) =>
          mutation.entry,
        bindRemoteWorkspacePath() {},
        bindRemoteWorkspaceIdentity() {},
        addTab: tabs.getState().addTab,
        onWorkspaceActivated: () => startDraft(path, identity, { projectId }),
        refreshRemotePinnedTasksForSession: async () => {
          entered.resolve();
          await refresh.promise;
        },
        refreshRemoteTimelineTasksForSession: async () => {},
      },
    ),
  );
  const logger = { info: vi.fn(), error: vi.fn() };
  const rootActions = await callback<RootActions["startNewTaskFromActiveWorkspace"]>(
    "../src/root/useRootWorkspaceActions.ts",
    "startNewTaskFromActiveWorkspace",
    {
      remoteProjectOpener: {
        current: (target: RemoteTarget) =>
          history(
            "qa-session",
            path,
            undefined,
            identity,
            target.isCurrent,
            target.onWorkspaceActivated,
          ),
      },
      navigationSequence: { current: 0 },
      tabStoreApi: tabs,
      activeWorkspacePath: "/origin",
      activeWorkspaceIdentity: null,
      useZCodeSessionStore,
      readProjectSidebarView: () => "projects",
      resolveNewTaskTargetFromRequest: () => null,
      workbenchGroupClientMode: "desktop-continuous",
      services: {
        projectService: {
          prepareSession: vi.fn(async () => ({
            workspacePath: path,
            workspaceIdentity: identity,
            projectId,
          })),
        },
      },
      composerClientNamespace: "desktop",
      startDraftInWorkspace: startDraft,
      addTab: tabs.getState().addTab,
      setWorkspaceActionError: vi.fn(),
      logger,
    },
  );
  const onSelectTask = vi.fn((targetPath: string, taskId: string, targetIdentity?: string) => {
    tabs.getState().activateTabByPath(targetPath, { workspaceIdentity: targetIdentity });
    useZCodeSessionStore.getState().setActiveTaskId(targetPath, taskId, targetIdentity);
  });
  const attachment = vi.fn(attachRemoteProjectWorkspace);
  const sequence = { current: 0 };
  const taskActions = await callback<ProjectSidebarProps["onSelectTask"]>(
    "../src/project-sidebar/useProjectTaskNavigation.ts",
    "returnedCallback",
    {
      sequence,
      latest: {
        current: {
          props: {
            workspacePath: "/origin",
            onSelectTask,
            onSelectRemoteProject: history,
            onConnectRemote: vi.fn(async () => "qa-session"),
            onCancelRemoteProject: vi.fn(async () => {}),
          },
          tree: {
            tasks: [{ taskId: "task-A", hostId, workspacePath: path, workspaceIdentity: identity }],
          },
          remoteService,
        },
      },
      tabStoreApi: tabs,
      useZCodeSessionStore,
      attachRemoteProjectWorkspace: attachment,
      useRemoteWorkspaceSessionStore: {
        getState: () => ({ sessionsById: { "qa-session": session } }),
      },
      logger,
      toast: vi.fn(),
    },
  );
  return {
    tabs,
    startDraft,
    rootActions,
    taskActions,
    onSelectTask,
    entered,
    refresh,
    attachment,
    sequence,
    logger,
  };
}

describe("远端新任务只在原 history 激活边界提交", () => {
  it("补充读取期间用户后选任务，旧新建返回不能再次清空任务", async () => {
    const f = await fixture();
    const request = f.rootActions("new task", { projectId, hostId });
    await f.entered.promise;
    useZCodeSessionStore.getState().setActiveTaskId(path, "later-task", identity);
    f.refresh.resolve();
    await request;
    expect(useZCodeSessionStore.getState().getWorkspaceState(path, identity).activeTaskId).toBe(
      "later-task",
    );
    expect(f.startDraft).toHaveBeenCalledTimes(1);
  });

  it("完整草稿/配置/附件和完成回执在激活时一次提交，不等待列表刷新", async () => {
    const f = await fixture();
    const handoff: NonNullable<CreateTaskOptions["initialComposerDraft"]> = {
      sourceWorkspaceKey: "/origin",
      draft: {
        text: "原始草稿  ",
        mode: "build",
        planEnabled: true,
        modelSelection: { providerId: "custom", modelId: "test-model" },
      },
      attachments: [{ id: "attachment", filename: "a.txt", mimeType: "text/plain", sizeBytes: 1 }],
    };
    const onComplete = vi.fn();
    const request = f.rootActions("handoff", {
      projectId,
      hostId,
      initialComposerDraft: handoff,
      taskGroupId: "group",
      onComplete,
    });
    await f.entered.promise;
    const scope = composerDrafts.resolveComposerScope(projectId, identity, "desktop");
    const atActivation = composerDrafts.readV4ComposerDraft(
      path,
      identity,
      composerDrafts.V4_DRAFT_SCOPE_ROOT,
      scope,
    );
    const version = useZCodeSessionStore
      .getState()
      .getWorkspaceState(path, identity).draftFocusVersion;
    const attachments = consumeV4ComposerDraftAttachments(identity, version);
    const completedAtActivation = onComplete.mock.calls.length;
    f.refresh.resolve();
    await request;
    expect(atActivation).toMatchObject({ ...handoff.draft, projectId, taskGroupId: "group" });
    expect(attachments).toEqual(handoff.attachments);
    expect(completedAtActivation).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(f.startDraft).toHaveBeenCalledTimes(1);
  });

  it("激活即保留 initialPrompt 的尾空格和结构化 mention", async () => {
    const f = await fixture();
    const mention = {
      id: "skill:qa",
      category: "skills" as const,
      label: "qa",
      value: "qa",
      markdown: "$qa",
    };
    const request = f.rootActions("prompt", {
      projectId,
      hostId,
      initialPrompt: "$qa  ",
      initialPromptMention: mention,
    });
    await f.entered.promise;
    const inserted = useZCodeSessionStore
      .getState()
      .getWorkspaceState(path, identity).composerTextInsertRequest;
    f.refresh.resolve();
    await request;
    expect(inserted).toMatchObject({ text: "$qa  ", mention });
    expect(f.startDraft).toHaveBeenCalledTimes(1);
  });

  it("显式预填正文不丢失同次 handoff 的配置与附件", async () => {
    const f = await fixture();
    const handoff: NonNullable<CreateTaskOptions["initialComposerDraft"]> = {
      sourceWorkspaceKey: "/origin",
      draft: {
        text: "被显式预填替换的正文",
        editorStateJson: "旧正文对应的 editor state",
        mode: "build",
        planEnabled: true,
        modelSelection: { providerId: "custom", modelId: "test-model" },
      },
      attachments: [{ id: "attachment", filename: "a.txt", mimeType: "text/plain", sizeBytes: 1 }],
    };
    const request = f.rootActions("prompt handoff", {
      projectId,
      hostId,
      initialPrompt: "新预填正文  ",
      initialComposerDraft: handoff,
    });
    await f.entered.promise;
    const scope = composerDrafts.resolveComposerScope(projectId, identity, "desktop");
    const atActivation = composerDrafts.readV4ComposerDraft(
      path,
      identity,
      composerDrafts.V4_DRAFT_SCOPE_ROOT,
      scope,
    );
    const version = useZCodeSessionStore
      .getState()
      .getWorkspaceState(path, identity).draftFocusVersion;
    const attachments = consumeV4ComposerDraftAttachments(identity, version);
    f.refresh.resolve();
    await request;
    expect(atActivation).toMatchObject({
      text: "新预填正文  ",
      mode: "build",
      planEnabled: true,
      modelSelection: handoff.draft.modelSelection,
    });
    expect(atActivation?.editorStateJson).toBeUndefined();
    expect(attachments).toEqual(handoff.attachments);
  });
});

describe("远端历史任务 attachment 返回后的导航资格", () => {
  it("自身切换 workspace/identity 不使正常导航失效", async () => {
    const f = await fixture();
    f.taskActions(path, "task-A", identity);
    await f.entered.promise;
    f.refresh.resolve();
    await f.attachment.mock.results[0]!.value;
    expect(f.onSelectTask).toHaveBeenCalledWith(path, "task-A", identity, "qa-session", undefined);
    expect(f.logger.error).not.toHaveBeenCalled();
  });

  it.each(["task", "draft", "tab", "history", "request"])(
    "补充读取期间 %s 换代后，旧任务不能再被选择",
    async (later) => {
      const f = await fixture();
      f.taskActions(path, "task-A", identity);
      await f.entered.promise;
      const state = useZCodeSessionStore.getState();
      if (later === "task") state.setActiveTaskId(path, "later-task", identity);
      if (later === "draft") state.startDraft(path, undefined, identity, { projectId });
      if (later === "tab") f.tabs.getState().addTab("/later-tab");
      if (later === "history") {
        state.setActiveTaskId(path, "later-task", identity);
        useZCodeSessionStore.getState().setActiveTaskId(path, null, identity);
      }
      if (later === "request") f.sequence.current++;
      f.refresh.resolve();
      await f.attachment.mock.results[0]!.value;
      expect(f.onSelectTask).not.toHaveBeenCalled();
      expect(f.logger.error).not.toHaveBeenCalled();
    },
  );
});

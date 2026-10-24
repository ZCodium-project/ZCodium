/* eslint-disable max-lines -- Root workspace action hook 集中编排项目、远程和 conversation 入口；合并期保持动作边界完整，后续按领域拆分。 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DesktopCommandIds,
  remoteHostIdFromWorkspaceIdentity,
  type AppSettings,
  type IPlatformService,
  type UserInfo,
  type ZCodeTaskClientMode,
} from "@zcode/shared";
import type { IServiceAccessor } from "@zcode/services";
import type {
  CreateTaskOptions,
  CreateTaskRequest,
  RemoteConnectionOpenPreference,
} from "@/app-shell/types.js";
import { useComposerClientNamespace } from "@/hooks/useServices.js";
import { readProjectSidebarView } from "@/project-sidebar/index.js";
import { stageV4ComposerDraftAttachments } from "@/v4/composer/composerDraftWorkspaceTransfer.js";
import {
  resolveComposerScope,
  ensurePendingTaskDraft,
  bindPendingTaskDraft,
  rememberComposerWorkspaceScope,
  readComposerWorkspaceScope,
  readV4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { resolveLogoutProviderFamilyDomain } from "@/lib/providerFamilyDomainSettings.js";
import { isRendererReloadNavigation } from "@/lib/rendererNavigation.js";
import { parseWslUncWorkspacePath } from "@/lib/wslUncWorkspace.js";
import { logger } from "@/logger.js";
import { openFolderFromWorkspaceEntry } from "@/root/openWorkspaceFolderEntry.js";
import { useConversationWorkspaceActions } from "@/root/useConversationWorkspaceActions.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { type TabStore, type TabStoreState } from "@/store/tabStore.js";
import { notifyTaskNavigationCommitted } from "@/store/zcodeSessionStoreNavigation.js";
import type { RootProps } from "@/root/types.js";
import { hadPersistedPaneLayoutAtModuleLoad, usePaneLayoutStore } from "@/v4/paneLayoutStore.js";
import { resolveWorkbenchNewTaskTarget } from "@/v4/workbenchNewTaskTarget.js";
import type { WorkbenchNewTaskTarget } from "@/v4/workbenchNewTaskTarget.js";
import { useWorkbenchGroupStore } from "@/v4/workbenchGroupStore.js";
import { persistV4ComposerDraft, V4_DRAFT_SCOPE_ROOT } from "@/v4/composer/composerDraftStore.js";

export type OpenRemoteConnectionPreference = RemoteConnectionOpenPreference;

/** 新任务落点：identity 缺省一律归一化为 null，供只读校验、focus/addTab 统一消费。 */
export interface NewTaskTargetResolution {
  workspacePath: string;
  workspaceIdentity: string | null;
}

/**
 * 解析新任务落点：请求显式带 targetWorkspace 时（跨项目发起已保存工作流）直接采用它，不再询问 workbench 焦点；
 * 否则惰性回退到 resolveWorkbenchNewTaskTarget。identity 缺省归一化为 null。
 */
export function resolveNewTaskTargetFromRequest(
  request: CreateTaskRequest | undefined,
  resolveFallback: () => WorkbenchNewTaskTarget | null,
): NewTaskTargetResolution | null {
  const targetWorkspace =
    typeof request === "string" || !request ? undefined : request.targetWorkspace;
  if (targetWorkspace) {
    return {
      workspacePath: targetWorkspace.workspacePath,
      workspaceIdentity: targetWorkspace.workspaceIdentity ?? null,
    };
  }
  const fallback = resolveFallback();
  if (!fallback) {
    return null;
  }
  return {
    workspacePath: fallback.workspacePath,
    workspaceIdentity: fallback.workspaceIdentity ?? null,
  };
}

export function useRootWorkspaceActions({
  intl,
  platform,
  services,
  tabStoreApi,
  addTab,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  supportsSettings,
  allowOpenWorkspace,
  preferDirectoryBrowser,
  openDirectoryBrowser,
  refreshProviderState,
  updateAppSettings,
  setOAuthError,
  setUser,
  onProviderFamilyDomainClearedAfterLogout,
  userId,
  onOpenRemoteConnection,
  openRemoteProjectWorkspace,
  openMobileProjectDraft,
  workbenchGroupClientMode = "desktop-continuous",
}: {
  intl: ReturnType<typeof import("@/i18n/IntlProvider.js").useZCodeIntl>["intl"];
  platform: IPlatformService;
  services: IServiceAccessor;
  tabStoreApi: TabStore;
  addTab: TabStoreState["addTab"];
  activeWorkspacePath: string | null;
  activeWorkspaceIdentity: string | null;
  supportsSettings: boolean;
  allowOpenWorkspace: NonNullable<RootProps["allowOpenWorkspace"]>;
  preferDirectoryBrowser: boolean;
  openDirectoryBrowser?: () => void;
  refreshProviderState: () => Promise<void>;
  updateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
  setOAuthError: (error: string | null) => void;
  setUser: (user: UserInfo | null) => void;
  onProviderFamilyDomainClearedAfterLogout?: () => void;
  userId?: string;
  onOpenRemoteConnection?: (preference?: RemoteConnectionOpenPreference) => void;
  openRemoteProjectWorkspace?: (target: {
    hostId: string;
    workspacePath: string;
    workspaceIdentity?: string;
    expectedMembershipId?: string;
    projectId: string | null;
    isCurrent?: () => boolean;
    /** 由原 history owner 在 canonical workspace 激活时同步提交，不能等列表刷新返回。 */
    onWorkspaceActivated?: () => void;
  }) => Promise<void>;
  openMobileProjectDraft?: (request: CreateTaskOptions) => Promise<void>;
  workbenchGroupClientMode?: ZCodeTaskClientMode;
}) {
  const navigationSequence = useRef(0);
  const remoteProjectOpener = useRef(openRemoteProjectWorkspace);
  useLayoutEffect(() => {
    remoteProjectOpener.current = openRemoteProjectWorkspace;
  });
  const [workspaceActionError, setWorkspaceActionError] = useState<string | null>(null);
  const requestConfirmation = useConfirmDialog();
  const {
    handleSelectConversationWorkspace,
    handleResolveConversationWorkspace,
    handleEnsureConversationWorkspace,
  } = useConversationWorkspaceActions({
    services,
    addTab,
    setWorkspaceActionError,
  });

  useEffect(() => {
    useWorkbenchGroupStore.getState().configureClientMode(workbenchGroupClientMode);
    if (workbenchGroupClientMode === "desktop-continuous" && !isRendererReloadNavigation()) {
      // group/pane 是 renderer-local 持久化 UI 状态。app 冷启动如果直接
      // 激活它们，即使 activeTaskId=null 也会把历史 session 显示出来，违背启动草稿语义。
      // renderer reload 则保留恢复资格，用于输出中刷新续流。
      const workbenchState = useWorkbenchGroupStore.getState();
      const activeGroup = workbenchState.activeGroupId
        ? workbenchState.groups[workbenchState.activeGroupId]
        : null;
      const activeGroupWasRestored = Boolean(
        activeGroup &&
        [activeGroup.primaryBinding, ...Object.values(activeGroup.panes)].some(
          (binding) => binding.restoredUnvalidated,
        ),
      );
      if (activeGroupWasRestored) {
        workbenchState.deactivateActiveGroup();
      }
      if (hadPersistedPaneLayoutAtModuleLoad()) {
        usePaneLayoutStore.getState().resetToPrimaryPane();
      }
    }
  }, [workbenchGroupClientMode]);

  const composerClientNamespace = useComposerClientNamespace();
  const startDraftInWorkspace = useCallback(
    (workspacePath: string, workspaceIdentity?: string, options?: CreateTaskOptions) => {
      const projectId =
        options?.projectId !== undefined
          ? options.projectId
          : (readComposerWorkspaceScope(workspacePath, workspaceIdentity, composerClientNamespace)
              ?.projectId ?? null);
      const scope = resolveComposerScope(projectId, workspaceIdentity, composerClientNamespace);
      const savedDraft = readV4ComposerDraft(
        workspacePath,
        workspaceIdentity,
        V4_DRAFT_SCOPE_ROOT,
        scope,
      );
      const taskGroupId =
        options?.taskGroupId !== undefined
          ? options.taskGroupId
          : (savedDraft?.taskGroupId ?? null);
      rememberComposerWorkspaceScope(workspacePath, workspaceIdentity, scope);
      if (options?.draftId) bindPendingTaskDraft(scope, options.draftId, workspacePath);
      persistV4ComposerDraft(
        workspacePath,
        workspaceIdentity,
        V4_DRAFT_SCOPE_ROOT,
        {
          text: "",
          ...(options?.initialComposerDraft?.draft ?? savedDraft),
          projectId,
          taskGroupId,
        },
        scope,
      );
      if (workbenchGroupClientMode === "desktop-continuous") {
        useWorkbenchGroupStore.getState().deactivateActiveGroup();
        usePaneLayoutStore.getState().resetToPrimaryPane();
      }
      useZCodeSessionStore
        .getState()
        .startDraft(workspacePath, options?.provider, workspaceIdentity, {
          projectId,
          taskGroupId,
        });
      if (options?.initialComposerDraft) {
        stageV4ComposerDraftAttachments(
          workspacePath,
          workspaceIdentity,
          useZCodeSessionStore.getState().getWorkspaceState(workspacePath, workspaceIdentity)
            .draftFocusVersion,
          options.initialComposerDraft,
        );
      }
      // 项目草稿只由接收目录的 Root 初始化；mention 的尾空格属于编辑内容。
      const initialPrompt = options?.initialPrompt;
      if (initialPrompt?.trim()) {
        const mention = options?.initialPromptMention;
        persistV4ComposerDraft(
          workspacePath,
          workspaceIdentity,
          V4_DRAFT_SCOPE_ROOT,
          {
            // #79：显式预填只替换正文，不能把同次交接的模型/模式配置抹掉；
            // 旧 editor state/mention 属于旧正文，必须随正文一起失效。
            ...(options?.initialComposerDraft?.draft ?? savedDraft),
            text: initialPrompt,
            editorStateJson: undefined,
            projectId,
            taskGroupId,
            mention,
          },
          scope,
        );
        useZCodeSessionStore
          .getState()
          .requestComposerTextInsert(workspacePath, initialPrompt, workspaceIdentity, mention);
      }
    },
    [workbenchGroupClientMode, composerClientNamespace],
  );

  const startNewTaskFromActiveWorkspace = useCallback(
    async (source: string, request?: CreateTaskRequest) => {
      const openRemoteProjectWorkspace = remoteProjectOpener.current;
      const sequence = ++navigationSequence.current;
      const originTab = tabStoreApi.getState().activeTabId;
      const originWorkspace = activeWorkspacePath
        ? useZCodeSessionStore
            .getState()
            .getWorkspaceState(activeWorkspacePath, activeWorkspaceIdentity ?? undefined)
        : null;
      const isCurrent = () =>
        (typeof request !== "object" || request.isCurrent?.() !== false) &&
        sequence === navigationSequence.current &&
        tabStoreApi.getState().activeTabId === originTab &&
        (!activeWorkspacePath ||
          (() => {
            const state = useZCodeSessionStore
              .getState()
              .getWorkspaceState(activeWorkspacePath, activeWorkspaceIdentity ?? undefined);
            return (
              state.activeTaskId === originWorkspace?.activeTaskId &&
              state.draftFocusVersion === originWorkspace?.draftFocusVersion
            );
          })());
      try {
        // 在第一次 await 前捕获活动任务/草稿；快捷键和侧栏新建共用同一组织意图。
        const requestOptions = typeof request === "string" ? { provider: request } : { ...request };
        if (
          requestOptions.taskGroupId === undefined &&
          requestOptions.projectId === undefined &&
          readProjectSidebarView() === "grouped" &&
          activeWorkspacePath
        ) {
          const taskId = originWorkspace?.activeTaskId;
          const draftGroupId = originWorkspace?.draftTaskGroupId;
          const structure = taskId ? await services.taskGroupService?.read() : undefined;
          if (!isCurrent()) return;
          requestOptions.taskGroupId = taskId
            ? (structure?.members.find(
                (member) =>
                  member.taskId === taskId &&
                  member.workspaceKey === (activeWorkspaceIdentity?.trim() || activeWorkspacePath),
              )?.groupId ?? null)
            : (draftGroupId ?? null);
        }
        request = requestOptions;
        let projectId =
          typeof request === "string"
            ? undefined
            : (request?.projectId ?? request?.targetWorkspace?.projectId);
        let hostId =
          typeof request === "string"
            ? undefined
            : (request?.hostId ?? request?.targetWorkspace?.hostId);
        const hasExplicitProject =
          typeof request === "object" &&
          request !== null &&
          ("projectId" in request || Boolean(request.targetWorkspace?.projectId));
        const newTaskTarget = resolveNewTaskTargetFromRequest(request, () =>
          resolveWorkbenchNewTaskTarget({
            activeWorkspacePath,
            activeWorkspaceIdentity,
            activeGroup: useWorkbenchGroupStore.getState().activeGroupId
              ? (useWorkbenchGroupStore.getState().groups[
                  useWorkbenchGroupStore.getState().activeGroupId!
                ] ?? null)
              : null,
            paneLayout: usePaneLayoutStore.getState(),
          }),
        );
        if (!hasExplicitProject && newTaskTarget) {
          // 原因：仅远程继承项目会让本地快捷键落入未归类。按任务完整身份读取归属，不能由 cwd 猜项目。
          if (newTaskTarget.workspaceIdentity) {
            hostId =
              remoteHostIdFromWorkspaceIdentity(newTaskTarget.workspaceIdentity) ?? undefined;
            if (!hostId) throw new Error("project.host-identity-required");
          }
          const workspace = useZCodeSessionStore
            .getState()
            .getWorkspaceState(
              newTaskTarget.workspacePath,
              newTaskTarget.workspaceIdentity ?? undefined,
            );
          const tree = workspace.activeTaskId
            ? await services.projectService?.readTree(hostId ? { hostId } : undefined)
            : undefined;
          if (workspace.activeTaskId && !tree) throw new Error("project.service-unavailable");
          projectId = workspace.activeTaskId
            ? (tree?.tasks.find(
                (task) =>
                  task.taskId === workspace.activeTaskId &&
                  (task.workspaceIdentity?.trim() || task.workspacePath) ===
                    (newTaskTarget.workspaceIdentity?.trim() || newTaskTarget.workspacePath),
              )?.projectId ?? undefined)
            : (workspace.draftProjectId ?? undefined);
          if (hostId && !projectId) throw new Error("project.remote-project-required");
        }
        if (!isCurrent()) return;
        if (workbenchGroupClientMode === "web-remote-replayable") {
          if (!openMobileProjectDraft) throw new Error("project.remote-navigation-unavailable");
          // 归属先在共享入口解析，目录仍只由 bridge owner 准备；旧 Root 不写交接后的草稿。
          await openMobileProjectDraft({
            ...requestOptions,
            ...(projectId ? { projectId } : {}),
            ...(hostId ? { hostId } : {}),
          });
          return;
        }
        if (!services.projectService) throw new Error("project.service-unavailable");
        const pendingDraft =
          !projectId && (!hostId || hostId === "local")
            ? ensurePendingTaskDraft(resolveComposerScope(null, undefined, composerClientNamespace))
            : null;
        const target = await services.projectService.prepareSession({
          ...(projectId ? { projectId } : {}),
          ...(hostId ? { hostId } : {}),
          // 显式 local 与省略 Host 是同一入口，不能漏掉待发送身份而另建目录。
          ...(pendingDraft
            ? { draftId: pendingDraft.draftId, reuseDraft: Boolean(pendingDraft.workspacePath) }
            : {}),
        });
        if (!isCurrent()) return;
        const activateDraft = () => {
          startDraftInWorkspace(target.workspacePath, target.workspaceIdentity, {
            ...requestOptions,
            ...(pendingDraft ? { draftId: pendingDraft.draftId } : {}),
            projectId: target.projectId,
          });
          requestOptions.onComplete?.();
          setWorkspaceActionError(null);
          logger.info(`[Root] ${source}`, {
            workspacePath: target.workspacePath,
            projectId: target.projectId,
          });
        };
        if (hostId && hostId !== "local") {
          if (!target.workspaceIdentity || !openRemoteProjectWorkspace)
            throw new Error("project.remote-navigation-unavailable");
          await openRemoteProjectWorkspace({
            ...target,
            hostId,
            isCurrent,
            onWorkspaceActivated: activateDraft,
            ...(typeof request === "object" && request.remoteProjectMembershipId
              ? { expectedMembershipId: request.remoteProjectMembershipId }
              : {}),
          });
          // #79：history 已在 bind ACK/port ready 的唯一激活边界提交完整草稿。
          // pinned/timeline 等补充读取返回后再 startDraft 会清掉用户后来选中的任务。
          return;
        }
        // 目录准备成功才提交导航；失败保留当前会话和分屏。
        addTab(target.workspacePath, {
          workspacePurpose: target.projectId ? "project" : "conversation",
          ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
        });
        activateDraft();
      } catch (error) {
        if (!isCurrent()) return;
        logger.error("[Root] 准备新任务失败", error);
        if (typeof request === "object") request.onError?.(error);
        setWorkspaceActionError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      services.projectService,
      composerClientNamespace,
      activeWorkspacePath,
      activeWorkspaceIdentity,
      tabStoreApi,
      addTab,
      openMobileProjectDraft,
      workbenchGroupClientMode,
      startDraftInWorkspace,
    ],
  );

  const handleLogout = useCallback(async () => {
    let runningAgentSessionCount: number | null = null;
    try {
      const sessionActivity = await platform.getDesktopSessionActivity?.();
      runningAgentSessionCount =
        typeof sessionActivity?.runningAgentSessionCount === "number"
          ? sessionActivity.runningAgentSessionCount
          : null;
    } catch (error) {
      logger.warn("[Root] 查询桌面运行中会话数量失败，使用保守退出登录文案", { error });
    }

    const confirmed = await requestConfirmation({
      title: intl.formatMessage({ id: "logout.confirm.title" }),
      description:
        runningAgentSessionCount !== null && runningAgentSessionCount > 0
          ? intl.formatMessage(
              { id: "logout.confirm.descriptionWithRunningSessions" },
              { count: String(runningAgentSessionCount) },
            )
          : intl.formatMessage({ id: "logout.confirm.descriptionDefault" }),
      confirmLabel: intl.formatMessage({ id: "logout.confirm.ok" }),
      cancelLabel: intl.formatMessage({ id: "logout.confirm.cancel" }),
    });
    if (!confirmed) {
      return;
    }
    const settingsBeforeLogout = await services.settingService.get();
    const nextProviderFamilyDomain = resolveLogoutProviderFamilyDomain({
      currentDomain: settingsBeforeLogout.providerFamilyDomain,
    });
    await services.oauthService.logout();
    await updateAppSettings({
      providerFamilyDomain: (nextProviderFamilyDomain ?? "") as AppSettings["providerFamilyDomain"],
      providerFamilyDomainUpdatedAt: Date.now(),
      providerFamilyDomainMigrated: true,
    });
    if (!nextProviderFamilyDomain) {
      onProviderFamilyDomainClearedAfterLogout?.();
    }
    // ZAI/BigModel provider 已恢复为 App 登录镜像。
    // 派生 Coding/Start key 由 OAuth logout 的 host hook 统一清理，Root 只负责刷新展示态。
    setOAuthError(null);
    setUser(null);
    // 退出登录后刷新 Account Source 与 Registry，避免继续展示退出前的 Provider 状态。
    await refreshProviderState();
    // Coding Plan 官网 webview 使用独立持久 partition，App logout 必须同步清理。
    await platform.executeDesktopCommand(DesktopCommandIds.ClearCodingPlanWebviewStorage);
    await platform.executeDesktopCommand(DesktopCommandIds.RelaunchApp);
  }, [
    intl,
    requestConfirmation,
    refreshProviderState,
    onProviderFamilyDomainClearedAfterLogout,
    platform,
    services.oauthService,
    services.modelSelectionService,
    services.settingService,
    setOAuthError,
    setUser,
    updateAppSettings,
    userId,
  ]);

  const handleSelectProject = useCallback(
    async (path: string) => {
      logger.info("[Root] handleSelectProject called with path:", path);
      try {
        const wslUncWorkspace = parseWslUncWorkspacePath(path);
        if (wslUncWorkspace && onOpenRemoteConnection) {
          const shouldOpenWslConnection = await requestConfirmation({
            title: intl.formatMessage({ id: "workspace.wslUncPrompt.title" }),
            description: intl.formatMessage(
              { id: "workspace.wslUncPrompt.description" },
              {
                path,
              },
            ),
            confirmLabel: intl.formatMessage({ id: "workspace.wslUncPrompt.openWsl" }),
            cancelLabel: intl.formatMessage({ id: "workspace.wslUncPrompt.continuePath" }),
          });
          if (shouldOpenWslConnection) {
            logger.info("[Root] 用户选择通过 WSL 远程连接打开 UNC 工作区", {
              distro: wslUncWorkspace.distro,
              path,
            });
            onOpenRemoteConnection({
              preferredKind: "wsl",
              preferredWslDistro: wslUncWorkspace.distro,
            });
            return;
          }
        }

        // 桌面端：检查是否已有其他窗口打开了该目录，如果是则激活该窗口对应 tab
        const result = await platform.activateOrSetWorkspace(path);
        if (result.activated) {
          logger.info("[Root] 目录已在其他窗口打开，已激活该窗口对应 tab，跳过重复打开");
          return;
        }

        // 新增 tab（如果已在本窗口打开则激活它）
        addTab(path);
        // 打开 workspace 是 workspace-only 意图，不是“继续上次会话”。
        // 即使命中已存在 tab，也必须清掉该 workspace 的 activeTaskId 并回到单 pane 草稿。
        startDraftInWorkspace(path);
        setWorkspaceActionError(null);

        // 更新最近项目列表
        if (supportsSettings) {
          // 远程窗口的 host 不提供 settingService，之前这里仍然会更新 recentProjects，
          // 导致 SSH 场景在打开项目后再次命中不存在的 setting channel。
          // 只有本地窗口才维护最近项目，远程窗口只负责打开当前 workspace。
          logger.info("[Root] calling settingService.get()...");
          const settings = await services.settingService.get();
          const updated = [
            path,
            ...settings.recentProjects.filter((projectPath) => projectPath !== path),
          ].slice(0, 10);
          await services.settingService.update({ recentProjects: updated });
          // Dock/Jump List 的系统最近文档入口已经下线，这里只保留应用内 recentProjects，
          // 避免系统最近项和项目选择页列表重复维护，造成两个入口内容漂移。
          logger.info("[Root] settingService.update() done");
        }
      } catch (err) {
        logger.error("[Root] handleSelectProject error:", err);
      }
    },
    [
      addTab,
      intl,
      onOpenRemoteConnection,
      platform,
      requestConfirmation,
      services.settingService,
      startDraftInWorkspace,
      supportsSettings,
    ],
  );

  const handleOpenWorkspace = useCallback(() => {
    if (!allowOpenWorkspace) {
      // Web 远程控制当前只保证“进入 desktop 已打开的 workspace”。
      // 之前这里继续放开“打开工作区”，用户会被带进打开工作区中间页，
      // 但后续的新工作区/新会话链路并没有在 Web 远程控制模式里补齐，看起来就像页面一直卡住。
      // 这里直接拦掉入口，避免把用户带进半支持状态。
      logger.info("[Root] 当前模式不支持打开其他工作区，已忽略请求");
      return;
    }
    setWorkspaceActionError(null);

    if (preferDirectoryBrowser) {
      void openFolderFromWorkspaceEntry({
        preferDirectoryBrowser,
        openDirectoryBrowser,
        selectDirectory: () => platform.selectDirectory(),
        onSelectProject: (path) => {
          void handleSelectProject(path);
        },
      });
      return;
    }

    // 打开工作区中间页作为“新标签页”会在启动空态、Cmd/Ctrl+O
    // 和菜单打开工作区时抢占整页。现在打开工作区只保留为动作：本地优先直接弹系统目录选择，
    // 不再进入中间页面；不支持系统目录选择的壳层由启动兜底负责创建默认 workspace。
    if (!supportsSettings) {
      void handleEnsureConversationWorkspace().catch((error) => {
        logger.error("[Root] 创建对话 workspace 失败", { error });
      });
      return;
    }

    void openFolderFromWorkspaceEntry({
      selectDirectory: () => platform.selectDirectory(),
      onSelectProject: (path) => {
        void handleSelectProject(path);
      },
    });
  }, [
    allowOpenWorkspace,
    handleEnsureConversationWorkspace,
    handleSelectProject,
    openDirectoryBrowser,
    platform,
    preferDirectoryBrowser,
    supportsSettings,
  ]);

  const handleOpenFolderFromWorkspaceMenu = useCallback(() => {
    if (!allowOpenWorkspace) {
      logger.info("[Root] 当前模式不支持从空态菜单打开文件夹，已忽略请求");
      return;
    }

    // 空态 workspace 菜单的 Open folder 需要复用根级打开工作区动作。
    // 因此这里调用同一个入口函数，只把 Root 里的 selectDirectory 与项目选择回调注入进去。
    if (preferDirectoryBrowser) {
      void openFolderFromWorkspaceEntry({
        preferDirectoryBrowser,
        openDirectoryBrowser,
        selectDirectory: () => platform.selectDirectory(),
        onSelectProject: (path) => {
          void handleSelectProject(path);
        },
      });
      return;
    }

    if (!supportsSettings) {
      void handleEnsureConversationWorkspace().catch((error) => {
        logger.error("[Root] 从空态菜单创建对话 workspace 失败", { error });
      });
      return;
    }

    void openFolderFromWorkspaceEntry({
      selectDirectory: () => platform.selectDirectory(),
      onSelectProject: (path) => {
        void handleSelectProject(path);
      },
    });
  }, [
    allowOpenWorkspace,
    handleEnsureConversationWorkspace,
    handleSelectProject,
    openDirectoryBrowser,
    platform,
    preferDirectoryBrowser,
    supportsSettings,
  ]);

  const handleCreateScratchWorkspace = useCallback(
    async (name: string) => {
      if (!allowOpenWorkspace) {
        logger.info("[Root] 当前模式不支持从空态菜单创建工作区，已忽略请求");
        return null;
      }

      const result = await services.fileService.createScratchWorkspace({ name });
      await handleSelectProject(result.path);
      return result.path;
    },
    [allowOpenWorkspace, handleSelectProject, services.fileService],
  );

  const handleCreateTask = useCallback(
    (request?: CreateTaskRequest) => {
      return startNewTaskFromActiveWorkspace("sidebar new task", request);
    },
    [startNewTaskFromActiveWorkspace],
  );

  const createUnclassifiedTask = useCallback(
    () => startNewTaskFromActiveWorkspace("unclassified new task", { projectId: null }),
    [startNewTaskFromActiveWorkspace],
  );

  const handleBackFromSettings = useCallback(() => {
    if (!activeWorkspacePath) {
      return;
    }

    // 设置页返回最近 workspace 时不能只按 path 激活。
    // 同一路径可能存在不同远端身份，丢掉 activeWorkspaceIdentity 会把远程工作区切到 path-only 桶。
    const activated = tabStoreApi
      .getState()
      .activateTabByPath(
        activeWorkspacePath,
        activeWorkspaceIdentity ? { workspaceIdentity: activeWorkspaceIdentity } : undefined,
      );
    const taskId = useZCodeSessionStore
      .getState()
      .getWorkspaceState(activeWorkspacePath, activeWorkspaceIdentity ?? undefined).activeTaskId;
    if (activated && taskId)
      notifyTaskNavigationCommitted({
        workspacePath: activeWorkspacePath,
        workspaceIdentity: activeWorkspaceIdentity ?? undefined,
        taskId,
      });
  }, [activeWorkspaceIdentity, activeWorkspacePath, tabStoreApi]);

  return {
    workspaceActionError,
    setWorkspaceActionError,
    startDraftInWorkspace,
    startNewTaskFromActiveWorkspace,
    handleLogout,
    handleSelectProject,
    handleSelectConversationWorkspace,
    handleResolveConversationWorkspace,
    handleEnsureConversationWorkspace,
    handleCreateConversationTask: createUnclassifiedTask,
    handleOpenWorkspace,
    handleOpenFolderFromWorkspaceMenu,
    handleCreateScratchWorkspace,
    handleCreateTask,
    handleBackFromSettings,
  };
}

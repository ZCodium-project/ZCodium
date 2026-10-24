import { useCallback, useLayoutEffect, useRef } from "react";
import type {
  ProjectSidebarProps,
  ProjectTree,
  IRemoteProjectService,
} from "@/project-sidebar/contract.js";
import { attachRemoteProjectWorkspace } from "@/project-sidebar/remote-navigation.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { openWebRemoteControlTask } from "@/hooks/useWebRemoteControlTaskOpen.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeSessionStore } from "@/store/zcodeSessionStore.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";

/** 打开任务才绑定 workspace；列表 mutation 不借导航创建 scope。 */
export function useProjectTaskNavigation(
  props: ProjectSidebarProps,
  tree: ProjectTree,
  remoteService?: IRemoteProjectService,
): ProjectSidebarProps["onSelectTask"] {
  const tabStoreApi = useTabStoreApi();
  const sequence = useRef(0);
  useLayoutEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  const latest = useRef({ props, tree, remoteService });
  useLayoutEffect(() => {
    latest.current = { props, tree, remoteService };
  });
  return useCallback(
    (path, taskId, identity, remoteSessionId, unreadAt) => {
      const request = ++sequence.current;
      const { props, tree, remoteService } = latest.current;
      const activeWorkspaceIdentity = tabStoreApi.getState().activeWorkspaceIdentity;
      const readNavigation = () => {
        // Store 先提交、React 后渲染；异步资格不能依赖上一帧的 props/selector。
        const tab = tabStoreApi.getState();
        const state = useZCodeSessionStore.getState();
        const focus = tab.activeWorkspacePath
          ? state.getWorkspaceState(
              tab.activeWorkspacePath,
              tab.activeWorkspaceIdentity ?? undefined,
            )
          : undefined;
        return {
          tabId: tab.activeTabId,
          workspaceKey: tab.activeWorkspaceIdentity?.trim() || tab.activeWorkspacePath,
          history: state.taskNavHistory,
          taskId: focus?.activeTaskId,
          draftVersion: focus?.draftFocusVersion,
        };
      };
      let expectedNavigation = readNavigation();
      const isCurrent = () => {
        const current = readNavigation();
        return (
          sequence.current === request &&
          current.tabId === expectedNavigation.tabId &&
          current.workspaceKey === expectedNavigation.workspaceKey &&
          current.history === expectedNavigation.history &&
          current.taskId === expectedNavigation.taskId &&
          current.draftVersion === expectedNavigation.draftVersion &&
          (!identity ||
            latest.current.tree.tasks.some(
              (task) => task.taskId === taskId && task.workspaceIdentity === identity,
            ))
        );
      };
      const open = async () => {
        const task = tree.tasks.find(
          (item) =>
            item.taskId === taskId &&
            (item.workspaceIdentity || item.workspacePath) === (identity || path),
        );
        if (props.webRemoteControlWorkspaceSwitcher) {
          if (!task) throw new Error("project.task-not-found");
          await openWebRemoteControlTask({
            switcher: props.webRemoteControlWorkspaceSwitcher,
            activeWorkspacePath: props.workspacePath,
            activeWorkspaceIdentity: activeWorkspaceIdentity ?? undefined,
            activeTaskId: null,
            task: {
              ...task,
              workspacePath: path,
              workspaceIdentity: identity,
              taskId,
              unreadAt,
              workspaceLabel: path,
              workspaceKind: task.hostId === "local" ? "local" : "remote",
            },
            markTaskReadOnOpen: true,
            mobileNavigationIntent: "chat",
            onSelectTask: props.onSelectTask,
            onTaskOpen: props.onWebRemoteTaskOpen,
            onSwitchingChange: props.onWebRemoteTaskSwitchingChange,
            setError: (error) => {
              if (error) toast(error);
            },
          });
          return;
        }
        if (identity && task && remoteService) {
          const directory = await remoteService.readDirectory();
          if (!isCurrent()) return;
          if (directory.hosts.some((host) => host.id === task.hostId)) {
            remoteSessionId = await attachRemoteProjectWorkspace({
              hostId: task.hostId,
              workspacePath: path,
              workspaceIdentity: identity,
              remoteService,
              isCurrent,
              findSession: (key) =>
                Object.values(useRemoteWorkspaceSessionStore.getState().sessionsById).find(
                  (session) => session.workspaceIdentity === key,
                ),
              connect: props.onConnectRemote,
              bind: (sessionId, workspacePath, guard) =>
                props.onSelectRemoteProject(
                  sessionId,
                  workspacePath,
                  undefined,
                  identity,
                  guard,
                  () => {
                    // #79：自身 bind/激活会改变 origin scope，只在这个同步提交点接纳新快照。
                    // 后续补充读取期间的后选任务、草稿或历史回放不能被旧 attachment 覆盖。
                    expectedNavigation = readNavigation();
                  },
                ),
              cancel: props.onCancelRemoteProject,
            });
          }
        }
        if (!isCurrent()) return;
        props.onSelectTask(path, taskId, identity, remoteSessionId, unreadAt);
      };
      void open().catch((error) => {
        logger.error("[project-sidebar] 打开任务失败", error);
        toast(String(error));
      });
    },
    [tabStoreApi],
  );
}

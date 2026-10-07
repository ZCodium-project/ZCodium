import { useCallback, useSyncExternalStore } from "react";
import type { SessionDebugSnapshot } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";

const REFRESH_INTERVAL_MS = 1000;
const EMPTY_DEBUG = { rounds: [], networkEntries: [], cache: null };

type SessionDebugView = {
  rounds: SessionDebugSnapshot["rounds"];
  networkEntries: SessionDebugSnapshot["networkEntries"];
  cache: SessionDebugSnapshot["cache"];
  error: boolean;
};

const EMPTY_VIEW: SessionDebugView = { ...EMPTY_DEBUG, error: false };

type SharedLoop = {
  service: ReturnType<typeof useServices>["zcodeAgentService"];
  // workspacePath 只在守卫通过后进入循环（定位会话的必填项），此处保持非可选。
  params: { workspacePath: string; workspaceIdentity?: string; taskId: string };
  view: SessionDebugView;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setTimeout>;
  stopped: boolean;
};

// 会话级共享轮询：同一 (workspace, session) 的多个订阅者（调试面板、各回复动作行）
// 复用一条轮询循环。此前每组件实例独立轮询，20 轮会话插出 20 个秒级轮询器，
// 远控/SSH 场景每秒 N 次跨 host 往返；共享后每个会话恒定 1 次。
const sharedLoops = new Map<string, SharedLoop>();

function acquireLoop(
  scopeKey: string,
  service: SharedLoop["service"],
  params: SharedLoop["params"],
): SharedLoop {
  const existing = sharedLoops.get(scopeKey);
  if (existing && existing.service === service) return existing;
  if (existing) {
    // 服务实例被替换（重连/热重载）：旧循环停摆，其订阅者由 React 重新订阅新循环。
    existing.stopped = true;
    if (existing.timer) clearTimeout(existing.timer);
    existing.listeners.clear();
  }
  const loop: SharedLoop = {
    service,
    params,
    view: EMPTY_VIEW,
    listeners: new Set(),
    stopped: false,
  };
  sharedLoops.set(scopeKey, loop);
  startLoop(loop);
  return loop;
}

function startLoop(loop: SharedLoop) {
  const refresh = async () => {
    try {
      const data = await loop.service.readSessionDebug({
        workspacePath: loop.params.workspacePath,
        workspaceIdentity: loop.params.workspaceIdentity,
        sessionId: loop.params.taskId,
      });
      loop.view = { ...data, error: false };
    } catch {
      // 失败保留最近一次成功快照（历史行的速度不因瞬时错误闪烁），仅置错误标记。
      loop.view = { ...loop.view, error: true };
    }
    for (const listener of loop.listeners) listener();
    // 查询按完成节拍续期，不重叠请求；订阅清零或循环已停则不再排期。
    if (!loop.stopped && loop.listeners.size > 0)
      loop.timer = setTimeout(() => void refresh(), REFRESH_INTERVAL_MS);
  };
  void refresh();
}

function releaseLoop(loop: SharedLoop, listener: () => void): () => void {
  loop.listeners.add(listener);
  return () => {
    loop.listeners.delete(listener);
    if (loop.listeners.size === 0) {
      loop.stopped = true;
      if (loop.timer) clearTimeout(loop.timer);
      // 按值删除：loop 可能已被同 key 的新循环替换出 Map，不能按 key 删。
      for (const [key, value] of sharedLoops) if (value === loop) sharedLoops.delete(key);
    }
  };
}

export function useSessionDebug({
  workspacePath,
  workspaceIdentity,
  taskId,
  enabled = true,
}: {
  workspacePath?: string;
  workspaceIdentity?: string;
  taskId: string | null;
  enabled?: boolean;
}) {
  const { zcodeAgentService } = useServices();
  // workspacePath 是 workspace 定位必填项（身份 key 兜底）；缺席时无法定位会话，不轮询。
  const active = Boolean(enabled && taskId && workspacePath);
  const scopeKey = JSON.stringify([workspaceIdentity?.trim() || workspacePath, taskId]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      // active 蕴含 taskId 与 workspacePath 均存在，缺席时无法定位会话，不轮询。
      if (!active || !taskId || !workspacePath) return () => {};
      const loop = acquireLoop(scopeKey, zcodeAgentService, {
        workspacePath,
        workspaceIdentity,
        taskId,
      });
      return releaseLoop(loop, onStoreChange);
    },
    [active, scopeKey, taskId, workspaceIdentity, workspacePath, zcodeAgentService],
  );

  const getSnapshot = useCallback(
    () => sharedLoops.get(scopeKey)?.view ?? EMPTY_VIEW,
    [scopeKey],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}

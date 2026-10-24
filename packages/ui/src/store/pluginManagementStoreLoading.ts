import type { IPluginManagementService } from "@zcode/services";
import {
  parseRemoteWorkspaceIdentity,
  remoteHostIdFromWorkspaceIdentity,
  type ZCodePluginScope,
} from "@zcode/shared";
import { logger } from "@/logger.js";
import type { PluginManagementState } from "@/store/pluginManagementStore.js";

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildWorkspaceKey(workspacePath: string, workspaceIdentity: string | null): string {
  return workspaceIdentity?.trim() || workspacePath;
}

const inFlightLoads = new Map<string, Promise<void>>();

export interface PluginManagementChange {
  workspacePath: string;
  workspaceIdentity: string | null;
  scope: ZCodePluginScope;
}
const changeListeners = new Set<(change: PluginManagementChange) => void>();
export function subscribePluginManagementChanges(
  listener: (change: PluginManagementChange) => void,
): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}
export function notifyPluginManagementChange(change: PluginManagementChange): void {
  for (const listener of changeListeners) {
    try {
      listener(change);
    } catch (error) {
      logger.warn("[plugins] projection refresh failed", { error: toMessage(error) });
    }
  }
}
export function isPluginManagementChangeRelevant(
  target: { workspacePath: string; workspaceIdentity: string | null },
  change: PluginManagementChange,
): boolean {
  if (change.scope === "workspace")
    return (
      buildWorkspaceKey(target.workspacePath, target.workspaceIdentity) ===
      buildWorkspaceKey(change.workspacePath, change.workspaceIdentity)
    );
  const hostKey = (identity: string | null) => {
    const source = parseRemoteWorkspaceIdentity(identity ?? "")?.sourceServerId;
    return source
      ? `source-settings:${source}`
      : (remoteHostIdFromWorkspaceIdentity(identity ?? "") ?? "local");
  };
  return hostKey(target.workspaceIdentity) === hostKey(change.workspaceIdentity);
}

/** 仅投影在途命令；每次调用持有独立条目，迟到结束不能清除同名的新操作。 */
export function beginPluginOperation(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  id: string,
): () => void {
  const entry = { id };
  set({
    activeOperations: [...get().activeOperations, entry],
    operationId: id,
    operationVersion: get().operationVersion + 1,
    error: null,
    lastFailedPluginId: null,
  });
  return () => {
    if (!get().activeOperations.includes(entry)) return;
    const activeOperations = get().activeOperations.filter((operation) => operation !== entry);
    set({ activeOperations, operationId: activeOperations.at(-1)?.id ?? null });
  };
}

export async function runWorkspaceOperation(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  pluginService: IPluginManagementService,
  operationId: string,
  operation: (workspace: { workspacePath: string; workspaceIdentity?: string }) => Promise<void>,
  scope: ZCodePluginScope = "user",
): Promise<boolean> {
  const { workspacePath, workspaceIdentity, configScope } = get();
  if (!workspacePath) return false;
  const finish = beginPluginOperation(set, get, operationId);
  const operationVersion = get().operationVersion;
  const isCurrentContext = (): boolean => {
    const current = get();
    return (
      current.workspacePath === workspacePath &&
      current.workspaceIdentity === workspaceIdentity &&
      current.configScope === configScope
    );
  };
  const ownsVisibleOperation = (): boolean =>
    isCurrentContext() && get().operationVersion === operationVersion;
  try {
    await operation({
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    });
    // 只广播真实成功的写入，scope 切换不撤销已经落盘的变更；派生面板自行按身份刷新。
    notifyPluginManagementChange({ workspacePath, workspaceIdentity, scope });
    if (!isCurrentContext()) return false;
    await loadInto(set, get, {
      workspacePath,
      workspaceIdentity,
      configScope,
      pluginService,
      fresh: true,
    });
    return isCurrentContext();
  } catch (error) {
    // marketplace add/update 等通用操作失败：无插件目标，归属清空。
    logger.error("[plugins] operation failed", { operationId, error: toMessage(error) });
    // 旧操作不能覆盖同一配置层中新操作的错误态。
    if (ownsVisibleOperation()) {
      set({ error: toMessage(error), lastFailedPluginId: null });
    }
    return false;
  } finally {
    finish();
  }
}

export async function loadInto(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  params: {
    workspacePath: string;
    workspaceIdentity: string | null;
    configScope: ZCodePluginScope | null;
    pluginService: IPluginManagementService;
    fresh?: boolean;
  },
): Promise<void> {
  const workspaceKey = buildWorkspaceKey(params.workspacePath, params.workspaceIdentity);
  const loadKey = `${workspaceKey}\u0000${params.configScope ?? "effective"}`;
  const existing = inFlightLoads.get(loadKey);
  if (existing) {
    logger.debug("[plugins] join in-flight list", {
      configScope: params.configScope,
      workspaceKey,
    });
    await existing;
    // 变更前启动的读取不能代替变更后的刷新，等待旧读取完成后重新取权威状态。
    if (params.fresh) await loadInto(set, get, { ...params, fresh: false });
    return;
  }
  const loadTask = runLoadInto(set, get, { ...params, workspaceKey });
  inFlightLoads.set(loadKey, loadTask);
  try {
    await loadTask;
  } finally {
    if (inFlightLoads.get(loadKey) === loadTask) {
      inFlightLoads.delete(loadKey);
    }
  }
}

async function runLoadInto(
  set: (partial: Partial<PluginManagementState>) => void,
  get: () => PluginManagementState,
  params: {
    workspacePath: string;
    workspaceIdentity: string | null;
    configScope: ZCodePluginScope | null;
    workspaceKey: string;
    pluginService: IPluginManagementService;
  },
): Promise<void> {
  const setIfCurrent = (partial: Partial<PluginManagementState>): void => {
    const current = get();
    if (
      current.workspacePath !== params.workspacePath ||
      current.workspaceIdentity !== params.workspaceIdentity ||
      current.configScope !== params.configScope
    ) {
      return;
    }
    set(partial);
  };
  try {
    // React StrictMode、settings service 引用刷新或快速切换设置页时，
    // 同一 workspace 会并发触发 initialize。每次触发都发成独立 plugins/list 的话，
    // agent 已经 stale 时这些请求会排队产生多个 30s timeout。按 workspaceKey 复用 in-flight
    // 请求，并在仍处于同一 workspace 时才回写结果，避免过期响应覆盖当前设置页。
    const [listResult, overviewResult] = await Promise.all([
      params.pluginService.listPlugins({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      }),
      params.pluginService.getPluginsOverview({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      }),
    ]);
    const diagnostics = [...listResult.diagnostics, ...overviewResult.diagnostics];
    setIfCurrent({
      plugins: listResult.plugins,
      marketplaces: overviewResult.marketplaces,
      marketplaceAvailabilityKnown: true,
      // Host 注入的展示态；旧 agent/旧 Host 缺省视为可用。
      officialMarketplaceEnabled: overviewResult.officialMarketplaceEnabled !== false,
      availablePlugins: overviewResult.availablePlugins,
      installedPlugins: overviewResult.installedPlugins,
      restorableBuiltins: overviewResult.restorableBuiltins,
      diagnostics,
      loading: false,
    });
  } catch (error) {
    logger.error("[plugins] overview/list failed", {
      workspacePath: params.workspacePath,
      workspaceKey: params.workspaceKey,
      lastFailedPluginId: null,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      const result = await params.pluginService.listPlugins({
        workspacePath: params.workspacePath,
        ...(params.workspaceIdentity ? { workspaceIdentity: params.workspaceIdentity } : {}),
        ...(params.configScope ? { configScope: params.configScope } : {}),
      });
      setIfCurrent({
        plugins: result.plugins,
        marketplaces: [],
        // overview 失败时空数组表示“来源状态未知”，而不是“所有来源已删除”。
        // 保留该边界，避免 list fallback 返回的 official/cache 插件被批量误判为孤立安装。
        marketplaceAvailabilityKnown: false,
        availablePlugins: [],
        installedPlugins: [],
        restorableBuiltins: [],
        diagnostics: result.diagnostics,
        loading: false,
      });
      return;
    } catch (listError) {
      logger.error("[plugins] list fallback failed", {
        workspacePath: params.workspacePath,
        workspaceKey: params.workspaceKey,
        lastFailedPluginId: null,
        error: listError instanceof Error ? listError.message : String(listError),
      });
      setIfCurrent({
        loading: false,
        marketplaceAvailabilityKnown: false,
        lastFailedPluginId: null,
        error: listError instanceof Error ? listError.message : String(listError),
      });
    }
  }
}

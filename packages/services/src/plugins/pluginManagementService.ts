// 设置页插件管理薄服务实现——plugins/* 旧协议词的唯一 host 侧消费点。
// 插件安装/市场/启停的事实源在 zcode-cli 进程（读写 ~/.zcode 插件目录并热更新
// 运行态），host 无副本，故实现保持 agent 协议往返；收敛价值在 UI 层不再直触
// IZCodeAgentService，词表消费面从 UI 散点收拢到本文件一处。
import type { IZCodeAgentService } from "../zcode-agent/zcodeAgent.js";
import type { IPluginManagementService } from "./pluginManagement.js";

export interface PluginManagementServiceDependencies {
  now?: () => number;
  zcodeAgentService: Pick<
    IZCodeAgentService,
    | "listPlugins"
    | "getPluginReferenceCatalog"
    | "resolveSuggestedPluginReference"
    | "onDynamicPluginOperationProgress"
    | "getPluginsOverview"
    | "addPluginMarketplace"
    | "removePluginMarketplace"
    | "updatePluginMarketplace"
    | "installPlugin"
    | "cancelPluginOperation"
    | "uninstallPlugin"
    | "updatePlugin"
    | "restoreBuiltinPlugin"
    | "configurePlugin"
    | "resetPluginConfig"
    | "validatePlugin"
    | "describePlugin"
    | "setPluginEnabled"
  >;
}

export function createPluginManagementService(
  dependencies: PluginManagementServiceDependencies,
): IPluginManagementService {
  const agent = dependencies.zcodeAgentService;
  const now = dependencies.now ?? Date.now;
  type Params =
    import("../zcode-agent/zcodeAgentPluginParams.js").ZCodeAgentPluginMutationTarget & {
      pluginId?: string;
      pluginName?: string;
      marketplace?: string;
      scope?: "user" | "workspace";
      dryRun?: boolean;
      removeCache?: boolean;
    };
  type Result = {
    diagnostics?: Array<{ severity?: string; code?: string }>;
    installedPlugins?: Array<{
      id: string;
      marketplace: string;
      version?: string;
      scope: string;
      listing?: { publisherType?: string };
    }>;
    removedPlugin?: { id: string; marketplace: string; version?: string };
    pluginId?: string;
    marketplaces?: unknown[];
    marketplace?: { id: string };
    plugin?: { id: string; marketplace: string; source: string; version?: string };
  };
  const observe = async <T extends Result>(
    action: string,
    params: Params,
    invoke: (clean: Params) => Promise<T>,
  ): Promise<T> => {
    const startedAt = now();
    const { telemetry: _telemetry, ...clean } = params;
    try {
      const result = await invoke(clean);
      return result;
    } catch (error) {
      throw error;
    }
  };
  return {
    listPlugins: (params) => agent.listPlugins(params),
    getPluginReferenceCatalog: (params) => agent.getPluginReferenceCatalog(params),
    resolveSuggestedPluginReference: (params) => agent.resolveSuggestedPluginReference(params),
    onDynamicPluginOperationProgress: (operationId) =>
      agent.onDynamicPluginOperationProgress(operationId),
    getPluginsOverview: (params) => agent.getPluginsOverview(params),
    addPluginMarketplace: (params) =>
      observe("source_add", params, (clean) => agent.addPluginMarketplace(clean as typeof params)),
    removePluginMarketplace: (params) =>
      observe("source_remove", params, (clean) =>
        agent.removePluginMarketplace(clean as typeof params),
      ),
    updatePluginMarketplace: (params) =>
      observe("source_refresh", params, (clean) =>
        agent.updatePluginMarketplace(clean as typeof params),
      ),
    installPlugin: (params) =>
      observe("install", params, (clean) => agent.installPlugin(clean as typeof params)),
    cancelPluginOperation: (params) => agent.cancelPluginOperation(params),
    uninstallPlugin: (params) =>
      observe("uninstall", params, (clean) => agent.uninstallPlugin(clean as typeof params)),
    updatePlugin: (params) =>
      observe("update", params, (clean) => agent.updatePlugin(clean as typeof params)),
    restoreBuiltinPlugin: (params) =>
      observe("restore", params, (clean) => agent.restoreBuiltinPlugin(clean as typeof params)),
    configurePlugin: (params) =>
      observe("configure", params, (clean) => agent.configurePlugin(clean as typeof params)),
    resetPluginConfig: (params) =>
      observe("reset_config", params, (clean) => agent.resetPluginConfig(clean as typeof params)),
    validatePlugin: (params) => agent.validatePlugin(params),
    describePlugin: (params) => agent.describePlugin(params),
    setPluginEnabled: (params) =>
      observe(params.enabled ? "enable" : "disable", params, (clean) =>
        agent.setPluginEnabled(clean as typeof params),
      ),
  };
}

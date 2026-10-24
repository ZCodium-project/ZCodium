import { useEffect, useState } from "react";
import {
  parseRemoteWorkspaceIdentity,
  buildRemoteWorkspaceIdentity,
  remoteTargetSchema,
  type IServiceAccessor,
} from "./contract.js";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import {
  ensureSourceSettingsServices,
  useSourceSettingsServices,
} from "@/store/sourceSettingsServiceStore.js";
import { logger } from "@/logger.js";

/** 配置专用解析；不改变 conversation 的 workspace attachment / replay 边界。 */
export function useConfigWorkspaceServicesResolution(
  ...args: Parameters<typeof useWorkspaceServicesResolution>
) {
  const workspace = useWorkspaceServicesResolution(...args);
  const localServices = useBaseWorkspaceServices();
  const explicitLocal = !args[1]?.trim() && !args[2]?.trim() && !args[3];
  const parsed = args[2] && parseRemoteWorkspaceIdentity(args[2]);
  const sourceId = parsed && parsed.kind === "server" ? parsed.sourceServerId : undefined;
  const platform = useOptionalPlatform();
  const sourceServices = useSourceSettingsServices(sourceId);
  const canAttach = Boolean(platform?.requestSourceSettingsAttachment);
  const [binding, setBinding] = useState<{
    services: IServiceAccessor;
    workspaceKey: string;
  } | null>(null);
  const workspacePath = args[0];
  const workspaceKey = args[2]?.trim() || workspacePath || "";
  const target = remoteTargetSchema.safeParse(args[3]);
  const legacyRouteHint =
    target.success && workspacePath
      ? buildRemoteWorkspaceIdentity(workspacePath, target.data)
      : undefined;
  useEffect(() => {
    if (explicitLocal || workspace.rpcReady || !canAttach || !sourceServices || !workspacePath)
      return;
    let current = true;
    // 原因：无 tab 的 Source 配置没有经历 workspace attach，直接写会绕过旧 canonical key。
    // alias admission 完成后才开放 RPC；迟到结果只属于原 attachment/目录。
    void sourceServices.sourceServerWorkspaceService
      .resolveWorkspace({ workspacePath, legacyRouteHint })
      .then(
        () => {
          if (current) setBinding({ services: sourceServices, workspaceKey });
        },
        (error) => {
          if (current) logger.error("[workspace-config-catalog] 绑定配置目录身份失败", error);
        },
      );
    return () => {
      current = false;
    };
  }, [
    explicitLocal,
    workspace.rpcReady,
    canAttach,
    sourceServices,
    workspacePath,
    workspaceKey,
    legacyRouteHint,
  ]);
  useEffect(() => {
    if (workspace.rpcReady || !sourceId || !platform?.requestSourceSettingsAttachment) return;
    void ensureSourceSettingsServices(sourceId, platform.requestSourceSettingsAttachment).catch(
      (error) => {
        logger.error("[workspace-config-catalog] 请求远端配置 attachment 失败", error);
      },
    );
  }, [workspace.rpcReady, sourceId, platform]);
  // 原因：普通会话 hook 的 path-only 推断会命中同路径活动远端 tab；Catalog 已明确目录 Host，不能再猜。
  if (explicitLocal)
    return {
      services: localServices,
      remoteSessionId: null,
      isRemoteTarget: false,
      connectionKind: "local-ready" as const,
      rpcReady: true,
    };
  return !workspace.rpcReady &&
    canAttach &&
    sourceServices &&
    binding?.services === sourceServices &&
    binding.workspaceKey === workspaceKey
    ? {
        ...workspace,
        services: sourceServices,
        connectionKind: "remote-ready" as const,
        rpcReady: true,
      }
    : workspace;
}

export function useConfigWorkspaceServices(
  ...args: Parameters<typeof useWorkspaceServicesResolution>
) {
  return useConfigWorkspaceServicesResolution(...args).services;
}

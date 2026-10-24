import type { IServiceAccessor } from "@zcode/services";
import { isRemoteWorkspaceIdentity, type IPlatformService } from "@zcode/shared";
import { logger } from "@/logger.js";
import { buildPluginUiSurfaceKey } from "../contract.js";
import { resolvePluginUiLogicalScope } from "../domain/pluginUiLogicalScope.js";
import { buildPluginUiToolResult } from "../domain/pluginUiToolFeed.js";
import { createPage } from "./pluginUiManagedPage.js";
import { acquirePluginUiPage } from "./pluginUiPageRegistry.js";
import type { UsePluginUiHostInput } from "./pluginUiHostTypes.js";

/** 窗口订阅本地 live 工具结果；页面创建不依赖当前会话组件是否挂载。 */
export function attachPluginUiToolResults(
  services: IServiceAccessor,
  platform: IPlatformService,
  settings: () => Pick<UsePluginUiHostInput, "theme" | "locale">,
): () => void {
  if (!platform.pluginSandbox || !services.pluginUiBridgeService) return () => {};
  let disposed = false;
  const subscription = services.zcodeAgentService.onDynamicPluginUiToolResult()((result) => {
    if (disposed || isRemoteWorkspaceIdentity(result.workspaceIdentity ?? "")) return;
    const presentation = { ...result.ui, serverName: result.serverName };
    const scope = {
      workspacePath: result.workspacePath,
      workspaceIdentity: result.workspaceIdentity,
      sessionId: result.sessionId,
      scope: resolvePluginUiLogicalScope(presentation, {
        kind: "toolCall",
        toolCallId: result.toolCallId,
      }),
    };
    const input: UsePluginUiHostInput = {
      ...settings(),
      presentation,
      scope,
      displayMode: "inline",
      width: 0,
      hostVersion: "zcode",
      toolCallId: result.toolCallId,
      toolInput: result.input,
      toolResult: buildPluginUiToolResult(
        { status: "completed", input: result.input },
        presentation,
      ),
    };
    const key = buildPluginUiSurfaceKey({ ...scope, ...presentation }, scope.scope);
    // 与前台共用准入；后续结果只更新工具数据，不覆盖侧栏当前尺寸、展示模式和交互回调。
    void acquirePluginUiPage(key, () => createPage(key, input, platform, services)).then(
      (page) => {
        if (!disposed) page.updateToolFeed(input);
      },
      (error) =>
        logger.warn("[plugin-ui] background admission failed", {
          sessionId: result.sessionId,
          pluginId: presentation.pluginId,
          error: String(error),
        }),
    );
  });
  return () => {
    disposed = true;
    subscription.dispose();
  };
}

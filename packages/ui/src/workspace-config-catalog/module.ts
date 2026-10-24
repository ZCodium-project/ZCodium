/** 配置目录的只读投影与配置 attachment 解析；不承载会话或项目权威状态。 */
export const workspaceConfigCatalogModule = {
  id: "workspace-config-catalog",
  requires: ["services", "shared", "ui"],
  provides: ["workspace-config-catalog"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;

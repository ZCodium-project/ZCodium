export const sourceServerSettingsModule = {
  id: "source-server-settings",
  requires: ["services", "shared", "ui", "remote-connection-flow", "project-presentation"],
  provides: ["source-server-settings"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;

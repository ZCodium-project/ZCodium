export const projectPresentationModule = {
  id: "project-presentation",
  requires: ["services", "shared", "ui", "conversation-workspace-target"],
  provides: ["project-presentation"],
  publicEntrypoints: ["contract.ts"],
} as const;

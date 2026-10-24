export const remoteConnectionFlowModule = {
  id: "remote-connection-flow",
  requires: ["shared", "ui"],
  provides: ["remote-connection-progress"],
  publicEntrypoints: ["index.ts", "contract.ts", "ui/RemoteConnectionProgress.tsx"],
} as const;

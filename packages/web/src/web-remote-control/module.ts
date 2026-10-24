export const webRemoteControlModule = {
  id: "web-remote-control",
  requires: ["client", "mobile-ui", "shared", "ui", "web", "web-remote-relay"],
  provides: ["web-remote-control"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;

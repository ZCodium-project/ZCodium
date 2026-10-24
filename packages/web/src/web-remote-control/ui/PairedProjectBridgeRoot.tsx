import { AppErrorBoundary, Root, ZCodeIntlProvider } from "@zcode/ui";
import type { ComponentProps } from "react";
import type { ProjectBridgeRootInput } from "../contracts/projectBridge.js";

/** 只挂载已经完成 Host bridge admission 的 Root；授权/配对仍由外层传输 owner 提供。 */
export function PairedProjectBridgeRoot({
  input,
  platform,
  switcher,
}: {
  input: ProjectBridgeRootInput;
  platform: ComponentProps<typeof Root>["platform"];
  switcher: NonNullable<ComponentProps<typeof Root>["webRemoteControlWorkspaceSwitcher"]>;
}) {
  return (
    <AppErrorBoundary key={input.bridge.bridgeSessionId}>
      <ZCodeIntlProvider
        settingService={input.services.settingService}
        broadcastService={input.services.broadcastService}
      >
        <Root
          services={input.services}
          platform={platform}
          initialWorkspaceAbsPath={input.bridge.workspacePath}
          initialWorkspaceIdentity={
            input.bridge.kind === "remote" ? input.bridge.workspaceIdentity : undefined
          }
          initialTaskId={input.bridge.initialTaskId}
          initialTaskDraft={input.initialTaskDraft}
          composerClientNamespace={input.composerClientNamespace}
          initialWebRemoteControlMobileNavigationIntent={input.navigationIntent}
          restoreSession={false}
          allowOpenWorkspace={false}
          allowRemoteWorkspace={false}
          supportsEmbeddedBrowser={false}
          preferDirectoryBrowser
          webRemoteControlWorkspaceSwitcher={switcher}
        />
      </ZCodeIntlProvider>
    </AppErrorBoundary>
  );
}

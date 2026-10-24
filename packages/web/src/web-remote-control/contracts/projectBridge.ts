import type { ComponentProps } from "react";
import type { Root } from "@zcode/ui";
import type {
  WebRemoteControlExternalWorkspaceBridge,
  WebRemoteControlWorkspaceBridgeOpenPayload,
  WebRemoteControlWorkspaceSwitchOptions,
} from "@zcode/shared";

export type MobileProjectDraft = NonNullable<ComponentProps<typeof Root>["initialTaskDraft"]>;
export type ProjectBridgeOpenOptions = WebRemoteControlWorkspaceSwitchOptions & {
  project?: WebRemoteControlWorkspaceBridgeOpenPayload["project"];
  isCurrent?: () => boolean;
};
export interface ProjectBridgeSession {
  bridge: WebRemoteControlExternalWorkspaceBridge;
  services: ComponentProps<typeof Root>["services"];
}
export interface ProjectBridgeRootInput extends ProjectBridgeSession {
  initialTaskDraft?: MobileProjectDraft;
  composerClientNamespace: string;
  navigationIntent?: "chat";
  initialSidebarFileTreeOpen?: boolean;
}
export interface ProjectDraftNavigationPort {
  /** 目标设备的稳定身份，不得传临时 bridge/session ID。 */
  deviceIdentity: string;
  getWorkspaceKey(): string | undefined;
  openWorkspaceBridge(
    workspaceKey: string,
    options?: ProjectBridgeOpenOptions,
  ): Promise<ProjectBridgeSession>;
  renderRoot(input: ProjectBridgeRootInput): void;
}

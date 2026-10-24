import type { ProjectBridgeRootInput } from "./contract.js";
export const projectRootIdentity = (input: ProjectBridgeRootInput) => input.bridge.workspaceKey;

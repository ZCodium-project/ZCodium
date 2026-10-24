// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  V4ConversationProvider,
  V4PaneConversationProvider,
  useV4Conversation,
} from "@/v4/V4ConversationContext.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import type { ConversationTransport } from "@/v4/transport.js";

const h = vi.hoisted(() => {
  const sendCommand = vi.fn(async () => ({
    commandId: "command",
    status: "accepted",
    revisionAtDecision: 0,
  }));
  const transport = { sendCommand };
  const services = { zcodeAgentService: {} };
  return {
    sendCommand,
    transport,
    services,
    lease: { transport, layer: {}, release: vi.fn(), activateRemoteService: vi.fn() },
  };
});
vi.mock("@/hooks/useServices.js", () => ({
  ServiceProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({}) }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useWorkspaceServicesResolution: () => ({
    rpcReady: true,
    services: h.services,
    remoteSessionId: null,
  }),
}));
vi.mock("@/v4/agentConversationTransport.js", () => ({
  createAgentConversationTransport: () => h.transport,
}));
vi.mock("@/v4/sessionDataLayer.js", () => ({
  SessionDataLayer: class {
    dispose() {}
  },
}));
vi.mock("@/v4/workspaceConnectionRegistry.js", () => ({
  acquireWorkspaceConnection: () => h.lease,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ZUP05 Provider 不丢 Host 项目创建 context", () => {
  it.each(["workspace", "pane"])(
    "%s provider 将 envelope 和外层 context 原样交给同一 transport",
    async (kind) => {
      let send!: ConversationTransport["sendCommand"];
      function Probe() {
        send = useV4Conversation().sendCommand;
        return null;
      }
      render(
        kind === "workspace"
          ? createElement(V4ConversationProvider, {
              workspacePath: "/same",
              children: createElement(Probe),
            })
          : createElement(V4PaneConversationProvider, {
              scope: { workspacePath: "/same" },
              children: createElement(Probe),
            }),
      );
      const envelope = createCommandEnvelope({
        type: "createSession",
        sessionId: null,
        payload: { workspaceId: "/same" },
      });
      await send(envelope, { projectId: "p" });
      expect(h.sendCommand).toHaveBeenCalledWith(envelope, { projectId: "p" });
      expect(envelope.payload).not.toHaveProperty("projectId");
    },
  );
});

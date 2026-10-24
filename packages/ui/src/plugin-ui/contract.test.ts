import { describe, expect, it } from "vitest";
import { exampleOpenSideTab, examplePresentation } from "./contract.example.js";
import { openPluginUiSidePane } from "./sidePane/pluginUiSidePaneTab.js";
import { closeSidePaneTab } from "@/lib/workspaceSidePane.js";
import {
  PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX,
  buildPluginUiSidePaneTabId,
  buildPluginUiSurfaceKey,
  documentViewerInstance,
  readPluginUiScopeRef,
  type PluginUiSessionActions,
  type PluginUiSessionCommandPort,
} from "./contract.js";

describe("plugin-ui contract", () => {
  it("侧栏与渲染面同时隔离 workspace/session/plugin", () => {
    const request = {
      workspacePath: "/repo",
      parentSessionId: "s1",
      pluginId: "p",
      toolCallId: "c1",
      resourceUri: "ui://p/widget",
      title: "Widget",
    };
    expect(buildPluginUiSidePaneTabId(request)).toBe(
      "plugin-ui:%2Frepo:s1:p::ui%3A%2F%2Fp%2Fwidget:c1",
    );
    expect(buildPluginUiSidePaneTabId({ ...request, pluginId: "other" })).not.toBe(
      buildPluginUiSidePaneTabId(request),
    );
    const scope = { workspacePath: "/repo", sessionId: "s1", pluginId: "p" };
    const surface = { kind: "surface" as const, surfaceId: "panel" };
    expect(buildPluginUiSurfaceKey(scope, surface)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, pluginId: "other" }, surface),
    );
    expect(buildPluginUiSurfaceKey(scope, surface)).not.toBe(
      buildPluginUiSurfaceKey({ ...scope, workspaceIdentity: "ssh:a" }, surface),
    );
  });

  it("作用域解析：surfaceId 优先，两者都缺为 null", () => {
    expect(readPluginUiScopeRef({ toolCallId: "c1" })).toEqual({
      kind: "toolCall",
      toolCallId: "c1",
    });
    expect(readPluginUiScopeRef({ toolCallId: "c1", surfaceId: "p" })).toEqual({
      kind: "surface",
      surfaceId: "p",
    });
    expect(readPluginUiScopeRef({})).toBeNull();
  });

  it("示例请求生成 session 作用域的 tab", () => {
    const tab = exampleOpenSideTab({
      parentSessionId: "s1",
      toolCallId: "c1",
      pluginId: examplePresentation.pluginId,
      resourceUri: examplePresentation.resourceUri,
      title: "Widget",
      workspacePath: "/repo",
    });
    expect(tab.type).toBe("plugin-ui");
    expect(tab.id).toContain(":s1:");
    expect(tab.id).toContain(encodeURIComponent(examplePresentation.pluginId));
    expect(tab.remoteSessionId).toBeNull();
    const surfaceTab = exampleOpenSideTab({
      parentSessionId: "s1",
      surfaceId: "panel",
      serverName: examplePresentation.serverName,
      pluginId: examplePresentation.pluginId,
      resourceUri: examplePresentation.resourceUri,
      title: "Panel",
      workspacePath: "/repo",
    });
    expect(surfaceTab.id).toContain(":surface:panel");
    expect(surfaceTab.serverName).toBe(examplePresentation.serverName);
  });

  it("默认卡片高度符合宿主约定", () => {
    expect(PLUGIN_UI_CARD_DEFAULT_HEIGHT_PX).toBe(240);
  });

  it("文档手动打开独立身份，恢复时不重复追加作用域，非文档仍共享", () => {
    const request = {
      workspacePath: "/repo",
      parentSessionId: "s1",
      pluginId: "documents@personal",
      serverName: "plugin:documents:documents",
      surfaceId: "documents",
      resourceUri: "ui://documents/panel.html",
      title: "Documents",
    };
    const first = { ...request, ...documentViewerInstance(request.resourceUri) };
    const second = { ...request, ...documentViewerInstance(request.resourceUri) };
    expect(first.instanceId).toBeTruthy();
    expect(first.instanceId).not.toBe(second.instanceId);
    expect(buildPluginUiSidePaneTabId(first)).not.toBe(buildPluginUiSidePaneTabId(second));
    const opened = openPluginUiSidePane(
      openPluginUiSidePane(null, { ...first, workspaceKey: "/repo" }),
      { ...second, workspaceKey: "/repo" },
    );
    expect(opened.tabs).toHaveLength(2);
    const firstTab = opened.tabs.find((tab) => tab.id === buildPluginUiSidePaneTabId(first));
    expect(firstTab?.type).toBe("plugin-ui");
    if (firstTab?.type !== "plugin-ui") throw new Error("document tab missing");
    expect(readPluginUiScopeRef(firstTab)).toEqual(readPluginUiScopeRef(first));
    expect(closeSidePaneTab(opened, firstTab.id)?.tabs.map((tab) => tab.id)).toEqual([
      buildPluginUiSidePaneTabId(second),
    ]);
    expect(readPluginUiScopeRef(first)).toEqual(readPluginUiScopeRef({ ...first }));
    expect(documentViewerInstance("ui://editor/panel.html")).toEqual({});
  });

  it("4a-0 / S3：会话动作只剩 sendFollowUp，命令端口是 sendText + uploadAttachment（widgetState 不再经会话命令）", () => {
    const port: PluginUiSessionCommandPort = {
      sendText: async () => "sent",
      uploadAttachment: async (input) => ({
        ref: "ref",
        fileName: input.fileName,
        mime: input.mime,
        bytes: 0,
      }),
    };
    const actions: PluginUiSessionActions = { sendFollowUp: async () => {} };
    expect(Object.keys(port)).toEqual(["sendText", "uploadAttachment"]);
    expect(Object.keys(actions)).toEqual(["sendFollowUp"]);
  });
});

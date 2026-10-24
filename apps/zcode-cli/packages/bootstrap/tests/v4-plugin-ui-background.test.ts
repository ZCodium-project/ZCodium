import { describe, expect, it, vi } from "vitest";
import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import { ConversationV4Gateway } from "../src/zcode-protocol-v4/index.js";

const ui = { pluginId: "editor@example", resourceUri: "ui://editor", surface: "editor" };
function events(success = true, isError = false, sessionId = "session-1"): SessionEvent[] {
  return [
    [SessionEventType.SessionCreated, { mode: "default", contextWindow: 200_000 }],
    [SessionEventType.TurnStarted, { turnNumber: 1, input: "open", inputId: "cmd" }],
    [
      SessionEventType.ToolCallScheduled,
      {
        toolCallId: "tool",
        toolName: "mcp__editor__open",
        input: { file: "drawing.png" },
        schedule: { parallelGroups: [["tool"]], executionOrder: ["tool"] },
      },
    ],
    [
      SessionEventType.ToolCallResult,
      {
        toolCallId: "tool",
        duration: 1,
        result: {
          success,
          content: "opened",
          display: {
            kind: "mcp_tool",
            serverName: "plugin:editor:editor",
            toolName: "open",
            ui: { ...ui, ...(isError ? { isError: true } : {}) },
          },
        },
      },
    ],
  ].map(
    ([type, payload], index) =>
      ({
        id: `event-${index}` as never,
        sessionId: sessionId as never,
        turnId: "turn-1" as never,
        traceId: "trace" as never,
        type,
        payload,
        timestamp: new Date(1000 + index),
        sequenceNumber: index + 1,
      }) as SessionEvent,
  );
}
function setup(history: SessionEvent[] = []) {
  const emit = vi.fn(),
    frames = vi.fn();
  const gateway = new ConversationV4Gateway({
    sessionExists: () => true,
    executeCommand: async () => undefined,
    emitWireFrame: frames,
    emitPluginUiToolResult: emit,
    loadPersistedEvents: async () => ({ events: history, synthesized: false }),
  });
  return { gateway, emit, frames };
}
describe("后台 UI 工具结果创建入口", () => {
  it("没有 conversation 订阅也投递成功 UI 结果，重复 ingest 不重复投递", () => {
    const { gateway, emit, frames } = setup();
    try {
      const live = events();
      for (const event of live) gateway.ingest("session-1", event);
      gateway.ingest("session-1", live.at(-1)!);
      expect(frames).not.toHaveBeenCalled();
      expect(emit).toHaveBeenCalledExactlyOnceWith({
        sessionId: "session-1",
        toolCallId: "tool",
        serverName: "plugin:editor:editor",
        ui,
        input: { file: "drawing.png" },
      });
    } finally {
      gateway.dispose();
    }
  });
  it("乱序结果等待权威工具行提交，旧 raw 水位的迟到结果不重复投递", () => {
    const { gateway, emit } = setup();
    try {
      const [created, started, scheduled, result] = events();
      gateway.ingest("session-1", created!);
      gateway.ingest("session-1", started!);
      gateway.ingest("session-1", result!);
      expect(emit).not.toHaveBeenCalled();
      gateway.ingest("session-1", scheduled!);
      expect(emit).toHaveBeenCalledExactlyOnceWith({
        sessionId: "session-1",
        toolCallId: "tool",
        serverName: "plugin:editor:editor",
        ui,
        input: { file: "drawing.png" },
      });
      gateway.ingest("session-1", {
        ...result!,
        id: "late-old-result" as never,
        sequenceNumber: 3,
      });
      expect(emit).toHaveBeenCalledTimes(1);
    } finally {
      gateway.dispose();
    }
  });
  it("相同 event/tool ID 在不同会话中独立投递，不混用另一会话的权威行", () => {
    const { gateway, emit } = setup();
    try {
      for (const sessionId of ["session-1", "session-2"]) {
        for (const event of events(true, false, sessionId)) gateway.ingest(sessionId, event);
      }
      expect(emit.mock.calls.map(([result]) => result.sessionId)).toEqual([
        "session-1",
        "session-2",
      ]);
    } finally {
      gateway.dispose();
    }
  });
  it("没有 UI display 的成功工具不投递", () => {
    const { gateway, emit } = setup();
    try {
      const live = events();
      const result = live.at(-1)!;
      result.payload = {
        toolCallId: "tool",
        duration: 1,
        result: { success: true, content: "ordinary tool output" },
      };
      for (const event of live) gateway.ingest("session-1", event);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      gateway.dispose();
    }
  });
  it("非对象输入不进入通知 payload", () => {
    const { gateway, emit } = setup();
    try {
      const live = events();
      const scheduled = live[2]!;
      scheduled.payload = {
        ...(scheduled.payload as object),
        input: ["not-a-record"],
      } as SessionEvent["payload"];
      for (const event of live) gateway.ingest("session-1", event);
      expect(emit).toHaveBeenCalledExactlyOnceWith({
        sessionId: "session-1",
        toolCallId: "tool",
        serverName: "plugin:editor:editor",
        ui,
      });
    } finally {
      gateway.dispose();
    }
  });
  it.each(["desktop-continuous", "web-remote-replayable"] as const)(
    "%s 使用同一 live 通知入口，重订阅不重放创建副作用",
    async (clientMode) => {
      const { gateway, emit } = setup();
      try {
        const params = { connectionId: "live", clientMode, topic: "conversation/session-1" };
        await gateway.subscribe(params);
        for (const event of events()) gateway.ingest("session-1", event);
        expect(emit).toHaveBeenCalledTimes(1);
        await gateway.subscribe({ ...params, connectionId: "reconnected" });
        expect(emit).toHaveBeenCalledTimes(1);
      } finally {
        gateway.dispose();
      }
    },
  );
  it.each([
    [false, false],
    [true, true],
  ])("失败结果不创建 success=%s isError=%s", (success, isError) => {
    const { gateway, emit } = setup();
    try {
      for (const event of events(success, isError)) gateway.ingest("session-1", event);
      expect(emit).not.toHaveBeenCalled();
    } finally {
      gateway.dispose();
    }
  });
  it("订阅历史不会重新触发创建副作用", async () => {
    const { gateway, emit } = setup(events());
    try {
      await gateway.subscribe({
        connectionId: "history",
        clientMode: "desktop-continuous",
        topic: "conversation/session-1",
      });
      expect(emit).not.toHaveBeenCalled();
    } finally {
      gateway.dispose();
    }
  });
});

import { describe, expect, it } from "vitest";
import { commandAckSchema, parseCommandEnvelope } from "../src/zcode-protocol-v4/index.js";

describe("setAssistantFeedback command schema", () => {
  it("复用 row target CAS，feedback null 表示清除", () => {
    const parsed = parseCommandEnvelope({
      commandId: "command-1",
      clientId: "desktop-1",
      sessionId: "session-1",
      baseRevision: 3,
      baseLogEpoch: "epoch-1",
      type: "setAssistantFeedback",
      payload: {
        target: { rowId: 7, entityId: "assistant-message-1" },
        feedback: null,
      },
      issuedAt: 1_700_000_000_000,
    });
    expect(parsed.ok).toBe(true);
  });

  it("缺少 revision/logEpoch 或伪造 target 字段时拒绝", () => {
    const envelope = {
      commandId: "command-1",
      clientId: "desktop-1",
      sessionId: "session-1",
      type: "setAssistantFeedback" as const,
      payload: {
        target: { rowId: 7, entityId: "assistant-message-1" },
        feedback: "like",
      },
      issuedAt: 1_700_000_000_000,
    };
    expect(parseCommandEnvelope(envelope).ok).toBe(false);
    expect(
      parseCommandEnvelope({
        ...envelope,
        baseRevision: 3,
        baseLogEpoch: "epoch-1",
        payload: {
          ...envelope.payload,
          target: { ...envelope.payload.target, messageId: "x" },
        },
      }).ok,
    ).toBe(false);
  });
});

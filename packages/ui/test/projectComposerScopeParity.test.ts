import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindPendingTaskDraft,
  clearV4ComposerDraft,
  completePendingTaskDraft,
  ensurePendingTaskDraft,
  persistV4ComposerDraft,
  readPendingTaskDraft,
  readV4ComposerDraft,
  resolveComposerScope,
  V4_DRAFT_SCOPE_ROOT,
} from "@/v4/composer/composerDraftStore.js";
import {
  acceptComposerRecentReceipt,
  prepareComposerRecentReceipt,
  readComposerRecent,
} from "@/lib/composerRecent.js";
import { ReplaceableConversationTransport } from "@/v4/replaceableConversationTransport.js";
import type { ConversationTransport } from "@/v4/transport.js";
import { createCommandEnvelope } from "@/v4/commandFactory.js";
import { PendingCommandRegistry } from "@/v4/pendingCommandRegistry.js";
import { createAgentConversationTransport } from "@/v4/agentConversationTransport.js";

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  },
};
const p = resolveComposerScope("p");
const q = resolveComposerScope("q");
const selection = {
  modelSelection: { providerId: "provider", modelId: "model", options: { reasoningLevel: "high" } },
  mode: "edit" as const,
};

describe("项目 Composer 上游合同", () => {
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("同 cwd 两项目的文字、Recent 独立，项目换 cwd 不丢正文", () => {
    persistV4ComposerDraft(
      "/same",
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "P", projectId: "p", ...selection },
      p,
    );
    persistV4ComposerDraft(
      "/same",
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "Q", projectId: "q", ...selection },
      q,
    );
    expect(readV4ComposerDraft("/new-primary", undefined, V4_DRAFT_SCOPE_ROOT, p)?.text).toBe("P");
    expect(readV4ComposerDraft("/same", undefined, V4_DRAFT_SCOPE_ROOT, q)?.text).toBe("Q");
    const receipt = prepareComposerRecentReceipt(p, selection);
    acceptComposerRecentReceipt(receipt, storage);
    expect(readComposerRecent("/same", undefined, storage, p)?.mode).toBe("edit");
    expect(readComposerRecent("/same", undefined, storage, q)).toBeNull();
  });

  it("相同项目/路径在不同主机及客户端下不共享草稿", () => {
    const first = resolveComposerScope("p", "remote-a", "mobile");
    persistV4ComposerDraft(
      "/same",
      "remote-a",
      V4_DRAFT_SCOPE_ROOT,
      { text: "remote mobile" },
      first,
    );
    for (const scope of [
      resolveComposerScope("p", "remote-b", "mobile"),
      resolveComposerScope("p", "remote-a", "desktop"),
      p,
    ]) {
      expect(readV4ComposerDraft("/same", "remote-a", V4_DRAFT_SCOPE_ROOT, scope)).toBeNull();
    }
  });

  it("旧草稿只有显式 projectId 匹配才认领；删空及改主目录不复活旧正文", () => {
    persistV4ComposerDraft("/old", undefined, V4_DRAFT_SCOPE_ROOT, {
      text: "legacy",
      projectId: "p",
    });
    expect(readV4ComposerDraft("/old", undefined, V4_DRAFT_SCOPE_ROOT, q)).toBeNull();
    expect(readV4ComposerDraft("/old", undefined, V4_DRAFT_SCOPE_ROOT, p)?.text).toBe("legacy");
    clearV4ComposerDraft("/old", undefined, V4_DRAFT_SCOPE_ROOT, p);
    expect(readV4ComposerDraft("/new", undefined, V4_DRAFT_SCOPE_ROOT, p)).toBeNull();
    expect(readV4ComposerDraft("/old", undefined, V4_DRAFT_SCOPE_ROOT)?.text).toBe("legacy");
    expect(readV4ComposerDraft("/old", undefined, V4_DRAFT_SCOPE_ROOT, p)).toBeNull();
  });

  it("迟到 ACK 只提交冻结 scope，旧回执不回滚更新的 Recent", () => {
    const first = prepareComposerRecentReceipt(p, selection);
    const newer = prepareComposerRecentReceipt(p, { ...selection, mode: "yolo" });
    acceptComposerRecentReceipt(newer, storage);
    acceptComposerRecentReceipt(first, storage);
    expect(readComposerRecent("/same", undefined, storage, p)?.mode).toBe("yolo");
    expect(readComposerRecent("/same", undefined, storage, q)).toBeNull();
  });

  it("旧 draftId 接纳不能消费下一代目录引用", () => {
    const tasks = resolveComposerScope(null);
    const first = ensurePendingTaskDraft(tasks);
    bindPendingTaskDraft(tasks, first.draftId, "/first");
    completePendingTaskDraft(tasks, first.draftId);
    const next = ensurePendingTaskDraft(tasks);
    completePendingTaskDraft(tasks, first.draftId);
    expect(readPendingTaskDraft(tasks)?.draftId).toBe(next.draftId);
  });

  it("代理换代仍把 projectId 留在 Host 外层而非 CLI envelope", async () => {
    const sendCommand = vi.fn(async () => ({ status: "accepted" }));
    const transport = new ReplaceableConversationTransport({
      sendCommand,
    } as unknown as ConversationTransport);
    const envelope = createCommandEnvelope({
      type: "createSession",
      sessionId: null,
      payload: { workspaceId: "/same" },
    });
    await transport.sendCommand(envelope, { projectId: "p" });
    expect(sendCommand).toHaveBeenCalledWith(envelope, { projectId: "p" });
    expect(envelope).not.toHaveProperty("projectId");
    expect(envelope.payload).not.toHaveProperty("projectId");
  });

  it("Host adapter 只在服务外层发送项目归属，连续/回放链路不改变协议", async () => {
    const agent = {
      helloConversationV4: vi.fn(async () => ({
        kind: "hello",
        protocolVersion: 3,
        connectionId: "host",
        clientMode: "desktop-continuous",
        deliveryProfile: "continuous",
        serverTime: 1,
        capabilities: {
          nativeDialogs: true,
          localTerminal: true,
          binaryFrames: false,
          compression: "none",
        },
        auth: {},
      })),
      initializeConversationV4: vi.fn(async () => {}),
      sendConversationCommandV4: vi.fn(async (params) => ({
        commandId: params.envelope.commandId,
        status: "accepted",
        revisionAtDecision: 0,
      })),
    };
    const transport = createAgentConversationTransport(agent as never, {
      workspacePath: "/same",
      workspaceIdentity: "remote-host",
    });
    const envelope = createCommandEnvelope({
      type: "createSession",
      sessionId: null,
      payload: { workspaceId: "remote-host" },
    });
    await transport.sendCommand(envelope, { projectId: "p" });
    expect(agent.sendConversationCommandV4).toHaveBeenCalledWith({
      workspacePath: "/same",
      workspaceIdentity: "remote-host",
      projectId: "p",
      envelope,
    });
    expect(envelope.payload).not.toHaveProperty("projectId");
  });

  it("pending 接纳完成原 scope 交接；不会清除同 cwd 另一个项目", () => {
    persistV4ComposerDraft("/same", undefined, V4_DRAFT_SCOPE_ROOT, { text: "Q", ...selection }, q);
    const registry = new PendingCommandRegistry({ storage });
    const envelope = createCommandEnvelope({
      type: "sendText",
      sessionId: "session-p",
      payload: { text: "P", ...selection },
    });
    registry.record(envelope, {
      workspace: { workspacePath: "/same" },
      projectId: "p",
      composer: prepareComposerRecentReceipt(p, selection),
    });
    registry.applyAck(envelope, {
      commandId: envelope.commandId,
      status: "accepted",
      revisionAtDecision: 0,
    });
    expect(readComposerRecent("/same", undefined, storage, p)?.mode).toBe("edit");
    expect(readV4ComposerDraft("/same", undefined, V4_DRAFT_SCOPE_ROOT, q)?.text).toBe("Q");
  });

  it("首发 unknown 和 TTL 不释放目录；duplicate 才交接等待期间的新正文", () => {
    const scope = resolveComposerScope(null);
    const pending = ensurePendingTaskDraft(scope);
    bindPendingTaskDraft(scope, pending.draftId, "/tasks");
    let now = 0;
    const registry = new PendingCommandRegistry({ storage, now: () => now });
    const envelope = createCommandEnvelope({
      type: "sendText",
      sessionId: "task-session",
      payload: { text: "protocol text", ...selection },
    });
    registry.record(envelope, {
      workspace: { workspacePath: "/tasks" },
      composer: {
        ...prepareComposerRecentReceipt(scope, selection),
        draftId: pending.draftId,
        submittedText: "sent",
      },
    });
    persistV4ComposerDraft(
      "/tasks",
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "next message", ...selection },
      scope,
    );
    now = 48 * 60 * 60 * 1000;
    registry.applyQuery({
      results: [
        {
          key: { commandId: envelope.commandId, sessionId: envelope.sessionId },
          result: "unknown",
        },
      ],
    });
    expect(registry.findCommand(envelope.commandId)).toBeDefined();
    expect(readPendingTaskDraft(scope)?.draftId).toBe(pending.draftId);
    registry.applyAck(envelope, {
      commandId: envelope.commandId,
      status: "duplicate",
      revisionAtDecision: 0,
    });
    expect(readPendingTaskDraft(scope)).toBeNull();
    expect(readV4ComposerDraft("/tasks", undefined, "task-session")?.text).toBe("next message");
    expect(readV4ComposerDraft("/tasks", undefined, V4_DRAFT_SCOPE_ROOT, scope)).toBeNull();
  });

  it("持久化旧 ACK 不能消费新 draftId，原始已发送正文不复活", () => {
    const scope = resolveComposerScope(null);
    const pending = ensurePendingTaskDraft(scope);
    bindPendingTaskDraft(scope, pending.draftId, "/tasks");
    const registry = new PendingCommandRegistry({ storage });
    const envelope = createCommandEnvelope({
      type: "sendText",
      sessionId: "task-session",
      payload: { text: "sent plus context", ...selection },
    });
    registry.record(envelope, {
      workspace: { workspacePath: "/tasks" },
      composer: {
        ...prepareComposerRecentReceipt(scope, selection),
        draftId: pending.draftId,
        submittedText: "sent",
      },
    });
    persistV4ComposerDraft(
      "/tasks",
      undefined,
      V4_DRAFT_SCOPE_ROOT,
      { text: "sent", ...selection },
      scope,
    );
    registry.applyAck(envelope, {
      commandId: envelope.commandId,
      status: "accepted",
      revisionAtDecision: 0,
    });
    expect(readV4ComposerDraft("/tasks", undefined, "task-session")).toBeNull();
    const next = ensurePendingTaskDraft(scope);
    registry.applyAck(envelope, {
      commandId: envelope.commandId,
      status: "duplicate",
      revisionAtDecision: 0,
    });
    expect(readPendingTaskDraft(scope)?.draftId).toBe(next.draftId);
  });
});

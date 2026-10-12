// AstrBot 桥接 selection 下发契约。见 .agents/specs/bots-astrbot-bridge.md「selection 下发契约」。
//
// 回归背景：astrbotProvider 曾只把 BotOutboundMessage.text 包成 {type:"text"} 下发，message.selection
// 被丢弃；而 BotsService 对非 weixin provider 只把 selection.title 写进 text，导致 AstrBot 用户
// 看不到权限/提问/菜单的选项，交互无法完成。这里同时钉住 payload 形状与 canonical 文本内容。

import assert from "node:assert/strict";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const { createAstrBotBotProvider } = await tsImport(
  "../src/bots/providers/astrbotProvider.ts",
  import.meta.url,
);
const { buildAstrBotSelectionDeliveryPayload } = await tsImport(
  "../src/bots/astrbotSelectionPayload.ts",
  import.meta.url,
);

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
};

function createProvider() {
  let seq = 0;
  return createAstrBotBotProvider({
    logger: silentLogger,
    clock: () => 1_700_000_000_000,
    idFactory: () => `id-${++seq}`,
  });
}

function beginPromptTurn(provider, options = {}) {
  const frame = {
    v: 2,
    kind: "command",
    id: "cmd-1",
    commandId: "cmd-1",
    actor: {
      channel: "astrbot",
      externalUserId: options.externalUserId ?? "lark:u1",
      chatType: options.chatType ?? "private",
      ...(options.chatId ? { chatId: options.chatId } : {}),
    },
    command: { type: "prompt", text: "帮我看一下" },
  };
  return provider.beginTurn(frame, "bot-1");
}

const permissionSelection = {
  id: "permission-req-1",
  title: "是否允许执行命令？",
  action: "permission.respond",
  showCancel: false,
  options: [
    { id: "/approve req-1 allow", label: "允许", description: "本次允许" },
    { id: "/approve req-1 always", label: "始终允许" },
    { id: "/deny req-1", label: "拒绝" },
  ],
};

const elicitationSelection = {
  id: "elicitation-req-1-0",
  title: "1/2 请选择部署环境",
  action: "elicitation.respond",
  token: "abcdef123456",
  options: [
    { id: "staging", label: "预发" },
    { id: "prod", label: "生产" },
  ],
};

const workspaceSelection = {
  id: "workspace-menu",
  title: "选择 workspace",
  action: "workspace.set",
  options: [
    { id: "ws-1", label: "repo-a" },
    { id: "ws-2", label: "repo-b" },
  ],
};

test("permission selection 下发 selection payload，含序号选项、对应命令与 requestId", () => {
  const payload = buildAstrBotSelectionDeliveryPayload(permissionSelection, "zh-CN");

  assert.equal(payload.type, "selection");
  assert.equal(payload.selectionId, "permission-req-1");
  assert.equal(payload.title, "是否允许执行命令？");
  assert.equal(payload.action, "permission.respond");
  assert.equal(payload.requestId, "req-1");
  assert.equal(payload.meta.kind, "permission");
  assert.deepEqual(
    payload.options.map((option) => option.id),
    ["/approve req-1 allow", "/approve req-1 always", "/deny req-1"],
  );

  // canonical 文本必须让人知道回什么：序号 + 标签 + 命令。
  assert.match(payload.text, /是否允许执行命令？/u);
  assert.match(payload.text, /1\. 允许 — 本次允许 → \/approve req-1 allow/u);
  assert.match(payload.text, /2\. 始终允许 → \/approve req-1 always/u);
  assert.match(payload.text, /3\. 拒绝 → \/deny req-1/u);
  // showCancel=false 时不展示取消项。
  assert.doesNotMatch(payload.text, /^0\./mu);
});

test("elicitation selection 带 token，canonical 文本给出 /elicitation <token> <序号>", () => {
  const payload = buildAstrBotSelectionDeliveryPayload(elicitationSelection, "zh-CN");

  assert.equal(payload.type, "selection");
  assert.equal(payload.token, "abcdef123456");
  assert.equal(payload.meta.kind, "elicitation");
  assert.equal(payload.requestId, undefined);
  assert.match(payload.text, /1\/2 请选择部署环境/u);
  assert.match(payload.text, /1\. 预发/u);
  assert.match(payload.text, /2\. 生产/u);
  // 非微信通道强校验 token，canonical 文本必须把命令形式写全。
  assert.match(payload.text, /\/elicitation abcdef123456 <序号>/u);
});

test("菜单类 selection 也下发选项与对应命令前缀", () => {
  const payload = buildAstrBotSelectionDeliveryPayload(workspaceSelection, "zh-CN");

  assert.equal(payload.meta.kind, "menu");
  assert.match(payload.text, /1\. repo-a/u);
  assert.match(payload.text, /2\. repo-b/u);
  assert.match(payload.text, /\/workspace <序号>/u);
  assert.match(payload.text, /^0\. 取消$/mu);
});

test("英文 locale 只本地化提示行，选项 label 原样透传", () => {
  // label/description 是 BotsService 的业务内容（真实流程由 formatBotPermissionOptionLabel 本地化），
  // 传输层渲染器不得改写，只负责本地化自己产生的提示行。
  const payload = buildAstrBotSelectionDeliveryPayload(permissionSelection, "en-US");
  assert.match(payload.text, /^1\. 允许 — 本次允许 → \/approve req-1 allow$/mu);
  assert.match(payload.text, /Reply with \/permission <number>, or send the command above\./u);
  // showCancel=false 时不出现取消项，也不得出现 "0 to cancel" 这类文案。
  assert.doesNotMatch(payload.text, /0 to cancel/u);

  const menuPayload = buildAstrBotSelectionDeliveryPayload(workspaceSelection, "en-US");
  assert.match(menuPayload.text, /Reply with \/workspace <number> to choose\./u);
  assert.match(menuPayload.text, /^0\. Cancel$/mu);
  // 每个 action 只给一行提示，不得再叠加 "回复 0 取消" 之类的重复解释。
  assert.doesNotMatch(menuPayload.text, /Reply with 0 to cancel\./u);

  const elicitationPayload = buildAstrBotSelectionDeliveryPayload(elicitationSelection, "en-US");
  assert.match(
    elicitationPayload.text,
    // 修复依据：裸 submit 会被 elicitation.submit 分支拒绝，必须带 token。
    /Reply with \/elicitation abcdef123456 <number>; send \/elicitation abcdef123456 submit when a multi-select is done\./u,
  );
});

test("provider.send 带 selection 时只发一条 selection delivery，不重复发标题文本", async () => {
  const provider = createProvider();
  const frames = [];
  provider.attachTransport({ send: (frame) => frames.push(frame) });

  const bindingId = beginPromptTurn(provider);
  await provider.send(
    {},
    {
      botId: "bot-1",
      provider: "astrbot",
      providerUserId: "lark:u1",
      // BotsService 对非 weixin provider 只把 title 写进 text。
      text: permissionSelection.title,
      selection: permissionSelection,
    },
  );
  provider.settleTurn(bindingId);

  const deliveries = frames.filter((frame) => frame.kind === "delivery");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].payload.type, "selection");
  assert.equal(deliveries[0].payload.requestId, "req-1");
  assert.equal(deliveries[0].seq, 1);

  // 无 selection 的出站保持原有 text 行为。
  await provider.send(
    {},
    {
      botId: "bot-1",
      provider: "astrbot",
      providerUserId: "lark:u1",
      text: "普通回复",
    },
  );
  const textDeliveries = frames.filter(
    (frame) => frame.kind === "delivery" && frame.payload.type === "text",
  );
  assert.equal(textDeliveries.length, 1);
  assert.equal(textDeliveries[0].payload.text, "普通回复");
  assert.equal(textDeliveries[0].seq, 2);

  provider.dispose();
});

test("selection delivery 与 text delivery 共用 seq/回放窗口", async () => {
  const provider = createProvider();
  const frames = [];
  provider.attachTransport({ send: (frame) => frames.push(frame) });

  const bindingId = beginPromptTurn(provider);
  await provider.send(
    {},
    {
      botId: "bot-1",
      provider: "astrbot",
      providerUserId: "lark:u1",
      text: permissionSelection.title,
      selection: permissionSelection,
    },
  );
  await provider.send(
    {},
    { botId: "bot-1", provider: "astrbot", providerUserId: "lark:u1", text: "已允许" },
  );
  provider.settleTurn(bindingId);

  const replay = provider.resolveResume([{ bindingId, seq: 1 }]);
  const replayed = replay.get(bindingId);
  assert.equal(replayed.needsSnapshot, false);
  assert.equal(replayed.frames.length, 1);
  assert.equal(replayed.frames[0].payload.type, "text");

  // 超窗时补投窗口内全部帧；snapshot 保留最近一条（此处最后一条是 text）。
  const stale = provider.resolveResume([{ bindingId, seq: 0 }]);
  assert.equal(stale.get(bindingId).frames.length, 2);
  const snapshot = await provider.buildSnapshot(bindingId);
  assert.equal(snapshot.payload.type, "text");
  assert.equal(snapshot.payload.text, "已允许");

  provider.dispose();
});

test("群聊按 chatId 路由，selection 也能到达同一绑定", async () => {
  const provider = createProvider();
  const frames = [];
  provider.attachTransport({ send: (frame) => frames.push(frame) });

  const bindingId = beginPromptTurn(provider, { chatType: "group", chatId: "lark:group-1" });
  await provider.send(
    {},
    {
      botId: "bot-1",
      provider: "astrbot",
      // BotsService 的 createOutbound 用 chatId 作为 providerUserId。
      providerUserId: "lark:group-1",
      text: permissionSelection.title,
      selection: permissionSelection,
    },
  );

  const deliveries = frames.filter((frame) => frame.kind === "delivery");
  assert.equal(deliveries.length, 1);
  assert.equal(deliveries[0].bindingId, bindingId);
  assert.equal(deliveries[0].payload.type, "selection");

  provider.dispose();
});

// ── 任务流归属回归 ─────────────────────────────────────────────
// 修复依据：notifyTaskLifecycle("awaiting_input") 原会 delete 任务流，用户应答权限/提问后
// 任务恢复的出站在 currentTurns / taskStreams 里都查不到 stream，于是每帧 idFactory()
// 新建无主 stream，插件按 stream 收口时恢复后的正文变成孤立帧。现在 awaiting_input 只标记
// 暂停，BotsService 在应答成功后重新通知 started，provider 把当前轮次提升为任务流。

function taskActor() {
  return {
    provider: "astrbot",
    botId: "bot-1",
    providerUserId: "lark:u1",
    chatType: "private",
  };
}

function commandFrame(id, text) {
  return {
    v: 2,
    kind: "command",
    id,
    commandId: id,
    actor: { channel: "astrbot", externalUserId: "lark:u1", chatType: "private" },
    command: { type: "prompt", text },
  };
}

/** 协议不变量：① delivery 的 stream 必须被某个 accepted 预告；② 终态 status 与最后一条 delivery 同 stream。 */
function assertStreamInvariants(frames) {
  const announced = new Set(
    frames.filter((frame) => frame.kind === "accepted").map((frame) => frame.streamId),
  );
  const deliveries = frames.filter((frame) => frame.kind === "delivery");
  for (const delivery of deliveries) {
    assert.ok(
      announced.has(delivery.streamId),
      `delivery 落在未预告的 stream 上：${delivery.streamId}`,
    );
  }
  const terminal = frames.filter((frame) => frame.kind === "status").at(-1);
  const lastDelivery = deliveries.at(-1);
  assert.ok(terminal, "缺少终态 status");
  assert.equal(terminal.streamId, lastDelivery.streamId, "终态与正文的 stream 不一致");
}

function createTurnHarness() {
  let seq = 0;
  const provider = createAstrBotBotProvider({
    logger: silentLogger,
    clock: () => 1_700_000_000_000,
    idFactory: () => `id-${++seq}`,
  });
  const frames = [];
  provider.attachTransport({ send: (frame) => frames.push(frame) });
  const actor = taskActor();
  const send = (text, selection) =>
    provider.send(
      {},
      {
        botId: "bot-1",
        provider: "astrbot",
        providerUserId: "lark:u1",
        text,
        ...(selection ? { selection } : {}),
      },
    );
  return {
    provider,
    frames,
    actor,
    send,
    begin: (id, text) => provider.beginTurn(commandFrame(id, text), "bot-1"),
    lifecycle: (phase) => provider.notifyTaskLifecycle({}, actor, phase),
    settle: (bindingId) => provider.settleTurn(bindingId),
  };
}

test("权限应答后任务恢复：无无主 stream，终态与恢复后的正文同 stream", async () => {
  const h = createTurnHarness();
  const bindingId = h.begin("cmd-prompt", "帮我看一下");
  h.lifecycle("started");
  await h.send("正在处理…");
  await h.send("是否允许执行命令？", permissionSelection);
  h.lifecycle("awaiting_input");
  // 用户应答权限：BotsService 处理成功后重新通知 started，任务在该轮次 stream 上继续。
  h.begin("cmd-perm", "/permission 1");
  h.lifecycle("started");
  h.settle(bindingId);
  await h.send("已允许，继续执行…");
  await h.send("执行完成。");
  h.lifecycle("completed");

  assertStreamInvariants(h.frames);
  // 恢复后的正文与终态必须落在应答轮次的 stream 上，而不是各自新建。
  const resumed = h.frames.filter((frame) => frame.kind === "delivery" && frame.seq >= 3);
  assert.ok(resumed.length >= 2);
  assert.equal(new Set(resumed.map((frame) => frame.streamId)).size, 1);
  h.provider.dispose();
});

test("任务等待期间收到独立命令：该轮次仍被收口，不会被挂住", async () => {
  const h = createTurnHarness();
  const bindingId = h.begin("cmd-prompt", "帮我看一下");
  h.lifecycle("started");
  await h.send("正在处理…", permissionSelection);
  h.lifecycle("awaiting_input");

  // BotsService 对「运行中任务 + 普通消息」回 taskRunning，是独立出站。
  const statusBinding = h.begin("cmd-status", "/status");
  await h.send("任务正在进行中。");
  h.settle(statusBinding);

  const statusStream = h.frames.find(
    (frame) => frame.kind === "accepted" && frame.inReplyTo === "cmd-status",
  ).streamId;
  assert.ok(
    h.frames.some((frame) => frame.kind === "status" && frame.streamId === statusStream),
    "独立命令轮次没有被收口，插件侧的流永远不会结束",
  );

  // 之后再应答权限，任务恢复仍走自己的 stream。
  h.begin("cmd-perm", "/permission 1");
  h.lifecycle("started");
  h.settle(bindingId);
  await h.send("已允许，继续执行…");
  h.lifecycle("completed");
  assertStreamInvariants(h.frames);
  h.provider.dispose();
});

test("非任务命令保持「立即收口」的原有语义", async () => {
  const h = createTurnHarness();
  const bindingId = h.begin("cmd-help", "/help");
  await h.send("命令列表…");
  h.settle(bindingId);

  const last = h.frames.at(-1);
  assert.equal(last.kind, "status");
  assert.equal(last.state, "completed");
  h.provider.dispose();
});

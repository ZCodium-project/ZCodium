/* oxlint-disable eslint(max-lines) -- 桥接协议契约单文件导出，便于 ZCodium 与 AstrBot 插件共用同一份 schema。 */
// Bots ↔ AstrBot 桥接协议 v2（见 .agents/specs/bots-astrbot-bridge.md）。
//
// 对齐官方 ZCode 的 bot 实现：
// - ZCodium 集中解析用户输入（平台适配器只提供文本 / 把按钮翻译成同一条文本命令）。
// - 交互用官方同款 `selection` 抽象：canonical 文本 + 结构化 options/action/token。
// - 纯文本平台直接打印 canonical 文本；结构化命令保留给程序化客户端。
// 本文件只描述 wire 契约，不做 IO。

import { z } from "zod";

export const BOTS_BRIDGE_PROTOCOL_VERSION = 2 as const;
export const BOTS_BRIDGE_PATH = "/bots/bridge/v2" as const;

const nonEmpty = z.string().trim().min(1);
const timestampMs = z.number().int().nonnegative();

/** ZCodium 侧固定为 `astrbot`；插件用 id 前缀自行隔离真实平台，只做透传。 */
export const botsBridgeChannelSchema = z.string().trim().min(1);
export type BotsBridgeChannel = z.infer<typeof botsBridgeChannelSchema>;

/** 平台消息来源；`externalUserId` 必须稳定。 */
export const botsBridgeActorSchema = z
  .object({
    channel: botsBridgeChannelSchema,
    externalUserId: nonEmpty,
    chatType: z.enum(["private", "group"]),
    chatId: nonEmpty.optional(),
    displayName: z.string().optional(),
  })
  .strict();
export type BotsBridgeActor = z.infer<typeof botsBridgeActorSchema>;

// ── delivery payload ──────────────────────────────────────────

export const botsBridgeChangeFileSchema = z
  .object({
    path: z.string(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
  })
  .strict();

export const botsBridgeSelectionOptionSchema = z
  .object({
    id: nonEmpty,
    label: nonEmpty,
    description: z.string().optional(),
  })
  .strict();
export type BotsBridgeSelectionOption = z.infer<typeof botsBridgeSelectionOptionSchema>;

export const botsBridgeSelectionKindSchema = z.enum(["permission", "elicitation", "menu"]);

export const botsBridgeSelectionMetaSchema = z
  .object({
    kind: botsBridgeSelectionKindSchema,
    currentQuestionIndex: z.number().int().nonnegative().optional(),
    total: z.number().int().nonnegative().optional(),
    multiSelect: z.boolean().optional(),
    status: z.enum(["pending", "completed", "cancelled"]).optional(),
    planApproval: z.string().optional(),
  })
  .strict();

/**
 * 交互载荷：官方 `selection` 抽象。
 * `text` 是 canonical 渲染（选项 + 该选项要发送的命令），纯文本平台直接打印。
 * `options[].id` 是**运行时口径**的选中值（permission 为 optionId，elicitation 为 option.value）；
 * canonical 文本里展示的是 1-based 序号，解析时两者都认。
 */
export const botsBridgeSelectionPayloadSchema = z
  .object({
    type: z.literal("selection"),
    selectionId: nonEmpty,
    title: z.string(),
    text: z.string(),
    options: z.array(botsBridgeSelectionOptionSchema),
    action: nonEmpty,
    requestId: nonEmpty.optional(),
    token: nonEmpty.optional(),
    cancelLabel: z.string().optional(),
    showCancel: z.boolean().optional(),
    meta: botsBridgeSelectionMetaSchema.optional(),
  })
  .strict();
export type BotsBridgeSelectionPayload = z.infer<typeof botsBridgeSelectionPayloadSchema>;

export const botsBridgeDeliveryPayloadSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text"),
      text: z.string(),
      // 流式卡片更新同一条消息时置 true。
      replace: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool"),
      toolId: nonEmpty,
      title: z.string(),
      status: z.enum(["pending", "in_progress", "completed", "failed", "denied"]),
      summary: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("changes"),
      fileCount: z.number().int().nonnegative(),
      files: z.array(botsBridgeChangeFileSchema),
    })
    .strict(),
  z
    .object({
      type: z.literal("notice"),
      level: z.enum(["info", "warn", "error"]),
      message: z.string(),
    })
    .strict(),
  botsBridgeSelectionPayloadSchema,
]);
export type BotsBridgeDeliveryPayload = z.infer<typeof botsBridgeDeliveryPayloadSchema>;

// ── command ───────────────────────────────────────────────────

export const botsBridgeCommandSchema = z.discriminatedUnion("type", [
  // 用户文本原样透传，由 ZCodium 集中解析（/new、/permission、自由输入等）。
  z.object({ type: z.literal("prompt"), text: z.string() }).strict(),
  z.object({ type: z.literal("bind"), code: nonEmpty }).strict(),
  z.object({ type: z.literal("unbind") }).strict(),
  z.object({ type: z.literal("new") }).strict(),
  z.object({ type: z.literal("stop") }).strict(),
  z.object({ type: z.literal("cancel") }).strict(),
  z.object({ type: z.literal("status") }).strict(),
  z.object({ type: z.literal("help") }).strict(),
  z.object({ type: z.literal("workspace.set"), value: nonEmpty }).strict(),
  // 结构化交互应答（官方 webhook 旁路同款）；插件默认走文本命令。
  z
    .object({
      type: z.literal("permission.respond"),
      requestId: nonEmpty,
      optionId: nonEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal("elicitation.respond"),
      requestId: nonEmpty,
      token: nonEmpty.optional(),
      action: z.enum(["accept", "decline", "cancel"]),
      content: z.record(z.string(), z.unknown()).optional(),
    })
    .strict(),
]);
export type BotsBridgeCommand = z.infer<typeof botsBridgeCommandSchema>;

// ── 帧 ────────────────────────────────────────────────────────

const frameBase = { v: z.literal(BOTS_BRIDGE_PROTOCOL_VERSION), id: nonEmpty };

export const botsBridgeResumeCursorSchema = z
  .object({ bindingId: nonEmpty, seq: z.number().int().nonnegative() })
  .strict();
export type BotsBridgeResumeCursor = z.infer<typeof botsBridgeResumeCursorSchema>;

export const botsBridgeHelloFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("hello"),
    clientId: nonEmpty,
    clientVersion: z.string().optional(),
    channels: z.array(botsBridgeChannelSchema),
    resume: z.array(botsBridgeResumeCursorSchema).optional(),
  })
  .strict();
export type BotsBridgeHelloFrame = z.infer<typeof botsBridgeHelloFrameSchema>;

export const botsBridgeWelcomeFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("welcome"),
    inReplyTo: nonEmpty,
    serverVersion: z.string().optional(),
    enabled: z.boolean(),
    workspaceCount: z.number().int().nonnegative(),
  })
  .strict();
export type BotsBridgeWelcomeFrame = z.infer<typeof botsBridgeWelcomeFrameSchema>;

export const botsBridgeCommandFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("command"),
    commandId: nonEmpty,
    actor: botsBridgeActorSchema,
    command: botsBridgeCommandSchema,
  })
  .strict();
export type BotsBridgeCommandFrame = z.infer<typeof botsBridgeCommandFrameSchema>;

export const botsBridgeAcceptedFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("accepted"),
    inReplyTo: nonEmpty,
    streamId: nonEmpty,
    bindingId: nonEmpty.optional(),
  })
  .strict();
export type BotsBridgeAcceptedFrame = z.infer<typeof botsBridgeAcceptedFrameSchema>;

export const botsBridgeDeliveryFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("delivery"),
    bindingId: nonEmpty,
    streamId: nonEmpty,
    seq: z.number().int().positive(),
    createdAt: timestampMs,
    payload: botsBridgeDeliveryPayloadSchema,
  })
  .strict();
export type BotsBridgeDeliveryFrame = z.infer<typeof botsBridgeDeliveryFrameSchema>;

export const botsBridgeStreamStateSchema = z.enum([
  "completed",
  "failed",
  "stopped",
  "awaiting_input",
]);
export type BotsBridgeStreamState = z.infer<typeof botsBridgeStreamStateSchema>;

export const botsBridgeStatusFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("status"),
    bindingId: nonEmpty,
    streamId: nonEmpty,
    state: botsBridgeStreamStateSchema,
    message: z.string().optional(),
  })
  .strict();
export type BotsBridgeStatusFrame = z.infer<typeof botsBridgeStatusFrameSchema>;

/** 客户端 ack 下行 delivery。 */
export const botsBridgeAckFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("ack"),
    inReplyTo: nonEmpty,
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .strict();
export type BotsBridgeAckFrame = z.infer<typeof botsBridgeAckFrameSchema>;

export const botsBridgeErrorFrameSchema = z
  .object({
    ...frameBase,
    kind: z.literal("error"),
    inReplyTo: nonEmpty.optional(),
    code: nonEmpty,
    message: z.string(),
  })
  .strict();
export type BotsBridgeErrorFrame = z.infer<typeof botsBridgeErrorFrameSchema>;

export const botsBridgeClientFrameSchema = z.discriminatedUnion("kind", [
  botsBridgeHelloFrameSchema,
  botsBridgeCommandFrameSchema,
  botsBridgeAckFrameSchema,
  botsBridgeErrorFrameSchema,
]);
export type BotsBridgeClientFrame = z.infer<typeof botsBridgeClientFrameSchema>;

export const botsBridgeServerFrameSchema = z.discriminatedUnion("kind", [
  botsBridgeWelcomeFrameSchema,
  botsBridgeAcceptedFrameSchema,
  botsBridgeDeliveryFrameSchema,
  botsBridgeStatusFrameSchema,
  botsBridgeErrorFrameSchema,
]);
export type BotsBridgeServerFrame = z.infer<typeof botsBridgeServerFrameSchema>;

export function safeParseBotsBridgeClientFrame(input: unknown) {
  return botsBridgeClientFrameSchema.safeParse(input);
}

export function safeParseBotsBridgeServerFrame(input: unknown) {
  return botsBridgeServerFrameSchema.safeParse(input);
}

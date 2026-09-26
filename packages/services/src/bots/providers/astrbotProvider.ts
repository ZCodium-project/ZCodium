// AstrBot 传输 provider（v2.1）。见 .agents/specs/bots-astrbot-bridge.md。
//
// 这是官方 BotsService 的一个 BotProviderAdapter：
// - 入站：bridge command 帧 → BotInboundMessage，交官方命令准入 / 任务驱动。
// - 出站：BotOutboundMessage 文本 → bridge delivery 帧。
// - 交互：官方 selection 走文本回退（ZCodium 侧 channel 固定为 astrbot）。
//
// 轮次模型（与插件对齐，每命令一个 stream）：
//   beginTurn → accepted(新 stream) → delivery… → status
// 若该命令启动了任务流（notifyTaskLifecycle("started")），则命令流被提升为任务流，
// 任务期间出站继续走任务流，终态/等待交互时以 status 收口。
// binding 路由与 seq/ack/replay 只属于传输层；provider 不持 sessionId/pending/任务状态。

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  BOTS_BRIDGE_PROTOCOL_VERSION,
  botsBridgeCommandFrameSchema,
  type BotActor,
  type BotInboundMessage,
  type BotOutboundMessage,
  type BotsBridgeCommandFrame,
  type BotsBridgeDeliveryFrame,
  type BotsBridgeResumeCursor,
  type BotsBridgeServerFrame,
  type BotsBridgeStreamState,
} from "@zcode/shared";
import { createServiceLogger, type ServiceLogger } from "#src/logger/serviceLogger.js";
import type { AstrBotBridgeTransport, IAstrBotBridgeService } from "../astrbotBridgePort.js";
import { BotsDeliveryLog, type BotsDeliveryReplay } from "../botsDeliveryLog.js";
import type { BotProviderAdapter, BotTaskLifecyclePhase } from "./types.js";

/** 官方 inbound 处理入口会注入 botId（wire 上没有该字段）。 */
const inboundFrameSchema = botsBridgeCommandFrameSchema.extend({
  zcodeBotId: z.string().trim().min(1),
});

/** actorKey 用平台稳定用户 id 派生，不落明文 id（原桥接 domain 逻辑，现为 provider 私有）。 */
function computeActorKey(channel: string, externalUserId: string): string {
  return createHash("sha256").update(`${channel}\u0000${externalUserId.trim()}`).digest("hex");
}

function buildBindingId(channel: string, actorKey: string): string {
  return `${channel}:${actorKey.slice(0, 16)}`;
}

function targetKey(actor: Pick<BotActor, "chatId" | "providerUserId">): string {
  return actor.chatId?.trim() || actor.providerUserId;
}

function toBridgeState(phase: BotTaskLifecyclePhase): BotsBridgeStreamState {
  switch (phase) {
    case "awaiting_input":
      return "awaiting_input";
    case "failed":
      return "failed";
    default:
      return "completed";
  }
}

export interface AstrBotProviderOptions {
  logger?: ServiceLogger;
  clock?: () => number;
  idFactory?: () => string;
}

export interface AstrBotProvider extends BotProviderAdapter, IAstrBotBridgeService {
  dispose(): void;
}

export function createAstrBotBotProvider(options: AstrBotProviderOptions = {}): AstrBotProvider {
  const logger = options.logger ?? createServiceLogger("bots.astrbot");
  const clock = options.clock ?? (() => Date.now());
  const idFactory = options.idFactory ?? (() => randomUUID());

  const deliveryLog = new BotsDeliveryLog({ idFactory, clock });
  /** targetKey → bindingId（出站路由）。 */
  const routing = new Map<string, string>();
  /** bindingId → 当前命令轮次（命令窗口内出站走它）。 */
  const currentTurns = new Map<string, { streamId: string; startedTask: boolean }>();
  /** bindingId → 正在运行的任务流。 */
  const taskStreams = new Map<string, string>();
  /** bindingId → 最近分配的下行 seq。 */
  const cursors = new Map<string, number>();
  /** bindingId → 最近一条 delivery（snapshot 用）。 */
  const latestFrames = new Map<string, BotsBridgeDeliveryFrame>();
  let transport: AstrBotBridgeTransport | null = null;

  function resolveBindingId(actor: Pick<BotActor, "chatId" | "providerUserId">): string {
    return buildBindingId("astrbot", computeActorKey("astrbot", targetKey(actor)));
  }

  function emit(frame: BotsBridgeServerFrame): void {
    transport?.send(frame);
  }

  function emitStatus(bindingId: string, streamId: string, state: BotsBridgeStreamState): void {
    emit({
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "status",
      id: idFactory(),
      bindingId,
      streamId,
      state,
    });
  }

  function emitDelivery(bindingId: string, streamId: string, text: string): void {
    const currentCursor = cursors.get(bindingId) ?? 0;
    const frame = deliveryLog.append({
      bindingId,
      streamId,
      currentCursor,
      payload: { type: "text", text },
    });
    cursors.set(bindingId, frame.seq);
    latestFrames.set(bindingId, frame);
    emit(frame);
  }

  function beginTurn(frame: BotsBridgeCommandFrame, botId: string): string {
    const actor: BotActor = {
      provider: "astrbot",
      botId,
      providerUserId: frame.actor.externalUserId.trim(),
      chatType: frame.actor.chatType,
      ...(frame.actor.chatId ? { chatId: frame.actor.chatId } : {}),
      ...(frame.actor.displayName ? { displayName: frame.actor.displayName } : {}),
    };
    const bindingId = resolveBindingId(actor);
    routing.set(targetKey(actor), bindingId);
    const streamId = idFactory();
    currentTurns.set(bindingId, { streamId, startedTask: false });
    emit({
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "accepted",
      id: idFactory(),
      inReplyTo: frame.id,
      streamId,
      bindingId,
    });
    return bindingId;
  }

  function settleTurn(bindingId: string): void {
    const turn = currentTurns.get(bindingId);
    if (!turn) {
      return;
    }
    currentTurns.delete(bindingId);
    // 启动任务的轮次由任务终态收口；其余命令立即收口。
    if (!turn.startedTask) {
      emitStatus(bindingId, turn.streamId, "completed");
    }
  }

  function notifyTaskLifecycle(_bot: unknown, actor: BotActor, phase: BotTaskLifecyclePhase): void {
    const bindingId = routing.get(targetKey(actor)) ?? resolveBindingId(actor);
    if (phase === "started") {
      const turn = currentTurns.get(bindingId);
      const streamId = turn?.streamId ?? idFactory();
      if (turn) {
        turn.startedTask = true;
      }
      taskStreams.set(bindingId, streamId);
      return;
    }
    const streamId =
      taskStreams.get(bindingId) ?? currentTurns.get(bindingId)?.streamId ?? idFactory();
    taskStreams.delete(bindingId);
    emitStatus(bindingId, streamId, toBridgeState(phase));
  }

  return {
    async test() {
      return {
        ok: transport !== null,
        message: transport ? "AstrBot bridge connected." : "AstrBot bridge transport not attached.",
      };
    },

    async send(_bot, message: BotOutboundMessage): Promise<void> {
      const bindingId = routing.get(message.providerUserId);
      if (!bindingId) {
        logger.warn(undefined, `astrbot delivery without binding target=${message.providerUserId}`);
        return;
      }
      // 命令窗口内走当前命令流；任务运行期间走任务流；兜底新建流。
      const streamId =
        currentTurns.get(bindingId)?.streamId ?? taskStreams.get(bindingId) ?? idFactory();
      emitDelivery(bindingId, streamId, message.text);
    },

    parseCallback(payload: unknown): BotInboundMessage[] {
      const parsed = inboundFrameSchema.safeParse(payload);
      if (!parsed.success) {
        return [];
      }
      const frame = parsed.data;
      const actor: BotActor = {
        provider: "astrbot",
        botId: frame.zcodeBotId,
        providerUserId: frame.actor.externalUserId.trim(),
        chatType: frame.actor.chatType,
        ...(frame.actor.chatId ? { chatId: frame.actor.chatId } : {}),
        ...(frame.actor.displayName ? { displayName: frame.actor.displayName } : {}),
        providerMessageId: frame.id,
      };
      routing.set(targetKey(actor), resolveBindingId(actor));
      const base = { botId: frame.zcodeBotId, actor, receivedAt: clock() };
      switch (frame.command.type) {
        case "prompt":
          return [{ ...base, text: frame.command.text }];
        case "bind":
          return [{ ...base, text: `/bind ${frame.command.code}` }];
        case "new":
          return [{ ...base, text: "/new" }];
        case "stop":
          return [{ ...base, text: "/stop" }];
        case "cancel":
          return [{ ...base, text: "/cancel" }];
        case "status":
          return [{ ...base, text: "/status" }];
        case "help":
          return [{ ...base, text: "/help" }];
        case "unbind":
          return [{ ...base, text: "/unbind" }];
        case "workspace.set":
          return [{ ...base, text: `/workspace ${frame.command.value}` }];
        case "permission.respond":
          return [
            { ...base, text: `/approve ${frame.command.requestId} ${frame.command.optionId}` },
          ];
        case "elicitation.respond":
          return [
            {
              ...base,
              text: "",
              elicitationResponse: {
                requestId: frame.command.requestId,
                action: frame.command.action,
                ...(frame.command.content ? { content: frame.command.content } : {}),
              },
            },
          ];
        default:
          return [];
      }
    },

    notifyTaskLifecycle,

    attachTransport(next: AstrBotBridgeTransport) {
      transport = next;
      return {
        dispose: () => {
          if (transport === next) {
            transport = null;
          }
        },
      };
    },

    beginTurn,

    settleTurn,

    resolveResume(cursorsIn: readonly BotsBridgeResumeCursor[]): Map<string, BotsDeliveryReplay> {
      return deliveryLog.resolveResume(cursorsIn);
    },

    async buildSnapshot(bindingId: string): Promise<BotsBridgeDeliveryFrame | null> {
      return latestFrames.get(bindingId) ?? null;
    },

    ackDeliveryByFrameId(deliveryId: string): void {
      deliveryLog.ackById(deliveryId);
    },

    dispose(): void {
      transport = null;
      routing.clear();
      currentTurns.clear();
      taskStreams.clear();
      cursors.clear();
      latestFrames.clear();
    },
  };
}
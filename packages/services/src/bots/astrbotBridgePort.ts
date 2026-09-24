// AstrBot 桥接传输控制面（v2.1）。见 .agents/specs/bots-astrbot-bridge.md。
//
// 官方 BotsService 的 astrbot provider 实现本接口；host 侧 loopback WS 服务持有它收发帧。
// 入站帧经 IBotsService.handleProviderCallback("astrbot", payload) 进入官方流程，
// 出站由 provider.send 经已 attach 的 transport 下发。本文件只描述契约，不做 IO。

import { ServiceChannels } from "@zcode/shared";
import type {
  BotsBridgeCommandFrame,
  BotsBridgeDeliveryFrame,
  BotsBridgeResumeCursor,
  BotsBridgeServerFrame,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";
import type { BotsDeliveryReplay } from "./botsDeliveryLog.js";

/** host 侧 loopback WS 服务作为 provider 的传输端点。 */
export interface AstrBotBridgeTransport {
  send(frame: BotsBridgeServerFrame): void;
}

export interface IAstrBotBridgeService {
  /**
   * 建立/替换本机传输端点（loopback WS）。
   * 同一时刻只保留最后一个 transport；返回的 dispose 只会清掉自己。
   */
  attachTransport(transport: AstrBotBridgeTransport): { dispose(): void };

  /** 命令帧受理：发出 accepted、登记本次轮次的 binding，返回 bindingId。 */
  beginTurn(frame: BotsBridgeCommandFrame, botId: string): string;

  /**
   * 官方 inbound 处理结束后的收口：若该 binding 未启动任务流，则补一个 status{completed}。
   * 已启动任务流的 binding 由 notifyTaskLifecycle 在终态时收口。
   */
  settleTurn(bindingId: string): void;

  /** 客户端 hello 时按游标解析补投。 */
  resolveResume(cursors: readonly BotsBridgeResumeCursor[]): Map<string, BotsDeliveryReplay>;

  /** 超窗重连时构造 snapshot（当前为最近一条投递）。 */
  buildSnapshot(bindingId: string): Promise<BotsBridgeDeliveryFrame | null>;

  /** ack：按 delivery frame id 确认。 */
  ackDeliveryByFrameId(deliveryId: string): void;
}

export const IAstrBotBridgeService =
  createServiceDescriptor<IAstrBotBridgeService>(ServiceChannels.AstrBotBridge);
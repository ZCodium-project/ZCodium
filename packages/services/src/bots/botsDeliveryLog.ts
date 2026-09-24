// 每个绑定的下行投递序列与有限回放窗口。见 .agents/specs/bots-astrbot-bridge.md。
//
// seq 是「每绑定全局单调」，streamId 只是分组标签；这样重连补投一个游标就能覆盖多个轮次。
// 桥接按 web-remote-replayable 处理：窗口内补 delta，超窗由调用方改发 snapshot。

import {
  BOTS_BRIDGE_PROTOCOL_VERSION,
  type BotsBridgeDeliveryFrame,
  type BotsBridgeDeliveryPayload,
  type BotsBridgeResumeCursor,
} from "@zcode/shared";

/** 每个绑定保留的最近投递条数；超出后重连只能靠 snapshot。 */
export const BOTS_DELIVERY_WINDOW = 200;

export interface BotsDeliveryRecord {
  seq: number;
  frame: BotsBridgeDeliveryFrame;
  acknowledged: boolean;
}

export interface BotsDeliveryReplay {
  frames: BotsBridgeDeliveryFrame[];
  needsSnapshot: boolean;
}

export class BotsDeliveryLog {
  private readonly logs = new Map<string, BotsDeliveryRecord[]>();

  constructor(
    private readonly options: {
      idFactory: () => string;
      clock: () => number;
      window?: number;
    },
  ) {}

  private get window(): number {
    return this.options.window ?? BOTS_DELIVERY_WINDOW;
  }

  /**
   * 追加一条投递。
   * @param currentCursor 该绑定最近已分配的 seq（服务层从 binding.deliveryCursor 读取）。
   */
  append(input: {
    bindingId: string;
    streamId: string;
    currentCursor: number;
    payload: BotsBridgeDeliveryPayload;
  }): BotsBridgeDeliveryFrame {
    const seq = input.currentCursor + 1;
    const frame: BotsBridgeDeliveryFrame = {
      v: BOTS_BRIDGE_PROTOCOL_VERSION,
      kind: "delivery",
      id: this.options.idFactory(),
      bindingId: input.bindingId,
      streamId: input.streamId,
      seq,
      createdAt: this.options.clock(),
      payload: input.payload,
    };
    const list = this.logs.get(input.bindingId) ?? [];
    list.push({ seq, frame, acknowledged: false });
    if (list.length > this.window) {
      list.splice(0, list.length - this.window);
    }
    this.logs.set(input.bindingId, list);
    return frame;
  }

  /** 从 cursor+1 补投；cursor 早于保留窗口首条时要求 snapshot。 */
  replay(bindingId: string, cursor: number): BotsDeliveryReplay {
    const list = this.logs.get(bindingId);
    if (!list || list.length === 0) {
      return { frames: [], needsSnapshot: false };
    }
    const firstRetained = list[0]?.seq ?? 0;
    if (cursor + 1 < firstRetained) {
      return { frames: [], needsSnapshot: true };
    }
    return {
      frames: list.filter((record) => record.seq > cursor).map((record) => record.frame),
      needsSnapshot: false,
    };
  }

  resolveResume(cursors: readonly BotsBridgeResumeCursor[]): Map<string, BotsDeliveryReplay> {
    const result = new Map<string, BotsDeliveryReplay>();
    for (const cursor of cursors) {
      result.set(cursor.bindingId, this.replay(cursor.bindingId, cursor.seq));
    }
    return result;
  }

  ack(bindingId: string, seq: number): void {
    const record = this.logs.get(bindingId)?.find((item) => item.seq === seq);
    if (record) {
      record.acknowledged = true;
    }
  }

  /** 按 delivery frame id 反查并确认；返回所属绑定与 seq。 */
  ackById(deliveryId: string): { bindingId: string; seq: number } | null {
    for (const [bindingId, list] of this.logs) {
      const record = list.find((item) => item.frame.id === deliveryId);
      if (record) {
        record.acknowledged = true;
        return { bindingId, seq: record.seq };
      }
    }
    return null;
  }

  drop(bindingId: string): void {
    this.logs.delete(bindingId);
  }
}

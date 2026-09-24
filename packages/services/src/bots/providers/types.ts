import type {
  BotActor,
  BotConfig,
  BotInboundAttachment,
  BotInboundMessage,
  BotOutboundMessage,
  BotProviderCallbackResult,
  Locale,
} from "@zcode/shared";

export interface BotTypingTarget {
  providerUserId: string;
  providerMessageId?: string;
  providerContextToken?: string;
}

export interface BotProviderDownloadedAttachment {
  attachment: BotInboundAttachment;
  data: Uint8Array;
}

export type BotStreamingReplyCardBlock =
  | {
      type: "message";
      text: string;
    }
  | {
      type: "tools";
      summaries: string[];
      title?: string;
      expanded?: boolean;
    };

export interface BotStreamingReplyCardState {
  providerUserId: string;
  locale?: Locale;
  blocks: BotStreamingReplyCardBlock[];
  status: "running" | "sealed" | "completed" | "error";
}

export interface BotStreamingReplyCardHandle {
  providerMessageId: string;
}

export type BotTransientInteractionCardHandle = BotStreamingReplyCardHandle;

export interface BotProviderAcknowledgeResult {
  handled?: boolean;
}

/**
 * 官方任务流生命周期，供传输型 provider（如 astrbot）对齐 bridge 的 accepted→delivery→status 轮次收口。
 * `started` 表示已进入任务流（此时不应提前收口）；其余为终态/等待交互。
 */
export type BotTaskLifecyclePhase = "started" | "awaiting_input" | "completed" | "failed";

export interface BotProviderAdapter {
  test(bot: BotConfig): Promise<{ ok: boolean; message: string }>;
  resolveName?(bot: BotConfig): Promise<string | null>;
  syncCommands?(bot: BotConfig): Promise<void>;
  send(bot: BotConfig, message: BotOutboundMessage): Promise<void>;
  sendTyping?(bot: BotConfig, target: BotTypingTarget): Promise<void>;
  startTyping?(bot: BotConfig, target: BotTypingTarget): Promise<void>;
  stopTyping?(bot: BotConfig, target: BotTypingTarget): Promise<void>;
  resolveActorDisplayName?(bot: BotConfig, actor: BotActor): Promise<string | null>;
  acknowledgeCallback?(
    bot: BotConfig,
    payload: unknown,
    text?: string,
    message?: BotOutboundMessage,
    signal?: AbortSignal,
  ): Promise<BotProviderAcknowledgeResult | void>;
  createStreamingReplyCard?(
    bot: BotConfig,
    state: BotStreamingReplyCardState,
    signal?: AbortSignal,
  ): Promise<BotStreamingReplyCardHandle | null>;
  updateStreamingReplyCard?(
    bot: BotConfig,
    handle: BotStreamingReplyCardHandle,
    state: BotStreamingReplyCardState,
    signal?: AbortSignal,
  ): Promise<void>;
  splitStreamingReplyCardStates?(
    state: BotStreamingReplyCardState,
  ): BotStreamingReplyCardState[];
  createTransientInteractionCard?(
    bot: BotConfig,
    message: BotOutboundMessage,
  ): Promise<BotTransientInteractionCardHandle | null>;
  updateTransientInteractionCard?(
    bot: BotConfig,
    handle: BotTransientInteractionCardHandle,
    message: BotOutboundMessage,
  ): Promise<void>;
  deleteTransientInteractionCard?(
    bot: BotConfig,
    handle: BotTransientInteractionCardHandle,
  ): Promise<void>;
  prepareCallbackPayload?(bot: BotConfig, payload: unknown): Promise<unknown>;
  handleCallbackResponse?(bot: BotConfig, payload: unknown): Promise<Pick<BotProviderCallbackResult, "responseBody" | "status"> | null>;
  downloadAttachment?(
    bot: BotConfig,
    attachment: BotInboundAttachment,
    actor?: BotActor,
  ): Promise<BotProviderDownloadedAttachment | null>;
  /**
   * 任务流生命周期通知（可选）。仅在 provider 需要把官方轮次映射成自有传输信号时实现，
   * 不改变任何业务状态。
   */
  notifyTaskLifecycle?(bot: BotConfig, actor: BotActor, phase: BotTaskLifecyclePhase): void;
  parseCallback(payload: unknown): BotInboundMessage[];
}

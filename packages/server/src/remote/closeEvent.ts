import { constants } from "node:os";
import { Emitter, type Event } from "@zcode/rpc";

interface CloseEventController {
  event: Event<number>;
  fire(code: number): void;
}

export function createCloseEventController(): CloseEventController {
  const emitter = new Emitter<number>();
  let closed = false;
  let closeCode = 0;

  const event: Event<number> = (listener) => {
    // 远端命令可能在调用方订阅 onClose 之前就瞬间退出。
    // 如果事件只做“在线分发”不做补发，waitForClose 会永远等不到，表现为连接卡住。
    // 这里对晚订阅者补发最后一次 close code，避免竞态丢事件。
    if (closed) {
      queueMicrotask(() => {
        listener(closeCode);
      });
      return { dispose() {} };
    }

    return emitter.event(listener);
  };

  const fire = (code: number) => {
    if (closed) {
      return;
    }
    closed = true;
    closeCode = code;
    emitter.fire(code);
    emitter.dispose();
  };

  return { event, fire };
}

/** 没有可用退出码时的失败值，与 OpenSSH 客户端收不到 exit-status 时的退出码一致。 */
const UNKNOWN_REMOTE_EXIT_CODE = 255;

/**
 * 把 child_process / ssh2 的 exit 参数归一成一个退出码。
 *
 * Bug 原因：三个 Backend 都写成 `code ?? 0`。进程被信号杀死时 code 是 null，
 * ssh2 的通道在没有 exit-status 时 close 也不带 code，于是被 kill -9 的下载、解包、
 * update 都被当成成功。这里按 shell 惯例返回 128 + 信号值；完全没有退出信息时返回 255。
 */
export function resolveRemoteExitCode(
  code: number | null | undefined,
  signal: string | null | undefined,
): number {
  if (typeof code === "number") {
    return code;
  }
  const signalNumber = signal
    ? constants.signals[signal as keyof typeof constants.signals]
    : undefined;
  return typeof signalNumber === "number" ? 128 + signalNumber : UNKNOWN_REMOTE_EXIT_CODE;
}

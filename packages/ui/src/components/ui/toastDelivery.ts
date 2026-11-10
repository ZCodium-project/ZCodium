/**
 * 全局 toast 的投递控制器（26.5.6 修复项 1/2）。
 *
 * 根因：旧实现里 `toast()` 在 ToastContainer 尚未挂载时用 `requestAnimationFrame`
 * 重试投递、消息可见性也靠 rAF 翻转——被遮挡/后台的 Electron 窗口 rAF 停摆
 * （实测被遮挡窗口 rAF 低至 ~0.2 帧/秒甚至暂停），toast 因此延迟数秒或永久丢失；
 * 而状态圆点、保存反馈卡等 React 状态渲染走 Scheduler（MessageChannel）不受影响。
 * 这正是 26.5.4/26.5.5 两轮双盲「刷新失败 toast 全程未出现」的根因。
 *
 * 修复契约：**投递与可见性零 rAF 依赖**。
 * - 容器未挂载时 toast 进入缓冲队列；容器挂载（`setReceiver`）同步排空队列——
 *   React 初始挂载走 Scheduler，不随窗口可见性停摆（已被遮挡窗口挂载事实证实）。
 * - 预挂载的 update/dismiss 语义不变：update 合并到待投递项、dismiss 丢弃待投递项。
 */

export type ToastDeliveryReceiver<T> = (item: T) => void;

export interface ToastDeliveryController<T> {
  /** 投递一条 toast：接收方已就绪则立即送达，否则缓冲待容器挂载后排空。 */
  deliver: (item: T) => void;
  /** 容器挂载：登记接收方并同步排空缓冲队列（保持入队顺序）。 */
  setReceiver: (receiver: ToastDeliveryReceiver<T>) => void;
  /** 容器卸载：撤销接收方（缓冲语义保持，等待下一次挂载）。 */
  unsetReceiver: () => void;
  /** 仅供测试：缓冲中的待投递项。 */
  buffered(): readonly T[];
}

export function createToastDelivery<T>(): ToastDeliveryController<T> {
  let receiver: ToastDeliveryReceiver<T> | null = null;
  const queue: T[] = [];

  return {
    deliver(item) {
      if (receiver) {
        receiver(item);
        return;
      }
      queue.push(item);
    },
    setReceiver(next) {
      receiver = next;
      const buffered = queue.splice(0, queue.length);
      for (const item of buffered) receiver(item);
    },
    unsetReceiver() {
      receiver = null;
    },
    buffered() {
      return [...queue];
    },
  };
}

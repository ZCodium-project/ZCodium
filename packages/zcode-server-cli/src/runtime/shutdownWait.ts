import { SOURCE_SERVER_STOP_FAILED_ERROR_CODE } from "@zcode/shared";
import { SERVER_STOP_WAIT_TIMEOUT_MS, type ServerStatus } from "../contracts.js";
import { isControlEndpointUnavailable, requestControl } from "../ipc/controlClient.js";
import { DataRootLock } from "./lock.js";
import type { ServerLayout } from "./paths.js";
import { readPersistedStatusDetailed } from "./statusSnapshot.js";
import { describeLockInspection } from "./uninstallGuard.js";

/**
 * 状态快照写出的 stop-failed：Supervisor 停 Core 失败后继续持锁，不会再自行停止。
 * 失败事实来自 status 文件而不是 control 应答，因此不借用 `ControlRequestError`；
 * `code` 仍是公开错误码，CLI 顶层按结构读取后原样输出给桌面端。
 */
class ServerStopFailedError extends Error {
  public readonly code = SOURCE_SERVER_STOP_FAILED_ERROR_CODE;

  public constructor(lastExitReason: string | null) {
    super(`Server stop failed${lastExitReason ? `: ${lastExitReason}` : ""}`);
    this.name = "ServerStopFailedError";
  }
}

/** 快照是否表示 Supervisor 已完成停止收口；uninstalled 是卸载流程里的停止态。 */
export function isStoppedServerStatus(status: ServerStatus | null | undefined): boolean {
  return status?.state === "stopped" || status?.state === "uninstalled";
}

export async function waitForServerStopped(
  layout: ServerLayout,
  minUpdatedAt = 0,
  requireFreshSnapshot = false,
): Promise<void> {
  // Bug 原因：旧的 6 秒上限短于 Supervisor 的 5 秒宽限 + 强杀等待；Core 走 SIGKILL 路径时
  // Supervisor 仍会正常 stopped，等待方却先超时，update handoff 因此误报失败。
  const deadline = Date.now() + SERVER_STOP_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const persisted = await readPersistedStatusDetailed(layout);
    if (persisted.state === "invalid" || persisted.state === "unreadable") {
      throw new Error("Cannot verify Server shutdown status");
    }
    const lockInspection = await new DataRootLock(layout.lockFile).inspect();
    if (lockInspection.state === "invalid" || lockInspection.state === "unreadable") {
      throw new Error(`Cannot verify Server shutdown (${describeLockInspection(lockInspection)})`);
    }
    const lockReleased = lockInspection.state === "missing" || lockInspection.state === "stale";
    const stopped = isStoppedServerStatus(persisted.status);
    const freshSnapshot = persisted.status !== null && persisted.status.updatedAt > minUpdatedAt;
    // 本次 stop 之后写出的 stop-failed 是终态：Supervisor 继续持锁且不会再自行停止，
    // 继续轮询只会把明确的失败拖成 20 秒超时。
    if (requireFreshSnapshot && freshSnapshot && persisted.status?.state === "stop-failed") {
      throw new ServerStopFailedError(persisted.status.lastExitReason);
    }
    // stopped 落盘早于 lock.release，陈旧的 stopped 快照不能作为立即注册新服务的依据。
    // 迁移必须同时确认新快照和锁已释放；只有离线卸载且没有任何快照时才允许仅凭缺锁继续。
    if (
      lockReleased &&
      ((stopped && (!requireFreshSnapshot || freshSnapshot)) ||
        (!requireFreshSnapshot && persisted.state === "missing"))
    )
      return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Server shutdown (${layout.statusFile})`);
}

/**
 * control 不可达时的重复停止兜底，CLI 内唯一实现（ack 型 `stop` 与停止等待共用）。
 *
 * Supervisor 收口顺序是“落盘 stopped → 关闭 control → 释放锁”。control 已不可达且快照已是
 * stopped/uninstalled，说明另一次停止已完成或正在收尾，不能因 socket 消失把重复停止报成失败。
 * 返回此刻的快照；快照缺失返回 null（从未写出过状态）。其余情况原样抛出 control 错误。
 */
export async function readStatusForStopWithoutControl(
  layout: ServerLayout,
  controlError: unknown,
): Promise<ServerStatus | null> {
  if (!isControlEndpointUnavailable(controlError)) throw controlError;
  const persisted = await readPersistedStatusDetailed(layout);
  if (persisted.state === "invalid" || persisted.state === "unreadable") throw controlError;
  if (persisted.status !== null && !isStoppedServerStatus(persisted.status)) throw controlError;
  return persisted.status;
}

/**
 * 停止现有 Supervisor 并等待停止完成，是 CLI 内唯一的“停止并等待”实现。
 *
 * 读取停止前 status 作为基线 → 锁缺失或 stale 视为已停止 → 向 control 发 stop →
 * 等到 data-root 锁释放且 status 为比基线新的 stopped。`operation` 只用于错误文案。
 */
export async function stopSupervisorAndWait(
  layout: ServerLayout,
  operation: string,
): Promise<void> {
  const persisted = await readPersistedStatusDetailed(layout);
  if (persisted.state === "invalid" || persisted.state === "unreadable") {
    throw new Error(`Cannot verify Server status before ${operation}`);
  }
  const baselineUpdatedAt = persisted.status?.updatedAt ?? 0;
  const lockInspection = await new DataRootLock(layout.lockFile).inspect();
  if (lockInspection.state === "invalid" || lockInspection.state === "unreadable") {
    throw new Error(
      `Cannot verify Server lock before ${operation} (${describeLockInspection(lockInspection)})`,
    );
  }
  // 没有存活的锁持有者就没有可停止的 Supervisor；残留的 control socket 会被下一任 Supervisor 清理。
  if (lockInspection.state === "missing" || lockInspection.state === "stale") return;
  try {
    await requestControl(layout.controlEndpoint, { command: "stop" });
  } catch (error) {
    // 锁仍被存活进程持有却没有任何快照：Supervisor 尚在首次启动（先持锁、后监听 control 再落盘），
    // 不是正在收尾的停止，按原 control 错误失败。另一次停止正在收尾时只需等锁释放。
    if ((await readStatusForStopWithoutControl(layout, error)) === null) throw error;
    await waitForServerStopped(layout);
    return;
  }
  await waitForServerStopped(layout, baselineUpdatedAt, true);
}

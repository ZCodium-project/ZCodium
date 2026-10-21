import { BrowserWindow, ipcMain } from "electron";
import type { WebContents } from "electron";
import {
  PlatformChannels,
  type WebRemoteControlAuthStateChange,
  type WebRemoteControlContext,
  type WebRemoteControlStartResult,
  type WebRemoteControlStatus,
} from "@zcode/shared";
import type { WebRemoteControlStartAuthorization } from "./webRemoteControlManager.js";

export interface WebRemoteControlIpcManager {
  authorizeStart: (
    windowId: number,
    context: WebRemoteControlContext,
  ) => WebRemoteControlStartAuthorization;
  startAuthorized: (
    windowId: number,
    context: WebRemoteControlContext,
    authorization: WebRemoteControlStartAuthorization,
  ) => Promise<WebRemoteControlStartResult>;
  notifyAuthStateChanged(windowId: number, change: WebRemoteControlAuthStateChange): Promise<void>;
  stop(windowId: number): Promise<void>;
  getStatus(windowId: number): WebRemoteControlStatus;
}

interface WebRemoteControlIpcDependencies {
  webRemoteControlManager: WebRemoteControlIpcManager;
}

async function runStartOperation(input: {
  context: WebRemoteControlContext;
  sender: WebContents;
  missingWindowMessage: string;
  operation: (windowId: number) => Promise<WebRemoteControlStartResult>;
}): Promise<WebRemoteControlStartResult> {
  // 交互边界：远控面板已有显式用户操作，main 只校验窗口并绑定目标，
  // 不再叠加原生确认弹窗，避免一次操作出现两层确认。
  const win = BrowserWindow.fromWebContents(input.sender);
  if (!win) {
    throw new Error(input.missingWindowMessage);
  }
  return await input.operation(win.id);
}

export function registerWebRemoteControlIpcHandlers(
  dependencies: WebRemoteControlIpcDependencies,
): void {
  ipcMain.on(PlatformChannels.WebRemoteControlAuthStateChanged, (event, payload: unknown) => {
    // 审计版不再依赖 zod schema：只接受 renderer 的 signed-in / signed-out 两态通知。
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return;
    const state = (payload as { state?: unknown }).state;
    if (state !== "signed-in" && state !== "signed-out") return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    // 单向通知不把异步异常泄漏到 Electron；下次通知或 workspace sync 可重试恢复。
    void dependencies.webRemoteControlManager
      .notifyAuthStateChanged(win.id, { state })
      .catch(() => {});
  });
  ipcMain.handle(
    PlatformChannels.StartWebRemoteControl,
    async (event, context: WebRemoteControlContext) =>
      runStartOperation({
        context,
        sender: event.sender,
        missingWindowMessage: "未找到当前窗口，无法开启 Web 远程控制",
        operation: (windowId) => {
          const manager = dependencies.webRemoteControlManager;
          const authorization = manager.authorizeStart(windowId, context);
          return manager.startAuthorized(windowId, context, authorization);
        },
      }),
  );

  ipcMain.handle(PlatformChannels.StopWebRemoteControl, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      await dependencies.webRemoteControlManager.stop(win.id);
    }
  });

  ipcMain.handle(PlatformChannels.GetWebRemoteControlStatus, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win
      ? dependencies.webRemoteControlManager.getStatus(win.id)
      : { status: "idle" as const };
  });
}

/**
 * 数据根决策窗口（独立轻量 BrowserWindow）。
 *
 * 出现在主窗口与 Host 之前：窗口只负责展示状态与提交选择，所有文件操作都在
 * desktopDataRootDecision 的 main 侧编排中完成。
 */
import { app, BrowserWindow, nativeTheme } from "electron";
import { join } from "node:path";

interface DataRootDecisionWindowOptions {
  /** 窗口被关闭（用户点 X 或进程退出）时回调；决策流程据此退出应用。 */
  onClosed: () => void;
  logger: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}

let instance: BrowserWindow | null = null;

export function createDataRootDecisionWindow(
  options: DataRootDecisionWindowOptions,
): BrowserWindow {
  if (instance && !instance.isDestroyed()) {
    instance.focus();
    return instance;
  }

  const preloadPath = join(import.meta.dirname, "../preload/dataRootDecision.cjs");
  const win = new BrowserWindow({
    width: 760,
    height: 620,
    minWidth: 640,
    minHeight: 520,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "ZCodium",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#101014" : "#f5f5f7",
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  instance = win;

  win.once("ready-to-show", () => {
    win.show();
  });
  win.on("closed", () => {
    instance = null;
    options.onClosed();
  });

  // 与其它辅助窗口一致：生产包加载签名包内资源，开发态走 Vite dev server。
  if (!app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    const base = process.env["ELECTRON_RENDERER_URL"];
    void win.loadURL(`${base}/data-root-decision.html`).catch((error: unknown) => {
      options.logger.warn("[data-root-decision] window load failed", error);
    });
  } else {
    const pagePath = join(import.meta.dirname, "../renderer/data-root-decision.html");
    void win.loadFile(pagePath).catch((error: unknown) => {
      options.logger.warn("[data-root-decision] window load failed", error);
    });
  }

  options.logger.info("[data-root-decision] window opened");
  return win;
}

export function getDataRootDecisionWindow(): BrowserWindow | null {
  return instance && !instance.isDestroyed() ? instance : null;
}

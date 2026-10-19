import { app, Menu, nativeImage, Tray } from "electron";
import type { NativeImage } from "electron";
import { join } from "node:path";
import {
  DesktopCommandIds,
  desktopMenuMessageIds,
  getDesktopMenuMessage,
  ZCODE_PRODUCT_FLAVOR,
  type DesktopCommandId,
  type Locale,
} from "@zcode/shared";
import {
  blendBadgeIntoBitmap,
  renderTaskbarBadgePixels,
  resolveBadgeOverlayLabel,
} from "./unreadBadge.js";

let desktopTray: Tray | null = null;
let rebuildDesktopTrayContextMenu: (() => void) | null = null;
let trayLogger: { warn: (...args: unknown[]) => void } | null = null;

// 托盘红点合成参数：画布 32×32，Logo 满幅；Logo 是圆角方块，右上直角处天然有约
// 4×4 的透明缺口，9×9 红点（画布 10、radius 4）圆心 (28.5, 3.5) 嵌进缺口，
// 与图片上边缘、右边缘正切，最外缘再往外就会被画布裁掉。
// spec 见 docs/desktop/windows-taskbar-unread-badge.md
const TRAY_IMAGE_SIZE = 32;
const TRAY_BADGE_SIZE = 10;
const TRAY_BADGE_ORIGIN_X = 24;
const TRAY_BADGE_ORIGIN_Y = -1;

let trayBaseImage: NativeImage | null = null;
const trayBadgeImageCache = new Map<string, NativeImage>();

export function resolveDesktopTrayIconPath(platform: NodeJS.Platform = process.platform) {
  // Linux 托盘只接受 PNG（.ico 不会渲染）；打包态 icon.png 已由 extraResources 无条件放入
  // resources 目录（electron-builder.config.js），Windows 继续用独立托盘 .ico 避免高 DPI 模糊。
  if (platform === "linux") {
    return app.isPackaged
      ? join(process.resourcesPath, "icon.png")
      : join(import.meta.dirname, "../../build/icon.png");
  }
  return app.isPackaged
    ? join(process.resourcesPath, "tray_icon.ico")
    : join(import.meta.dirname, "../../build/icon.ico");
}

export function createDesktopTray(options: {
  platform?: NodeJS.Platform;
  getLocale: () => Locale;
  showCurrentWindow: () => Promise<void> | void;
  executeDesktopCommand: (command: DesktopCommandId) => Promise<unknown>;
  quitApp: () => void;
  logger: { warn: (...args: unknown[]) => void };
}) {
  const platform = options.platform ?? process.platform;
  // Linux 驻留能力由 createCloseToTrayCapabilityMonitor 探测决定（spec：
  // docs/desktop/linux-close-to-tray.md）；这里只挡平台，能力不过关时调用方不应传入 linux。
  if (platform !== "win32" && platform !== "linux") {
    return null;
  }

  if (desktopTray) {
    return desktopTray;
  }

  try {
    desktopTray = new Tray(resolveDesktopTrayIconPath(platform));
  } catch (error) {
    options.logger.warn("[desktop-tray] failed to create tray icon", error);
    return null;
  }
  trayLogger = options.logger;

  const getLabel = (id: (typeof desktopMenuMessageIds)[keyof typeof desktopMenuMessageIds]) =>
    getDesktopMenuMessage(options.getLocale(), id);
  const showTrayWindow = () => {
    void Promise.resolve(options.showCurrentWindow()).catch((error) => {
      options.logger.warn("[desktop-tray] failed to show current window", error);
    });
  };
  const executeTrayCommand = (command: DesktopCommandId) => {
    void Promise.resolve(options.showCurrentWindow())
      .then(() => options.executeDesktopCommand(command))
      .catch((error) => {
        options.logger.warn(`[desktop-tray] failed to execute tray command ${command}`, error);
      });
  };
  const rebuildContextMenu = () => {
    desktopTray?.setToolTip(getLabel(desktopMenuMessageIds.trayTooltip));
    desktopTray?.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: getLabel(desktopMenuMessageIds.trayOpenZCode),
          click: showTrayWindow,
        },
        { type: "separator" },
        {
          label: getLabel(desktopMenuMessageIds.fileNewTask),
          click: () => executeTrayCommand(DesktopCommandIds.NewTask),
        },
        {
          label: getLabel(desktopMenuMessageIds.fileOpenWorkspace),
          click: () => executeTrayCommand(DesktopCommandIds.OpenWorkspace),
        },
        { type: "separator" },
        // 更新入口跟随产品身份：Preview（含生产后端的 Preview）禁用更新器，托盘也不能露出入口。
        ...(ZCODE_PRODUCT_FLAVOR === "production"
          ? [
              {
                label: getLabel(desktopMenuMessageIds.helpCheckForUpdates),
                click: () => executeTrayCommand(DesktopCommandIds.CheckForUpdates),
              },
            ]
          : []),
        {
          label: getLabel(desktopMenuMessageIds.helpAbout),
          click: () => executeTrayCommand(DesktopCommandIds.ShowAbout),
        },
        {
          // 托盘只提供日志诊断入口，避免右键菜单暴露清除全部数据操作；复用应用菜单导出命令。
          label: getLabel(desktopMenuMessageIds.helpExportLogs),
          click: () => executeTrayCommand(DesktopCommandIds.ExportLogs),
        },
        { type: "separator" },
        {
          label: getLabel(desktopMenuMessageIds.trayQuit),
          click: () => options.quitApp(),
        },
      ]),
    );
  };

  rebuildDesktopTrayContextMenu = rebuildContextMenu;
  desktopTray.on("click", showTrayWindow);
  desktopTray.on("double-click", showTrayWindow);
  rebuildContextMenu();

  return desktopTray;
}

export function updateWindowsDesktopTrayMenu() {
  rebuildDesktopTrayContextMenu?.();
}

function loadTrayBaseImage(): NativeImage | null {
  if (trayBaseImage && !trayBaseImage.isEmpty()) {
    return trayBaseImage;
  }

  try {
    trayBaseImage = nativeImage.createFromPath(resolveDesktopTrayIconPath());
  } catch (error) {
    trayLogger?.warn("[desktop-tray] failed to load tray base image for badge", error);
    return null;
  }
  return trayBaseImage.isEmpty() ? null : trayBaseImage;
}

function composeTrayBadgeImage(label: string, baseImage: NativeImage): NativeImage | null {
  const cached = trayBadgeImageCache.get(label);
  if (cached) {
    return cached;
  }

  const resized = baseImage.resize({ width: TRAY_IMAGE_SIZE, height: TRAY_IMAGE_SIZE });
  const bitmap = resized.toBitmap();
  // 位深防御：toBitmap 尺寸与预期不符时放弃合成，保持无红点底图，避免托盘出花屏。
  if (bitmap.length !== TRAY_IMAGE_SIZE * TRAY_IMAGE_SIZE * 4) {
    trayLogger?.warn(
      `[desktop-tray] unexpected tray bitmap size ${bitmap.length}, skip badge compose`,
    );
    return null;
  }

  const canvas = new Uint8Array(bitmap);
  // 托盘实际显示仅 16×16，数字不可读：只画红点提示"有未读"，数量看任务栏气泡/任务列表。
  // 红点嵌进 Logo 圆角留下的右上透明缺口，边缘与圆弧相切（见顶部常量注释）。
  const badge = renderTaskbarBadgePixels(label, {
    size: TRAY_BADGE_SIZE,
    glyphScale: 1,
    padding: 0,
    dot: true,
  });
  blendBadgeIntoBitmap({
    base: canvas,
    size: TRAY_IMAGE_SIZE,
    badge,
    badgeSize: TRAY_BADGE_SIZE,
    originX: TRAY_BADGE_ORIGIN_X,
    originY: TRAY_BADGE_ORIGIN_Y,
  });
  const image = nativeImage.createFromBitmap(Buffer.from(canvas), {
    width: TRAY_IMAGE_SIZE,
    height: TRAY_IMAGE_SIZE,
  });
  trayBadgeImageCache.set(label, image);
  return image;
}

// 未读计数变化时同步托盘角标：非零在图标右上角贴数字徽章，零恢复原图。
// macOS 无托盘（createDesktopTray 返回 null），由 Dock 角标承担，这里天然 no-op。
export function applyDesktopTrayUnreadBadge(totalUnreadCount: number): void {
  if (!desktopTray) {
    return;
  }

  const label = resolveBadgeOverlayLabel(totalUnreadCount);
  if (!label) {
    const base = loadTrayBaseImage();
    if (base) {
      desktopTray.setImage(base);
    }
    return;
  }

  const base = loadTrayBaseImage();
  if (!base) {
    return;
  }

  const image = composeTrayBadgeImage(label, base);
  if (image) {
    desktopTray.setImage(image);
  }
}

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const trayInstances: Array<{
    imageAtCreate: string;
    images: unknown[];
    tooltips: string[];
  }> = [];
  const createFromBitmapCalls: Array<{ buffer: Buffer; width: number; height: number }> = [];
  let baseImageCounter = 0;

  // 32×32 不透明蓝底（预乘 BGRA），模拟托盘底图
  const baseBuffer = Buffer.alloc(32 * 32 * 4);
  for (let offset = 0; offset < baseBuffer.length; offset += 4) {
    baseBuffer[offset] = 200;
    baseBuffer[offset + 1] = 40;
    baseBuffer[offset + 2] = 10;
    baseBuffer[offset + 3] = 255;
  }

  const fakeBaseImage = () => ({
    __baseImage: ++baseImageCounter,
    isEmpty: () => false,
    resize: () => ({ toBitmap: () => baseBuffer }),
  });

  return {
    trayInstances,
    createFromBitmapCalls,
    baseBuffer,
    fakeBaseImage,
    resetBaseImageCounter: () => {
      baseImageCounter = 0;
    },
  };
});

vi.mock("electron", () => ({
  app: { isPackaged: false },
  Menu: { buildFromTemplate: (template: unknown) => ({ template }) },
  Tray: class {
    images: unknown[] = [];
    tooltips: string[] = [];
    constructor(imagePath: string) {
      state.trayInstances.push({ imageAtCreate: imagePath, images: this.images, tooltips: this.tooltips });
    }
    setImage(image: unknown) {
      this.images.push(image);
    }
    setToolTip(tooltip: string) {
      this.tooltips.push(tooltip);
    }
    setContextMenu() {}
    on() {}
  },
  nativeImage: {
    createFromPath: () => state.fakeBaseImage(),
    createFromBitmap: (buffer: Buffer, options: { width: number; height: number }) => {
      state.createFromBitmapCalls.push({ buffer, width: options.width, height: options.height });
      return { __composed: state.createFromBitmapCalls.length, buffer };
    },
  },
}));

describe("desktop tray unread badge", () => {
  beforeEach(() => {
    vi.resetModules();
    state.trayInstances.length = 0;
    state.createFromBitmapCalls.length = 0;
    state.resetBaseImageCounter();
  });

  async function loadModule() {
    return import("../src/main/desktopTray.js");
  }

  const trayOptions = {
    getLocale: () => "zh-CN" as const,
    showCurrentWindow: () => {},
    executeDesktopCommand: async () => {},
    quitApp: () => {},
    logger: { warn: vi.fn() },
  };

  function pixelOf(buffer: Buffer, x: number, y: number): number[] {
    const offset = (y * 32 + x) * 4;
    return [buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!, buffer[offset + 3]!];
  }

  it("没有托盘时 no-op 不抛错", async () => {
    const { applyDesktopTrayUnreadBadge } = await loadModule();

    expect(() => applyDesktopTrayUnreadBadge(3)).not.toThrow();
    expect(state.trayInstances).toHaveLength(0);
  });

  it("计数非零时在 Logo 圆角透明缺口合成红点，按 label 缓存", async () => {
    const mod = await loadModule();
    mod.createDesktopTray({ ...trayOptions, platform: "win32" });
    expect(state.trayInstances).toHaveLength(1);

    mod.applyDesktopTrayUnreadBadge(3);
    mod.applyDesktopTrayUnreadBadge(3);

    // 同一 label 只合成一次
    expect(state.createFromBitmapCalls).toHaveLength(1);
    // 创建时 + 两次换图
    const images = state.trayInstances[0]!.images;
    expect(images).toHaveLength(2);

    const { buffer } = state.createFromBitmapCalls[0]!;
    expect(state.createFromBitmapCalls[0]!).toMatchObject({ width: 32, height: 32 });
    expect(buffer.length).toBe(32 * 32 * 4);
    // 画布 32×32、Logo 满幅；红点 9×9（画布 10、radius 4）圆心 (28.5, 3.5)，
    // 嵌进 Logo 圆角的透明缺口，与图片上边缘、右边缘正切。
    expect(pixelOf(buffer, 26, 4)).toEqual([53, 57, 229, 255]);
    expect(pixelOf(buffer, 25, 3)).toEqual([53, 57, 229, 255]);
    // 正切：红点像素触达图片第 0 行（上边缘）与第 31 列（右边缘）
    expect(pixelOf(buffer, 28, 0)).toEqual([53, 57, 229, 255]);
    expect(pixelOf(buffer, 31, 3)).toEqual([53, 57, 229, 255]);
    // Logo 本体与远离红点的底图保持蓝色
    expect(pixelOf(buffer, 16, 16)).toEqual([200, 40, 10, 255]);
    expect(pixelOf(buffer, 22, 0)).toEqual([200, 40, 10, 255]);
    // 整图不应出现白色笔画像素
    let hasWhitePixel = false;
    for (let offset = 0; offset + 3 < buffer.length; offset += 4) {
      if (
        buffer[offset] === 255 &&
        buffer[offset + 1] === 255 &&
        buffer[offset + 2] === 255 &&
        buffer[offset + 3] === 255
      ) {
        hasWhitePixel = true;
        break;
      }
    }
    expect(hasWhitePixel).toBe(false);
  });

  it("计数归零时恢复原始托盘底图", async () => {
    const mod = await loadModule();
    mod.createDesktopTray({ ...trayOptions, platform: "win32" });

    mod.applyDesktopTrayUnreadBadge(3);
    mod.applyDesktopTrayUnreadBadge(0);

    const images = state.trayInstances[0]!.images;
    expect(images).toHaveLength(2);
    // 恢复的图就是 createFromPath 返回的底图对象本身
    expect(images[1]).toMatchObject({ __baseImage: 1 });
  });

  it("linux 平台托盘同样生效", async () => {
    const mod = await loadModule();
    mod.createDesktopTray({ ...trayOptions, platform: "linux" });

    mod.applyDesktopTrayUnreadBadge(1);

    expect(state.createFromBitmapCalls).toHaveLength(1);
  });
});

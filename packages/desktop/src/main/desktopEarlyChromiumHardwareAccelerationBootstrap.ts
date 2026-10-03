import { app } from "electron";
import { applyEarlyChromiumHardwareAccelerationBootstrap } from "./desktopChromiumHardwareAccelerationBootstrap.js";
import { getDesktopDataRootStartupResult } from "./desktopEarlyDataBaseDirBootstrap.js";

// 数据根 pending（他产品残留 / 存在旧根）时不得读取正式根的 setting.json：
// 那可能是其它产品遗留的配置，读取会把别人的偏好当成用户的。此阶段一律用默认值。
// 依赖顺序由 index.ts 的 import 顺序保证：early data root bootstrap 先于本模块求值。
const startupResult = getDesktopDataRootStartupResult();
applyEarlyChromiumHardwareAccelerationBootstrap(
  app,
  startupResult.state === "pending" ? {} : undefined,
);

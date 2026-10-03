import {
  applyEarlyDataBaseDirBootstrap,
  type DesktopDataRootStartupResult,
} from "./desktopDataBaseDirBootstrap.js";

/**
 * 启动早期数据根判定。必须在任何会写数据根的模块（logger / crashReporter / Host）之前
 * 执行；判定为 pending 时，数据根解析已重定向到进程诊断根，正式根保持零写入。
 */
const desktopDataRootStartupResult: DesktopDataRootStartupResult =
  applyEarlyDataBaseDirBootstrap();

export function getDesktopDataRootStartupResult(): DesktopDataRootStartupResult {
  return desktopDataRootStartupResult;
}

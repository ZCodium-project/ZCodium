/**
 * 数据根决策窗口的 renderer 入口。
 *
 * 独立于主窗口：不连接 services / Host，只通过专用 preload 与 main 交换决策状态。
 */
import { createRoot } from "react-dom/client";
import type { DataRootDecisionBridge } from "@zcode/shared";
import { DataRootDecisionApp } from "@zcode/ui";
import "@zcode/ui/styles.css";

// 决策窗口独立于主窗口，没有主题服务可用（此时设置尚未读取）。
// 跟随系统主题应用与主窗口一致的 zai 皮肤 class（system 模式：浅色 zai-light / 深色 dark+zai-dark），
// 避免系统深色时弹白窗，或皮肤变量缺失导致按钮对比度异常。
function applySystemTheme(): void {
  const root = document.documentElement;
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("dark", isDark);
  root.classList.toggle("theme-zai-dark", isDark);
  root.classList.toggle("theme-zai-light", !isDark);
}

applySystemTheme();
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applySystemTheme);

const container = document.getElementById("root");
const bridge = (window as Window & { zcodiumDataRootDecision?: DataRootDecisionBridge })
  .zcodiumDataRootDecision;

if (container) {
  const root = createRoot(container);
  if (bridge) {
    root.render(<DataRootDecisionApp bridge={bridge} />);
  } else {
    root.render(
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        Data root decision bridge unavailable.
      </div>,
    );
  }
}

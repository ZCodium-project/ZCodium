/**
 * 数据根决策窗口的 renderer 入口。
 *
 * 独立于主窗口：不连接 services / Host，只通过专用 preload 与 main 交换决策状态。
 */
import { createRoot } from "react-dom/client";
import type { DataRootDecisionBridge } from "@zcode/shared";
import { DataRootDecisionApp } from "@zcode/ui";
import "@zcode/ui/styles.css";

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

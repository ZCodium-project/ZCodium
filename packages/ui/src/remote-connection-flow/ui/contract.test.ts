import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildRemoteConnectionProgress } from "../progressProjection.js";
import { RemoteConnectionMinimizedProgress } from "./RemoteConnectionProgress.js";
// 根 Vitest 收集 managed contract.test.ts；UI 生命周期回归留在 UI 层，不倒置 app 依赖。
import "./progressContext.test.js";

const { buttons } = vi.hoisted(() => ({
  buttons: [] as Array<{ children?: ReactNode; onClick?: () => void }>,
}));
vi.mock("@/components/ui/button.js", () => ({
  Button: (props: { children?: ReactNode; onClick?: () => void }) => {
    buttons.push(props);
    return createElement("button", props);
  },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

describe("收起进度卡", () => {
  it("只显示真实输出，不伪造百分比，点击才恢复/取消", () => {
    buttons.length = 0;
    const source = {
      currentStep: "connecting" as const,
      loading: true,
      selectingDirectory: false,
      open: false,
      error: "",
      connectedSessionId: null,
      connectingRequestId: "original-request",
      pendingRemoteTarget: { kind: "ssh" as const, host: "example.test", username: "user" },
      connectionLogs: [
        { id: "1", level: "info" as const, timestamp: "10:00:00", message: "Actual upload log" },
      ],
      onResume: vi.fn(),
      onCancel: vi.fn(),
    };
    const progress = buildRemoteConnectionProgress(source)!;
    const html = renderToStaticMarkup(createElement(RemoteConnectionMinimizedProgress, progress));
    expect(html).toContain("Actual upload log");
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("%");
    expect(source.onResume).not.toHaveBeenCalled();
    expect(source.onCancel).not.toHaveBeenCalled();
    buttons[0]?.onClick?.();
    expect(source.onResume).toHaveBeenCalledOnce();
    buttons.at(-1)?.onClick?.();
    expect(source.onCancel).toHaveBeenCalledOnce();
  });
});

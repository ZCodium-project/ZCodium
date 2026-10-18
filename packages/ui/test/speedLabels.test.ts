import { describe, expect, it } from "vitest";

import { formatSpeedLabels, shouldStartSessionDebugPolling } from "@/v4/speedLabels.js";

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

describe("formatSpeedLabels", () => {
  it("有 prefill/decode 时返回两个标签", () => {
    const labels = formatSpeedLabels(
      { tokensPerSecond: 88.6, prefillTokensPerSecond: 1200.4 },
      numberFormat,
    );
    expect(labels.decodeLabel).toBe("88.6");
    expect(labels.prefillLabel).toBe("1,200.4");
  });

  it("prefill 为 null（全缓存直出/TTFT=0）时只显示 decode", () => {
    const labels = formatSpeedLabels(
      { tokensPerSecond: 88.6, prefillTokensPerSecond: null },
      numberFormat,
    );
    expect(labels.decodeLabel).toBe("88.6");
    expect(labels.prefillLabel).toBe(null);
  });

  it("无匹配轮（undefined）时两个标签都为 null", () => {
    const labels = formatSpeedLabels(undefined, numberFormat);
    expect(labels.decodeLabel).toBe(null);
    expect(labels.prefillLabel).toBe(null);
  });
});

describe("shouldStartSessionDebugPolling", () => {
  it("sessionId 与 workspacePath 齐全才启动", () => {
    expect(shouldStartSessionDebugPolling({ sessionId: "s", workspacePath: "/w" })).toBe(true);
  });

  it("workspacePath 缺席（缺陷 ② 回归：调用点未传 props 时轮询恒不启动）", () => {
    expect(shouldStartSessionDebugPolling({ sessionId: "s", workspacePath: undefined })).toBe(
      false,
    );
  });

  it("sessionId 缺席不启动", () => {
    expect(shouldStartSessionDebugPolling({ sessionId: null, workspacePath: "/w" })).toBe(false);
  });
});

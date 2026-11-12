import { describe, expect, it } from "vitest";
import {
  resolveQueuedSummaryPlaybackQueue,
  SUMMARY_ROLL_TOTAL_MS,
  shouldAnimateQueuedSummaryContent,
} from "@/ToolCallBlocks/QueuedSummaryContent.js";

describe("summary roll timing", () => {
  it("keeps each queued summary step under one second", () => {
    expect(SUMMARY_ROLL_TOTAL_MS).toBeLessThan(1000);
  });
});

describe("resolveQueuedSummaryPlaybackQueue", () => {
  it("keeps queued summaries when the timer fires on time", () => {
    expect(resolveQueuedSummaryPlaybackQueue(["read", "search"], 100)).toEqual(["read", "search"]);
  });

  it("skips stale queued summaries when the timer fires late", () => {
    // Bugfix: 主线程卡顿后不要补播过期摘要，否则用户会看到旧状态继续滚动。
    expect(resolveQueuedSummaryPlaybackQueue(["read", "search"], 300)).toEqual(["search"]);
  });
});

describe("shouldAnimateQueuedSummaryContent", () => {
  it("allows callers to disable summary animation explicitly", () => {
    expect(
      shouldAnimateQueuedSummaryContent({
        enabled: true,
        disableAnimation: true,
        reducedMotion: false,
      }),
    ).toBe(false);
  });

  it("keeps animation enabled when no disable switch is set", () => {
    expect(
      shouldAnimateQueuedSummaryContent({
        enabled: true,
        reducedMotion: false,
      }),
    ).toBe(true);
  });
});

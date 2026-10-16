import type { SessionDebugSnapshot } from "@zcode/shared";

// 只依赖标签计算实际读取的两个字段：逻辑测试可直接构造字面量，
// 组件传入完整轮次对象亦天然兼容。
type ProducingRound = Pick<
  SessionDebugSnapshot["rounds"][number],
  "tokensPerSecond" | "prefillTokensPerSecond"
>;

export interface SpeedLabels {
  /** decode 吞吐（tokens/s）；无数据时 null（不渲染节点）。 */
  decodeLabel: string | null;
  /** prefill 吞吐（tokens/s）；TTFT=0（全缓存直出或未知）时 null——只显示 ↓ 是预期行为。 */
  prefillLabel: string | null;
}

export function formatSpeedLabels(
  round: ProducingRound | undefined,
  numberFormat: Intl.NumberFormat,
): SpeedLabels {
  const decodeLabel =
    round?.tokensPerSecond === null || round?.tokensPerSecond === undefined
      ? null
      : numberFormat.format(round.tokensPerSecond);
  const prefillLabel =
    round?.prefillTokensPerSecond === null || round?.prefillTokensPerSecond === undefined
      ? null
      : numberFormat.format(round.prefillTokensPerSecond);
  return { decodeLabel, prefillLabel };
}

/**
 * 轮询启动守卫（缺陷 ② 的回归面）：taskId 或 workspacePath 任一缺席即不启动——
 * 调用点未传 workspacePath 曾导致轮询恒不启动、速度展示从未生效（上游 PR #40 review 同源发现）。
 */
export function shouldStartSessionDebugPolling(params: {
  sessionId: string | null | undefined;
  workspacePath: string | null | undefined;
}): boolean {
  return Boolean(params.sessionId) && Boolean(params.workspacePath);
}

// 终态出站的 stream 归属回归。见 .agents/specs/bots-astrbot-bridge.md「终态出站顺序」。
//
// 回归背景：notifyTaskLifecycle 的终态分支在 provider 侧同时做「发 status 终止符」和
// 「删除任务流」两件事，而 BotsService 曾在终态分支「开头」就调用它。于是后面的失败原因、
// 变更摘要、「任务已完成。」以及 transient card 收尾全部查不到 stream，落到 idFactory()
// 的新流上——客户端看到若干从未被 accepted 预告的 stream，且 status 之后还有 delivery。
//
// 修复：把终态收口移到 BotsService 终态分支的 finally，使其晚于该分支全部出站。
//
// 为什么不写成行为测试：终态出站位于 createBotsService 内部的 handleStreamEvent 闭包中，
// 需要整套 services / context / stream 订阅才能驱动，单测成本远高于收益。因此这里以
// 源码契约的方式钉住不变量——把 notifyTaskLifecycle 移出 finally 即会失败：
//   1. 终态调用点必须位于 finally 块中（晚于该分支全部出站）；
//   2. status 必须是该 binding 的最后一条帧（由 provider 侧契约测试钉住）。

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../src/bots/botsService.ts", import.meta.url), "utf8").catch(
  () => null,
);

test(
  "终态 notifyTaskLifecycle 位于终态分支的 finally 中",
  { skip: !source && "无法读取源码" },
  () => {
    if (!source) return;
    const lines = source.split("\n");
    const start = lines.findIndex((line) =>
      line.includes('event.type === "task_complete" || event.type === "task_error"'),
    );
    assert.ok(start >= 0, "未找到终态事件分支");

    // 从分支起点向后找第一个属于该分支的 finally（缩进与分支同级）。
    // 分支体在 if 的下一层；其 } finally { 与该体同级。
    const branchIndent = lines[start].search(/\S/);
    const bodyIndent = branchIndent + 2;
    let finallyIndex = -1;
    for (let i = start + 1; i < lines.length; i += 1) {
      // 空行的 search 返回 -1，不能当作离开分支，需跳过。
      const indent = lines[i].trim() === "" ? bodyIndent : lines[i].search(/\S/);
      if (indent <= branchIndent) break; // 碰到 if 自身的闭合括号，离开分支
      if (indent === bodyIndent && lines[i].trim() === "} finally {") {
        finallyIndex = i;
        break;
      }
    }
    assert.ok(finallyIndex >= 0, "终态分支中未找到 finally 块");

    // finally 体内必须调用 notifyTaskLifecycle，且带上 terminalPhase。
    let notified = false;
    for (let i = finallyIndex + 1; i < lines.length; i += 1) {
      const indent = lines[i].search(/\S/);
      if (indent <= branchIndent) break;
      if (lines[i].includes("notifyTaskLifecycle?.(bot, actor, terminalPhase)")) notified = true;
    }
    assert.ok(notified, "finally 中未调用 notifyTaskLifecycle(bot, actor, terminalPhase)");

    // 该调用必须出现在 try 体内所有出站（sendOutbound / finalizeTransientInteractionCard）之后。
    const tryIndex = lines.findIndex((line, i) => i > start && line.trim() === "try {");
    assert.ok(tryIndex >= 0 && tryIndex < finallyIndex, "finally 之前未找到 try 块");
    const lastOutboundBeforeFinally = Math.max(
      ...lines
        .slice(tryIndex, finallyIndex)
        .map((line, i) => (line.includes("sendOutbound(") ? i : -1)),
    );
    assert.ok(
      lastOutboundBeforeFinally >= 0,
      "try 体内未找到出站调用；终态文案可能已不在 finally 之前发出",
    );
  },
);

// 恢复路径的源码契约：权限/问答应答成功后必须重新通知 started。
// 这两处调用把「应答命令」的轮次流提升为任务流，并让 startedTask 阻止 host 在命令
// 结束时提前 settle 收口（见 astrbotProvider 的 settleTurn / notifyTaskLifecycle）。
// 历史：这两处曾随终态收口重构一起被误删，任务恢复后的出站会回到 awaiting_input
// 的旧流而不是应答轮次。
test("权限/问答应答恢复路径保留 started 通知", { skip: !source && "无法读取源码" }, () => {
  if (!source) return;

  // elicitation accept 分支内：started 必须在返回问答结果之前。
  assert.match(
    source,
    /if \(action === "accept"\) \{[\s\S]*?notifyTaskLifecycle\?\.\(auth\.bot, actor, "started"\)[\s\S]*?return \[createCompletedElicitationOutbound/,
    "elicitation accept 分支必须通知 started（否则恢复出站失去 stream 归属）",
  );

  // permission.respond 成功出站（permissionSubmitted）之前：started 必须在。
  assert.match(
    source,
    /startTyping\(auth\.bot, message\.actor, auth\.context\.activeTaskId\);[\s\S]*?notifyTaskLifecycle\?\.\(auth\.bot, message\.actor, "started"\)[\s\S]*?"permissionDenied" : "permissionSubmitted"/,
    "permission.respond 成功后必须通知 started（否则恢复出站失去 stream 归属）",
  );
});

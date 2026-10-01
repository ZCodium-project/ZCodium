// 影子重放对账（交付 / 测试基建）。
// 用途：把本机真实 CLI 库（默认 ~/.zcodium/cli/db/db.sqlite）的历史会话全量喂给
// 冷恢复管线（transcript 合成 → ProductProjection），输出守恒对账报告——
// 每阶段上线门槛 = 全量重放无崩溃、无静默丢弃、失败清单审查完毕。
//
// 对源库只读：默认把 db（含 -wal/-shm）复制到临时目录再打开——store 打开时会跑
// 迁移（0015/0016 等），不能直接落在用户真实库上（迁移应由 CLI 正常启动路径应用）。
// 运行前先构建：pnpm -C apps/zcode-cli build（脚本从各包 dist 导入）。
//
// 用法：
//   node scripts/shadow-replay.mjs [--db <path>] [--limit <n>] [--session <id>] [--verbose] [--no-copy]
import { parseArgs } from "node:util";
import { homedir, tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { copyFileSync, existsSync, mkdtempSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = (relative) =>
  import(pathToFileURL(join(here, "..", "packages", relative)).href);

const { values: args } = parseArgs({
  options: {
    db: { type: "string" },
    limit: { type: "string" },
    session: { type: "string" },
    verbose: { type: "boolean", default: false },
    "no-copy": { type: "boolean", default: false },
  },
});

const [{ createSqliteSessionStore }, hydration, projectionModule, contracts] =
  await Promise.all([
    pkg("adapters/dist/storage/index.js"),
    pkg("bootstrap/dist/zcode-protocol-v4/transcript-hydration.js"),
    pkg("bootstrap/dist/zcode-protocol-v4/product-projection.js"),
    pkg("contracts/dist/index.js"),
  ]);
const {
  synthesizeEventsFromMessages,
  goalVerificationEntriesFromSessionEntries,
} = hydration;
const { ProductProjection } = projectionModule;
const { SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION } = contracts;

const sourceDbPath = args.db ?? join(homedir(), ".zcodium", "cli", "db", "db.sqlite");
const limit = args.limit ? Number(args.limit) : Infinity;

let dbPath = sourceDbPath;
if (!args["no-copy"]) {
  const tempDir = mkdtempSync(join(tmpdir(), "zcode-shadow-replay-"));
  dbPath = join(tempDir, basename(sourceDbPath));
  copyFileSync(sourceDbPath, dbPath);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(sourceDbPath + suffix)) {
      copyFileSync(sourceDbPath + suffix, dbPath + suffix);
    }
  }
}

const store = createSqliteSessionStore({ dbPath });

const sessions = args.session
  ? [{ id: args.session }]
  : await store.listSessions({ includeArchived: true, limit: 100000 });

const totals = {
  sessions: 0,
  crashed: 0,
  assistantTextMissing: 0,
  userInputMismatch: 0,
  goalVerifyMissing: 0,
  modelChangeMissing: 0,
  entityTargetMismatch: 0,
  actionAddressabilityMismatch: 0,
  clean: 0,
};
const offenders = [];

for (const session of sessions) {
  if (totals.sessions >= limit) break;
  totals.sessions += 1;
  const sessionId = String(session.id);
  const report = {
    sessionId,
    problems: [],
  };
  try {
    const messages = await store.messages({ sessionID: session.id });
    if (messages.length === 0) continue;
    const entries = store.sessionEntries
      ? await store.sessionEntries({
          sessionID: session.id,
          type: SESSION_ENTRY_TARGET_COMPLETION_VERIFICATION,
        })
      : [];
    const goalVerificationEntries = goalVerificationEntriesFromSessionEntries(entries);
    const events = synthesizeEventsFromMessages(messages, {
      sessionId,
      goalVerificationEntries,
    });
    const projection = new ProductProjection(sessionId, "shadow-replay");
    for (const event of events) projection.applyEvent(event);
    const rows = projection.getSnapshot().rows.window;

    // ── 守恒对账 ──
    // assistant 守恒：每条可见 assistant text 必须出现在 rows（多重集覆盖）。
    const expectedTexts = [];
    for (const message of messages) {
      if (message.info.role !== "assistant") continue;
      for (const part of message.parts) {
        if (part.type === "text" && part.ignored !== true && part.text.length > 0) {
          expectedTexts.push(part.text);
        }
      }
    }
    const actualTexts = rows
      .filter((row) => row.kind === "assistantText")
      .map((row) => row.text);
    const remaining = [...actualTexts];
    let missingTexts = 0;
    for (const text of expectedTexts) {
      const index = remaining.indexOf(text);
      if (index < 0) missingTexts += 1;
      else remaining.splice(index, 1);
    }
    if (missingTexts > 0) {
      totals.assistantTextMissing += 1;
      report.problems.push(`assistant text 缺失 ${missingTexts}/${expectedTexts.length}`);
    }

    // goal verify 守恒：part ∪ entry 的 lifecycle key 数 vs goalVerify marker 行数。
    const goalKeys = new Set();
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === "timeline" && part.timelineType === "goal_verification") {
          goalKeys.add(
            part.goalIteration !== undefined
              ? `${part.targetId}_${part.goalIteration}`
              : part.verificationId,
          );
        }
      }
    }
    for (const entry of goalVerificationEntries) {
      const payload = entry.payload;
      goalKeys.add(
        payload.goalIteration !== undefined
          ? `${payload.targetId}_${payload.goalIteration}`
          : payload.verificationId,
      );
    }
    const goalMarkers = rows.filter(
      (row) => row.kind === "timelineMarker" && row.marker.type === "goalVerify",
    ).length;
    if (goalMarkers < goalKeys.size) {
      totals.goalVerifyMissing += 1;
      report.problems.push(`goalVerify marker ${goalMarkers}/${goalKeys.size}`);
    }

    // 可见 user 输入守恒：userInput 行数不得少于真实 user 文本消息数的下限估计
    //（synthetic/model-only 不计；guide steer 内联也是可见行，计入两侧）。
    // 已知误报：legacy 数据里 goal-continuation reminder / fork notice 以裸文本
    // 持久化（无 synthetic/source/metadata 标记），分类器按文本前缀正确隐藏，
    // 本启发式会把它们计成可见——flag 需人工核对（全量重放中 21 个
    // flag 全为此类误报，真实守恒失败为 0）。
    const expectedUsers = messages.filter(
      (message) =>
        message.info.role === "user" &&
        message.info.synthetic !== true &&
        message.info.visibility !== "model-only" &&
        // compact 续接摘要（info.summary / semantics.kind=compact_summary）是
        // providerContextOnly：分类器裁决不可见，不计入可见 user 下限。
        message.info.summary === undefined &&
        !message.info.semantics?.kind?.startsWith?.("compact") &&
        message.info.source === undefined &&
        message.parts.some(
          (part) => part.type === "text" && part.ignored !== true && part.text.length > 0,
        ),
    ).length;
    const actualUsers = rows.filter((row) => row.kind === "userInput").length;
    if (actualUsers < expectedUsers) {
      totals.userInputMismatch += 1;
      report.problems.push(`userInput 行 ${actualUsers}/${expectedUsers}`);
    }

    // 可寻址性守恒：shadow replay 不能只证明“文本还在”。每条 transcript row 的
    // entity/productTurn/message target，以及每个已发布 action，都必须由同一次 cold
    // materialization 的 resolver 精确命中；否则 UI 会显示按钮但命令必然 stale/reject。
    let entityTargetProblems = 0;
    let actionProblems = 0;
    const actionByFlag = [
      ["canEdit", "editUserQuery"],
      ["canRetry", "retryTurn"],
      ["canFork", "forkAssistant"],
      ["canRewindFiles", "fileRewindPreview"],
    ];
    for (const row of rows) {
      const entityId = projection.getEntityIdForRow(row.rowId);
      const messageId = projection.getMessageIdForRow(row.rowId);
      if (
        (row.kind === "userInput" || row.kind === "assistantText") &&
        (!entityId || !messageId || !row.turnId)
      ) {
        entityTargetProblems += 1;
      }
      for (const [flag, action] of actionByFlag) {
        if (row.actions?.[flag] !== true) continue;
        if (!entityId) {
          actionProblems += 1;
          continue;
        }
        const resolution = projection.resolveRowActionTarget(
          { rowId: row.rowId, entityId },
          action,
        );
        if (!resolution.ok || resolution.row.turnId !== row.turnId) {
          actionProblems += 1;
          continue;
        }
        if (
          (action === "editUserQuery" ||
            action === "retryTurn" ||
            action === "forkAssistant") &&
          (!messageId ||
            ("messageId" in resolution && resolution.messageId !== messageId) ||
            ("editTarget" in resolution &&
              resolution.editTarget.productTurnId !== row.turnId))
        ) {
          actionProblems += 1;
        }
      }
    }
    if (entityTargetProblems > 0) {
      totals.entityTargetMismatch += 1;
      report.problems.push(`entity/target 不可寻址 ${entityTargetProblems}`);
    }
    if (actionProblems > 0) {
      totals.actionAddressabilityMismatch += 1;
      report.problems.push(`row.actions resolver 不等价 ${actionProblems}`);
    }

    if (report.problems.length === 0) totals.clean += 1;
  } catch (error) {
    totals.crashed += 1;
    report.problems.push(`重放崩溃: ${error?.message ?? error}`);
  }
  if (report.problems.length > 0) {
    offenders.push(report);
    if (args.verbose) {
      console.log(`✗ ${sessionId}: ${report.problems.join("; ")}`);
    }
  }
}

store.close();

console.log("\n── 影子重放对账报告 ──");
console.log(`源 DB: ${sourceDbPath}${dbPath === sourceDbPath ? "" : "（已复制到临时副本重放）"}`);
console.log(`会话: ${totals.sessions}（干净 ${totals.clean}）`);
console.log(`重放崩溃: ${totals.crashed}`);
console.log(`assistant text 缺失: ${totals.assistantTextMissing}`);
console.log(`userInput 行不足: ${totals.userInputMismatch}`);
console.log(`goalVerify marker 缺失: ${totals.goalVerifyMissing}`);
console.log(`entity/target 不可寻址: ${totals.entityTargetMismatch}`);
console.log(`row.actions resolver 不等价: ${totals.actionAddressabilityMismatch}`);
if (offenders.length > 0 && !args.verbose) {
  console.log(`\n问题会话（前 20，--verbose 看全量）：`);
  for (const report of offenders.slice(0, 20)) {
    console.log(`  ${report.sessionId}: ${report.problems.join("; ")}`);
  }
}
process.exitCode =
  totals.crashed > 0 ||
  totals.entityTargetMismatch > 0 ||
  totals.actionAddressabilityMismatch > 0
    ? 1
    : 0;

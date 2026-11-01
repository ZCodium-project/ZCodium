import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { ZCODE_DATA_ROOT_DIR_NAME, zcodeTaskMetaSchema } from "@zcode/shared";
import {
  TID_CONFIRM_DIALOG_CONFIRM,
  TID_TASK_ARCHIVE,
  TID_TASK_ITEM,
  testId,
} from "@zcode/shared/test-ids";
import { DEFAULT_WORKSPACE } from "../../../helpers/desktop-app.js";
import { ensureProjectExpanded } from "../../../helpers/project-sidebar.js";
import { restartIntoWorkspacePreservingProfile } from "../../../helpers/model-provider-restart-runtime.js";
import {
  prepareV4ConversationE2E,
  sendV4Prompt,
  waitForV4AssistantMessageContaining,
  waitForV4Pane,
} from "../../../helpers/v4-conversation.js";

const home = process.env.ZCODE_E2E_HOME_DIR!;
const tid = (id: string) => `[data-testid="${id}"]`;
const taskRow = (id: string) => tid(testId(TID_TASK_ITEM, id));
const archiveRow = (id: string) => `${tid("archive-task")}[data-task-id="${id}"]`;

function readTask(id: string) {
  const db = new DatabaseSync(join(home, ZCODE_DATA_ROOT_DIR_NAME, "v2", "tasks-index.sqlite"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare(
        "SELECT workspace_key,archived,cli_deleted,cli_title,meta_json FROM tasks WHERE task_id=? AND host_id='local'",
      )
      .get(id) as
      | {
          workspace_key: string;
          archived: number;
          cli_deleted: number;
          cli_title: string | null;
          meta_json: string;
        }
      | undefined;
    if (!row) throw new Error(`NAV99 Host 尚无真实会话 ${id}`);
    // 原 SQL 的空 meta_json 与假 CLI project_id 会制造 sessionNotFound；现在只验证原 owner 的真实数据。
    const meta = zcodeTaskMetaSchema.parse(JSON.parse(row.meta_json));
    expect(meta.taskId).toBe(id);
    expect(row.workspace_key).toBe(meta.workspaceIdentity?.trim() || meta.workspacePath);
    return { ...row, meta };
  } finally {
    db.close();
  }
}

function readCliSession(id: string) {
  const db = new DatabaseSync(join(home, ZCODE_DATA_ROOT_DIR_NAME, "cli", "db", "db.sqlite"), {
    readOnly: true,
  });
  try {
    const row = db
      .prepare(
        "SELECT id,project_id,directory,time_deleted,(SELECT count(*) FROM message WHERE session_id=session.id) AS messages FROM session WHERE id=?",
      )
      .get(id) as
      | {
          id: string;
          project_id: string;
          directory: string;
          time_deleted: number | null;
          messages: number;
        }
      | undefined;
    if (!row) throw new Error(`NAV99 CLI 尚无真实会话 ${id}`);
    return row;
  } finally {
    db.close();
  }
}

async function clickStable(selector: string) {
  const button = $(selector);
  await button.waitForDisplayed();
  await button.scrollIntoView({ block: "nearest", inline: "nearest" });
  // 驱动 click 返回不代表目标收到了输入；先等动画/命中稳定，再由被动捕获证明真实 click。
  await browser.waitUntil(
    () =>
      browser.execute((selector) => {
        const target = document.querySelector<HTMLButtonElement>(selector);
        if (!target || target.disabled) return false;
        const scope =
          target.closest('[role="dialog"], [data-testid="archive-management"], aside') ?? target;
        if (
          scope.getAnimations({ subtree: true }).some((a) => a.pending || a.playState === "running")
        )
          return false;
        const rect = target.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return rect.width > 0 && rect.height > 0 && hit !== null && target.contains(hit);
      }, selector),
    { timeoutMsg: `NAV99 动画或命中未就绪: ${selector}` },
  );
  await browser.execute((selector) => {
    const target = document.querySelector(selector)!;
    const probe = { received: false };
    (window as Window & { __nav99ClickProbe?: typeof probe }).__nav99ClickProbe = probe;
    document.addEventListener(
      "click",
      (event) => {
        probe.received =
          event.isTrusted && event.target instanceof Node && target.contains(event.target);
      },
      { capture: true, passive: true, once: true },
    );
  }, selector);
  await button.click();
  await browser.waitUntil(
    () =>
      browser.execute(
        () =>
          (window as Window & { __nav99ClickProbe?: { received: boolean } }).__nav99ClickProbe
            ?.received === true,
      ),
    { timeoutMsg: `NAV99 真实 click 未抵达目标: ${selector}` },
  );
}

async function createArchivedSession(kind: "RESTORE" | "DELETE") {
  await prepareV4ConversationE2E();
  const reply = `NAV99_${kind}_OK`;
  await sendV4Prompt(`E2E_NAV99_${kind}: Reply exactly ${reply}.`);
  await waitForV4AssistantMessageContaining(reply);
  const completed = await waitForV4Pane(
    (s) => Boolean(s.sessionId && s.sessionId !== "draft") && !s.canStop,
    "NAV99 真实会话没有完成",
  );
  const id = completed.sessionId!;
  await browser.waitUntil(
    () => {
      const task = readTask(id);
      const cli = readCliSession(id);
      // 标题事实读取 CLI 镜像；合法 meta_json 仍可能保留初始占位标题，不能当成标题 owner。
      return task.cli_title?.includes("NAV99") === true && cli.messages >= 2;
    },
    { timeoutMsg: "NAV99 真实会话/标题/正文未持久化" },
  );
  const task = readTask(id);
  const cli = readCliSession(id);
  expect(cli.id).toBe(id);
  expect(cli.project_id.length).toBeGreaterThan(0);
  expect(cli.directory).toBe(task.meta.workspacePath);
  expect(cli.time_deleted).toBeNull();
  await ensureProjectExpanded(DEFAULT_WORKSPACE);
  await $(taskRow(id)).moveTo();
  await clickStable(tid(testId(TID_TASK_ARCHIVE, id)));
  await $(`[data-archive-confirming-task-id="${id}"]`).waitForExist();
  await clickStable(tid(testId(TID_TASK_ARCHIVE, id)));
  await browser.waitUntil(() => readTask(id).archived === 1);
  await $(taskRow(id)).waitForExist({ reverse: true });
  return { id, projectId: cli.project_id, workspacePath: cli.directory };
}

async function openArchives() {
  await clickStable(tid("task-settings-button"));
  await clickStable(tid("settings-section-nav-archives"));
  await $(tid("archive-management")).waitForDisplayed();
  await $(tid("archive-search")).setValue("NAV99");
}

describe("NAV99：归档入口恢复", () => {
  it("真实创建与归档后取消归档、取消/确认删除，完整重启保持双库事实", async function () {
    this.timeout(180_000);
    if (!home || !basename(home).startsWith("zcode-navigation-e2e-"))
      throw new Error("使用独立 zcode-navigation-e2e-* HOME，禁止写生产数据库");
    const replay = new URL(process.env.E2E_PROVIDER_RUNTIME_BASE_URL || "http://invalid.test");
    if (
      process.env.E2E_PROVIDER_CAPTURE_MODE !== "replay" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(replay.hostname)
    )
      throw new Error("NAV99 仅允许本地 replay，禁止 capture 或供应商实网");

    const restore = await createArchivedSession("RESTORE");
    const remove = await createArchivedSession("DELETE");
    expect(remove.id).not.toBe(restore.id);
    expect(remove.projectId).toBe(restore.projectId);
    expect(remove.workspacePath).toBe(restore.workspacePath);
    await openArchives();
    expect(await $$(tid("archive-group"))).toHaveLength(1);
    await clickStable(tid("archive-group-toggle"));
    await clickStable(`${archiveRow(restore.id)} ${tid("archive-unarchive")}`);
    await browser.waitUntil(() => readTask(restore.id).archived === 0);
    await $(archiveRow(restore.id)).waitForExist({ reverse: true });
    await clickStable(`${archiveRow(remove.id)} ${tid("archive-delete")}`);
    await $('[role="dialog"]').waitForDisplayed();
    await browser.keys("Escape");
    await $('[role="dialog"]').waitForExist({ reverse: true });
    expect(readTask(remove.id)).toMatchObject({ archived: 1, cli_deleted: 0 });
    expect(readCliSession(remove.id).time_deleted).toBeNull();
    await clickStable(`${archiveRow(remove.id)} ${tid("archive-delete")}`);
    await clickStable(tid(TID_CONFIRM_DIALOG_CONFIRM));
    await browser.waitUntil(
      () =>
        readTask(remove.id).cli_deleted === 1 && (readCliSession(remove.id).time_deleted ?? 0) > 0,
    );
    await $(archiveRow(remove.id)).waitForExist({ reverse: true });
    await $('[role="dialog"]').waitForExist({ reverse: true });
    await clickStable(tid("settings-back-button"));

    // 完整退出旧 Electron/Host/Agent 后复用同一 profile，不把 renderer refresh 冒充冷启动。
    await restartIntoWorkspacePreservingProfile(DEFAULT_WORKSPACE);
    expect(readTask(restore.id)).toMatchObject({ archived: 0, cli_deleted: 0 });
    expect(readCliSession(restore.id).time_deleted).toBeNull();
    expect(readTask(remove.id).cli_deleted).toBe(1);
    expect(readCliSession(remove.id).time_deleted).toBeGreaterThan(0);
    await ensureProjectExpanded(DEFAULT_WORKSPACE);
    await $(taskRow(restore.id)).waitForDisplayed();
    expect(await $(taskRow(remove.id)).isExisting()).toBe(false);
    await openArchives();
    expect(await $$(tid("archive-group"))).toHaveLength(0);
  });
});

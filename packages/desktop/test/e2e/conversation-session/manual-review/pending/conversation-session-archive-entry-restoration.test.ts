import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { TID_CONFIRM_DIALOG_CONFIRM } from "@zcode/shared/test-ids";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../../../helpers/desktop-app.js";

const home = process.env.ZCODE_E2E_HOME_DIR!;
const ids = ["nav99-restore", "nav99-delete"];
function readTask(id: string) {
  const db = new DatabaseSync(join(home, ".zcode/v2/tasks-index.sqlite"), { readOnly: true });
  try {
    return db.prepare("SELECT archived,cli_deleted FROM tasks WHERE task_id=?").get(id) as {
      archived: number;
      cli_deleted: number;
    };
  } finally {
    db.close();
  }
}
async function openArchives() {
  await $('[data-testid="task-settings-button"]').click();
  await $('[data-testid="settings-section-nav-archives"]').click();
  await $('[data-testid="archive-management"]').waitForDisplayed();
}

describe("NAV99：归档入口恢复", () => {
  it("真实设置入口可查阅、取消归档、确认删除，重载不复活", async function () {
    this.timeout(90_000);
    if (!home || !basename(home).startsWith("zcode-navigation-e2e-"))
      throw new Error("使用独立 zcode-navigation-e2e-* HOME，禁止写生产数据库");
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    const db = new DatabaseSync(join(home, ".zcode/v2/tasks-index.sqlite"));
    const cli = new DatabaseSync(join(home, ".zcode/cli/db/db.sqlite"));
    try {
      for (const id of ids) {
        cli
          .prepare(
            "INSERT INTO session(id,project_id,slug,directory,title,version,time_created,time_updated,title_source,last_outcome) VALUES(?,?,?,?,?,'1',1,2,'custom','completed')",
          )
          .run(id, "nav99-cli", id, DEFAULT_WORKSPACE, id);
        db.prepare(
          "INSERT INTO tasks(workspace_key,workspace_path,task_id,title,provider,created_at,updated_at,host_id,root_path,project_id,archived,cli_title,cli_title_source,cli_created_at,cli_updated_at,cli_last_outcome,cli_deleted) VALUES(?,?,?,?,'glm',1,2,'local',?,NULL,1,?,'custom',1,2,'completed',0)",
        ).run(DEFAULT_WORKSPACE, DEFAULT_WORKSPACE, id, id, DEFAULT_WORKSPACE, id);
      }
    } finally {
      db.close();
      cli.close();
    }
    await browser.refresh();
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await openArchives();
    await $('[data-testid="archive-search"]').setValue("nav99-");
    await $('[data-testid="archive-group-toggle"]').click();
    const restore = $('[data-testid="archive-task"][data-task-id="nav99-restore"]');
    const remove = $('[data-testid="archive-task"][data-task-id="nav99-delete"]');
    await restore.$('[data-testid="archive-unarchive"]').click();
    await browser.waitUntil(() => readTask(ids[0]!).archived === 0);
    await restore.waitForExist({ reverse: true });
    await remove.$('[data-testid="archive-delete"]').click();
    await $('[role="dialog"]').waitForDisplayed();
    await browser.keys("Escape");
    await $('[role="dialog"]').waitForExist({ reverse: true });
    expect(readTask(ids[1]!)).toEqual({ archived: 1, cli_deleted: 0 });
    await remove.$('[data-testid="archive-delete"]').click();
    await $(`[data-testid="${TID_CONFIRM_DIALOG_CONFIRM}"]`).click();
    await browser.waitUntil(() => readTask(ids[1]!).cli_deleted === 1);
    await remove.waitForExist({ reverse: true });
    await browser.refresh();
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    expect(readTask(ids[0]!)).toEqual({ archived: 0, cli_deleted: 0 });
    expect(readTask(ids[1]!).cli_deleted).toBe(1);
    await openArchives();
    await $('[data-testid="archive-search"]').setValue("nav99-");
    expect(await $$('[data-testid="archive-task"]').length).toBe(0);
    const cliCheck = new DatabaseSync(join(home, ".zcode/cli/db/db.sqlite"), { readOnly: true });
    try {
      expect(
        cliCheck.prepare("SELECT time_deleted FROM session WHERE id=?").get(ids[1]!)?.time_deleted,
      ).toBeGreaterThan(0);
    } finally {
      cliCheck.close();
    }
  });
});

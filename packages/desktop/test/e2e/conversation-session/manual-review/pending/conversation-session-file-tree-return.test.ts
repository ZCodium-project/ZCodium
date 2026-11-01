import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { ZCODE_DATA_ROOT_DIR_NAME } from "@zcode/shared";
import { DEFAULT_WORKSPACE, waitForWorkspaceApp } from "../../../helpers/desktop-app.js";

describe("NAV104：项目文件树返回", () => {
  it("返回按钮不被标题栏覆盖，鼠标与键盘返回保持项目展开态", async function () {
    this.timeout(90_000);
    const home = process.env.ZCODE_E2E_HOME_DIR;
    if (!home || !basename(home).startsWith("zcode-navigation-e2e-"))
      throw new Error("使用独立 zcode-navigation-e2e-* HOME，禁止写生产数据库");
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    await writeFile(join(DEFAULT_WORKSPACE, "NAV104-fixture.txt"), "navigation fixture");
    // 使用 release 的共享数据根，不在旧 helper 指向的 .zcode 下创建无效 fixture。
    const db = new DatabaseSync(join(home, ZCODE_DATA_ROOT_DIR_NAME, "v2", "tasks-index.sqlite"));
    try {
      db.prepare(
        "INSERT INTO projects(project_id,host_id,name,position,deleted,created_at,updated_at) VALUES('nav104-project','local','NAV104',0,0,1,1)",
      ).run();
      db.prepare(
        "INSERT INTO project_roots(project_id,root_path,position,is_primary) VALUES('nav104-project',?,0,1)",
      ).run(DEFAULT_WORKSPACE);
    } finally {
      db.close();
    }
    await browser.refresh();
    await waitForWorkspaceApp(DEFAULT_WORKSPACE, 45_000);
    const project = $('[data-project-name="NAV104"]');
    const row = project.$('[data-testid="virtual-project-row"]');
    const toggle = row.$('[data-testid="virtual-project-toggle"]');
    await row.waitForDisplayed();
    const nextExpanded = String((await toggle.getAttribute("aria-expanded")) !== "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", nextExpanded);

    for (const keyboard of [false, true]) {
      await row.moveTo();
      await row.$('[data-testid="virtual-project-files"]').click();
      const panel = $('[data-testid="workspace-file-tree-panel"]');
      const back = $('[data-testid="workspace-file-tree-back"]');
      await panel.waitForDisplayed();
      await browser.waitUntil(async () => (await panel.getText()).includes("NAV104-fixture.txt"));
      const hitTest = await browser.execute(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="workspace-file-tree-back"]',
        )!;
        const rect = button.getBoundingClientRect();
        const header = document
          .querySelector('[data-testid="sidebar-file-tree-titlebar"]')!
          .getBoundingClientRect();
        return {
          belowTitlebar: rect.top >= header.bottom,
          hits: [0.25, 0.5, 0.75].map(
            (ratio) =>
              document
                .elementFromPoint(rect.left + rect.width * ratio, rect.top + rect.height / 2)
                ?.closest("button") === button,
          ),
        };
      });
      expect(hitTest).toEqual({ belowTitlebar: true, hits: [true, true, true] });
      if (keyboard) {
        await browser.execute(() =>
          document
            .querySelector<HTMLButtonElement>('[data-testid="workspace-file-tree-back"]')!
            .focus(),
        );
        await browser.keys("Enter");
      } else {
        await browser.saveScreenshot(
          join(process.env.ZCODE_E2E_ARTIFACT_DIR!, "NAV104-return-hit-target.png"),
        );
        await back.click();
      }
      await panel.waitForExist({ reverse: true });
      await expect(toggle).toHaveAttribute("aria-expanded", nextExpanded);
    }
  });
});

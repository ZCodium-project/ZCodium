import { waitForDefaultWorkspaceReady } from "./helpers/desktop-app.js";

describe("#68 远端运行时来源与离线导入", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
  });

  it("SSH 向导提供明确的仅离线选择", async () => {
    await waitForDefaultWorkspaceReady();
    // 审计版入口是项目添加菜单，不依赖未同步的上游 virtual-project/remoteDevices 设置页。
    const add = $('[data-testid="project-add"]');
    await add.moveTo();
    await add.click();
    await $(
      '//*[@role="menuitem"][normalize-space(.)="远程连接" or normalize-space(.)="Remote connection"]',
    ).click();
    await $('[data-testid="remote-kind-ssh"]').waitForDisplayed();
    await $('[data-testid="remote-kind-ssh"]').click();
    await $(
      '//*[@data-testid="ssh-dialog"]//button[normalize-space(.)="下一步" or normalize-space(.)="Next"]',
    ).click();
    await $('[data-testid="remote-runtime-assets"]').waitForExist();
    const mode = $('[data-testid="remote-runtime-mode"]');
    await mode.scrollIntoView();
    await mode.click();
    await $('//*[@role="option"][contains(., "仅离线") or contains(., "Offline only")]').click();
    await expect(mode).toHaveText(/仅离线|Offline only/);
    await expect($('[data-testid="remote-runtime-mirror"]')).not.toExist();
  });

  const importCase = process.env.ZCODIUM_E2E_OFFLINE_RUNTIME_DIR ? it : it.skip;
  importCase("选择目录后真实 Host 校验导入，并切为仅离线", async () => {
    const picker = await browser.electron.mock("dialog", "showOpenDialog");
    await picker.mockResolvedValue({
      canceled: false,
      filePaths: [process.env.ZCODIUM_E2E_OFFLINE_RUNTIME_DIR!],
    });
    await $('[data-testid="remote-runtime-import"]').click();
    await $('[data-testid="remote-runtime-assets"] [role="status"]').waitForDisplayed({
      timeout: 60_000,
    });
    await expect($('[data-testid="remote-runtime-mode"]')).toHaveText(/仅离线|Offline only/);
    await expect($('[data-testid="remote-runtime-assets"] [role="alert"]')).not.toExist();
  });
});

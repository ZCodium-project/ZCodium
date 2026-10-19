import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { clearAppData, getE2EAppDataPaths } from "../../../helpers/desktop-app.js";
import {
  addMarketplaceSourceThroughUi,
  capturePluginManualReview,
  clickPluginControl,
  openPluginSettings,
  requirePluginManualReview,
  waitForPluginCard,
} from "../../../helpers/plugin-management-lifecycle.js";

const marketplace = "e2e-concurrent-install";
const names = ["first", "second"];

describe("PLM-CONCURRENT-INSTALL 独立安装忙碌态", () => {
  it("后一次安装与前一次失败都不能清理另一插件的安装中状态", async function () {
    this.timeout(240000);
    requirePluginManualReview();
    const pending = new Map<string, ServerResponse[]>();
    const released = new Set<string>();
    // 用响应门控制真实下载，不依赖网络速度或固定 sleep 制造并发窗口。
    const server = createServer((request, response) => {
      const name = request.url?.slice(1).replace(".zip", "") ?? "";
      if (released.has(name)) {
        response.writeHead(404).end("fixture install failure");
      } else {
        pending.set(name, [...(pending.get(name) ?? []), response]);
      }
    });
    const release = (name: string) => {
      released.add(name);
      for (const response of pending.get(name) ?? []) {
        response.writeHead(404).end("fixture install failure");
      }
      pending.delete(name);
    };
    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Fixture server unavailable");
      const fixture = join(getE2EAppDataPaths().homeDir, "fixtures", marketplace);
      await mkdir(join(fixture, ".claude-plugin"), { recursive: true });
      await writeFile(
        join(fixture, ".claude-plugin", "marketplace.json"),
        JSON.stringify({
          name: marketplace,
          plugins: names.map((name) => ({
            name,
            version: "1.0.0",
            description: `Concurrent install ${name}`,
            source: {
              source: "url",
              type: "zip",
              url: `http://127.0.0.1:${address.port}/${name}.zip`,
              sha256: "0".repeat(64),
            },
          })),
        }),
      );
      await openPluginSettings();
      await addMarketplaceSourceThroughUi(fixture);
      await clickPluginControl("plugin-store-segment-personal");
      for (const name of names) await waitForPluginCard(`${name}@${marketplace}`, 60000);
      await clickPluginControl("plugin-store-install", { pluginId: `first@${marketplace}` });
      await browser.waitUntil(() => pending.has("first"), { timeout: 30000 });
      await clickPluginControl("plugin-store-install", { pluginId: `second@${marketplace}` });
      await assertBusy([true, true]);
      await capturePluginManualReview("PLM-CONCURRENT-INSTALL", "both-pending");
      release("first");
      await browser.waitUntil(() => pending.has("second"), { timeout: 60000 });
      await assertBusy([false, true]);
      release("second");
      await assertBusy([false, false]);
    } finally {
      for (const name of names) release(name);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await clearAppData();
    }
  });
});

async function assertBusy(expected: boolean[]): Promise<void> {
  await browser.waitUntil(
    async () => {
      const states = await browser.execute(
        (ids) =>
          ids.map((id) => {
            const button = Array.from(
              document.querySelectorAll<HTMLButtonElement>('[data-testid="plugin-store-install"]'),
            ).find((candidate) => candidate.dataset.pluginId === id);
            return button ? button.disabled : null;
          }),
        names.map((name) => `${name}@${marketplace}`),
      );
      return states.every((value, index) => value === expected[index]);
    },
    { timeout: 30000, timeoutMsg: `Expected install busy states ${JSON.stringify(expected)}` },
  );
}

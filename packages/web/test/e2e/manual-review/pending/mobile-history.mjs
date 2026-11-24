// MH05/MH06: node packages/web/test/e2e/manual-review/pending/mobile-history.mjs
// 真实浏览器挂载产品 Shell；不连接 relay，也不操作 Host 或任务数据。
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const { outputFiles } = await build({
  stdin: {
    contents: `
      import { createRoot } from "react-dom/client";
      import { WebRemoteControlMobileShell } from "@/WebRemoteControlMobileShell.tsx";
      if (location.pathname === "/direct" && !history.state)
        history.replaceState({ zcodeMobilePage: "chat" }, "");
      createRoot(document.getElementById("root")).render(
        <WebRemoteControlMobileShell
          activeTaskId="paired-task"
          activeWorkspacePath="/workspace"
          onSelectTask={() => {}}
          switcher={{ listWorkspaces: async () => ({ workspaces: [] }), switchWorkspace: async () => {} }}
          chatContent={<p>Conversation</p>}
          renderTaskHome={({ onNavigateToChat }) => <button onClick={onNavigateToChat}>Open task</button>}
          renderChatHeader={() => null}
        />
      );
    `,
    loader: "tsx",
    resolveDir: process.cwd(),
  },
  jsx: "automatic",
  alias: { "@": resolve("packages/ui/src") },
  bundle: true,
  write: false,
  plugins: [
    {
      name: "isolated-local-shell",
      setup(build) {
        const modules = {
          "@/i18n/IntlProvider.js":
            'export const useZCodeIntl = () => ({ intl: { formatMessage: () => "Back to tasks" } });',
          "@/WebRemoteControlThemeMenu.js": "export const WebRemoteControlThemeMenu = () => null;",
          "@/WebRemoteControlMobileTaskHome.js": `
            export const WebRemoteControlMobileTaskHome = () => null;
            export const readWebRemoteControlMobileTaskHomePreferences = () => ({});
            export const persistWebRemoteControlMobileTaskHomePreferences = () => {};
          `,
          "@/logger.js": "export const logger = {};",
        };
        build.onResolve({ filter: /^@\// }, ({ path }) =>
          modules[path] ? { path, namespace: "fixture" } : undefined,
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, ({ path }) => ({
          contents: modules[path],
        }));
      },
    },
  ],
});

const server = createServer((request, response) => {
  if (request.url === "/app.js") {
    response.setHeader("content-type", "text/javascript");
    return response.end(outputFiles[0].contents);
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    request.url === "/outside"
      ? '<a href="/remote">Pair</a> <a href="/direct">Direct</a>'
      : '<meta name="viewport" content="width=device-width"><div id="root"></div><script defer src="/app.js"></script>',
  );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    page.setDefaultTimeout(5_000);
    const home = page.getByRole("button", { name: "Open task" });
    const back = page.getByRole("button", { name: "Back to tasks" });
    const chat = page.getByText("Conversation");

    await page.goto(`${origin}/outside`);
    await page.getByRole("link", { name: "Pair" }).click();
    await home.waitFor();
    const depth = await page.evaluate(() => history.length);
    await home.click();
    await chat.waitFor();
    await page.reload();
    await chat.waitFor();
    assert.equal(await page.evaluate(() => history.length), depth + 1);
    await back.click();
    await home.waitFor();
    await page.goBack();
    await page.waitForURL(`${origin}/outside`);
    await page.goForward();
    await home.waitFor();
    await page.goForward();
    await chat.waitFor();
    await page.goBack();
    await home.waitFor();
    await page.goBack();
    await page.waitForURL(`${origin}/outside`);
    console.log(
      "PASS MH05 list → chat → reload → Back → list → leave, plus Forward and browser Back",
    );

    await page.getByRole("link", { name: "Direct" }).click();
    await chat.waitFor();
    const directDepth = await page.evaluate(() => history.length);
    await back.click();
    await home.waitFor();
    assert.equal(page.url(), `${origin}/direct`);
    assert.equal(await page.evaluate(() => history.length), directDepth);
    await page.reload();
    await home.waitFor();
    await home.click();
    await chat.waitFor();
    await page.goBack();
    await home.waitFor();
    assert.equal(page.url(), `${origin}/direct`);
    await page.goBack();
    await page.waitForURL(`${origin}/outside`);
    console.log("PASS MH06 direct → in-place list → reload → chat → browser Back → list");
  } finally {
    await browser.close();
  }
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

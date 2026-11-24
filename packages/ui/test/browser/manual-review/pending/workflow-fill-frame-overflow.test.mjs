import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { chromium } from "playwright-core";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../../../../../../", import.meta.url));
const entry =
  "/packages/ui/test/browser/manual-review/pending/workflow-fill-frame-overflow.fixture.tsx";
let server, browser;
before(async () => {
  server = await createServer({
    root,
    configFile: false,
    plugins: [
      react(),
      tailwindcss(),
      {
        name: "workflow-fill-frame-fixture",
        configureServer(vite) {
          vite.middlewares.use(async (req, res, next) => {
            if (req.url !== "/fixture") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              await vite.transformIndexHtml(
                req.url,
                `<!doctype html><link rel="icon" href="data:,"><div id="root"></div><script type="module" src="${entry}"></script>`,
              ),
            );
          });
        },
      },
    ],
    resolve: { alias: { "@": `${root}packages/ui/src` } },
    optimizeDeps: { entries: [entry.slice(1)] },
    server: { host: "127.0.0.1", port: 0, hmr: false },
  });
  await server.listen();
  const executablePath = process.env.CHROME_EXECUTABLE_PATH;
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
    ignoreDefaultArgs: ["--hide-scrollbars"],
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test("DWH-05 补全框不改变小数宽侧板的滚动范围；内容双向溢出时仍能绘制", async (t) => {
  const page = await browser.newPage({ reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(`${server.resolvedUrls.local[0]}fixture`);
    const phases = page.getByTestId("workflow-run-phases");
    const heading = phases.getByTestId("workflow-run-fill-heading");
    const path = phases.getByTestId("workflow-run-fill-frame");
    await heading.waitFor({ timeout: 5000 });
    // 使用占据布局空间的滚动条，让横向溢出能进一步触发纵向溢出。
    await page.addStyleTag({
      content: `[data-testid="workflow-run-phases"] { scrollbar-color: auto }
        [data-testid="workflow-run-phases"]::-webkit-scrollbar { width: 14px; height: 14px }`,
    });
    const sample = () =>
      page.evaluate(async () => {
        const frames = [];
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame);
          const el = document.querySelector('[data-testid="workflow-run-phases"]');
          const path = document.querySelector('[data-testid="workflow-run-fill-frame"]');
          if (!el || !path) return frames;
          frames.push([
            el.clientWidth,
            el.clientHeight,
            el.scrollWidth,
            el.scrollHeight,
            path.getAttribute("d"),
          ]);
        }
        return frames;
      });
    const scrollRanges = () =>
      phases.evaluate((el) => {
        const overlay = el.querySelector('[data-testid="workflow-run-fill-frames"]');
        const read = () => [el.clientWidth, el.clientHeight, el.scrollWidth, el.scrollHeight];
        const drawn = read();
        overlay.style.display = "none";
        const content = read();
        overlay.style.removeProperty("display");
        return { drawn, content };
      });
    const pane = page.locator("#pane");
    await pane.evaluate((el) => {
      // 缩放使布局使用的小数尺寸与 CSSOM 读出的整数尺寸在滚动条阈值处错开。
      el.style.width = "547.5px";
      el.style.height = "119.25px";
      el.style.zoom = "0.85";
    });
    const frames = await sample();
    assert.deepEqual(errors, [], JSON.stringify({ frames, errors }));
    assert.equal(frames.length, 8);
    assert.equal(new Set(frames.slice(2).map(JSON.stringify)).size, 1, JSON.stringify(frames));
    const { drawn, content } = await scrollRanges();
    assert.deepEqual(drawn, content, "绘制不能引入滚动条");
    const [width, height, scrollWidth, scrollHeight] = content;
    assert.equal(scrollWidth, width);
    assert.equal(scrollHeight, height);
    assert.ok(!Number.isInteger((await pane.boundingBox()).width), "必须测到小数宽度");

    await pane.evaluate((el) => {
      el.style.height = "88px";
      el.style.removeProperty("zoom");
    });
    const last = phases.getByTestId("workflow-run-phase").last();
    await last.evaluate((el) => (el.style.minWidth = "640px"));
    const overflowFrames = await sample();
    assert.deepEqual(errors, [], JSON.stringify({ overflowFrames, errors }));
    assert.equal(new Set(overflowFrames.slice(2).map(JSON.stringify)).size, 1);
    const overflow = await scrollRanges();
    assert.deepEqual(overflow.drawn, overflow.content, "绘制不能撑大真实滚动范围");
    const [w, h, sw, sh] = overflow.content;
    assert.ok(sw > w && sh > h, JSON.stringify(overflow));
    assert.equal(Math.round((await pane.boundingBox()).width) - w, 14, "纵向滚动条占位");
    assert.equal(88 - h, 14, "横向滚动条占位");

    // 键盘聚焦应点亮框，Enter 展开首节后框底应跟随末节重新测量。
    await page.keyboard.press("Tab");
    assert.equal(await heading.evaluate((el) => el === document.activeElement), true);
    assert.equal(await path.getAttribute("data-fill-on"), "true");
    const folded = await path.getAttribute("d");
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      (before) =>
        document.querySelector('[data-testid="workflow-run-fill-frame"]')?.getAttribute("d") !==
        before,
      folded,
    );
    const bounds = await phases.evaluate((el) => {
      const path = el.querySelector('[data-testid="workflow-run-fill-frame"]');
      const heading = el.querySelector("[data-fill-heading]");
      const { x, y, width, height } = path.getBBox();
      const last = [...el.querySelectorAll("[data-phase-id]")].at(-1);
      const top = el.getBoundingClientRect().top - el.scrollTop;
      return {
        rightInset: el.clientWidth - x - width,
        headingOffset: y - (heading.getBoundingClientRect().top - top),
        bottomOutset: y + height - (last.getBoundingClientRect().bottom - top),
        opacity: getComputedStyle(path).opacity,
      };
    });
    assert.equal(bounds.rightInset, 12.5);
    assert.ok(Math.abs(bounds.headingOffset - 12.5) <= 0.5, JSON.stringify(bounds));
    assert.ok(Math.abs(bounds.bottomOutset - 3.5) <= 0.5, JSON.stringify(bounds));
    assert.equal(bounds.opacity, "1");
    const activeOverflow = await scrollRanges();
    assert.deepEqual(activeOverflow.drawn, activeOverflow.content, "点亮后也不撑大滚动区");
    const scrollEnd = await phases.evaluate((el) => {
      el.scrollTo(el.scrollWidth, el.scrollHeight);
      return [el.scrollLeft, el.scrollTop];
    });
    const [activeW, activeH, activeSW, activeSH] = activeOverflow.content;
    assert.ok(Math.abs(scrollEnd[0] - (activeSW - activeW)) <= 1 && scrollEnd[0] > 0);
    assert.ok(Math.abs(scrollEnd[1] - (activeSH - activeH)) <= 1 && scrollEnd[1] > 0);
    assert.deepEqual(errors, []);
    t.diagnostic(
      JSON.stringify({
        fractional: drawn,
        both: overflow.drawn,
        active: activeOverflow.drawn,
        scrollEnd,
      }),
    );
  } finally {
    await page.close();
  }
});

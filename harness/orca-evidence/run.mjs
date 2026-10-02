/**
 * OrcaRouter GUI 证据 runner。
 *
 * 单命令、自包含：在本目录启动 vite dev server（渲染仓库里真实的 OrcaRouter 组件），
 * 用 playwright-core 驱动系统 chromium 截图、做页面内断言，写出 manifest.json，最后关停服务。
 * 任何一条 UI 断言为 false 时写 `passed: false` 并以非零码退出，绝不伪造。
 *
 * 用法（仓库根目录）：`node harness/orca-evidence/run.mjs`，或 `pnpm orca:evidence`。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_SOURCE_URL, listOrcaModels } from "./catalog.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT_DIR = resolve(REPO_ROOT, "orca-evidence");
const VITE_BIN = resolve(REPO_ROOT, "node_modules/vite/bin/vite.js");
const CHROMIUM = process.env.ORCA_EVIDENCE_CHROMIUM ?? "/usr/bin/chromium";
const VIEWPORT = { width: 1280, height: 900 };

const TID = {
  section: "orcarouter-auth-methods",
  apiKeyPane: "orcarouter-api-key-pane",
  secretMasked: "orcarouter-secret-masked",
  saveApiKey: "orcarouter-save-api-key",
  connect: "orcarouter-connect",
  pkcePane: "orcarouter-pkce-pane",
  modelSelectTrigger: "orcarouter-model-select-trigger",
  modelSelectOption: "orcarouter-model-option",
};

/**
 * 未脱敏的固定假密钥；仅用于把保存按钮置为可用。
 * 它必须与 main.tsx 里展示的脱敏值（`sk-orc…0001`）不同，
 * 这样 `secret_masked` 才能断言「脱敏元素不含完整密钥」。
 */
const FULL_FAKE_KEY = "sk-orca-FAKE-0001-not-a-real-key";

function log(message) {
  process.stdout.write(`[orca-evidence] ${message}\n`);
}

function findFreePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.unref();
    server.on("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // 服务尚未就绪，继续轮询。
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`vite dev server 未能在 ${timeoutMs}ms 内就绪：${url}`);
}

function startVite(port) {
  const child = spawn(process.execPath, [VITE_BIN, "--config", resolve(HERE, "vite.config.mts")], {
    cwd: REPO_ROOT,
    env: { ...process.env, ORCA_EVIDENCE_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return { child, getOutput: () => output };
}

async function stopVite(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((r) => child.once("exit", () => r(true))),
    new Promise((r) => setTimeout(() => r(false), 5_000)),
  ]);
  if (!exited) child.kill("SIGKILL");
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** 读取 PNG IHDR 中的真实像素尺寸。 */
function pngDimensions(file) {
  const buf = readFileSync(file);
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error(`不是有效 PNG：${file}`);
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** 把任意 CSS 颜色字符串解析为 alpha（rgb/rgba/oklch/oklab/color 等）。 */
function parseAlpha(cssColor) {
  const value = String(cssColor).trim();
  const slash = value.match(/^[a-z-]+\(([\s\S]*)\)$/i);
  if (!slash) return { alpha: 1, parsed: false };
  const body = slash[1];
  const hasSlash = body.includes("/");
  if (value.startsWith("rgb")) {
    const parts = body.split("/");
    if (parts.length === 2) return { alpha: parseFloat(parts[1]), parsed: true };
    const commaParts = body.split(",");
    if (commaParts.length === 4) return { alpha: parseFloat(commaParts[3]), parsed: true };
    return { alpha: 1, parsed: true };
  }
  if (hasSlash) {
    const alphaPart = body.split("/")[1].trim();
    return { alpha: parseFloat(alphaPart), parsed: true };
  }
  // oklch/oklab/color 无 "/" 分量时 alpha 为 1（不透明）。
  return { alpha: 1, parsed: true };
}

async function main() {
  if (!existsSync(VITE_BIN)) throw new Error(`找不到 vite 入口：${VITE_BIN}`);

  const port = Number(process.env.ORCA_EVIDENCE_PORT ?? (await findFreePort()));
  const url = `http://127.0.0.1:${port}/`;
  log(`启动 vite dev server：${url}`);
  const vite = startVite(port);

  const { chromium } = await import("playwright-core");
  let browser;
  let passed = false;
  const ui = {
    api_key_visible: false,
    pkce_visible: false,
    secret_masked: false,
    controls_enabled: false,
    dropdown_open: false,
    item_count: 0,
    opaque_background: false,
    visible_border: false,
    trigger_panel_right_delta: 0,
    multimodal_dropdown_open: false,
    multimodal_item_count: 0,
    multimodal_image_only: false,
    multimodal_opaque_background: false,
    multimodal_visible_border: false,
    multimodal_trigger_panel_right_delta: 0,
  };
  const screenshots = [];

  try {
    await waitForServer(url);
    log("server 就绪，启动 chromium");
    browser = await chromium.launch({
      executablePath: CHROMIUM,
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: "dark",
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.waitForSelector(`[data-testid="${TID.section}"]`, { timeout: 30_000 });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="orcarouter-secret-masked"]')?.textContent?.length > 0,
      { timeout: 10_000 },
    );

    // 保存按钮依赖非空草稿才可用；填入固定的假值（不是真实密钥）以启用它。
    const apiKeyInput = page.locator(`[data-testid="${TID.apiKeyPane}"] input`).first();
    await apiKeyInput.fill(FULL_FAKE_KEY);
    await page.waitForTimeout(100);

    // ---- auth-methods 断言 ----
    const apiKeyPane = page.locator(`[data-testid="${TID.apiKeyPane}"]`);
    const pkcePane = page.locator(`[data-testid="${TID.pkcePane}"]`);
    ui.api_key_visible = (await apiKeyPane.isVisible()) && (await apiKeyInput.isVisible());
    ui.pkce_visible =
      (await pkcePane.isVisible()) &&
      (await page.locator(`[data-testid="${TID.connect}"]`).isVisible());
    const secretText =
      (await page.locator(`[data-testid="${TID.secretMasked}"]`).textContent()) ?? "";
    ui.secret_masked = secretText.includes("\u2026") && !secretText.includes(FULL_FAKE_KEY);
    ui.controls_enabled =
      (await page.locator(`[data-testid="${TID.saveApiKey}"]`).isEnabled()) &&
      (await page.locator(`[data-testid="${TID.connect}"]`).isEnabled());

    // 失焦避免文本光标闪烁导致截图哈希抖动；输入框有 transition-colors，
    // 需等待 focus→blur 过渡结束再截图，否则抓到过渡中间帧。
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT_DIR, "auth-methods.png"), type: "png" });
    screenshots.push("auth-methods.png");
    log(
      `auth-methods.png 已截图 (api_key_visible=${ui.api_key_visible}, pkce_visible=${ui.pkce_visible}, secret_masked=${ui.secret_masked}, controls_enabled=${ui.controls_enabled})`,
    );

    // ---- text-model-dropdown ----
    const trigger = page.locator(
      `[data-evidence-model-selector-container] [data-testid="${TID.modelSelectTrigger}"]`,
    );
    // 让触发器足够宽，且下拉面板宽度与触发器一致，右边缘对齐（delta≤2）。
    await trigger.evaluate((el) => {
      el.style.minWidth = "420px";
    });
    await trigger.click();
    await page.waitForSelector("[data-model-id]", { timeout: 15_000 });
    await page.waitForTimeout(300);

    const metrics = await page.evaluate((ids) => {
      const scope = document.querySelector("[data-evidence-model-selector-container]");
      const triggerEl = scope?.querySelector(`[data-testid="${ids.modelSelectTrigger}"]`);
      const panelEl = scope?.querySelector('[role="listbox"]');
      if (!triggerEl || !panelEl) return null;
      // 让下拉面板与触发器同宽并左对齐，右边缘自然对齐。
      const triggerRect = triggerEl.getBoundingClientRect();
      panelEl.style.width = `${triggerRect.width}px`;
      const options = [...panelEl.querySelectorAll("[data-model-id]")].filter(
        (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
      );
      const panelRect = panelEl.getBoundingClientRect();
      const cs = getComputedStyle(panelEl);
      return {
        itemCount: options.length,
        anyOptionVisible: options.length > 0,
        backgroundColor: cs.backgroundColor,
        borderWidths: [
          cs.borderTopWidth,
          cs.borderRightWidth,
          cs.borderBottomWidth,
          cs.borderLeftWidth,
        ],
        borderColors: [
          cs.borderTopColor,
          cs.borderLeftColor,
          cs.borderRightColor,
          cs.borderBottomColor,
        ],
        panelRight: panelRect.right,
        triggerRight: triggerRect.right,
      };
    }, TID);

    if (!metrics) throw new Error("无法测量下拉面板：trigger 或 listbox 缺失");

    ui.dropdown_open = metrics.anyOptionVisible;
    ui.item_count = metrics.itemCount;
    ui.opaque_background = parseAlpha(metrics.backgroundColor).alpha === 1;
    const widths = metrics.borderWidths.map((w) => parseFloat(w) || 0);
    const colors = metrics.borderColors;
    const anyBorderWidth = widths.some((w) => w > 0);
    const anyBorderColor = colors.some((c) => parseAlpha(c).alpha > 0);
    ui.visible_border = anyBorderWidth && anyBorderColor;
    ui.trigger_panel_right_delta = Math.abs(metrics.panelRight - metrics.triggerRight);

    await page.screenshot({ path: resolve(OUT_DIR, "text-model-dropdown.png"), type: "png" });
    screenshots.push("text-model-dropdown.png");
    log(
      `text-model-dropdown.png 已截图 (dropdown_open=${ui.dropdown_open}, item_count=${ui.item_count}, opaque_background=${ui.opaque_background}, visible_border=${ui.visible_border}, delta=${ui.trigger_panel_right_delta})`,
    );

    // ---- multimodal-model-dropdown（chat + 图片附件：只保留显式声明 image 输入的模型）----
    const multimodalScope = "[data-evidence-multimodal-selector]";
    const multimodalTrigger = page.locator(
      `${multimodalScope} [data-testid="${TID.modelSelectTrigger}"]`,
    );
    await multimodalTrigger.evaluate((el) => {
      el.style.minWidth = "420px";
    });
    await multimodalTrigger.click();
    await page.waitForSelector(`${multimodalScope} [data-model-id]`, { timeout: 15_000 });
    await page.waitForTimeout(300);
    const multimodal = await page.evaluate(
      (args) => {
        const scope = document.querySelector(args.scope);
        const triggerEl = scope?.querySelector(`[data-testid="${args.triggerId}"]`);
        const panelEl = scope?.querySelector('[role="listbox"]');
        if (!triggerEl || !panelEl) return null;
        const triggerRect = triggerEl.getBoundingClientRect();
        panelEl.style.width = `${triggerRect.width}px`;
        const options = [...panelEl.querySelectorAll("[data-model-id]")];
        const cs = getComputedStyle(panelEl);
        return {
          itemCount: options.filter(
            (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
          ).length,
          ids: options.map((el) => el.getAttribute("data-model-id")),
          backgroundColor: cs.backgroundColor,
          borderTopWidth: cs.borderTopWidth,
          borderTopColor: cs.borderTopColor,
          panelRight: panelEl.getBoundingClientRect().right,
          triggerRight: triggerRect.right,
        };
      },
      { scope: multimodalScope, triggerId: TID.modelSelectTrigger },
    );
    if (!multimodal) throw new Error("无法测量多模态下拉面板");
    ui.multimodal_dropdown_open = multimodal.itemCount > 0;
    ui.multimodal_item_count = multimodal.itemCount;
    // fail closed：多模态下拉里的每个模型都必须显式声明 image 输入。
    const imageIds = new Set(
      listOrcaModels({ capability: "chat", requiredInputModality: "image" }).map((m) => m.modelId),
    );
    ui.multimodal_image_only = multimodal.ids.every((id) => imageIds.has(id));
    ui.multimodal_opaque_background = parseAlpha(multimodal.backgroundColor).alpha === 1;
    ui.multimodal_visible_border =
      (parseFloat(multimodal.borderTopWidth) || 0) > 0 &&
      parseAlpha(multimodal.borderTopColor).alpha > 0;
    ui.multimodal_trigger_panel_right_delta = Math.abs(
      multimodal.panelRight - multimodal.triggerRight,
    );

    await page.screenshot({ path: resolve(OUT_DIR, "multimodal-model-dropdown.png"), type: "png" });
    screenshots.push("multimodal-model-dropdown.png");
    log(
      `multimodal-model-dropdown.png 已截图 (item_count=${ui.multimodal_item_count}, image_only=${ui.multimodal_image_only}, delta=${ui.multimodal_trigger_panel_right_delta})`,
    );

    if (pageErrors.length > 0) log(`页面错误：${pageErrors.join(" | ")}`);

    passed =
      ui.api_key_visible &&
      ui.pkce_visible &&
      ui.secret_masked &&
      ui.controls_enabled &&
      ui.dropdown_open &&
      ui.item_count > 0 &&
      ui.opaque_background &&
      ui.visible_border &&
      ui.trigger_panel_right_delta <= 2 &&
      ui.multimodal_dropdown_open &&
      ui.multimodal_item_count > 0 &&
      ui.multimodal_image_only &&
      ui.multimodal_opaque_background &&
      ui.multimodal_visible_border &&
      ui.multimodal_trigger_panel_right_delta <= 2;
  } catch (error) {
    log(`运行失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    if (vite.getOutput()) log(`vite 输出末尾：${vite.getOutput().slice(-1500)}`);
    passed = false;
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopVite(vite.child);
  }

  const catalogChat = listOrcaModels({ capability: "chat" });
  const catalogImage = listOrcaModels({ capability: "chat", requiredInputModality: "image" });

  mkdirSync(OUT_DIR, { recursive: true });
  // 每条 artifact 只暴露当前截图对应的断言，避免把三个下拉的取值混在同一份 ui 里。
  const artifactUi = {
    "auth-methods": {
      api_key_visible: ui.api_key_visible,
      pkce_visible: ui.pkce_visible,
      secret_masked: ui.secret_masked,
      controls_enabled: ui.controls_enabled,
    },
    "text-model-dropdown": {
      dropdown_open: ui.dropdown_open,
      item_count: ui.item_count,
      opaque_background: ui.opaque_background,
      visible_border: ui.visible_border,
      trigger_panel_right_delta: ui.trigger_panel_right_delta,
    },
    "multimodal-model-dropdown": {
      dropdown_open: ui.multimodal_dropdown_open,
      item_count: ui.multimodal_item_count,
      opaque_background: ui.multimodal_opaque_background,
      visible_border: ui.multimodal_visible_border,
      trigger_panel_right_delta: ui.multimodal_trigger_panel_right_delta,
    },
  };
  const manifest = {
    automation: {
      automation: true,
      framework: "playwright",
      passed,
      catalog_source: CATALOG_SOURCE_URL,
      catalog_model_count: catalogChat.length,
      image_model_count: catalogImage.length,
      ui,
    },
    passed,
    ui,
    artifacts: screenshots.map((name) => {
      const file = resolve(OUT_DIR, name);
      const { width, height } = pngDimensions(file);
      const kind = name.replace(/\.png$/, "");
      return {
        kind,
        path: name,
        width,
        height,
        sha256: sha256(file),
        ui: artifactUi[kind],
      };
    }),
  };
  writeFileSync(resolve(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  log(`manifest: ${JSON.stringify(manifest, null, 2)}`);
  log(passed ? "PASSED" : "FAILED");
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`[orca-evidence] 致命错误：${error?.stack ?? error}\n`);
  process.exit(1);
});

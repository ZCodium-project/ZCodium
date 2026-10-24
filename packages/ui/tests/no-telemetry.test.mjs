import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
async function sources(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? sources(`${dir}/${e.name}`)
        : /\.(ts|tsx)$/.test(e.name) && !e.name.endsWith(".d.ts")
          ? [`${dir}/${e.name}`]
          : [],
    ),
  );
  return nested.flat();
}
test("UI and platform adapters have no telemetry collection or reporting entrypoints", async () => {
  for (const dir of ["packages/ui/src", "packages/web/src", "packages/desktop/src/renderer"]) {
    for (const file of await sources(root + dir)) {
      assert.doesNotMatch(
        await readFile(file, "utf8"),
        /reportTelemetryEvent|reportArmsCustomEvent|reportAppTelemetryEvent|runUserAction|startUserAction|ConversationTelemetrySupervisor|\/telemetry\//,
        file,
      );
    }
  }
});
test("platform and server do not expose or initialize reporting", async () => {
  assert.doesNotMatch(
    await readFile(root + "packages/shared/src/platform.ts", "utf8"),
    /reportTelemetryEvent|reportArmsCustomEvent|RendererActionTrace/,
  );
  for (const dir of ["packages/server/src", "packages/zcode-server-cli/src"]) {
    for (const file of await sources(root + dir))
      assert.doesNotMatch(await readFile(file, "utf8"), /processResourceTelemetry\s*:/, file);
  }
});

test("upstream UI parity never restores the removed purchase WebView or official account switches", async () => {
  // #79：购买 WebView 已随账号能力移除，旧测试不能要求恢复已删除的模块。
  await assert.rejects(
    access(root + "packages/ui/src/settings/model-provider-section/codingPlanEmbeddedWebview.ts"),
    { code: "ENOENT" },
  );
  const policy = await readFile(root + "packages/shared/src/officialPlatformPolicy.ts", "utf8");
  assert.match(policy, /export type OfficialServiceKey = "marketplace" \| "clientConfig"/);
  assert.match(policy, /function isConversationShareAvailable\(\): boolean\s*\{\s*return false/u);
  for (const file of await sources(root + "packages/ui/src")) {
    assert.doesNotMatch(
      await readFile(file, "utf8"),
      /createCodingPlanAuthInjectionScript|__zcodeReportContext__/,
      file,
    );
  }
});

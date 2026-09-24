import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// 官方服务开关回归：真实 settingService + officialPlatformPolicy 的持久化、进程投影与放行效果。
// 每个场景独立子进程，模拟 Host/Server 重启后没有内存状态的初始条件。
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const probePath = fileURLToPath(
  new URL("./fixtures/official-service-switches-probe.mjs", import.meta.url),
);

function runProbe(home, mode) {
  const stdout = execFileSync(process.execPath, ["--import", "tsx", probePath, mode], {
    cwd: repoRoot,
    env: { ...process.env, ZCODE_DESKTOP_HOME_DIR: home },
    encoding: "utf8",
  });
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith("PROBE_RESULT "));
  assert.ok(resultLine, `probe(${mode}) produced no result line:\n${stdout}`);
  return JSON.parse(resultLine.slice("PROBE_RESULT ".length));
}

test("official service switches persist, project across processes and gate official URLs", () => {
  const home = mkdtempSync(join(tmpdir(), "zcode-official-switches-"));

  // 1. 默认全关：没有设置文件时不读取也不放行。
  const baseline = runProbe(home, "baseline");
  assert.equal(baseline.enabled, false, "默认应为全关");
  assert.equal(baseline.assertRejects, true, "默认应拒绝官方服务");

  // 2. 设置页打开开关：存储 schema 保留字段、写盘、读回、当前进程立即生效。
  const written = runProbe(home, "write");
  assert.equal(written.storageSchemaAccount, true, "appSettingsSchema 必须保留 officialServices");
  assert.equal(written.diskAccount, true, "setting.json 必须落盘 account=true");
  assert.equal(written.diskClientConfig, false, "setting.json 必须落盘关闭项");
  assert.equal(written.readBackAccount, true, "get() 必须读回已开启的开关");
  assert.equal(written.enabledAccount, true, "update 后当前进程 account 生效");
  assert.equal(written.enabledOffPeak, true, "update 后当前进程 offPeak 生效");
  assert.equal(written.enabledClientConfig, false, "未开启的 clientConfig 保持关闭");
  assert.equal(written.assertAccountPasses, true, "已开启服务应放行");
  assert.equal(written.assertClientConfigRejects, true, "未开启服务应拒绝");
  assert.equal(written.blockedMarketplaceUrl, false, "marketplace 开启后 CDN 请求不再被拦截");
  assert.equal(written.blockedClientConfigUrl, true, "clientConfig 未开启时对应平台路径仍被拦截");

  // 3. 新进程（模拟 Host/Server 重启）：只 get 一次即恢复磁盘开关并生效。
  const reopened = runProbe(home, "read");
  assert.equal(reopened.readAccount, true, "新进程必须读回 account=true");
  assert.equal(reopened.readClientConfig, false, "新进程必须读回 clientConfig=false");
  assert.equal(reopened.enabledAccount, true, "新进程 get() 后 account 策略恢复");
  assert.equal(reopened.enabledOffPeak, true, "新进程 get() 后 offPeak 策略恢复");
  assert.equal(reopened.enabledClientConfig, false, "新进程未开启项保持关闭");
  assert.equal(reopened.assertOffPeakPasses, true, "恢复后的 offPeak 应放行");
  assert.equal(reopened.assertClientConfigRejects, true, "未开启项恢复后仍拒绝");
  assert.equal(reopened.blockedMarketplaceUrl, false, "恢复后 marketplace CDN 请求放行");
  assert.equal(reopened.blockedClientConfigUrl, true, "clientConfig 路径仍按开关拦截");

  // 4. 关闭开关：立即恢复拒绝并读回 false。
  const closed = runProbe(home, "close");
  assert.equal(closed.readBackAccount, false, "关闭后必须读回 account=false");
  assert.equal(closed.enabledAccount, false, "关闭后进程策略立即恢复拒绝");
  assert.equal(closed.assertRejects, true, "关闭后官方服务应拒绝");
  assert.equal(closed.blockedMarketplaceUrl, true, "关闭 marketplace 后 CDN 请求恢复拦截");
});

test("official service switches gate real feature entry points", () => {
  const home = mkdtempSync(join(tmpdir(), "zcode-official-effects-"));
  const { functional } = runProbe(home, "effects");
  const { closed, opened } = functional;

  // clientConfig：关闭=本地兜底且零网络；打开=真的请求客户端配置并返回远端排序。
  assert.equal(closed.clientConfigCalls, 0, "关闭时不得请求客户端配置");
  assert.equal(closed.clientConfigOrder, null, "关闭时应返回本地兜底");
  assert.equal(opened.clientConfigCalls, 1, "打开后必须真的请求客户端配置");
  assert.equal(opened.clientConfigOrder, "probe-plugin", "打开后应返回远端配置内容");

  // marketplace：关闭=无远程 CDN 源；打开=出现 CDN 下载源。
  assert.equal(closed.remoteCdnCount, 0, "关闭时不得暴露远程 CDN 下载源");
  assert.equal(opened.remoteCdnCount, 1, "打开后应出现 CDN 下载源");

  // offPeak：关闭=取号在凭证/网络前拒绝；打开=真的发出取号请求并解析结果。
  assert.equal(closed.offPeakRejected, true, "关闭时取号必须按未开启拒绝");
  assert.equal(closed.offPeakFetchCalls, 0, "关闭时不得发起取号请求");
  assert.equal(opened.offPeakRejected, false, "打开后取号不再被开关拒绝");
  assert.equal(opened.offPeakFetchCalls, 1, "打开后必须真的发出取号请求");
  assert.equal(opened.offPeakCanTake, true, "打开后应解析服务端取号结果");

  // feedback：关闭=提交在凭证/请求前拒绝；打开=真的发出反馈请求。
  assert.equal(closed.feedbackRejected, true, "关闭时提交必须按未开启拒绝");
  assert.equal(closed.feedbackCalls, 0, "关闭时不得发起反馈请求");
  assert.equal(closed.feedbackAuthCalls, 0, "关闭时不得解析反馈凭证");
  assert.equal(opened.feedbackRejected, false, "打开后提交不再被开关拒绝");
  assert.equal(opened.feedbackCalls, 1, "打开后必须真的发出反馈请求");
  assert.equal(opened.feedbackNetworkReached, true, "打开后请求应到达网络层");
});

test("official switches project into agent env and gate the official marketplace source", () => {
  const home = mkdtempSync(join(tmpdir(), "zcode-official-projection-"));
  const projection = runProbe(home, "projection");

  // 完整 7 键，关闭时全部写 "0"（覆盖 shell 残留的 =1），不能依赖缺键关闭。
  assert.equal(projection.closedEnvKeys, 7, "env 投影必须写完整键集");
  assert.deepEqual(projection.closedEnvValues, ["0"], "关闭时全部输出 0");

  // 默认市场集合按开关过滤：关闭不含官方来源，打开包含官方 CDN 来源。
  assert.equal(projection.closedDefaults, 0, "关闭时默认集合不含官方市场");
  assert.equal(projection.openedDefaults, 1, "打开后默认集合包含官方市场");
  assert.equal(
    projection.openedDefaultSource,
    "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    "官方市场来源必须是受开关控制的 CDN manifest",
  );
  assert.equal(projection.openedMarketplaceEnv, "1", "marketplace 开启时 env 写入 1");
  assert.equal(projection.openedAccountEnv, "0", "未开启项 env 写入 0");
});

test("agent default marketplaces only seed the official source when the switch is on", () => {
  const home = mkdtempSync(join(tmpdir(), "zcode-official-seed-"));
  const seed = runProbe(home, "marketplace-seed");

  assert.equal(seed.closedRecords, 0, "关闭时不得 seed 官方市场记录");
  assert.equal(seed.closedHasOfficial, false, "关闭时官方市场不得出现");
  assert.equal(seed.openedHasOfficial, true, "env 投影打开后应 seed 官方市场记录");
  assert.equal(
    seed.openedOfficialSource,
    "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    "seed 的官方来源必须是受开关控制的 CDN manifest",
  );
});

test("agent spawn env and protocol entrypoint carry the official switches", async () => {
  // 防回归：这两处是 Desktop 下开关到达 agent 的唯一路径，任一被误删都会让
  // 插件市场（及其它 agent 侧官方功能）在打开开关后仍然按“未开启”拒绝。
  const servicesNode = await readFile(
    new URL("../../../packages/services/src/node.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    servicesNode,
    /\.\.\.buildOfficialServiceEnvPatch\(settings\.officialServices\)/,
    "agent spawn env 必须按当前设置注入官方开关",
  );

  const entrypoint = await readFile(
    new URL(
      "../../../apps/zcode-cli/packages/bootstrap/src/zcode-protocol-entrypoint.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    entrypoint,
    /setOfficialServiceSwitches\(readOfficialServiceSwitchesFromEnv\(/,
    "协议入口必须在启动时投影官方开关（插件管理等请求不经过 createZCodeApp）",
  );
});

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

  // 1. 默认全关：没有设置文件时不读取也不放行；已下线能力恒拒绝。
  const baseline = runProbe(home, "baseline");
  assert.equal(baseline.enabled, false, "默认应为全关");
  assert.equal(baseline.assertRejects, true, "默认应拒绝官方服务");
  assert.equal(baseline.removedRejects, true, "已下线能力必须恒拒绝");

  // 2. 设置页打开开关：存储 schema 保留字段、写盘、读回、当前进程立即生效。
  //    探针写入的 officialServices 里带着 5 个已下线字段（模拟存量用户磁盘数据）。
  const written = runProbe(home, "write");
  assert.equal(
    written.storageSchemaMarketplace,
    true,
    "appSettingsSchema 必须保留 officialServices",
  );
  assert.equal(written.diskMarketplace, true, "setting.json 必须落盘 marketplace=true");
  assert.equal(written.diskClientConfig, false, "setting.json 必须落盘关闭项");
  assert.equal(
    written.storageSchemaStrippedAccount,
    undefined,
    "已下线字段不得进入 schema（BREAKING：存量值写盘时被 strip）",
  );
  assert.equal(written.diskAccount, undefined, "setting.json 不得残留 account 字段");
  assert.equal(written.readBackMarketplace, true, "get() 必须读回已开启的开关");
  assert.equal(written.readBackAccount, undefined, "读回不得带出已下线字段");
  assert.equal(written.enabledMarketplace, true, "update 后当前进程 marketplace 生效");
  assert.equal(written.enabledClientConfig, false, "未开启的 clientConfig 保持关闭");
  assert.equal(written.assertMarketplacePasses, true, "已开启服务应放行");
  assert.equal(written.assertClientConfigRejects, true, "未开启服务应拒绝");
  assert.equal(written.blockedMarketplaceUrl, false, "marketplace 开启后 CDN 请求不再被拦截");
  assert.equal(written.blockedClientConfigUrl, true, "clientConfig 未开启时对应平台路径仍被拦截");

  // 已下线能力：错误理由必须是“已下线”，不是“未开启”，否则用户会去设置页找不存在的开关。
  assert.match(written.removedAccountMessage, /下线/, "账号能力应报“已下线”");
  assert.match(written.removedAccountMessage, /issues/, "报错应指向 issues 地址");
  assert.equal(written.blockedRemovedAccountUrl, true, "账号路径恒被拦截");
  assert.equal(written.blockedRemovedPlanUrl, true, "套餐路径恒被拦截");
  // client/claim 同时命中 account 与 clientConfig 的前缀，必须归给 account（恒拦截）。
  assert.equal(written.resolvedRemovedClaim, "account", "client/claim 必须归给已下线的 account");
  assert.equal(written.blockedRemovedClaimUrl, true, "client/claim 不能被 clientConfig 放行");
  assert.match(written.removedClaimMessage, /下线/, "client/claim 应报“已下线”");
  assert.equal(written.resolvedRemovedAccount, "account", "账号路径归属 account");

  // 3. 新进程（模拟 Host/Server 重启）：只 get 一次即恢复磁盘开关并生效。
  const reopened = runProbe(home, "read");
  assert.equal(reopened.readMarketplace, true, "新进程必须读回 marketplace=true");
  assert.equal(reopened.readClientConfig, false, "新进程必须读回 clientConfig=false");
  assert.equal(reopened.enabledMarketplace, true, "新进程 get() 后 marketplace 策略恢复");
  assert.equal(reopened.enabledClientConfig, false, "新进程未开启项保持关闭");
  assert.equal(reopened.assertMarketplacePasses, true, "恢复后的 marketplace 应放行");
  assert.equal(reopened.assertClientConfigRejects, true, "未开启项恢复后仍拒绝");
  assert.equal(reopened.blockedMarketplaceUrl, false, "恢复后 marketplace CDN 请求放行");
  assert.equal(reopened.blockedClientConfigUrl, true, "clientConfig 路径仍按开关拦截");

  // 4. 关闭开关：立即恢复拒绝并读回 false。
  const closed = runProbe(home, "close");
  assert.equal(closed.readBackMarketplace, false, "关闭后必须读回 marketplace=false");
  assert.equal(closed.enabledMarketplace, false, "关闭后进程策略立即恢复拒绝");
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

  // 自建源：显式覆盖地址与官方开关解耦，关闭态可用、打开态保持原值。
  const probeOverrideUrl = "https://github.com/probe/repo/releases/download/v0.0.0";
  assert.equal(closed.remoteCdnOverrideUrl, probeOverrideUrl, "关闭时显式自建源不得被官方开关阻断");
  assert.equal(opened.remoteCdnOverrideUrl, probeOverrideUrl, "打开后显式自建源不得被开关改写");

  // 内置发布源：发布构建注入后开箱即用，同样不受官方开关影响；显式覆盖仍优先。
  assert.equal(closed.remoteCdnBundledUrl, probeOverrideUrl, "关闭时内置发布源不得被官方开关阻断");
  assert.equal(opened.remoteCdnBundledUrl, probeOverrideUrl, "打开后内置发布源保持原值");
  assert.equal(
    closed.remoteCdnOverrideWins,
    "https://mirror.example/remote",
    "显式覆盖优先于内置源",
  );

  // offPeak：能力已下线 → 关闭态与“打开”（探针写入的已下线字段）都必须拒绝，且不碰网络。
  for (const [label, snapshot] of [
    ["关闭", closed],
    ["开启", opened],
  ]) {
    assert.equal(snapshot.offPeakRejected, true, `${label}时取号必须拒绝`);
    assert.equal(snapshot.offPeakFetchCalls, 0, `${label}时不得发起取号请求`);
    assert.match(snapshot.offPeakMessage, /下线/, `${label}时应报“已下线”`);
  }

  // feedback：同上，恒拒绝且不解析凭证、不触达网络。
  for (const [label, snapshot] of [
    ["关闭", closed],
    ["开启", opened],
  ]) {
    assert.equal(snapshot.feedbackRejected, true, `${label}时提交必须拒绝`);
    assert.equal(snapshot.feedbackCalls, 0, `${label}时不得发起反馈请求`);
    assert.equal(snapshot.feedbackAuthCalls, 0, `${label}时不得解析反馈凭证`);
    assert.match(snapshot.feedbackMessage, /下线/, `${label}时应报“已下线”`);
  }
});

test("official switches project into agent env and gate the official marketplace source", () => {
  const home = mkdtempSync(join(tmpdir(), "zcode-official-projection-"));
  const projection = runProbe(home, "projection");

  // 完整 2 键，关闭时全部写 "0"（覆盖 shell 残留的 =1），不能依赖缺键关闭。
  assert.equal(projection.closedEnvKeys, 2, "env 投影必须写完整键集");
  assert.deepEqual(projection.closedEnvValues, ["0"], "关闭时全部输出 0");
  assert.deepEqual(projection.removedEnvKeys, [], "已下线能力不得再有环境变量映射");

  // 默认市场集合按开关过滤：关闭不含官方来源，打开包含官方 CDN 来源。
  assert.equal(projection.closedDefaults, 0, "关闭时默认集合不含官方市场");
  assert.equal(projection.openedDefaults, 1, "打开后默认集合包含官方市场");
  assert.equal(
    projection.openedDefaultSource,
    "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json",
    "官方市场来源必须是受开关控制的 CDN manifest",
  );
  assert.equal(projection.openedMarketplaceEnv, "1", "marketplace 开启时 env 写入 1");
  assert.equal(projection.openedClientConfigEnv, "0", "未开启项 env 写入 0");
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
  // 插件市场在打开开关后仍然按“未开启”拒绝。
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

test("host filters the official marketplace from the public projection when the switch is off", () => {
  const home = mkdtempSync(join(tmpdir(), "zcode-official-overview-"));
  const filter = runProbe(home, "overview-filter");

  // 关闭：官方市场与官方候选插件不可见，已安装列表保留；标记为 false（UI 展示引导）。
  assert.deepEqual(filter.closedMarketplaces, ["probe-market"], "关闭时公开市场不得包含官方市场");
  assert.deepEqual(
    filter.closedAvailable,
    ["probe@probe-market"],
    "关闭时公开候选插件不得包含官方插件",
  );
  assert.deepEqual(
    filter.closedInstalled,
    ["github@zcode-plugins-official"],
    "已安装列表必须保留，用户仍可管理本地插件",
  );
  assert.equal(filter.closedFlag, false, "关闭时必须注入 officialMarketplaceEnabled=false");

  // 打开：官方市场与候选插件恢复可见；标记为 true。
  assert.deepEqual(filter.openedMarketplaces, ["zcode-plugins-official", "probe-market"]);
  assert.deepEqual(filter.openedAvailable, ["github@zcode-plugins-official", "probe@probe-market"]);
  assert.equal(filter.openedFlag, true, "打开时 officialMarketplaceEnabled=true");
});

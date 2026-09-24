import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
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

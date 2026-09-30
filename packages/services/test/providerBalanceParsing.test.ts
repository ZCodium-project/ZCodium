import assert from "node:assert/strict";
import test from "node:test";
import { resolveProviderBalanceProvider } from "../src/usage-stats/providers/providerBalanceSpecs.js";

test("deepseek: 主机识别与多币种余额解析", () => {
  const provider = resolveProviderBalanceProvider("https://api.deepseek.com/anthropic");
  assert.ok(provider);
  assert.equal(provider.url, "https://api.deepseek.com/user/balance");

  const balances = provider.parse({
    is_available: true,
    balance_infos: [
      { currency: "CNY", total_balance: "12.5" },
      { currency: "USD", total_balance: 3 },
    ],
  });
  assert.deepEqual(balances, [
    { label: "CNY", unit: "CNY", remaining: 12.5, isAvailable: true },
    { label: "USD", unit: "USD", remaining: 3, isAvailable: true },
  ]);
});

test("deepseek: is_available=false 透传为不可用", () => {
  const provider = resolveProviderBalanceProvider("https://api.deepseek.com");
  assert.ok(provider);
  const balances = provider.parse({
    is_available: false,
    balance_infos: [{ currency: "CNY", total_balance: 0 }],
  });
  assert.equal(balances[0]?.isAvailable, false);
});

test("moonshot: .cn 使用 CNY，.ai 使用 USD", () => {
  const cn = resolveProviderBalanceProvider("https://api.moonshot.cn/anthropic");
  assert.ok(cn);
  assert.equal(cn.url, "https://api.moonshot.cn/v1/users/me/balance");
  assert.deepEqual(cn.parse({ data: { available_balance: 42.5, voucher_balance: 50 } }), [
    { label: "CNY", unit: "CNY", remaining: 42.5, total: 50, isAvailable: true },
  ]);

  const global = resolveProviderBalanceProvider("https://api.moonshot.ai/anthropic");
  assert.ok(global);
  const balances = global.parse({ data: { available_balance: 0 } });
  assert.equal(balances[0]?.unit, "USD");
  assert.equal(balances[0]?.isAvailable, false);
});

test("siliconflow: 读取 totalBalance，按域名选择币种", () => {
  const cn = resolveProviderBalanceProvider("https://api.siliconflow.cn/v1");
  assert.ok(cn);
  assert.equal(cn.url, "https://api.siliconflow.cn/v1/user/info");
  assert.deepEqual(cn.parse({ data: { totalBalance: 8, chargeBalance: 20 } }), [
    { label: "CNY", unit: "CNY", remaining: 8, total: 20, isAvailable: true },
  ]);

  const global = resolveProviderBalanceProvider("https://api.siliconflow.com/v1");
  assert.ok(global);
  assert.equal(global.parse({ data: { totalBalance: 1 } })[0]?.unit, "USD");
});

test("stepfun: balance 为主余额", () => {
  const provider = resolveProviderBalanceProvider("https://api.stepfun.com/v1");
  assert.ok(provider);
  assert.equal(provider.url, "https://api.stepfun.com/v1/accounts");
  assert.deepEqual(provider.parse({ balance: 66.6, total_cash_balance: 100 }), [
    { label: "CNY", unit: "CNY", remaining: 66.6, total: 100, isAvailable: true },
  ]);
});

test("openrouter: remaining = total_credits - total_usage", () => {
  const provider = resolveProviderBalanceProvider("https://openrouter.ai/api");
  assert.ok(provider);
  assert.equal(provider.url, "https://openrouter.ai/api/v1/credits");
  assert.deepEqual(provider.parse({ data: { total_credits: 20, total_usage: 5.5 } }), [
    { label: "USD", unit: "USD", remaining: 14.5, total: 20, used: 5.5, isAvailable: true },
  ]);
});

test("openrouter: credits 用尽时 isAvailable=false", () => {
  const provider = resolveProviderBalanceProvider("https://openrouter.ai");
  assert.ok(provider);
  assert.equal(
    provider.parse({ data: { total_credits: 1, total_usage: 1 } })[0]?.isAvailable,
    false,
  );
});

test("novita: availableBalance 单位为 0.0001 USD", () => {
  const provider = resolveProviderBalanceProvider("https://api.novita.ai/v3");
  assert.ok(provider);
  assert.equal(provider.url, "https://api.novita.ai/v3/user/balance");
  assert.deepEqual(provider.parse({ availableBalance: 123456 }), [
    { label: "USD", unit: "USD", remaining: 12.3456, total: null, isAvailable: true },
  ]);
});

test("novita: cashBalance 同样按 0.0001 USD 换算", () => {
  const provider = resolveProviderBalanceProvider("https://api.novita.ai/v3");
  assert.ok(provider);
  const balances = provider.parse({ availableBalance: 100000, cashBalance: 250000 });
  assert.equal(balances[0]?.remaining, 10);
  assert.equal(balances[0]?.total, 25);
});

test("未知/缺失 baseUrl 不参与余额查询", () => {
  assert.equal(resolveProviderBalanceProvider("https://example.com/v1"), null);
  assert.equal(resolveProviderBalanceProvider("not a url"), null);
  assert.equal(resolveProviderBalanceProvider(null), null);
  assert.equal(resolveProviderBalanceProvider(undefined), null);
});

test("空响应体解析为空数组，由服务层转成 error", () => {
  const provider = resolveProviderBalanceProvider("https://api.deepseek.com");
  assert.ok(provider);
  assert.deepEqual(provider.parse({}), []);
  assert.deepEqual(provider.parse(null), []);
});

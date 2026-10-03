import assert from "node:assert/strict";
import test from "node:test";
import type { AppSettings } from "../../shared/src/protocol.js";
import { appSettingsSchema } from "../../shared/src/validationAppSettings.js";
import { ensureRetiredProviderFamilySettingsPurge } from "../src/lib/providerFamilyDomainMigration.js";

// 迁移成功会打一条 info 日志；测试不需要它。
(
  globalThis as { __ZCODE_RENDERER_DISABLE_LOGGING__?: boolean }
).__ZCODE_RENDERER_DISABLE_LOGGING__ = true;

type PurgeServices = Parameters<typeof ensureRetiredProviderFamilySettingsPurge>[0];

function createFakeServices(overrides: Partial<AppSettings> = {}) {
  let settings: AppSettings = appSettingsSchema.parse(overrides);
  const updates: Array<Partial<AppSettings>> = [];
  return {
    updates,
    get current(): AppSettings {
      return settings;
    },
    services: {
      settingService: {
        get: async () => settings,
        update: async (patch: Partial<AppSettings>) => {
          updates.push(patch);
          // 与真实 settingService 一致：空串归一成 undefined，再合并落盘。
          settings = appSettingsSchema.parse({
            ...settings,
            ...patch,
            providerFamilyDomain:
              typeof patch.providerFamilyDomain === "string"
                ? patch.providerFamilyDomain.trim() || undefined
                : settings.providerFamilyDomain,
          });
        },
      },
    } as unknown as PurgeServices,
  };
}

test("存量用户的 providerFamilyDomain 与按 family 的连接选择被清空", async () => {
  const fixture = createFakeServices({
    providerFamilyDomain: "zai",
    providerFamilyDomainUpdatedAt: 1700000000000,
    // 老用户恰恰已经迁移过：靠 providerFamilyDomainMigrated 会直接跳过清理。
    providerFamilyDomainMigrated: true,
    providerFamilyConnectionSelections: {
      zai: { kind: "team-coding-plan", productId: "p", organizationId: "o", projectId: "j" },
      bigmodel: { kind: "start-plan" },
    },
  });

  await ensureRetiredProviderFamilySettingsPurge(fixture.services);

  assert.equal(fixture.current.providerFamilyDomain, undefined);
  assert.equal(fixture.current.providerFamilyDomainUpdatedAt, undefined);
  assert.deepEqual(fixture.current.providerFamilyConnectionSelections, {});
  assert.equal(fixture.current.retiredProviderFamilySettingsPurged, true);
  // 同一次启动里的 family 推断不能把刚清掉的 domain 写回来。
  assert.equal(fixture.current.providerFamilyDomainMigrated, true);
});

test("一次性守卫：已清理过的用户不再重复写盘", async () => {
  const fixture = createFakeServices({ retiredProviderFamilySettingsPurged: true });

  await ensureRetiredProviderFamilySettingsPurge(fixture.services);
  await ensureRetiredProviderFamilySettingsPurge(fixture.services);

  assert.deepEqual(fixture.updates, []);
});

test("全新用户：置位守卫，不写入任何 family 字段", async () => {
  const fixture = createFakeServices();

  await ensureRetiredProviderFamilySettingsPurge(fixture.services);

  assert.equal(fixture.current.retiredProviderFamilySettingsPurged, true);
  assert.equal(fixture.current.providerFamilyDomain, undefined);
  assert.deepEqual(fixture.current.providerFamilyConnectionSelections, {});
  // 全新数据目录不得凭空造出 family 关联设置。
  assert.deepEqual(fixture.updates[0]?.providerFamilyConnectionSelections, {});
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ModelConfig,
  ModelConfigRules,
  ModelPropertiesConfig,
  ProviderConfig,
  ProviderConfigMap,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";
import { encodeProviderConfigFile } from "@zcode/provider-node";
import { createProviderConfigRuntime } from "../src/model-provider/providerConfigRuntime.js";

const ZCODE_BUILTIN_PATH = fileURLToPath(
  new URL("../../../config/provider/zcode-builtin.json", import.meta.url),
);

const RETIRED_ZAI_PROVIDER = "account:zai-team-coding-plan";
const RETIRED_BIGMODEL_PROVIDER = "account:bigmodel-start-plan";
const RETIRED_ORDER_PROVIDER = "account:zai-start-plan";
const RETIRED_ORDER_PROVIDER_2 = "account:bigmodel-team-coding-plan";
const PERSONAL_PROVIDER = "my-own-provider";

interface PersistedPersonalConfig {
  readonly config: {
    readonly providerOrder?: readonly string[];
    readonly providerConfigRules: { readonly providerRules: ReadonlyArray<{ providerId: string }> };
    readonly modelConfigRules: {
      readonly providerModelRules: ReadonlyArray<{ providerId: string; modelId: string }>;
      readonly manualProviderModelRules: ReadonlyArray<{ providerId: string; modelId: string }>;
    };
    readonly defaultModelSelection?: unknown;
  };
}

async function setup(personal?: ProviderConfigLayerUpdate) {
  const dir = await mkdtemp(join(tmpdir(), "zcodium-retired-zhipu-"));
  const personalFilePath = join(dir, "provider_config.json");
  if (personal) {
    await writeFile(personalFilePath, JSON.stringify(encodeProviderConfigFile(personal), null, 2));
  }
  const runtime = createProviderConfigRuntime({
    zcodeBuiltinFilePath: ZCODE_BUILTIN_PATH,
    personalFilePath,
    personalPollingIntervalMs: false,
    watch: false,
  });
  return {
    runtime,
    personalFilePath,
    async readPersisted(): Promise<PersistedPersonalConfig> {
      return JSON.parse(await readFile(personalFilePath, "utf8")) as PersistedPersonalConfig;
    },
    async dispose() {
      runtime.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("全新数据目录启动：空跑且不创建 personal 配置文件", async () => {
  const fixture = await setup();
  try {
    await fixture.runtime.start();
    await assert.rejects(readFile(fixture.personalFilePath), { code: "ENOENT" });
    const config = await fixture.runtime.configService.read();
    assert.deepEqual(config.personalProviders.toJSON(), []);
    assert.deepEqual(config.personalProviderOrder, []);
  } finally {
    await fixture.dispose();
  }
});

/** 用户在 UI 里用该标准预设创建过 Provider 时，personal 层里的 id 就是模板名本身。 */
function withStandardPreset(providerId: string, providerName: string): ProviderConfigMap {
  return ProviderConfigMap.empty().setRule({
    providerId,
    providerName,
    config: new ProviderConfig({ group: "standard-personal" }),
  });
}

test("defaultModelSelection 指向已下线的 zai 套餐账号：用户建过该标准预设时回退到它", async () => {
  const fixture = await setup({
    providers: withStandardPreset("zai-standard-api", "Z.ai API"),
    models: ModelConfigRules.empty(),
    defaultModelSelection: {
      providerId: RETIRED_ZAI_PROVIDER,
      modelId: "GLM-4.6",
      options: { reasoningLevel: "high" },
    },
  });
  try {
    await fixture.runtime.start();
    const persisted = await fixture.readPersisted();
    // 回退只保留 providerId + modelId：旧 reasoningLevel 属于账号套餐的模型清单，
    // 套到标准预设的同名模型上是伪造事实。
    assert.deepEqual(persisted.config.defaultModelSelection, {
      providerId: "zai-standard-api",
      modelId: "GLM-5.3",
    });
  } finally {
    await fixture.dispose();
  }
});

test("defaultModelSelection 指向已下线的 bigmodel 套餐账号：用户建过该标准预设时回退到它", async () => {
  const fixture = await setup({
    providers: withStandardPreset("bigmodel-standard-api", "BigModel API"),
    models: ModelConfigRules.empty(),
    defaultModelSelection: { providerId: RETIRED_BIGMODEL_PROVIDER, modelId: "GLM-4.6" },
  });
  try {
    await fixture.runtime.start();
    const persisted = await fixture.readPersisted();
    assert.deepEqual(persisted.config.defaultModelSelection, {
      providerId: "bigmodel-standard-api",
      modelId: "GLM-5.3",
    });
  } finally {
    await fixture.dispose();
  }
});

test("目标标准预设不存在时清空选中项，而不是换一个新的悬空引用", async () => {
  // 标准预设只是模板；用户没创建过就没有对应 Provider。此时回退成同名 providerId
  // 只会把一个悬空引用换成另一个，用户仍然看到不可用条目。
  const fixture = await setup({
    providers: withStandardPreset(PERSONAL_PROVIDER, "My Provider"),
    models: ModelConfigRules.empty(),
    defaultModelSelection: { providerId: RETIRED_BIGMODEL_PROVIDER, modelId: "GLM-4.6" },
  });
  try {
    await fixture.runtime.start();
    const persisted = await fixture.readPersisted();
    assert.equal(persisted.config.defaultModelSelection, undefined);
  } finally {
    await fixture.dispose();
  }
});

test("providerOrder / providers / 模型规则里的已下线 id 被清理，用户自己的 Provider 与选中项不受影响", async () => {
  const fixture = await setup({
    providers: ProviderConfigMap.empty()
      .setRule({
        providerId: RETIRED_ORDER_PROVIDER,
        providerName: "Z.ai Start Plan",
        config: new ProviderConfig({ group: "standard-personal" }),
      })
      .setRule({
        providerId: PERSONAL_PROVIDER,
        providerName: "My Provider",
        config: new ProviderConfig({ group: "standard-personal" }),
      }),
    models: ModelConfigRules.empty().setExact(
      RETIRED_ORDER_PROVIDER,
      "GLM-4.6",
      new ModelConfig({ properties: new ModelPropertiesConfig({ contextWindow: 128000 }) }),
    ),
    providerOrder: [RETIRED_ORDER_PROVIDER, PERSONAL_PROVIDER, RETIRED_ORDER_PROVIDER_2],
    defaultModelSelection: { providerId: PERSONAL_PROVIDER, modelId: "my-model" },
  });
  try {
    await fixture.runtime.start();
    const config = await fixture.runtime.configService.read();
    assert.equal(config.personalProviders.has(RETIRED_ORDER_PROVIDER), false);
    assert.equal(config.personalProviders.has(PERSONAL_PROVIDER), true);
    assert.deepEqual(config.personalProviderOrder, [PERSONAL_PROVIDER]);
    assert.equal(
      config.personalModels.getExact(RETIRED_ORDER_PROVIDER, "GLM-4.6")?.properties?.contextWindow,
      undefined,
    );
    const persisted = await fixture.readPersisted();
    assert.deepEqual(
      persisted.config.providerConfigRules.providerRules.map((rule) => rule.providerId),
      [PERSONAL_PROVIDER],
    );
    assert.deepEqual(persisted.config.modelConfigRules.providerModelRules, []);
    // 未命中清单的选中项必须原样保留。
    assert.deepEqual(persisted.config.defaultModelSelection, {
      providerId: PERSONAL_PROVIDER,
      modelId: "my-model",
    });
  } finally {
    await fixture.dispose();
  }
});

test("幂等：第二次启动不再写入，personal 配置逐字节不变", async () => {
  const first = await setup({
    providers: ProviderConfigMap.empty(),
    models: ModelConfigRules.empty(),
    defaultModelSelection: { providerId: RETIRED_ZAI_PROVIDER, modelId: "GLM-4.6" },
  });
  try {
    await first.runtime.start();
    const migrated = await readFile(first.personalFilePath, "utf8");
    const revision = (await first.runtime.configService.read()).personalRevision;
    first.runtime.dispose();

    const second = await setup();
    try {
      await writeFile(second.personalFilePath, migrated);
      await second.runtime.start();
      assert.equal(await readFile(second.personalFilePath, "utf8"), migrated);
      assert.equal((await second.runtime.configService.read()).personalRevision, revision);
    } finally {
      second.runtime.dispose();
    }
  } finally {
    await first.dispose();
  }
});

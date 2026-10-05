# Spec：移除智谱套餐体系，所有 Provider 拉平为普通预设

## 背景

ZCodium 是去智谱化的社区 fork，但剥离不彻底：模型设置仍保留「智谱」专区
（BigModel / Start Plan / Coding Plan）、首启强制弹套餐/API Key 引导、账号子系统
（zhipu-account access + 8 个 account:\* 内置 Provider）仍在数据源中。
本 PR 完成剥离：智谱（Z.ai / BigModel）降级为与 DeepSeek / Kimi 同类的普通 API-Key
预设，移除订阅（Coding Plan）的产品面。

## 产品行为

1. 模型设置导航不再有「智谱 / 自定义供应商」两个分区，所有 Provider 平铺；
   「添加供应商」模板列表不再出现 Coding Plan 条目，Z.ai API / BigModel API 与
   DeepSeek 等并列。
2. Start Plan（订阅）相关条目、连接方式选择、套餐状态卡全部不再出现。
3. 首次启动不再弹出 API Key / 套餐引导屏；无 Provider 时应用直接可用，
   用户从模型设置自行添加。
4. 自定义 Provider 的「检测可用模型」等既有功能不受影响。

## 数据层（唯一事实源）

`config/provider/zcode-builtin.json`（revision 30 → 31）：

- 删除 8 条 `account:*` providerRules（zai-family / bigmodel-family 的全部实体，
  access=zhipu-account）；
- 删除 `zai-api`（Z.ai Coding Plan）与 `bigmodel-api`（BigModel Coding Plan）两条
  套餐模板（access=zhipu-coding-plan-api-key）；
- 删除上述条目对应的孤儿 modelConfigRules；
- 保留 `zai-standard-api`（Z.ai API）与 `bigmodel-standard-api`（BigModel API）
  —— api-key 预设，与 DeepSeek 同类。

## UI 层

- `constants.ts`：清空 model provider family specs（`resolveModelProviderFamilySpecByProviderId`
  恒返回 null），family 分支（连接方式 / 套餐卡 / entitlements）在数据与 spec 双重缺失下
  不可达；相关组件代码本轮保留为 dormant，后续单独清理。
- 首启：Root.tsx 不再渲染 WelcomeScreen，`shouldEnableProviderAvailabilityLoginEntryGuard`
  返回 false（无账号体系后启动门禁失去前提）；WelcomeScreen/LoginApiKeyForm 文件
  保留 dormant。
- 导航分区按数据自然塌缩：family Provider 不存在，「智谱」分区标题不再渲染。

## 设置页「官方服务」开关收窄（BREAKING）

智谱套餐与官方账号能力随本 PR 消失后，设置页「Z.AI 服务连接」原有 7 个开关里有 5 个
变成「开关能开、功能不生效」的死开关。本节记录移除清单与后果。

### 移除的开关

`account`、`feedback`、`codingPlan`、`officialMcp`、`offPeak` 全部移除，只保留
`marketplace` 与 `clientConfig`。

**原因**：这 5 个能力全部依赖智谱套餐/官方账号体系。`config/provider/zcode-builtin.json`
里对应的 `zhipu-coding-plan-api-key` 模板已删除，family 入口在数据与 spec 双重缺失下不可达，
开关保留只会让用户以为功能可用。留下开关比删掉开关更糟：它把「能力不存在」伪装成
「需要你打开开关」。

这是 **BREAKING** 变更：

1. 存量用户 `setting.json` 里的 `officialServices.account` 等 5 个字段会在写盘时被
   zod strip（`officialServiceSwitchesSchema` 不再登记这些字段）。用户升级后开关列表
   从 7 项变 2 项，属预期行为，不做数据迁移。
2. 5 个能力对应的官方平台 URL 恒被拦截，报错文案明确指出具体功能「已在 ZCodium 下线」，
   不再是含糊的「已下线或未登记」。已下线路径的正则保留在
   `officialPlatformPolicy` 内部的 `REMOVED_OFFICIAL_SERVICE_PATH_RULES` 表（模块私有，
   与保留功能的路径表分开），只为让拦截理由可辨认。匹配顺序上已下线表优先：`account` 的
   `client/claim` 会被 `clientConfig` 的 `client` 前缀吞掉，反过来会让套餐认领路径在
   clientConfig 开启时被误放行。
3. `ZCODIUM_ENABLE_OFFICIAL_ACCOUNT` / `_FEEDBACK` / `_CODING_PLAN` / `_MCP` / `_OFFPEAK`
   五个环境变量不再有映射。留着会让用户 shell 里残留的 `=1` 看起来仍能放行。
4. 调用点从「开关关闭就拒绝」改为「恒拒绝」：`assertOfficialServiceAvailable` →
   `assertOfficialServiceRemoved`（恒抛）；原本靠开关退化成未接入态的入口
   （`oauthService` 的 7 处、`resolveOfficialMcpCredentials`）改为按已下线短路。
5. 账号子系统的物理删除**不在本 PR**：上游维护者要求另开 issue 跟踪，因此上述调用点的
   dormant 代码保留原样，只摘掉开关依赖并让文案诚实。

### clientConfig 语义收窄

`clientConfig` 保留，但含义收窄为「拉取 Z.AI 客户端配置与启动预热数据」，
**不再覆盖 Provider 模板**：模型预设以内置配置为唯一事实源。

本轮**不恢复** CDN 模板下载链路——它与已文档化的架构决策「builtin 是 builtin Provider
的唯一事实源，CDN 只是套餐模板的投递/复活通道」直接冲突；套餐模板已随本 PR 删除，
恢复该链路等于把已下线的套餐体系复活。

因此 `clientConfig` 实际控制范围仅剩 `clientConfigService`（插件商店排序等客户端配置）。
设置页文案已同步改写，避免用户以为打开它能拉到模型预设。

## 存量数据一次性迁移

builtin 删除只改变「可选项」，不会回头修改用户磁盘上的数据。个人 provider 配置
（`.zcodium/v2/provider_config.json`）里可能残留三类悬空引用：Provider 排序项、
按 Provider 命名的模型规则，以及 `defaultModelSelection`。因此本 PR 补一条显式的
一次性对账，而不是依赖读取时的兼容兜底。

### 悬空引用的来源

`apps/zcode-cli/packages/bootstrap/src/auth-login.ts` 在登录成功后调用
`repository.saveConfiguredDefault({ providerId, modelId })`，把选中的 provider/model
写进 `defaultModelSelection`。登录激活的正是那批 `account:*` Provider，所以**任何
登录过的老用户**，该字段的 `providerId` 都是本 PR 删除的 8 个 id 之一。

### 触发时机与状态所有者

- 唯一状态所有者是 `NodeProviderConfigRuntime`（`@zcode/provider-node`）拥有的
  `NodePersonalProviderConfigRepository`。桌面端、CLI、server 三个入口共用这一个
  Personal Repository 所有者，迁移挂在它的 `start()` 边界上，因此不存在
  「只有渲染进程才迁移」的缺口。放在 UI 会引入第二条写入路径，且桌面主进程与
  纯 CLI 进程不会执行。
- 判定与写入分离：先按当前快照空跑一次，无需变更就直接返回（不产生文件 IO 与
  失效通知）；确有残留才调 `personalRepository.update()`，由它持锁并在锁内重读快照
  重新判定，避免用加锁前的旧判定覆盖其他 writer。
- appSettings 侧（`providerFamilyDomain` 等）由 `settingService` 拥有，在
  `Root.tsx` 启动迁移里执行，先于既有的 `ensureProviderFamilyDomainMigration`。

### 清理范围（下线清单为显式常量）

清单取自 builtin revision 30→31 的删除项，写死在
`packages/provider-node/src/retired-zhipu-provider-migration.ts`：

- 8 条 `account:*` providerRules：`account:{zai,bigmodel}-{individual-coding-plan,
offpeak-idle-plan,start-plan,team-coding-plan}`；
- 2 条套餐模板：`zai-api`、`bigmodel-api`。

清理动作：剔除 `providers` 与 `providerOrder` 中的命中项、剔除 `models` 里
按已下线 providerId 命名的精确规则、剔除 `providerTemplates` 中的命中模板。

**不能用「不在 builtin 里就算下线」这种动态判断**：个人 provider 本来就不在 builtin 里，
那会误删用户自己创建的 Provider。

### 选中模型回退规则

`defaultModelSelection.providerId` 命中清单时：

- `account:zai-*` → 回退到 `zai-standard-api`，`account:bigmodel-*` → 回退到
  `bigmodel-standard-api`；按前缀分族是因为套餐名会随产品迭代增删，而这两个前缀是
  builtin 里唯一稳定的分族信号。
- **回退目标必须先证明存在**：`zai-standard-api` / `bigmodel-standard-api` 是 builtin
  模板而不是 Provider，Provider 要等用户在设置里用它创建才落进 personal 层，id 取
  模板名归一化后的种子（见 `@zcode/provider` 的 `nextPersonalProviderId`）。因此存在性
  只在 personal 层查；去智谱化后 builtin 的 `providers` 已被清空，拿 builtin 兜底等于
  走进空集。用户没创建过该预设时把 `defaultModelSelection` 清为 `undefined`——回退成
  同名 providerId 只是把一个悬空引用换成另一个。
- `modelId` 优先取该 personal Provider 自己的 `builtinModelIds[0]`，缺失时取 builtin
  模板的 `builtinModelIds[0]`；两者都取不到则清空选中项。
- 只保留 `providerId` + `modelId`，不继承旧 `options.reasoningLevel`——它属于账号
  套餐的模型清单，套到标准预设的同名模型上是伪造事实。

### appSettings 侧清理

`providerFamilyDomain` 的两个合法取值（`zai` / `bigmodel`）连同
`providerFamilyConnectionSelections` 的全部 key 都指向已下线的套餐体系，一次性清空。
一次性守卫用新增字段 `retiredProviderFamilySettingsPurged`，**不复用**
`providerFamilyDomainMigrated`：需要清理的恰恰是已经迁移过、带着旧 domain 的老用户，
复用那个守卫会直接跳过。清理时同时置位 `providerFamilyDomainMigrated`，否则同一次
启动里既有的 family 推断会把刚清掉的 domain 写回来。

### 幂等保证

provider 配置侧的幂等性来自数据本身而不是额外守卫字段：判定输入就是「当前快照里还有
没有已下线 id」，第一次执行后这些 id 全部消失，第二次必然判定为无需变更。空跑不写盘，
因此不产生新的文件版本（personal revision 是内容哈希）也不触发失效通知。
appSettings 侧由 `retiredProviderFamilySettingsPurged` 守卫，第二次执行直接返回。

### 失败语义

迁移失败不阻断启动：Personal 数据本身仍能加载，悬空条目只是不可用而非非法，失败只按
warn 上报。迁移幂等，下次启动会重试。

## 明确不做（本轮范围外）

- 物理删除 account-provider / coding-plan / OAuth / off-peak 子系统代码（跨
  services/CLI/desktop 上百文件，单独 PR）。

## 验收场景

1. 全新数据目录启动：无首启套餐屏，直接进入工作区。
2. 模型设置：左侧无「智谱」分区与 Start Plan；「添加供应商」列表中 Z.ai API /
   BigModel API 与 DeepSeek 并列，无 Coding Plan 条目。
3. 选择 Z.ai API 预设 + API Key + 添加模型（可用检测）→ 可执行、可对话。
4. 旧数据目录（曾有 account provider 残留配置）启动不崩溃：残留条目不自动消失，
   由「存量数据一次性迁移」在启动边界显式对账——`providerOrder` / `providers` /
   `models` 里的已下线 id 被剔除，`defaultModelSelection` 按 `account:zai-*` →
   `zai-standard-api`、`account:bigmodel-*` → `bigmodel-standard-api` 回退并取该预设
   首个 builtin 模型；该预设尚未被用户创建过则清空选中项。appSettings 的
   `providerFamilyDomain` 与按 family 的连接选择被清空。用户自己创建的 Provider 与
   未命中清单的选中项不受影响。
5. 迁移幂等：第二次启动不再写入 personal 配置，文件内容与 revision 逐字节不变；
   `setting.json` 也不再产生第二次 family 清理写入。

# 官方服务开关：持久化与进程投影

用户在设置页“Z.AI 服务连接”（`settings.officialServices`）逐个打开或关闭官方服务：`account`、`codingPlan`、`feedback`、`officialMcp`、`offPeak`、`marketplace`、`clientConfig`；对话分享已永久下线，不在开关列表内。

## 事实源与所有权

- **持久化唯一所有者**：`@zcode/services` 的 `settingService`（`packages/services/src/setting/settingService.ts`），唯一读写 `~/.zcode/v2/setting.json` 的组件。
- **运行时策略所有者**：`@zcode/shared` 的 `officialPlatformPolicy` 进程级开关；业务服务、网络拦截与 UI 只读该策略，禁止调用 `setOfficialServiceSwitches`。
- **schema 所有者**：`@zcode/shared` 的 `validationAppSettings`。`appSettingsSchema`（存储读取/写盘）与 `appSettingsPatchSchema`（更新入参）必须都登记 `officialServices`，使用同一 `officialServiceSwitchesSchema` 形状；字段可选，缺省视为全部关闭。
- 开关只决定“本进程是否允许连接对应官方平台功能”，不改变各业务服务的数据所有者、接口或本地状态。

## 投影路径（只有两条）

```text
设置页点击开关
  └─ settingService.update({ officialServices })
       ├─ 按 patch 投影到调用方进程（当前会话立即生效）
       └─ appSettingsSchema.parse(merged) 保留字段 → 写入 setting.json
  └─ renderer 经平台 syncAppSettings 通知 main（落盘已完成）
       └─ main 重读设置 → get 投影到 main 的 webRequest 拦截策略
       └─ 广播 SettingsChanged → 其它窗口 UI 重新读取设置 → 各自 Host 投影

任何进程读取设置
  └─ settingService.get()
       └─ 按磁盘值投影到当前进程（重启后的 Host/Server/main 首次读取即恢复）
```

- `update()` 内部不经过 `get()`，因此“先投影 patch、再读盘合并写回”不会把开关覆盖回旧值。
- `get()` 是幂等投影：重复读取同一设置不改变结果，也不产生额外写盘。
- main 不直接采用 renderer 的 patch 值，而是重读落盘后的设置再投影，避免部分 patch 把其它已打开开关归一为关闭。
- CLI/headless 没有设置文件读写入口，仍由 `ZCODIUM_ENABLE_OFFICIAL_*` 环境变量投影。
- 读取失败、字段缺失或 schema 校验失败时按全关投影（fail-closed），保持审计版默认断连语义。

## Desktop → Agent 的开关投影

Host 按同一份设置把开关投影到 **agent 子进程**：

```text
Host spawn agent（每次 spawn 都读当前设置）
  └─ resolveSpawnEnv 注入 buildOfficialServiceEnvPatch(settings.officialServices)
       └─ 完整键集（开=1、关=0）进入 agent spawn env
  └─ agent 协议入口（app-server / agent-server）启动时投影
       └─ setOfficialServiceSwitches(readOfficialServiceSwitchesFromEnv(env))
  └─ createZCodeApp 保留同一投影（幂等，覆盖不经协议入口的调用方）
```

- **必须写完整键集（含关闭=0）**：用户 shell 里可能残留 `ZCODIUM_ENABLE_OFFICIAL_*=1`；Desktop 的设置是唯一事实源，关闭项要显式覆盖为 `0`，不能依赖“缺键=关闭”。
- **协议入口必须投影**：插件市场管理等协议请求不经过 `createZCodeApp`；只在 app 创建时投影会让这些请求长期停在默认全关（表现为“打开插件市场开关没反应”）。
- **生效时机**：env 在 agent spawn 时读取，设置页切换开关后**重启应用或下一次 agent 启动**生效；设置页文案提示需重启应用。已运行的 agent 不因设置变化而重启。
- CLI/headless 不受此投影影响，继续由用户手动的 `ZCODIUM_ENABLE_OFFICIAL_*` 控制。
- `buildOfficialServiceEnvPatch` 是 env 映射的单一实现，与 `readOfficialServiceSwitchesFromEnv` 共用键映射，禁止在两处手写键名。

## 功能来源与开关

- **marketplace**：开关关闭时默认插件市场集合不包含官方 CDN 来源（`https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json`），插件市场只保留本地内置插件与个人来源；开关开启（且 agent env 投影为 1）时默认集合包含官方来源，插件市场可刷新并安装官方插件。
- 官方市场的网络出口由 agent HTTP 适配器的 `assertOfficialPlatformAccessible` 按 agent 进程开关裁决：关闭时刷新/下载在请求前拒绝。
- **关闭时的展示投影**：Host 的插件 overview 在开关关闭时将官方市场与官方候选插件从公开投影中过滤，并注入 `officialMarketplaceEnabled: false`；插件市场“公开”分段因此为空，展示引导文案（去 设置 → Z.AI 服务 打开“Z.AI 插件市场与 CDN”）。已安装插件列表不过滤，用户仍可管理本地已安装的插件。
- 本地市场记录与缓存不主动删除：重新打开开关后（Host 过滤即时解除）公开分段恢复可见；无需重启应用。
- 该展示投影以 Host 的实时开关为准（`settingService.get` 投影）；agent 侧刷新/下载仍以 agent env 投影为准（重启应用后生效）。
- **account**：浏览器授权登录入口只在用户主动打开的模型设置页（provider 详情）提供；OAuth 流程与 CLI 一致（浏览器授权 + Host 轮询 + deep link 回调），登录成功后由 Root 常驻 effect 收敛账号态。**首次启动的 WelcomeScreen 保持 API Key 表单与“跳过”，不出现 OAuth 入口、不自动触发登录、不强迫新用户登录**。account 开关关闭时点击浏览器登录会在服务层被拒绝，UI 给出开关引导提示。

## 不变量

1. `appSettingsSchema.parse({ ...settings, officialServices })` 必须保留 `officialServices`；写入 `setting.json` 后 `get()` 读回相同的布尔值。否则 UI 受控开关会在 `refresh()` 后回弹，表现为“开关无法点击”。
2. 打开某开关只放行该开关对应的官方服务；未打开的开关保持拒绝，不得因其他开关打开而放行。
3. 投影结果与设置文件一致；进程内开关不得成为独立事实源（不允许出现“UI 显示开启、服务层仍全关”）。
4. 关闭开关立即恢复拒绝；已发出的请求不回溯。

## 失败语义

- `update()` 写盘失败：调用方收到 reject；进程内已按 patch 投影。UI 当前以 fire-and-forget 方式调用，错误表现为开关回弹，不产生半持久化状态。
- `get()` 读盘失败或坏文件：返回默认设置并把进程开关投影为全关；坏文件沿用既有隔离逻辑。
- `setting.json` 中 `officialServices` 字段形状非法：整份设置读取回退默认值（与既有设置字段的 fail-closed 行为一致）。

## 验收

1. 设置页点击开关后开关保持打开/关闭，`setting.json` 出现 `officialServices` 且与 UI 一致。
2. 新进程（模拟 Host/Server 重启）只调用 `settingService.get()`，进程策略即恢复磁盘值：已开启服务 `assertOfficialServiceAvailable` 放行、`shouldBlockOfficialPlatformUrl` 不再拦截对应域名；未开启服务仍拒绝。
3. `update()` 到落盘出现在同一条写队列内，重复 `get()` 幂等。
4. main 的 webRequest 策略随设置变更即时刷新：当前会话内 renderer 对官方域名的请求立即放行/拦截，不依赖重启；其它窗口的 Host 通过 `SettingsChanged` 广播重新读取设置。
5. 真实业务入口：关闭时 `clientConfigService` / `offPeakServerClient` / `FeedbackHttpClient` 在凭证与网络前拒绝且不发起请求，`resolveRemoteCdnBaseUrls` 返回空；打开后分别真的拉取客户端配置、发出取号请求、发出反馈请求并出现 CDN 下载源。
6. Desktop → Agent 投影：`buildOfficialServiceEnvPatch` 输出完整 7 键（开=1/关=0）；开关关闭时覆盖 shell 残留的 `=1`；开关打开时 agent 的默认市场集合包含官方来源，关闭时不含。
7. account 浏览器登录：模型设置页提供“通过浏览器登录”；全新用户首次启动只看到 API Key 表单且可跳过，不出现 OAuth 入口、不自动登录。
8. marketplace 关闭态：Host overview 过滤官方市场与官方候选插件并注入 `officialMarketplaceEnabled=false`；“公开”分段为空并展示开关引导文案；已安装列表保留；打开/关闭切换即时生效（Host 实时开关），无需重启。
9. 回归测试：`appSettingsSchema` 保留字段、`update` 落盘、`get` 读回、跨进程投影、开关放行与真实业务入口、官方市场 seed 与 env 投影、关闭态公开投影过滤；`pnpm typecheck`、`pnpm lint`、架构检查通过。

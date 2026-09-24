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
6. 回归测试：`appSettingsSchema` 保留字段、`update` 落盘、`get` 读回、跨进程投影、开关放行与真实业务入口；`pnpm typecheck`、`pnpm lint`、架构检查通过。

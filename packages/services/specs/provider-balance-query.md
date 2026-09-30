# 外部 API Key Provider 余额查询

用户在模型设置里为外部供应商（DeepSeek、Moonshot/Kimi、SiliconFlow、StepFun、OpenRouter、Novita）配置 API Key 后，Provider 详情卡片展示该账户的余额。官方 Coding Plan / Start Plan 的套餐额度仍由既有 entitlement 链路负责，两者互不覆盖。

## 事实源与所有权

- **Provider 配置所有者**：`@zcode/provider` 的 Provider Settings（`providerRuntime.providerSettings` / 远端 workspace 的 `providerSettingsService`）。余额查询只读 `effectiveConfig` 的 `access`（仅 `type === "api-key"`）与 `api.baseUrl`，不写入任何配置。
- **余额查询所有者**：`@zcode/services` 的 `IUsageStatsService.getProviderBalanceSnapshot`，实现为 `ProviderBalanceProvider`（`packages/services/src/usage-stats/providers/`）。UI 只消费快照，不缓存、不推导余额。
- **供应商识别与解析所有者**：`providerBalanceSpecs.ts` 纯函数，按 `api.baseUrl` 主机名映射固定余额接口与解析器。网络请求由 `ProviderBalanceProvider` 发起。
- 余额是可选数据面：不进入 entitlement 快照，不改变 Provider 的启用/可执行状态。

## 识别与解析

| 供应商          | baseUrl 主机                          | 查询地址                                | 余额字段                                         |
| --------------- | ------------------------------------- | --------------------------------------- | ------------------------------------------------ |
| DeepSeek        | `api.deepseek.com`                    | `https://api.deepseek.com/user/balance` | `balance_infos[].total_balance`（按 `currency`） |
| Moonshot / Kimi | `api.moonshot.cn` / `api.moonshot.ai` | `https://{host}/v1/users/me/balance`    | `data.available_balance`                         |
| SiliconFlow     | `api.siliconflow.cn` / `.com`         | `https://{host}/v1/user/info`           | `data.totalBalance`                              |
| StepFun         | `api.stepfun.com` / `.ai`             | `https://{host}/v1/accounts`            | `balance`                                        |
| OpenRouter      | `openrouter.ai`                       | `https://openrouter.ai/api/v1/credits`  | `data.total_credits - data.total_usage`          |
| Novita AI       | `api.novita.ai`                       | `https://api.novita.ai/v3/user/balance` | `availableBalance / 10000`（USD）                |

- 查询地址是供应商固定接口，不从 `baseUrl` 拼接路径（同一供应商的 baseUrl 后缀可能是 `/anthropic` 等）。
- 供应商识别只看主机名，不信任 Provider 名称，也不为未知主机猜测接口。

## 状态与失败语义

`ProviderBalanceSnapshot.status` 取值：

- `ok`：查询成功，`balances` 非空。
- `unsupported`：无解析器 / providerId 为空 / 目标解析失败；UI 不渲染卡片。
- `not_configured`：命中供应商但缺少 API Key；UI 提示填写 Key。
- `unauthorized`：HTTP 401/403；UI 提示 Key 无效或过期。
- `error`：网络、解析或空响应；UI 提示稍后重试。

不变量：

1. 查询失败不抛出到 UI 崩溃链路，也不影响 Provider 配置与对话使用。
2. 快照不包含 API Key、请求头或原始响应体；`message` 只放稳定诊断码。
3. 余额请求不调用 `assertOfficialServiceAvailable`，不进入官方平台出口策略（外部主机不经官方域名判定）。
4. 未装配 `resolveProviderBalanceTarget` 的 Environment 一律返回 `unsupported`，不发起网络请求。

## 装配

```text
设置页 模型供应商详情（本机 root Environment 的 base services）
  └─ useProviderBalance → usageStatsService.getProviderBalanceSnapshot({ providerId })
       └─ ProviderBalanceProvider
            └─ resolveProviderBalanceTarget(providerId)
                 └─ Provider Settings View（本 Environment 的 effectiveConfig）

node.ts：resolveProviderBalanceTarget = createProviderBalanceTargetResolver(providerRuntime.providerSettings)
remoteWorkspaceServiceCollection.ts：远端 Environment 的 usageStatsService 装配同一 resolver 的远端版本（connectionServices.providerSettingsService）
```

- 设置页模型配置区域固定使用本机 Host（`SettingsPage` 注释：模型配置属于本机全局事实源），余额卡片因此展示本机（root Environment）Provider 的余额。
- 远端装配保证：远端 Environment 的 `usageStatsService` 被调用时，余额查询读取该 Environment 自己的 Provider Settings，而不是 Desktop 本地配置。
- 余额卡与卡片头部共存：`statusSection` 默认替代头部（plan/账号分支依赖），余额卡调用点显式传 `statusSectionSuppressesHeader={false}`。

## 验收

1. 配置 DeepSeek / Kimi / OpenRouter 等 API Key 的 Provider 详情卡片展示对应余额；未识别供应商不渲染卡片，且卡片头部（名称/开关/重命名/删除）保留。
2. 未填写 API Key 显示 `not_configured` 文案；无效 Key 显示 `unauthorized`；网络失败显示 `error` 且可点刷新重试；保存 API Key / baseUrl 后自动重查。
3. 余额卡片与设置页模型配置的事实源一致（本机 root Environment）；远端 Environment 的 `usageStatsService` 被调用时按该 Environment 的 Provider Settings 解析。
4. `resolveProviderBalanceProvider` 的识别与解析、`ProviderBalanceProvider` 的状态机有 `node:test` 覆盖（`packages/services/test/providerBalanceParsing.test.ts`、`packages/services/test/providerBalanceProvider.test.ts`）。
5. `pnpm typecheck`、`pnpm lint`、`pnpm architecture:check --changed` 通过；余额查询不破坏既有 Coding Plan entitlement 行为。

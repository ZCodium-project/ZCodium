# Spec：自定义 Provider 的可用模型自动检测

## 行为

在模型设置中为自定义 Provider 添加或编辑 Personal Model 时，用户可以用当前草稿中的
连接信息（API 格式、Base URL、API Key、自定义 headers）向该 Provider 发起一次
「列出可用模型」请求，从返回的模型 ID 列表中点选，回填到模型 ID 输入框。

- 检测入口仅对 access 为 API Key 的普通 Provider 暴露；`zhipu-account`（套餐账号）没有
  可用于草稿的 Key，不提供该入口。
- 检测使用**当前草稿值**，不要求先保存；未保存的 Base URL / API Key 修改会立即反映到下一次检测。
- 检测是**纯读**操作：不写配置、不改 Registry、不产生持久化状态。

## 状态所有者与边界

```text
用户点击「检测可用模型」（模型元数据对话框，草稿态）
  → UI hook 组装 { apiType, baseUrl, apiKey, headers }（当前草稿值）
  → RPC: IProviderSettingsService.listRemoteModels（ProxyChannel 泛化转发）
  → Host: 注入的 executor 执行 HTTP GET 并解析
      → buildRemoteModelListRequest / parseRemoteModelList（@zcode/provider 纯函数）
  ← 返回只读快照 { models: [{ id }] } 或 { success: false, message }
  → UI 渲染列表；点选仅写入 draft.idValue（本地草稿），保存仍走既有 addPersonalModel 链
```

- 配置的唯一 owner 仍是 Host 的 Provider ConfigService；检测不拥有任何持久状态。
- 网络请求由 Host 进程执行（Node fetch）：桌面 renderer、手机 Web、远程 workspace 都不
  直接访问 Provider API，避免 CORS 与密钥面扩大。
- 服务实现位于 `packages/services` 的 `createLocalServices` 装配中，桌面本地 Host、
  远程 server、Web server 共用同一实现；`ProxyChannel` 按方法名转发，无需改动 stdio 协议。

## URL 与鉴权语义（与正式执行链一致）

检测结果的 URL 语义必须与 `apps/zcode-cli/packages/adapters` 中正式模型执行链一致：

| apiType | 请求 URL | 鉴权头 |
| --- | --- | --- |
| `openai-chat-completions` / `openai-responses` | `{baseUrl 原样}/models`（不插入 `/v1`） | `Authorization: Bearer {apiKey}` |
| `anthropic-messages` | baseUrl 归一化补 `/v1` 后拼 `/models` | `x-api-key: {apiKey}`、`anthropic-version`、兼容网关同时补 `Authorization: Bearer` |

- 显式配置的 headers 保持最高优先级，检测头不覆盖同名显式头。
- Anthropic 分页：请求带 `?limit=1000`，若响应 `has_more` 为真则跟随 `after` 游标继续拉取，
  总页数上限 10 页，防止异常网关造成死循环。
- 响应解析接受 `{ data: [...] }`（OpenAI / Anthropic 标准形状）；忽略缺失或非字符串的
  `id`；解析不出任何形状时返回明确错误，不猜测。

## 失败语义

- 401/403/404/网络错误/超时都返回 `{ success: false, message }`，UI 展示原文消息；
  检测失败不影响手输模型 ID 的任何能力。
- 超时使用 AbortSignal（默认 15s），Host 侧注入的 fetch 可被测试替换。

## 不变量

1. 检测不落盘：任何失败或成功都不改变 Provider 配置、Registry 或视图 revision。
2. 手输不被替代：模型 ID 输入框始终可用，检测结果只是点选回填草稿。
3. 检测请求的 URL/头语义与正式执行链保持一致；两处语义分叉视为 bug。

## 验收场景

1. openai 兼容网关 + `https://host/v1` + 正确 Key → 返回模型列表，点选后 `draft.idValue` 回填。
2. anthropic 兼容网关 + 不带 `/v1` 的 baseUrl → 请求落到 `{base}/v1/models`，头包含
   `x-api-key` 与 `anthropic-version`。
3. 错误 Key → 列表区显示错误消息，草稿不变化，可重试。
4. 不支持 `/models` 的网关（404）→ 显示错误消息，手输不受影响。
5. 草稿未保存时点击检测 → 使用草稿值；修改 Base URL 后再检测使用新值。
6. `zhipu-account` Provider → 不渲染检测入口。
7. 连续点击检测 → pending 期间按钮禁用；旧响应晚到时由 stale token 守卫丢弃。

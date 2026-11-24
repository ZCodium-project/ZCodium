# Standard Compute API Key 预设

## 产品规则与所有者

- Built-in 配置唯一拥有 `standardcompute` 模板：OpenAI Chat Completions，Base URL 为
  `https://api.stdcmpt.com/v1`，用户显式填写 Bearer API Key。Key 管理入口为
  [Dashboard → API Keys](https://standardcompute.com/dashboard/api-keys)。
- 默认启用公共目录中的三个精确 ID：`StandardCompute`（动态路由）、`deepseek/deepseek-v4.1-flash`
  和 `z-ai/glm-5.3`。API 目录文档明确 `StandardCompute` 是可发送的路由 ID；快速开始里的小写
  `standardcompute` 也是请求示例，响应仍报告 `StandardCompute`。预设保留目录拼法以便与发现结果一致，
  不把 Anthropic Messages 的 `anthropic/claude-standardcompute` 作为 Chat 模型。
- 浏览模板和无 Key 创建均不对外请求；无 Key 的实例不可执行。使用已有通用图标，不打包未获分发授权的商标。

## 2026-11-24 官方证据与取舍

- [快速开始](https://docs.standardcompute.com/quickstart) 给出 Key 页与 Base URL；
  [Models API 说明](https://docs.standardcompute.com/api/models) 与
  [公共目录](https://api.stdcmpt.com/v1/models) 给出精确 ID。目录总窗分别为 1,000,000、
  1,048,576、1,048,576；仅 DeepSeek 条目声明接受图片。
- [Budgets and limits](https://docs.standardcompute.com/budgets-and-limits) 区分每请求输入与输出：
  试用约 500,000 输入 / 32,768 输出；付费约 850,000 输入 / 50,000 输出。预设不知道 Key 的套餐，
  对这三个 ID 采用试用安全值：输出硬上限 32,768；ZCode 的 **有效输入加输出总预算**取 500,000，
  不是目录的模型总窗，也不是另设的硬输入上限。正常满输出预算为输入预留至多 467,232（压缩时还会
  留安全余量）。当前配置没有独立输入帽字段，本地预算按估算运作；超大请求仍由供应商裁剪或拒绝。
  仅匹配 Standard Compute 的 Chat 站点和这三个 ID，不改变其他模型或供应商的通用规则。
- [Chat Completions](https://docs.standardcompute.com/api/chat-completions) 明确接收
  `max_completion_tokens`、`reasoning_effort`、工具和 SSE；
  [Reasoning](https://docs.standardcompute.com/reasoning) 明确省略该字段时用站点默认值。
  路由预设默认不发推理档位（可选 `low` / `high`）；DeepSeek 与 GLM 走站点声明的
  `reasoning_effort`，不发送原厂 `thinking` 对象。DeepSeek 的 `disabled` 发 `none`，站点可能为
  无法关闭推理的上游降到低档；GLM 保留 `low` / `high` / `max`。
- [Vercel AI SDK](https://docs.standardcompute.com/frameworks/vercel-ai-sdk) 给出兼容客户端和常规多轮工具
  调用范式；[OpenCode V1 指南](https://docs.standardcompute.com/agents/opencode) 另外提醒供应商结构化
  推理元数据可能需要专用适配器。ZCode 当前 Chat 客户端支持普通推理文本，不保证结构化
  `reasoning_details` 在回合间保真；本预设不新增适配器。无测试 Key，不实测有鉴权的路由及各上游续轮。

## 验收

1. Built-in 配置解析出三个启用模型、Key 管理 URL、通用图标和试用预算；其他站点的同名模型不受影响。
2. 生产客户端经受控 HTTP mock 发出精确模型 ID、Bearer、工具、站点推理字段及 32,768 输出预算；
   超预算不会发请求。SSE 消费不依赖真实密钥或额度。

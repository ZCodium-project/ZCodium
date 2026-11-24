# MartLLM API Key 预设

## 产品规则与所有者

- Built-in 配置唯一拥有 `martllm` 模板：API 为 `openai-chat-completions`，Base URL
  为 `https://api.martllm.com/v1`，鉴权为用户显式填写的 API Key；Key 管理入口为
  `https://martllm.com/dashboard/keys`。旧 UberLLM 域名与历史 Key 在服务端兼容；该预设从未发布，
  不增加旧模板、配置迁移或 URL 重写。
- 模板默认启用 `deepseek/deepseek-v4.1-flash` 与 `z-ai/glm-5.3`。站点规则仅给现行 MartLLM
  Chat 端点的这两个 ID 映射 `max_tokens` 和 `reasoning_effort`，不发原厂 `thinking`。
  DeepSeek 的 `disabled` 发 `none`，GLM 保留 `low` / `high` / `max`。
  共用规则继续拥有模型能力及有效预算（DeepSeek 1,000,000 / 384,000；GLM 1,000,000 / 128,000）。
- 模板浏览、创建和 Registry 初始化不向该供应商发网络请求；只有用户明确执行检测或推理
  才请求供应商。浏览模板不创建 Provider，创建无 Key 的 Provider 不可执行。
- 不增加 OAuth、后台自动探测或目录服务。使用已有通用图标，不打包未获分发授权的商标。

## 2026-11-24 核验依据

- [官方文档](https://martllm.com/docs)、[快速开始](https://martllm.com/docs/quickstart) 与
  [鉴权](https://martllm.com/docs/authentication) 确认改名、旧端点兼容、现行 Base URL 和 Key 页。
- 公共目录的 [DeepSeek](https://api.martllm.com/v1/models/deepseek/deepseek-v4.1-flash)：
  context 1,048,576 / max output 384,000、文本与图片；[GLM](https://api.martllm.com/v1/models/z-ai/glm-5.3)：
  context 1,000,000 / max output 131,072，仅文本。两者均列出工具、`max_tokens` 和 `reasoning_effort`，
  没有把 `max_completion_tokens` 列为支持的请求参数；目录响应里的 `top_provider.max_completion_tokens`
  是能力描述，不用作请求字段的证据。
- [OpenAI SDK 指南](https://martllm.com/docs/openai-sdk) 确认工具、`max_tokens` 和 reasoning 字段处理，
  [Streaming](https://martllm.com/docs/streaming) 确认 SSE 及使用量结束块。
  [WeKnora #5389](https://github.com/Tencent/WeKnora/pull/5389) 另记录 DeepSeek `none` 与 GLM 离散档位的
  有鉴权测试，这是第三方的观测，不是本仓库的实网验证或各卖家的兼容保证。

## 验收

1. 真实 Built-in schema / rules 解析后，现行模板和 Key URL 正确，两模型完整、默认启用且预算不超目录；
   同名模型在其他站点的映射不变。
2. 无 Key 创建 Provider 不触发网络，不默认可执行；不产生自动目录行为。
3. 生产客户端在受控 HTTP mock 上使用现行路径、Bearer、`max_tokens`、`reasoning_effort` 与工具字段，
   并解析 SSE 正文、普通推理、工具调用及使用量。不使用真实 Key，不验证实际卖家选择、计费、SSE 与
   跨轮结构化推理兼容性。

# UberLLM API Key 预设

## 产品规则与所有者

- Built-in 配置唯一拥有 `uberllm` 模板：API 为 `openai-chat-completions`，Base URL
  为 `https://api.uberllm.dev/v1`，鉴权为用户显式填写的 API Key；Key 管理入口为
  `https://uberllm.dev/dashboard/keys`。
- 模板默认启用 `deepseek/deepseek-v4.1-flash` 与 `z-ai/glm-5.3`，能力、推理参数、limits
  复用已有通用 modelRules（`deepseek-v4[.-]1-flash`、`glm-5\.3`），不新增重复站点规则。
  不新增 OAuth、目录服务或后台自动探测。
- 模板浏览、创建和 Registry 初始化不向该供应商发网络请求；只有用户明确执行检测或推理
  才请求供应商。浏览模板不创建 Provider，创建无 Key 的 Provider 不可执行。
- Logo 仅由 UI 的资源 key 解析器映射打包素材，运行时不访问来源网站。浅色/深色使用独立
  方形 SVG；不含脚本、外链或嵌入字体。

## 2026-11-10 核验依据

- [快速开始文档](https://uberllm.dev/docs/quickstart)：OpenAI 兼容 URL 与 Bearer API Key。
- [公共模型目录 API](https://api.uberllm.dev/v1/models)（无需 Key）：
  `deepseek/deepseek-v4.1-flash` context 1,048,576 / max output 384,000，文本与图片输入；
  `z-ai/glm-5.3` context 1,000,000 / max output 131,072，仅文本。通用规则的 limits
  （1,000,000 / 384,000 与 1,000,000 / 128,000）不超过目录值。
- 价格页：<https://uberllm.dev/models>。检查与测试使用固定已核验数据，不在测试时请求远端，
  不把接口缓存或真实 Key 写入仓库。
- Logo 取自官网 [favicon.svg](https://uberllm.dev/favicon.svg) 的官方图形：去掉背景色块，
  路径不变，viewBox 裁为方形，按主题替换描边/填充颜色。

## 验收

1. 真实 Built-in schema / rules 解析后，两模型配置完整、默认启用且 limits 与通用规则一致。
2. 无 Key 创建 Provider 不触发网络，不默认可执行；不产生自动目录行为。
3. 模板 logo key、UI 映射、manifest 与两份本地 SVG 一致；主题资源方形、无远端引用，
   来源可追溯。

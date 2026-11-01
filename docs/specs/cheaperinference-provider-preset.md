# Cheaper Inference API Key 预设

## 产品规则与所有者

- Built-in 配置唯一拥有 `cheaperinference` 模板：API 为 `openai-chat-completions`，Base URL
  为 `https://api.cheaperinference.com/v1`，鉴权为用户显式填写的 API Key。
- 模板默认启用 `gpt-5.4-mini` 与 `claude-sonnet-5`，能力、推理参数、limits 复用已有通用
  modelRules，不新增重复站点规则。不新增 OAuth、目录服务或后台自动探测。
- 模板浏览、创建和 Registry 初始化不向该供应商发网络请求；只有用户明确执行检测或推理
  才请求供应商。浏览模板不创建 Provider，创建无 Key 的 Provider 不可执行。
- Logo 仅由 UI 的资源 key 解析器映射打包素材，运行时不访问来源网站。浅色/深色使用独立
  方形 SVG；不含脚本、外链或嵌入字体。

## 2026-11-02 核验依据

- [官方文档](https://www.cheaperinference.com/docs)：OpenAI 兼容 URL 与 Bearer API Key。
- [gpt-5.4-mini 官方目录](https://www.cheaperinference.com/models/gpt-5.4-mini)：
  context 400,000 / max output 128,000。
- [claude-sonnet-5 官方目录](https://www.cheaperinference.com/models/claude-sonnet-5)：
  context 1,000,000 / max output 128,000。
- [公共目录 API](https://api.cheaperinference.com/public/models) 是网关实时依据。检查与测试
  使用固定已核验数据，不在测试时请求远端，不把接口缓存或真实 Key 写入仓库。
- 原 PR 使用无法追溯的 `user-provided:ci-logo.svg`，且图形与当前官网不同。改用
  [LobeHub Mono 资源](https://github.com/lobehub/lobe-icons/blob/63ef3f5900f7387b3024c920f6c1978672d8f9e4/src/CheaperInference/components/Mono.tsx)
  的现行品牌路径，保留 MIT 许可全文和来源（品牌商标权仍归 Cheaper Inference）；仅按主题
  替换 currentColor。官网 [icon.svg](https://www.cheaperinference.com/icon.svg) 用于形状交叉核对。

## 验收

1. 真实 Built-in schema / rules 解析后，两模型配置完整、默认启用且 limits 精确一致。
2. 无 Key 创建 Provider 不触发网络，不默认可执行；不产生自动目录行为。
3. 模板 logo key、UI 映射、manifest 与两份本地 SVG 一致；主题资源方形、无远端引用，
   来源可追溯且附 MIT notice。

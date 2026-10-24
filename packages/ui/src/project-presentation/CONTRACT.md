# 项目设备展示

本模块收口项目侧栏与设备设置共用的 Source 名称、状态、结构化操作日志及错误展示投影。
Registry 按原服务实例订阅，只是只读投影；Host 仍独占连接/入口/恢复事实，Root/SSH 独占交互意图。
组件通过 hooks 读取服务，不建立 Agent、不维护第二份运行队列，不从路径推断设备身份。
跨模块公开入口为 architecture-policy.yaml 中逐路径登记的已有 hooks/展示文件；不接管整个 hooks/lib/store。

# #68：自有远端运行时源与离线导入

## 产品规则

- 发布版默认下载根为当前仓库 Release 的完整版本地址 `https://github.com/<repository>/releases/download/v<appVersion>`，由发布工作流注入；本地构建默认本仓地址。不得回退官方 CDN，不使用 latest，也不借用上游版本包。
- 远程连接向导提供应用级「运行时资源」设置：自动（自有源）、自定义 HTTP(S) 镜像、仅离线。镜像使用完整版本目录；显式环境变量源覆盖默认自有源，但不得覆盖仅离线禁网规则。
- 「导入离线运行时」选择本机目录，目录内包含当前版本的 `source-server-release.json` 和至少一个对应平台的 `zcode-server-<target>.tar.gz`。不把所有平台运行时内置到 DMG。
- Host 校验严格 schema、版本、平台、文件名、普通文件、大小与 SHA-256；可只导入描述文件所列平台的子集。任何已提供的包损坏则整体导入失败，不改变原有可用导入。
- 导入成功后将校验过的文件放入内容寻址的独立缓存代，最后原子发布指针，再由 UI 保存仅离线偏好；UI 不保存另一份导入事实。
- 仅离线优先使用已导入包，否则使用完整且校验通过的当前版本缓存。缺包、版本不匹配、损坏必须立即明确报错；不得 fetch 描述文件，不得把 URL 交给远端下载，即使 SSH 配置选择 remote-download 也走本地上传。
- 在线本地上传路径优先完整导入/缓存，缺失才联网；在线远端直下载语义继续保留。自定义源不得因失败回退默认公网或官方 CDN。
- 开发态 development-content-addressed 仍只读本轮 staging，除非用户明确选择仅离线；不得因普通缓存存在而掩盖开发 staging 缺失。
- 已有兼容 Source Server 直接连接；新装、升级复用现有安装/升级准入、busy guard、取消和回滚，不另建运行时、Host 或任务队列。
- 旧向导尚未接上 R3 首次安装准入：连接失败须保留 Host reasonCode；只有 install-required 才显示明确的「安装并连接」确认，确认后以新 requestId 携带 confirmSourceServerInstall 重试一次。取消回配置页，普通错误不重试，升级 busy guard 不被该确认绕过。
- Local Host 初始化必须注入与手动连接相同的 remoteAssets，确保导入、冷启动重连和更新都拥有相同缓存根。资源策略在每次解析准入时读取，不通过切换设置拆除既有连接。
- 安装和握手后 Main 下发 scoped MessagePort 必须包含 sourceServerId、workspacePath、workspaceIdentity 及可选 purpose；Preload 与 Renderer 保持严格校验，store 注册完才确认 ready。不能通过放松 schema 或加长 ready 超时掩盖元数据丢失。
- 选择远端目录时必须先等 Host 的 bind 完成 ACK（携带权威 canonical descriptor），再换代 renderer port，收到正确窗口/attachment 的 ready 后返回结构化 IPC result。旧 Main 提前返回 void 会让 Preload 解包失败并由 UI 释放仍在绑定的 session。绑定取消/窗口关闭/Host 退出只回收对应 request，不连坐其他 attachment；迟到 ACK 不得发布。
- Source 会话在 bind 后必须从新一代 store 读取 Host canonical identity，用它提交 tab/历史/手机路由；不得继续使用 bind 前由 SSH 线路推导的旧 identity。无 sourceServerId 的旧链路保留已有兼容行为。

## 所有权与接口

- SettingService：唯一持久化应用偏好 `remoteRuntimeAssets`（缺省保持自动模式）。
- UI：RemoteConnectionFields 复用设置 hook 与 IPlatformService.selectDirectory；只持有输入草稿/导入进行中状态。
- ISourceServerManagementService.importOfflineRuntime(directory)：本机 Local Host RPC；严格校验参数/结果，由 Host release resolver 导入并返回版本与平台摘要。
- Host sourceServerReleaseResolver：唯一资源验证、导入缓存与部署资源解析 owner。Main 仅提供原生目录选择和注入发行源，不持有导入业务状态。
- 内部 remoteAssets 通道增加可选资源策略，保持旧消息与本地 fallback 兼容；版本源/模式不参与 workspaceIdentity，不改身份隔离。

```text
用户选目录 → UI hook → Local Host 导入命令
                         ├─ 校验源文件 → staging → 复验副本
                         └─ 原子发布内容代指针 → 返回摘要 → SettingService 写仅离线
SSH 安装请求 → 同一 Host resolver → 版本/平台/SHA 校验 → 本地上传 → 既有安装 guard → 握手
仅离线：断开所有资源网络出口；失败终止，不触发公网兜底。
```

幂等键为版本及描述文件内容哈希；提交点为指针原子 rename。并发导入使用不同 staging，读取只接受完整代；迟到 UI 返回不覆盖用户后来切换的策略。Desktop continuous 与手机 replayable 不改消息流、owner/lease 或恢复语义；手机不提供本机文件导入入口。

## 验收

- 默认完整 URL 包含 `/download/v<version>`，无 `/v/<version>`，发行构建注入跟随 github.repository；官方域名从候选中消失。
- 自定义镜像独占且版本严格匹配，完整缓存命中时 fetch 次数为零。
- 离线有效包、缺包、错版本/平台、损坏、符号链接、重复平台；失败不改变旧代。全局 fetch 与注入 fetch 均设为抛错仍能离线解析、预览、上传安装。
- 内网路径不能触发 remote-download；无网络仍能新装 SSH 并完成真实协议握手，重连不重复部署。
- 取消/升级 busy guard 不回归；导入中用户切换模式不被旧结果覆盖。
- 真实打包应用中选择目录、导入、状态反馈、深浅主题与窄窗口可用；Web 不展示本机导入。
- typecheck、lint、格式、架构检查、目标单测和可运行的交互测试通过。发布 1.16.3 后验证下载资产、校验和、离线使用说明；只有验证及发布完成后才评论并关闭 #68。

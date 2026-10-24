# 配置目录 Catalog

项目服务拥有 roots，Catalog 只读项目与仍保留的远端入口，按 workspace identity/path 去重，不从 tab 或旧 settings 集合推导目录成员。不读取任务、不创建项目/Agent/连接，未打开 tab 的 root 可配置。

`resolveWorkflowRunProjectOwnership` 只投影调用方已有 Host 树中的父会话归属，不主动查询任务，不按 cwd 推断项目；供本仓完成卡和运行侧板保持同一项目创建语义。

请求前后校验 Host membership 与入口 ID，丢弃删除/重加后的迟到远端结果。UI 只持有读取结果与加载状态；state:projects 通知触发重读。读取失败不沿用另一 Host 的配置目标。

Desktop 远端配置复用已有 Source settings attachment；仅在选中远端且无 logical attachment 时请求它。canonical resolve 完成前不可写。手机继续使用可信 shared-host workspace attachment，不请求桌面 Source settings 或启动独立 Host。配置 hooks 与 conversation hooks 分开，后者不能获得配置专用服务集合。显式本机目录固定用 base Host，不按同路径的活动远端 tab 猜测身份。

模块依赖既有 UI 的 tab 类型、workspace hooks、配置 attachment store 与 logger；这些是适配入口，不新增目录事实源。可选 sourceServerId 为 undefined 时展示所有 Host，null 仅本机，字符串仅对应 Source；可供 Source 管理页面接线复用。

`useConfigWorkspaceCatalog` 同时提供 targets/loading：初次读取或 Host 换代尚未返回时不能将空投影判定为“目标已删除”，也不能自动改选 User 并开放另一目录的写入。`useConfigWorkspaceTargets` 是只需候选数组的消费者入口。

# 手机项目桥接

Host 是项目与执行目录的唯一准入 owner。已配对的 Web 传输只发送 project/task 意图，接收 Host 返回的
workspacePath/workspaceIdentity/remoteSessionId，并以 web-remote-replayable attachment 连接同一运行时。
新 Root 显式接收 initialTaskDraft 与稳定设备隔离的 composerClientNamespace；未归类目录复用 UI 原草稿 owner。
导航代际、原发起者资格与可选窗口目录 capability 都需在异步交付前复验。失败保留原 Root，不新起 Agent/Host。

本模块不恢复官方账号或授权服务。当前发行入口的远控授权被审计策略显式移除，授权恢复需要另行裁决；
不能把普通 Web Server 的本地会话伪装成已配对手机 attachment，或用缺失授权的兼容 no-op 代替真实传输。

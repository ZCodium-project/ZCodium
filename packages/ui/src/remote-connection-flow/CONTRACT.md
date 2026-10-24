# 远程连接进度展示适配（ZUP10）

这是审计版 SSHDialog 的薄 UI 投影，不是连接状态机或连接管理器。Host / 原窗口连接 owner 和 SSHDialog 仍分别拥有 attachment / 连接请求与向导编辑态；本模块不发起连接、不保存业务状态、不恢复 request、不导航。

```text
原 SSHDialog 实际 step/loading/error/session/request/logs → 纯脱敏投影
                                                      → 稳定 publish Context
                                                      → read Context → 收起卡
用户点恢复 → 原 applyOpenState(true)
用户点取消 → 原 handleCloseRequest → 确认 → 原 requestId/session 精准清理
用户显式选择目录 → 原 onSelectProject → #68 canonical bind（本模块不参与）
```

Root 需常驻一个 `RemoteConnectionProgressProvider`，包住唯一发布方 SSHDialog 和设备管理页；Provider 不随设置切换销毁。Publish Context 和 read Context 分离，发布方不订阅自己的投影；发布者卸载时清空展示，投影改变不触发业务副作用。桌面 continuous / 手机 replayable 的原 attachment 与序列语义保持不变。

投影只使用已有事实；ready 只表示当前有 connectedSessionId 且停在目录步骤，没有加载或目录提交。ready 不调用恢复、选择目录或导航。无假百分比、计时器、阶段猜测或第二份日志累积。日志来自现有 hook 的 requestId 过滤结果。

Target 使用白名单展示字段，丢弃 password、passphrase、token、私钥路径、资源包；Server URL 丢弃 userinfo/query/hash。错误和日志使用共享脱敏及原 target 中精确 secret 替换，Provider 不保存原 target、凭据或服务实例。

保留原向导的安装确认、offline/runtimeAssets、取消和完成步骤。已有完成逻辑会重新显示向导；本适配不改变它，更不会自动选择项目。外部需要改变“完成后是否拉起向导”时，应在原 owner 的可见性合同单独裁决，不能由展示 Context 反写。

## 回归场景

- 初始空闲返回 null；进行中/失败/目录 ready 来自实际字段，重置后清空。
- 含 secret 的 SSH/Server target、错误、日志不进入共享展示数据。
- Context 更新不会反复重渲染发布方；更新投影不调用 resume/cancel，卸载清空。
- 收起卡显示真实最近日志，不提供猜测百分比；用户点击才调用原 resume/cancel。
- 原 SSHDialog 目录拒绝、重复提交、install-required 准入与精准取消回归保持。
- 真实 SSH、背景完成后手动选目录、桌面/窄屏、浅深主题 GUI 本任务禁止启动，待验收。

# 自有 Source 设备管理（ZUP10）

固定参照 `zai-org/ZCode@3c5b227649371507ddc4eb46ac5133afe6db1cab`。管理入口位于设置 → 远程设备，只呈现用户自有 SSH / WSL / Docker Source，不恢复官方账号、CDN、遥测或套餐入口。

## Owner 与接口

Host `ISourceServerManagementService` 是设备、线路、身份、迁移和操作日志的唯一 owner。UI 经已有 hooks 读取同一 Host 的单调 generation 快照，保存只提交既有命令。UI 仅保存表单草稿、展开状态和按设备互斥的在途操作投影。

```text
设置页 → 同窗口公开 callbacks → 既有 Root 连接 owner → install-required 显式确认 → canonical bind
      └→ hook → Host 管理服务 → 状态/目录事件 → generation 快照 → 设备卡
升级 → updateSource(force=false) → busy guard → 展示运行任务 + 用户确认 → force=true
后台完成 → 同一 Host 状态/日志 + toast；不打开项目、不切换 tab、不抢导航
桌面 continuous / 手机 replayable 复用既有 attachment，管理页不创建 runtime 或连接 manager
```

编辑复用本仓 `RemoteConnectionFields`，保留 #68 runtimeAssets 镜像/离线导入与仅离线设置。沿用保存凭据的留空语义，不把占位文本作为密码提交；保留 resourcePackages 与 SSH alias。连接/断开/新建/打开项目只走传入 callbacks，未接通的平台不显示可点击但无效的操作。

## 回归与验收

| 场景       | 确定性回归                                                                                | 真实链路（本任务禁止 GUI，待执行）                     |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 设备与线路 | 列表、首选、编辑、离线移除与身份确认均有可访问入口                                        | 自有 SSH/WSL/Docker 设备编辑后重连，canonical 身份不变 |
| 升级准入   | 初次始终 force=false；只有 running-tasks 错误且明确同意后 force=true；拒绝/其它错误不强制 | 运行任务时升级，检查任务清单、取消和强制升级           |
| 编辑凭据   | 空密码沿用凭据；端口范围验证；保留离线模式、资源包与 alias                                | 离线包安装、密码/私钥重新连接                          |
| 迁移       | 报告入口、最新失败记录重试/放弃确认；不重跑历史 SQL                                       | 构造迁移冲突后重试和查看结果                           |
| 生命周期   | 面板卸载后不导航；快照与日志由已有 hook 防迟到；不同设备互不阻塞                          | 升级/连接最小化后切页，后台完成不抢当前任务            |
| 布局       | 共享设计 token、响应式换行、国际化消息                                                    | 桌面/窄屏、Zai Light/Dark、中英文键盘操作              |

源码/定向 UT 不等于真实 SSH GUI 验收；未执行的设备和跨平台验证必须单列。

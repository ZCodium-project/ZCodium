# #109 历史管理与模型启动门禁

## 范围与证据

修复基线：`f34d4869bb3613261e235986d9d3f89ea8ce1211`。独立分支
`fix/archive-control-no-model`；不移动冻结 tag，不涉及发布 notes、CI runner 或 NAV99 pending 夹具。

真实包日志已定位到 `windowController.mutateTask(delete)` → `deleteTask` →
`mutation.execute` → `sendConversationCommandV4` → `getClient` →
`startModelExecutionClient(providerNotReady)`，尚未到 CLI 就失败。归档/取消归档仍为 Host-only。

本次源码回归还确认两处链路缺口：

- 已定义的 `CommandInbox.prepareDecision` 尚未接入 gateway，原有真实 SQLite 冷
  rename/delete 集成用例也返回 rejected。只换 Host 客户端不足以修复未打开的历史任务。
- 原生 delete handler 没有 busy 检查，会直接调用软删除/关闭。基线 loader 下五种
  busy 事实用例全部表现为“不拒绝”，不能把无模型控制面变成绕过运行保护的入口。

## 最小公共合同

共享 `isSessionHistoryManagementCommand` 仅识别 rename/delete；新命令默认不放行。
Host 复用现有只读/控制面 client，不提升模型执行能力；CLI 在同一个 inbox 内查重、
串行 admission、cold READY/restore/hydration，再由原 handler 修改事实。缺失会话拒绝，
重复删除不恢复。删除 busy 会话回 `guard.sessionBusy`，不先 stop；busy 重命名仍可用。

冷恢复的项目目录仍由现有 `session/requestRuntimePreferences` 的
`runtime-materialization` 反向请求交给 Host 解析。Host/CLI 两侧专项验证附加目录在
materialization 时进入唯一 runtime，后续订阅不会覆盖它；不新增 wire 字段或存储旁路。
owner/lease、地址检查、workspace identity、可信 continuous/replayable 连接保持原链路。
没有新增 schema、迁移、Provider/key 或 timeout 兜底。

## 实际验证（macOS，Node 24.14.0，pnpm 10.33.2）

先更新 spec、跑失败回归，再实现。Host 六个初始冷启动回归均复现 provider 门禁错误；
CLI 冷管理四例复现 rejected；使用精确基线源码 loader 验证五种 busy 事实未获保护。

| 验证 | 结果 |
| --- | --- |
| 根定向 5 文件：Host V4、Provider Registry、hook trust、共享 command、Window Controller | 191 通过 |
| 调用方：task-facts contract、task index syncer | 78 通过 |
| CLI：command inbox、native session management、native commands | 111 通过 |
| CLI `#109` 专项（真实 SQLite + server/binder/App/Core，以及 native busy guards） | 11 通过 |
| Host `#109` 专项 | 12 通过（包含在 191 中） |
| 根 `pnpm typecheck` | 通过 |
| `pnpm --dir apps/zcode-cli typecheck` | 30 tasks 成功，26 命中缓存；改动 bootstrap 实际检查 |
| 根 `pnpm lint` | 0 errors、116 warnings |
| CLI lint | 0 errors、76 warnings、12 项上游存量行数诊断 |
| `pnpm architecture:check --changed` | 0 violations / baseline / new |
| 改动 TS 格式检查、`git diff --check` | 通过 |

扩大到 CLI 六文件（上述 inbox/session management，加 cold resume、gateway、
sessions-index、history-first）为 **244 通过、45 失败**，不能写成全通过。
只读 loader 用精确基线 gateway/session handler 做 A/B（排除新增 `#109` 例）：
**233 通过、45 失败、11 跳过，失败名单完全一致**。分布为 gateway 33、
sessions-index 2、cold resume 的 historyFirst 1、history-first 9；本修复不处理这些既有缺口。

无效/禁用配置覆盖的是 Host readiness 边界夹具（读取报错/过滤后的空执行视图），CLI
使用真实空 Registry 验证管理与持久化。空 Registry 管理测试阻断并断言零 fetch；真实 busy
执行使用进程内本地 model executor，没有访问外网模型。协议集成不代表完整 GUI 验收。

架构 checker 对当前配置规则通过；services/shared/CLI 是 legacy 模块，不能据此宣称所有
运行时边界都已被静态治理覆盖。运行时边界证据来自以上定向测试。

## 生产影响与真实包验收建议

- 无可执行模型时可以删除/重命名真实历史；管理启动的 CLI 不能因此发送/创建/恢复模型任务。
- CLI 冷恢复补齐未打开历史任务的管理能力；删除仍为软删除，标题/存在性由 CLI 唯一持有。
- busy 删除现在明确拒绝、不停止执行；调用方应显示失败并保留任务，而不是提示删除成功。
- 在合入修复后的实际候选包中：准备真实 CLI 历史 → 归档 → 退出 → 清空/禁用模型配置 →
  冷启动 → 取消归档、重命名、删除 → 再重启确认不复活；确认只有一个 workspace CLI，模型请求为零。
- 桌面 continuous 与手机 shared-host replayable 均验证上述流程；再用本地模型夹具挂起
  一个 turn 验证删除 busy 失败，停止后用新操作删除成功。远端还应验证错误 owner/identity 拒绝。
- 本工作树未跑完整 Electron GUI、手机实机或 Windows/Linux；这些不能用本地协议集成替代。

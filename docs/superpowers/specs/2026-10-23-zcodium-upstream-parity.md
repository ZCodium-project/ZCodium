# ZCodium：官方 3.16.2 非官方服务能力对齐

## 范围与边界

- 用户要求：同步官方开源版本中不涉及官方服务的能力，明确包含同一项目多个文件夹的能力和 UI，不接受只存在底层类型或按钮。
- 固定比对源：`zai-org/ZCode@3c5b227649371507ddc4eb46ac5133afe6db1cab`，其 package 版本为 3.16.2；它不是官方同名 tag。ZCodium 起点为 `61eef508`（1.16.3）。工单 #79。
- 保留 `.zcodium` 数据根、品牌、独立版本、MIT、遥测/仓库上传剥离及官方服务默认关闭。不能为了 UI 编译通过恢复已移除的遥测 SDK、官方账号/购买/上报或外部 relay 服务依赖。
- 先盘点 #62/#64 选择性同步留下的真实产品差异，以用户可访问入口、提交、持久化及运行时行为判断是否对齐；文件 diff 或历史 spec 不是交付证据。独立缺口逐项列明，不把多目录完成描述为“所有能力已对齐”。

## 2026-10-24 发布授权与版本

- 用户已明确要求“发布新版，然后更新日志写清楚”。本轮从本地验证阶段进入正式提交、关联 #79 的 PR、合并和发布阶段，不再沿用“没有发布授权”的旧状态。
- 版本为 `1.17.0`：沿用本仓 README 的独立版本约定，次版本表示一次新的经审计上游能力同步，不代表存在官方 `3.17.0`；固定上游仍为前述 3.16.2 源码。只更新应用根版本，CLI/插件等独立包不集体改号。
- 使用本仓 GitHub Release 工作流构建 CLI、五个平台/架构桌面产物及四平台远端运行时。新 tag/new draft 独立于 v1.16.3，不覆盖旧 tag、安装包或运行时。
- 先完成 PR 检查与许可台账验证，再由正式工作流生成 draft。所有安装包、运行时、校验和、唯一更新清单验证成功后才公开并设置 Latest；构建失败保持 draft，不手动跳过完整性门禁。
- 更新日志必须说明新能力、已确认的修复机制、配置/数据与旧会话 cwd 的不变量、实测范围、已有 CLI 基线失败及未验证的平台/设备，不宣传全平台 E2E 或官方公网手机入口已经贯通。官方账号、购买、分享与遥测仍不恢复。

## 多文件夹产品合同（沿用已存在的上游裁决）

- 本地项目允许 0..n 个 roots，支持系统一次多选、继续添加、移除、去重、改名和设置主要目录；真实目录不作为项目树第二层节点。
- 项目使用已有 `IProjectService` / Host ProjectRepository / projects + project_roots，不能在 settings、localStorage 或 UI store 再建一套项目权威数据。UI 只持有编辑草稿和 Host 只读投影。
- 新任务按所选项目的主要目录准备，项目 ID 与 host ID 贯穿草稿和首次接纳；同 cwd 的不同项目草稿必须隔离。无目录的本地项目由既有 Host prepareSession 分配默认目录。
- 已创建会话 cwd 永不因改主要目录、移除 root 或移动项目而改写。普通会话附加目录为当前 roots 除该会话 cwd，在下一次 runtime materialization 解析；运行实例不因重订阅或网络重连刷新目录。
- 创建、显式恢复、V4 subscribe 冷恢复都传递 Host 解析的 additionalDirectories。CLI 不接触项目业务，只消费目录列表；不得掉回仅 cwd 的能力装配。
- 附加目录参与 skills、commands、subagents、可读写路径范围及文件提及；同名能力保留限定来源。AGENTS.md、settings、MCP、hooks、plugins、memory、permissions 仍只读会话绑定目录链，不扩大可执行配置的信任面。
- 远程仍遵守官方现行单固定 root、先项目后会话规则；不得把本地多目录能力扩展成远程任意目录，也不得把路径当 identity。本轮保持 #68 已验收的离线安装、Host canonical bind、取消与 attachment 边界。
- 删除项目是容器软删除，任务正文与既有归属保留；旧迁移 ID / SQL / checksum 不变，不为 UI 同步重跑迁移或清理用户数据。

## Owner 与时序

```text
项目编辑草稿 → UI hook → 当前 Host IProjectService.saveProject → Repository 原子写入
                                                           └→ readTree 投影 → 桌面/Web/手机 UI
项目内新任务 → Host prepareSession → cwd + projectId + additionalDirectories → 草稿 → CLI 创建准入
历史打开/冷恢复 → Host 按 task 归属解析当前目录列表 → 单飞 runtime 初始化 → 能力加载 → 可发送
运行实例存在 → 只订阅/重连，不重配目录；旧会话 cwd 和配置链不变
```

Host 是组织态唯一写者，CLI 是会话事实唯一写者；Main/relay 只转发。桌面仍为 desktop-continuous，手机仍为 web-remote-replayable，不新增 Agent 或队列。所有异步 UI 请求复用现有 request/version/entry 防迟到规则，取消或入口被移除后结果不能复活项目、回填旧草稿或抢焦点。

## 已确认的其它非官方能力差异

下列均是固定上游的已实现行为，不引入新的产品规则；以现有本仓服务、协议和已登记模块接通，不能把文件复制成功当产品入口完成。

| ID    | 缺口及目标                                                              | 权威/隔离边界                                                                             | 验收                                                   |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| ZUP08 | 正式消息流接入已有 GenUiMessageResponse，本地内联可视化可展开、交互续写 | 复用 Gen UI owner/沙箱；失效实例不可发送；手机不建本地沙箱；无官方请求                    | 真实消息组件、完成态引用/展开保持/失效拒绝             |
| ZUP09 | MCP UI 工具结果可在切页、隐藏、最小化时初始化/继续执行；保留未保存编辑  | 复用已有 guest/runtime identity，后台非零尺寸表面，不建第二份实例；删除/失效仍释放        | 冷启动、切页、离屏、保留编辑及销毁回归                 |
| ZUP10 | 用户自有 Source 设备的管理、编辑线路、升级与迁移日志入口                | Host 唯一 Source owner，复用 #68 离线资源与 canonical bind；busy/force/身份变更须显式准入 | 自有测试设备、升级/错误重试/后台完成不抢导航           |
| ZUP11 | Side Pane 完整视图实际展示与浮动对话切换，不止 controller/快捷键存在    | 唯一 SessionPane/草稿/附件，按现有会话 scope 恢复；不删除本仓仍可用的分屏能力             | 按钮/快捷键、满屏/对话/浮窗切换与状态恢复              |
| ZUP12 | 个人来源插件逐项 busy 状态、成功事件刷新、文档独立实例                  | 本地 plugin owner，个人来源无官方依赖；一次手动打开一个独立文档实例                       | A 安装时 B 可操作，启停后入口刷新，两文档不串          |
| ZUP13 | clipboard-text/topic-history 可预览；Bot 合批按原发送人/消息拆分        | 不改变原输入批次、正文、附件对应关系；不能将局部编辑当整批替换                            | 消息组件及代表 UI 预览/来源/编辑禁用                   |
| ZUP14 | 多 roots 配置目录 Catalog 与自动化/保存工作流项目候选                   | 项目服务枚举而非只读打开 tab；配置走所属 Host settings attachment，不为浏览启动Agent      | 未打开root可选，同路径异Host隔离，projectId/hostId贯穿 |

应保留差异：官方分享/relay账号准入/购买/推荐源/Telemetry 不补回；上游移除分屏不作为添加能力需求，本仓现有分屏继续可用；纯改名/移动不重复报缺口。不能因自有 Source/MCP/插件使用“服务”一词就误删为官方云能力。

设备管理与后台连接适配：复用审计版已验收 SSHDialog 的现有 flow owner。共享进度 Context 只投影该 owner 的实际 step/loading/error/logs/ready 与原 resume/cancel 动作，不重建上游另一套连接状态机；发布命令和读取投影分离，避免自己的日志更新形成 render/effect 回环。Root 常驻挂载此展示 Provider，关闭设置/收起向导不会另起或取消 Host 连接；明确取消仍走原 requestId/session 的精准清理，后台 ready 不能自动打开项目抢导航。

设备管理中的“打开项目/显示在侧栏”先复用管理服务连接保存线路，只有所属 Source 在线才提交显式 Host 入口，再交给既有项目选择器（历史路径未携带 projectId，不能按 cwd 任意选一个项目）。所属 Host 浏览器提供默认路径，不猜本机 HOME。UI unmount/新意图使晚回失效；保存/连接事实仍归原 Host owner，只有选择器确认后才准备草稿和 attachment。纯设备连接完成只重置旧向导展示，不释放已交接的连接，也不自动建项目。

开工基线审计：UI 主动遥测扫描通过；旧 `packages/ui/tests/no-telemetry.test.mjs` 另两项失败分别来自 Server 仍声明已不存在的 `processResourceTelemetry` 能力、测试仍执行已删除的购买 WebView 文件。服务端无该采集实现，不据此宣称已发生遥测；清理失实能力声明，并把旧购买测试改为“已移除模块/当前策略不回流”断言，不恢复购买代码来让旧测试变绿。

## Impact Brief

模式：planning；层级：presentation / option-source / draft-default / validation / commit-effect / recovery。codegraph 当前工具不可用，使用固定源码、合同和精确调用追踪，不宣称图扫描已完成。

| 场景/UI surface                     | 草稿/展示 owner                       | 提交/权威落点                                        | 必保留边界                                              |
| ----------------------------------- | ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| 项目区新建/编辑，多目录选择与主目录 | 官方 ProjectEditor 草稿；共享目录投影 | hook → IProjectService → Host projects/project_roots | Native picker 经 IPlatformService，手机使用同 Host 浏览 |
| 项目内新任务、全局新任务、首发      | Renderer draft owner                  | Host prepareSession → 创建准入，projectId 明确       | 同 cwd 不同项目隔离；未归类不是按 cwd 猜项目            |
| 项目/分组/置顶/归档/时间线          | Host 列表只读投影与本机展示偏好       | 既有项目/任务命令                                    | CLI 时间/标题/正文事实不由 UI 覆盖                      |
| composer 文件提及、能力发现         | 当前会话/项目目录投影                 | Host 目录解析 → CLI additionalDirectories            | 不扩大 MCP/hooks/配置链                                 |
| 历史恢复、V4 冷恢复                 | CLI 单飞初始化，UI 历史投影           | Host 解析目录 → V4 runtime initializer               | 历史先显示；运行实例不因订阅重配                        |

must-inspect：ProjectSidebar/ProjectEditor/ProjectDirectoryProvider、Root/App 草稿接线、项目服务准入、CLI create-app 与 V4 冷恢复；should-inspect：文件提及、设置目录源、定时/闲时/Bots 项目选择；conditional：远程设备与手机入口；invariant-only：数据根/官方开关、队列 owner/lease、workspace identity、历史迁移。图谱中 project-sidebar 的缺失 seeds 是已确认的 graph drift，随实际接入更新，不仅修改图谱以掩盖缺失。

## 验收用例与剪枝

用户已明确选择沿用官方多目录和 UI 语义，既有 session-management/spec 已裁决的边界不重复询问。

| ID    | Setup / action                                    | 必须断言                                                    | 证据                         |
| ----- | ------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
| ZUP01 | 本地新建项目，一次选择两个目录后保存              | 一项目两 roots、正确主目录；取消不落库                      | UI + Host 数据               |
| ZUP02 | 编辑项目追加/重复/移除/改主目录并重启             | 去重、持久化；旧会话 cwd 不变，新任务使用新主目录           | UI + Repo + create           |
| ZUP03 | roots 各放同名 skill/agent/command，创建任务      | 全部来源可见、正确限定名；附加目录 MCP/hooks/AGENTS 不生效  | CLI 真文件 fixture           |
| ZUP04 | 已有任务冷恢复，修改项目 roots 后重新 materialize | 附加目录贯穿 V4 冷恢复；正文和 cwd 保留，既有运行实例不重配 | 协议/初始化回归              |
| ZUP05 | 同一 cwd 分属两项目，分别输入草稿/创建任务        | projectId、草稿与任务归属不串                               | Store + UI                   |
| ZUP06 | 深浅主题、中文/英文、桌面/窄屏                    | 官方项目编辑入口可用、无溢出、保存/错误/取消可理解          | 实际截图/交互                |
| ZUP07 | SSH/手机已有单 root 项目与重连                    | 保留单目录、owner/identity 与 continuous/replayable 语义    | 受影响回归；真实链路单独说明 |

剪枝：远程追加/多 root 由既有 Host policy 拒绝，不实现新的远程多目录产品；官方账号/购买/云端上报/遥测不作为“缺能力”补回；不修改正文库迁移、既有 cwd 或运行实例目录；与当前发现无关的组合不展开。需要全新产品裁决的独立差异先记录，不靠兼容分支猜测。

先补回归再实现，执行架构、typecheck、lint、格式、受影响单测和可运行的桌面交互验证。源码/回放/真实运行证据分开；不能执行的真实手机、跨平台 GUI 或全量对齐明确标注，禁止统称已验证。

## ZUP09 / ZUP12 插件生命周期接线

```text
本地 live 工具结果 → RootShell BackgroundHost → 窗口 page registry 单飞准入 → 同一 controller/guest
                                                          ├→ 可见锚点：保留移动
                                                          └→ 无锚点/零尺寸 tab：非零、inert 后台表面
页面保留 + 隐藏/窗口最小化 → 既有 setExecutionActive(sandboxId, initId) → Main 可逆执行租约
删除任务/运行时失效/重载 → 原实例 force suspend → 撤凭证/调用/端口/guest/feed/lease
个人插件命令 → 既有 pluginManagement owner → 独立 activeOperations 条目 → 成功后发布 scope 失效事件
                                                                          └→ 面板入口重新 listSurfaces
手动文档打开 → 新 instanceId → tab/scope/page key；恢复保留身份，关闭按 tab id 不影响另一份文档
```

- 后台创建与前台共用 `acquirePluginUiPage`；后台结果只更新工具 feed，不能覆盖侧栏尺寸或会话交互。Web/手机/远程不创建本地 guest，也不增加 replay/queue。
- session 空闲不能证明插件内部无未保存编辑；保留 MCP 页面拒绝 TTL/容量自动回收，容量不足显式拒绝，不偷偷重建。原有显式失效和释放顺序保留。
- 插件管理的 `activeOperations` 仅是进行中命令的展示投影，不是第二份业务队列；条目按对象身份结束，跨 scope 的旧操作不能清除新条目。保留旧 `operationId` 作为兼容展示，插件卡和管理行改用逐项判定。
- 只在真实成功写入后发布插件变更；失败、验证和 optimistic 启停不发布。用户级变更刷新同 Host 的面板，workspace 级只刷新同 identity；过期查询不可覆盖新查询。保留当前审计版官方市场开关，不接推荐目录、账号、购买或遥测。

| 用例    | 确定性回归                                                              | 真实 Electron 验收（完成情况另见验收报告）        |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| ZUP09-A | 无工具卡也准入并启动；并发卡片复用；远程/Web 不订阅                     | 冷启动 MCP 工具后立即切设置页，仍完成初始化       |
| ZUP09-B | 无锚点/零尺寸锚点使用非零 inert 表面；可见恢复复用 guest                | 切页、离屏、最小化后编辑器继续完成异步渲染        |
| ZUP09-C | suspend(false) 不释放；删除/runtime 失效 force 释放原代际               | 未保存编辑离屏超过五分钟仍在；删除后无 guest/租约 |
| ZUP12-A | A/B 并发条目独立结束，同名迟到结束不误清新操作；B 更新按钮不被 A 禁用   | 个人 Git/GitHub/本地来源 A 安装期间操作 B         |
| ZUP12-B | 成功启停/安装刷新正确 scope 的 surfaces；失败不刷新、旧响应不回填       | 管理页启停后无需重启即可看到 launcher 变化        |
| ZUP12-C | 文档每次打开身份不同、恢复不叠加 instance 后缀、关闭一个 tab 另一个保留 | 打开两份文档分别编辑并按 tab 关闭，内容不串       |

ZUP09 跨范围接线证据：2026-10-23 首次聚焦执行 `pnpm --dir apps/zcode-cli --filter @zcode/bootstrap exec vitest run tests/v4-plugin-ui-background.test.ts`，复现成功 live 结果的 emit 调用 0 次（1 失败、3 通过）。已按固定上游在 `resolveProjectionEventCommit` 后从成功 MCP 权威行经严格 schema 投递 `emitPluginUiToolResult`，拒绝错误结果和不合法输入，保留既有去重/会话 scope；修复后的后台专项 10 项通过。该证据是 CLI 与 Renderer 合同回归，不替代真实 Electron 后台编辑验收。

## ZUP14 配置目录与自动化项目接线

- 配置目录由 `workspace-config-catalog` 只读 Host project catalog 的全部有效 roots，按 `workspaceIdentity?.trim() || workspacePath` 去重；tab 只补充已有连接信息，不决定目录成员。配置目录不是 session，也不合并项目各 root 的可执行配置。
- 配置消费者（插件、MCP、Skills、Commands、Hooks、Subagents）使用该目录及配置专用服务解析。桌面无 tab 的远端目录复用 Source settings attachment，完成 canonical resolve 后才开放 RPC；手机不请求桌面配置 attachment。显式本机目录不能被同路径的活动远端 tab 劫持。
- 定时/闲时的候选来自本机 Host `projectService.readProjects`，包括空项目；选择身份使用 `[hostId, projectId]`，不再用 cwd 或打开 tab 充当项目。保存交给 Host 以 projectId 准备空项目，不在浏览时 prepare 或启动 Agent。既有任务仍锁定原 cwd。
- 已保存工作流按 Host 项目目录枚举，工作流文件仍按其真实 cwd 查找；新会话及提升全局操作透传 projectId/hostId，归属不按路径猜测。关闭 tab 不移除候选；远端断连保持不可写，不回落本机。
- 本仓保留的完成卡/运行侧板「再次运行」同样枚举 Host 项目；项目档按父 sessionId + workspace identity 从现有 Host 项目树投影读取归属，缺行保持未归类，不按 cwd 唯一匹配去猜项目。全局档由用户明确选择项目，不新增项目或任务查询 owner。

```text
Host projectService / remoteProjectService → 只读 catalog → root 配置目标 / 项目候选
配置选择 → 已有 workspace attachment 或 Source settings attachment → canonical resolve → 配置 RPC
项目选择 → projectId + hostId → Host 创建/prepare 准入 → 固化 cwd 与归属
state:projects → 重读；请求代际/Host membership/entry 校验 → 迟到结果丢弃
```

| 用例    | 确定性回归                                                                  | GUI（完成情况另见验收报告）                   |
| ------- | --------------------------------------------------------------------------- | --------------------------------------------- |
| ZUP14-A | 未打开 root 可见、同 Host 去重、同路径异 Host 隔离，移除/重加入口拒绝旧结果 | 关闭项目 tab 后在配置页编辑另一个 root        |
| ZUP14-B | Source canonical 绑定前不可写、切目录旧结果丢弃、手机不请求配置 attachment  | 自有 Source 无 tab 配置；断连不写本机         |
| ZUP14-C | 两个同 cwd 项目与空项目可选，提交 projectId/hostId；仅浏览不 prepare        | 定时/闲时选择空项目后保存，检查 Host 分配目录 |
| ZUP14-D | 工作流启动/提升命令携带所选项目归属，关闭 tab 后项目候选仍在                | 未打开项目运行工作流，检查新会话归属          |

## 远端导航晚回收口（#79 集成审查确认）

- 已确认根因：原远端 history owner 在 canonical bind ACK / port ready 后同步激活 workspace，再等待 pinned/timeline 补充读取；Root 新任务入口在整个等待返回后再次 `startDraftInWorkspace`，项目历史任务入口也在返回后无资格复验地 `onSelectTask`。因此用户在补充读取期间已经选择的新任务/草稿会被旧 continuation 覆盖。真实 callback + deferred 等待可确定性复现，不涉及 CLI/Host 归属或 cwd 改写。
- 仍由原 history owner 持有唯一 workspace 激活边界。可选的激活回调沿现有导航端口传递：项目新任务在该同步边界一次性提交完整草稿（原文、mention、模型/模式、附件及项目/分组意图），补充读取结束后不再写草稿或完成导航。普通连接保持原默认激活动作，prepared 五参 identity/guard、bind lease 与按引用 finally 不变。
- 历史任务入口在 workspace 激活时记录本次已接纳的导航快照；attachment 返回后复验请求代际、真实 tab/workspace 身份、任务导航历史及当前任务/草稿版本。自身激活仅更新该请求的预期快照，不再复用已被自身切换改变的 origin guard；真正后选、返回/前进、新草稿或卸载使旧结果失效。快照只是该次 UI 导航的资格凭据，不是第二份业务状态或队列。
- 同一交接回归另确认：显式 `initialPrompt` 覆盖正文时，原第二次草稿写入会丢失同次 handoff 的模型/模式配置。覆盖只替换正文及其 editor state/mention，配置和附件仍按同一次交接保留；旧正文的 editor state 不得恢复到新正文上。

```text
项目新任务 → prepare → 原 Host canonical bind ACK + port ready
                             → history 同步激活 → 一次提交完整草稿/完成回执
                                                   └→ pinned/timeline 补充读取 → 只收口，不再导航
历史任务 → 同一 bind/激活边界 → 记录本次导航提交快照 → 补充读取
                                                     → 复验代际/快照 → 才选择原任务
用户后选任务/新草稿/切 tab/历史回放 ────────────────────→ 旧结果失去资格，不抢导航
```

回归先红后绿，执行实际 callback 而非仅断言源码字符串：①远端已激活、补充读取未结束时后选任务，旧新建返回不得清空任务；②激活边界保留完整草稿配置、附件和尾空格，且只初始化一次；③历史任务正常跨 workspace/identity 激活不被自己的切换误拒绝；④补充读取期间后选任务、新草稿、历史回放或请求换代后，旧 attachment 返回不得重选；⑤保留 prepared identity、cwd 不变、草稿 scope、handoff、取消与精确 attachment 清理回归。桌面 continuous / 手机 replayable、Host owner/lease 不作变更。

确定性验证记录：新增真实 callback / history owner / deferred 补充读取回归先复现 8 失败、1 通过；显式预填 + 配置/附件组合另复现 1 失败、9 通过，收口后新增 10 项全过。导航、Root、prepared、cwd、draft、handoff 邻接回归共 17 文件 /161 项通过；本次 7 个源码/测试文件格式通过、Lint 0 warnings /0 errors、架构 0 违规。全仓 `pnpm lint` 为 117 warnings /0 errors，未清理无关警告。Root 的激活回调转交 hunk 与最终 typecheck 由主会话串行整合；本子任务未构建、运行 GUI 或全量 UT。

## ZUP08 / ZUP09 正式 Main 沙箱启动接缝

- 已确认运行证据：隔离安装 App 的正式消息已投影 `::visualize`，执行 Host 的 `gen-ui.readDocument` 成功，但获取 owner 时返回 `No handler registered for 'zcode:plugin-sandbox-owner-web-contents-id'`。源码对照固定上游确认 Main 入口缺少三个调用点：ready 前把沙箱 privileged scheme 合入既有 scheme 注册；ready 后、窗口/Host 启动前安装已有 sandbox host；将窗口 Host 的已校验登记请求交给该同一 host。不能将此缺接线归类为“GUI 未验收”，也不能仅补一个 owner IPC。
- Main 继续只有 `plugin-sandbox` 原有注册表 owner。整组公开 IPC（owner、dispose、手势、copy-image、execution-active）、分区协议和原生权限均随同一次安装开放；Host 登记、will/did-attach、截图前后复验、释放与执行租约都读取同一 owner。保留窗口 Host 的 ownerWebContentsId 校验、initId 防迟到、Gen UI 禁用原生权限/执行租约及 guest 安全偏好，不新建业务状态。
- 数据根 pending 的决策分支仍先返回，不安装正式沙箱或启动 Host。打包态只读随包目录，开发态沿已有可选 dev-server 资源配置；不得恢复遥测、官方账号或请求策略。

```text
Main ready 前 → 既有 registerSchemesAsPrivileged 一次注册 media + sandbox
数据根决策完成 → installPluginSandboxHost → 原注册表 / 全组 IPC / 权限闸门
窗口 Host 校验登记 → Main registerFromHost → 分区协议准备 → 句柄
Renderer 挂载 → 同一 owner 校验 guest → 端口 / 截图 / MCP 执行租约
dispose / owner 销毁 → 原登记撤销 → 端口关闭 / 租约释放 / 文档停止
```

回归执行真实 Main 启动函数体和窗口 Host 注入回调（仅 Electron 平台边界替身），先复现缺注册，再验证全部 handler、scheme、登记与 owner/代次隔离；源码存在性断言不作为唯一证据。真实安装 App 重打包/GUI 由主代理独立复验，不与确定性测试混称。

## 实现与验证状态

本轮代码、确定性回归和桌面交互的真实结果统一记录于 [验收报告](../../testing/project-parity-validation.md)。固定上游不等于本仓已验收：公开手机配对入口仍受既有审计边界限制，真实设备升级、跨平台 GUI、插件长时间后台编辑等未执行项分别标明，不宣称“所有非官方能力均已完整实测”。

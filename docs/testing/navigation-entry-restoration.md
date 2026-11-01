# 导航入口恢复（#99 / #104）

## Feature Summary

| Field               | Value                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------- |
| Intent / capability | 恢复归档管理入口与项目文件树返回按钮可达性                                                   |
| Change layer / mode | presentation、validation；implementation-handoff                                             |
| Primary seeds       | settingsPageConfig / settingsNavigation / SettingsPage；WorkspaceSidebar / DesktopTopOverlay |
| Out of scope        | 自动归档默认值/位置、schema、命令、流协议、远端连接、文件管理器架构迁移                      |

证据：GitHub #99 描述设置按钮缺失；#104 原图由 `gh api https://github.com/user-attachments/assets/413db44d-ddf4-4a2f-989e-079624705c28` 下载检查，返回任务位于 logo 与顶部新建按钮同一行。Issue 写 `0.17.2/window`，当前 package.json 是 `1.17.2`；只能记录疑似笔误，不声称实测了另一版本或 Windows。

## UI Surface Matrix

| Scenario / entry              | Shared implementation                        | Display/draft                             | Validation / commit                       | Authority / mode                            | Isolation                                              |
| ----------------------------- | -------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------- | ------------------------------------------------------ |
| 设置数据与统计 → 归档         | ArchiveManagement / ProjectDirectoryProvider | SettingsPage activeSection；页面筛选/确认 | 合法 archives ID → 既有 mutateProjectTask | Host archived，CLI delete；桌面/普通 Web    | cwd、projectId、完整 identity 不变；不新增手机设置入口 |
| 项目/置顶任务 → 文件树 → 返回 | WorkspaceSidebar / WorkspaceFileTree         | Sidebar open/target                       | onClose 只关闭树；顶部浮层独立            | renderer 局部状态；桌面/普通 Web/既有手机壳 | 保留 ProjectSidebar 挂载和折叠；不新建任务、不中断会话 |

## Shared And Divergent Behavior

| Concern               | Shared                                  | Divergent / reason                                                          |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| UI / options          | 同一归档组件、同一文件树                | 文件树 overlay 必须像项目列表一样预留标题栏空间；手机远控窄屏沿用隐藏标题栏 |
| Defaults / validation | 既有 SettingsPage 合法 ID 与显示配置    | 不更改当前 fork 自动归档默认值/位置                                         |
| Commit / persistence  | 既有 Controller / TaskService / Host 树 | 归档页只持有筛选和在途；文件树返回无业务命令                                |
| Recovery              | 原请求序号/身份路由                     | continuous 与 replayable 均不改变                                           |

## Feature Relationships

| Rank           | From → semantic edge → To                                 | Evidence                                                                         |
| -------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| must-inspect   | Settings 配置/合法 ID → 可达渲染 → ArchiveManagement      | 三处入口在基线均缺 archives，组件仍经 index 公开                                 |
| must-inspect   | Sidebar 文件 overlay → 标题栏空间 → DesktopTopOverlay     | 列表已有 h-12 占位，文件树 absolute inset-0 未留空间；顶层 z-20 浮层覆盖返回按钮 |
| should-inspect | 归档操作 → 现有 mutation adapter → Controller/TaskService | 完整地址与确认候选不变                                                           |
| invariant-only | 目录 owner / Host archived / CLI deletion / stream        | 不新增事实 owner、库列、runtime 或事件                                           |
| evidence-only  | focused unit / pending E2E                                | 本地组件、源码结构与真实包验证分开记录                                           |

## State Owners And Commit Sinks

```text
SettingsPage activeSection → ArchiveManagement → 既有共享目录读取
用户确认 → mutateProjectTask → Controller/TaskService → Host archived / CLI delete
                                             ↓ 既有索引事件 → 同一目录刷新
WorkspaceSidebar open → 文件树 overlay → onClose → open=false（无业务写入）
DesktopTopOverlay 保持标题栏 owner；overlay 内容从预留标题栏之后开始
```

## Must-Preserve Invariants

Host 唯一持有归档；CLI 唯一持有存在性/标题/时间；workspaceKey 为 identity.trim() || path；分组 key 为 Host+projectId；不可用 cwd 重新归属；返回不改变项目折叠/草稿/当前 session；桌面 continuous 与手机 shared-host/replayable 原边界保持。

## Codegraph Evidence

当前工具目录未提供 codegraph，仓库也没有可执行入口；不假造图调用。以图谱 seeds 为起点做限定源码调用扫描，深度 2：SettingsPage → ArchiveManagement → useArchiveManagement；WorkspaceShellLayout → WorkspaceSidebar → WorkspaceFileTree，另读 DesktopTopOverlay 的覆盖层。`SessionManagementService` 在当前 packages 源码无定义/引用，实际 owner 是 projectService 与 Controller/TaskService。

## Graph Drift Candidates / Graph Delta

原归档 surface 描述可达但缺设置导航 seeds，本轮补充现有三处入口；文件树 surface 补侧栏宿主/顶部浮层 seeds。docs/ui/workspace-file-tree.md 的右侧文件管理器描述与本 fork 侧栏实际入口不完全一致，记录为历史 drift，不扩大本次为整体迁移。

## Clarification Log / Boundary Decisions / Domain Scope

用户已授权核实并修复两个 Issue，已有产品合同规定可查阅归档和返回项目列表，不再询问重复规则。仅设置导航与侧栏标题栏布局；provider、工具、队列、磁盘迁移及远端管理剪枝。无待裁决设计缺陷。

## Dimensions / Candidate Combinations / Pruning Decisions

| Dimension     | Accepted                                                                    | Pruned / reason                                  |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| 平台与标题栏  | Windows/Linux 自定义标题栏、macOS、普通 Web；手机远控窄屏保留原隐藏占位规则 | 不改变窗口 caption/拖动实现                      |
| 归档目标      | 项目/未归类、完整地址、取消归档/删除取消/确认                               | 自动归档策略无改动；真实 SSH/手机不以 jsdom 冒充 |
| 模型/运行阶段 | 历史会话，不调用模型                                                        | compact/fork/queue/goal 由不变事实边界剪枝       |

## Accepted Cases / Matrix Backfill

| Case   | Setup → action → assertion                                                                                                                      | Evidence / E2E                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| NAV99  | 隔离 HOME 中 CLI 历史会话+Host archived；设置 → 数据与统计 → 归档；搜索、展开、取消归档；取消删除、再确认删除；刷新仍保持结果且侧栏可见未归档项 | focused 导航/组件/命令 UT；新增 pending E2E；真实包由父会话执行  |
| NAV104 | 隔离项目含一个文件；项目行 files → 返回按钮；鼠标命中按钮中心和左右四分点，不是顶部浮层；真实点击关闭；同项目可再次打开，项目折叠不变           | 组件 open/close UT、布局断言；新增 pending E2E；Windows GUI 待验 |

本文件即专项 case catalog / coverage matrix / decision worksheet；不改 conversation runtime 协议 catalog。现有归档上游 pending E2E 含默认天数等 fork 未实现的历史预期，不将整份旧测试当成本轮通过证据。

## E2E Handoff Notes / Unresolved Questions

- Provider policy=none；不发模型请求。fixture 以独立 HOME 启动后用真实 SQLite 添加历史 CLI session 与 Host tasks；不使用生产库。
- 两个新增 fixture 从 `@zcode/shared` 公开入口读取 `ZCODE_DATA_ROOT_DIR_NAME`（当前 `.zcodium`），所有直接 SQLite 播种和断言路径统一为 `join(home, ZCODE_DATA_ROOT_DIR_NAME, ...)`：Host `v2/tasks-index.sqlite`，CLI `cli/db/db.sqlite`。不再硬编码旧 `.zcode`，不创建旧根、不依赖迁移把测试数据搬入实际根。
- 测试入口候选为本包现有 WDIO，pending 显式 spec；下述公共 helper 路径和 release 测试桥前置条件尚未对齐，不能称这两个候选已运行通过。本次实际 release 包建议使用隔离 HOME + CDP 手动验收。无固定 sleep，以 DOM、落库与导航回执等待。
- 不以 jsdom、390px 或 macOS 包冒充 Windows/真实手机/SSH；没有未决产品问题。

### 自动候选的已知前置阻塞（2026-11-02 补正）

- `packages/desktop/wdio.conf.ts` 与 `test/e2e/helpers/desktop-app.ts` 的公共 `E2E_STORAGE_ROOT` 仍写死 `.zcode`，WDIO 初始化/配置播种、helper 的设置读取和失败诊断不能代表 release 实际 `.zcodium` 数据。本轮仅修两个新增 fixture，不扩大修改公共 helpers 或迁移旧测试。
- 两个测试只从旧 helper 导入 `DEFAULT_WORKSPACE` 和 `waitForWorkspaceApp`，没有调用 helper 的数据库读取函数；前者是 `HOME/ZCodeProject`，与数据根名无关。后者依赖 DOM 路径徽标或 `__zcodeTabStoreE2E` 等就绪探针，失败诊断还会读取旧 helper 路径。release 构建不提供测试桥，不能假定该等待路径或 runner 初始化可直接复用。
- fixture check 仅验证 JSON/spec 契约，tsc 仅验证类型；均不证明 WDIO seed 写入真实根、release 已就绪或 GUI 行为通过。在公共路径与 bridge 合同另行对齐之前，下面自动命令只保留为候选，不作为本次 release 验收入口。

本次补正使用已提供的 Node 24.14.0：两个 fixture check、E2E `tsc --noEmit`、根 `pnpm typecheck`、`pnpm lint`（116 warnings / 0 errors）、architecture 与 diff check 通过；另从 `@zcode/shared` 实际导入常量并核对两个 fixture 无旧根路径拼接，输出 `.zcodium/v2/tasks-index.sqlite`。只改本文与两个新增测试，没有修改生产源码、公共 helpers、旧测试或迁移；未执行 WDIO 或 release GUI，以下原始单测记录不能替代这两项运行证据。

## 本轮执行记录

#99 红绿证据：新增 `archiveManagementEntry.test.ts` 先运行 4 个平台入口断言均因缺少 archives 失败，既有组件的取消归档/删除 2 项已通过；补接线后与导航、目录合同、批量删除及 Host 删除定向共 5 文件 / 39 项通过。根 `pnpm typecheck`、E2E `tsc --noEmit`、`pnpm lint`（116 warnings / 0 errors）、architecture（0/0）通过；新增 pending E2E fixture check 通过，真实 Electron 尚未运行。环境只有 Node 24.16.0（mise 不可用），不是 mise.toml 固定的 24.14.0；pnpm 10.33.2。根 node_modules 与包依赖仅本 worktree 建软链接，未修改共享依赖。#99 只编辑现有 ui legacy 导航文件，复用 project-sidebar/ui 公开入口；没有新增 source 或架构 owner。

#104 红绿证据：新增 `workspaceSidebarFileTreeReturn.test.ts` 在旧实现的五个平台组合均因缺失标题栏占位失败；修复后覆盖反复打开/关闭和项目展开态保留。最终定向 8 文件 / 98 项通过（归档入口、设置导航、目录合同、文件树、置顶文件入口、归档删除和 Host 删除）；根 typecheck、lint（116 warnings / 0 errors）、architecture（0 违规）、新增 E2E fixture check、所改文件格式与 diff check 通过。#104 编辑两个现有 ui legacy source；新增文件只有测试、fixture 与文档，无 unmanaged 新 source。

图谱 YAML 检查：无重复 node ID，两个 surface 的所有 seeds 文件/符号存在；4 条 dangling edge 与 ced6cb4b 基线完全相同，无新增。当前没有 codegraph 工具，不将此静态完整性检查称为代码调用图验证。

### 合成包交接

**建议本次实际 release 包使用隔离 HOME + CDP 手动验收；以下自动候选存在上述前置阻塞，未执行、未通过、未转正：**

```sh
# 仅候选：先另行对齐公共 WDIO 数据根与 release 就绪探针，当前不要据此宣称包验收通过。
ZCODE_E2E_HOME_DIR="/var/folders/zd/qnwn4b553t7bwmjqz93x65dm0000gn/T/opencode/zcode-navigation-e2e-99" \
ZCODE_E2E_PACKAGED_APP_PATH="<合成测试包可执行文件绝对路径>" \
ZCODE_E2E_SPEC="./test/e2e/conversation-session/manual-review/pending/conversation-session-archive-entry-restoration.test.ts" \
pnpm --filter @zcode/desktop test:e2e:serial
```

另用全新 `zcode-navigation-e2e-104` HOME 将 spec 换为 `conversation-session-file-tree-return.test.ts`。不指定 PACKAGED_APP_PATH 则按当前仓库规则构建开发 E2E 产物，不能称为合成包验证；设置该变量也不会自动解决旧 helper 路径或缺失测试桥。

手动路径：给实际 release 可执行文件设置全新隔离 `HOME` 与同一 `ZCODE_DATA_BASE_DIR`，并隔离 Electron user-data；启用独立 CDP 端口后只使用真实 DOM/用户操作与实际文件断言，不注入测试桥。先启动 App 初始化 `.zcodium` 归属文件和数据库，退出后再按下列 fixture SQL 向 `HOME/<ZCODE_DATA_ROOT_DIR_NAME>/...` 播种，避免旧 WDIO helper 初始化和运行时写入互相覆盖；重新启动同一 release 包进行验收。CDP 截图、命中结果和库查询结果分别留档。生产 HOME、旧 `.zcode` 与真实凭据均不参与。

- #99：隔离库的 CLI session 和 Host archived 双侧播种见 NAV99 before 代码；两条 `nav99-restore/delete`，相同 workspace，不依赖模型。点击 `task-settings-button` → `settings-section-nav-archives` → `archive-search` 输入 nav99- → `archive-group-toggle`。点 `archive-unarchive` 后核对 archived=0 与返回侧栏可见；对另一行 `archive-delete` 先 Escape 取消再确认 `confirm-dialog-confirm`，核对 CLI time_deleted 与 Host cli_deleted，重启后不复活。
- #104：隔离 Host projects/project_roots 添加 NAV104 单 root 项目并创建 NAV104-fixture.txt（完整 SQL 见测试）；hover `virtual-project-row`，点击 `virtual-project-files`。检查 `workspace-file-tree-back` 中心与左右四分点的 elementFromPoint 属于按钮、按钮位于 `sidebar-file-tree-titlebar` 之后；真实鼠标点击返回，再次打开用 Tab/Enter 返回，项目 `virtual-project-toggle` 的 aria-expanded 不变。另在 Windows 真实包复核标题栏拖动、窗口控制、新建任务没有被覆盖。

原始外部证据下载在 session 临时目录 `issue-104.png`；红态输出 `nav99-before.log` / `nav104-before.log`，最终根检查 `navigation-final-typecheck.log` / `navigation-final-lint.log`。这些日志不是 Desktop E2E 通过证据；实际 Electron/Windows/手机/SSH 尚未运行，由父会话的合成包验收决定是否发布。

### 真实 DMG 追加验收（2026-11-02）

- 使用候选 `f848246b` 的真实 arm64 DMG，挂载后复制到隔离临时安装目录，版本及内嵌 build commit 均匹配。从仓库外 cwd、独立 HOME 启动，复用 v1.17.2 初始化的数据根进行升级对照；没有操作生产数据。
- NAV104：按钮位于标题栏以下，中心/左右四分点均命中按钮；真实鼠标和 Enter 返回成功，项目折叠状态不变。
- NAV99：最初 SQL seed 还遗漏合法 `meta_json`，并且伪造 session 未建立 CLI 的完整运行时合同。它们不能作为删除回归 fixture；即使补齐 meta，`proto.sessionNotFound` 也不能当作生产缺陷。新增 NAV99 pending 用例仍须修正这些前置条件，禁止转正或宣称通过。
- 改用真实 UI 配置本地受控 Provider、创建两个真实会话并归档。查阅、搜索、取消归档、删除取消及确认删除均通过；确认后核对 Host `cli_deleted=1` 与 CLI `time_deleted>0`，另一会话 `archived=0`；完整退出重启后两库事实不变，取消归档项重新出现在侧栏，已删除项未复活。仅调用本地假模型，不是付费供应商实网验证。
- 自动化必须等待折叠/弹窗动画稳定后再发鼠标输入。被动 DOM 事件取证显示，早先“按钮无效”的部分点击没有抵达目标；稳定后真实 click 和键盘输入均可执行。不能用驱动返回成功、缺少完成日志或错误选择器超时推定产品缺陷。
- 另确认冷启动且未配置可用模型时，历史删除会被 `startModelExecutionClient` 的模型就绪门禁拒绝，见 [#109](https://github.com/ZCodium-project/ZCodium/issues/109)。配置受控模型后的真实会话路径通过不代表这个无模型场景已修复；发布决策须单独处理该限制。
- Windows/Linux GUI、真实手机/SSH 与这两个 pending WDIO 仍未执行。完整工件校验、实际包证据及发布状态由本轮验收报告记录，不把 353 项定向检查等同于全量单测。

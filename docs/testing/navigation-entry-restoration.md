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
- 测试入口为本包现有 WDIO，pending 显式 spec；父会话在合成测试包上运行/手动取证。无固定 sleep，以 DOM、落库与导航回执等待。
- 不以 jsdom、390px 或 macOS 包冒充 Windows/真实手机/SSH；没有未决产品问题。

## 本轮执行记录

#99 红绿证据：新增 `archiveManagementEntry.test.ts` 先运行 4 个平台入口断言均因缺少 archives 失败，既有组件的取消归档/删除 2 项已通过；补接线后与导航、目录合同、批量删除及 Host 删除定向共 5 文件 / 39 项通过。根 `pnpm typecheck`、E2E `tsc --noEmit`、`pnpm lint`（116 warnings / 0 errors）、architecture（0/0）通过；新增 pending E2E fixture check 通过，真实 Electron 尚未运行。环境只有 Node 24.16.0（mise 不可用），不是 mise.toml 固定的 24.14.0；pnpm 10.33.2。根 node_modules 与包依赖仅本 worktree 建软链接，未修改共享依赖。#99 只编辑现有 ui legacy 导航文件，复用 project-sidebar/ui 公开入口；没有新增 source 或架构 owner。

#104 红绿证据：新增 `workspaceSidebarFileTreeReturn.test.ts` 在旧实现的五个平台组合均因缺失标题栏占位失败；修复后覆盖反复打开/关闭和项目展开态保留。最终定向 8 文件 / 98 项通过（归档入口、设置导航、目录合同、文件树、置顶文件入口、归档删除和 Host 删除）；根 typecheck、lint（116 warnings / 0 errors）、architecture（0 违规）、新增 E2E fixture check、所改文件格式与 diff check 通过。#104 编辑两个现有 ui legacy source；新增文件只有测试、fixture 与文档，无 unmanaged 新 source。

图谱 YAML 检查：无重复 node ID，两个 surface 的所有 seeds 文件/符号存在；4 条 dangling edge 与 ced6cb4b 基线完全相同，无新增。当前没有 codegraph 工具，不将此静态完整性检查称为代码调用图验证。

### 合成包交接

可执行候选保持 pending、未转正：

```sh
ZCODE_E2E_HOME_DIR="/var/folders/zd/qnwn4b553t7bwmjqz93x65dm0000gn/T/opencode/zcode-navigation-e2e-99" \
ZCODE_E2E_PACKAGED_APP_PATH="<合成测试包可执行文件绝对路径>" \
ZCODE_E2E_SPEC="./test/e2e/conversation-session/manual-review/pending/conversation-session-archive-entry-restoration.test.ts" \
pnpm --filter @zcode/desktop test:e2e:serial
```

另用全新 `zcode-navigation-e2e-104` HOME 将 spec 换为 `conversation-session-file-tree-return.test.ts`。不指定 PACKAGED_APP_PATH 则按当前仓库规则构建开发 E2E 产物，不能称为合成包验证。发布构建若无测试桥，请手动执行下面相同路径，不以更改产品能力迁就测试。

- #99：隔离库的 CLI session 和 Host archived 双侧播种见 NAV99 before 代码；两条 `nav99-restore/delete`，相同 workspace，不依赖模型。点击 `task-settings-button` → `settings-section-nav-archives` → `archive-search` 输入 nav99- → `archive-group-toggle`。点 `archive-unarchive` 后核对 archived=0 与返回侧栏可见；对另一行 `archive-delete` 先 Escape 取消再确认 `confirm-dialog-confirm`，核对 CLI time_deleted 与 Host cli_deleted，重启后不复活。
- #104：隔离 Host projects/project_roots 添加 NAV104 单 root 项目并创建 NAV104-fixture.txt（完整 SQL 见测试）；hover `virtual-project-row`，点击 `virtual-project-files`。检查 `workspace-file-tree-back` 中心与左右四分点的 elementFromPoint 属于按钮、按钮位于 `sidebar-file-tree-titlebar` 之后；真实鼠标点击返回，再次打开用 Tab/Enter 返回，项目 `virtual-project-toggle` 的 aria-expanded 不变。另在 Windows 真实包复核标题栏拖动、窗口控制、新建任务没有被覆盖。

原始外部证据下载在 session 临时目录 `issue-104.png`；红态输出 `nav99-before.log` / `nav104-before.log`，最终根检查 `navigation-final-typecheck.log` / `navigation-final-lint.log`。这些日志不是 Desktop E2E 通过证据；实际 Electron/Windows/手机/SSH 尚未运行，由父会话的合成包验收决定是否发布。

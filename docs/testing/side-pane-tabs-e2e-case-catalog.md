# Side Pane Tabs E2E Case Catalog

## 范围

本文记录 Side Pane Tab strip 的响应式宽度、溢出、操作按钮和标题 Tooltip 的桌面端 UI E2E 语义。该能力属于 UI shell presentation，不依赖 Agent、provider fixture、session realtime 或持久化恢复。

## 状态维度与剪枝

| 维度          | 等价类                                                       | 决策                                                                                  |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 可用宽度      | 可容纳 156px / 需要在 156px 与 60px 间收缩 / 60px 仍无法容纳 | 三类均覆盖                                                                            |
| Tab 类型      | Browser / Terminal / Diff / Code Viewer / session-scoped tab | 使用可重复创建的 Terminal 代表共享 `SidePaneTabTrigger`；类型专属内容不在本组重复覆盖 |
| Tab 状态      | active / inactive                                            | 关闭按钮 case 同时覆盖                                                                |
| Tooltip hover | 未满 1500ms / 满 1500ms / 跨 Tab                             | 三类均覆盖                                                                            |
| 客户端        | Desktop / mobile Web touch                                   | Desktop 覆盖；触屏不依赖 hover，剪枝 Tooltip；移动布局由组件级响应式测试覆盖          |
| 鼠标中键      | active / inactive tab                                        | Desktop 覆盖；中键关闭不激活目标 tab，并阻止浏览器默认中键滚动                        |
| 其他交互      | 拖拽、右键、标签总览                                         | 不属于本次改动，使用既有组件测试，不在本组重复覆盖                                    |

## 接受的 Case

### SPT-E2E-000 独立面板平台圆角与拖动指示线

- Setup：桌面新任务草稿，展开 Side Pane 和底部 Terminal，分别使用亮暗主题。
- Action：等待平台状态和布局就绪，hover 并拖动 Sidebar、Side Pane、Terminal 手柄。
- Assertions：Windows 5px，Sequoia 及更早 macOS 6px，Tahoe 26+ 12px，Linux 12px；三处热区保持 4px，指示线为沿边 2px foreground-subtlest/50、无 mask，默认隐藏且 hover/拖动可见，尺寸真实变化。
- 数据链路补充：useAppChromeStateAutoUpdate.test.ts 运行真实 hook，以平台异步查询返回 macOS 15/26，验证半径与订阅清理；用于在非 macOS CI 中捕获 macOS 查询被守卫跳过的问题。不能替代 macOS 原生视觉验收。

### SPT-E2E-001 默认宽度与跟随加号

- Setup：桌面窗口打开 Side Pane，仅创建一个 Terminal tab，空间足以容纳默认宽度。
- Action：观察 tab strip。
- Assertions：Tab 宽度为 156px（允许亚像素误差）；横向 viewport 无溢出；新增按钮位于滚动内容内并紧跟最后一个 Tab。

### SPT-E2E-002 等宽收缩但不滚动

- Setup：创建三个 Terminal tabs，把窗口调整到需要收缩但仍能让每个 Tab 大于 60px 的宽度。
- Action：等待 ResizeObserver 完成布局。
- Assertions：所有 Tab 宽度相等；宽度处于 `[60px, 156px)`；横向 viewport 无溢出；新增按钮仍位于滚动内容内。

### SPT-E2E-003 达到最小宽度后滚动

- Setup：继续创建 Terminal tabs，使 60px 最小宽度之和超过可用空间。
- Action：等待溢出状态更新。
- Assertions：所有 Tab 不小于 60px；viewport 的 `scrollWidth > clientWidth`；新增按钮移到 viewport 外、固定在右侧操作区。

### SPT-E2E-004 选中或 hover 时显示关闭按钮且不激活

- Setup：至少两个 Tab，第二个为 active，第一个为 inactive。
- Action：移开鼠标并清除焦点，检查关闭按钮可见性；hover inactive Tab 后点击其关闭按钮。
- Assertions：active Tab 的关闭按钮可见；inactive Tab 未 hover 时隐藏、hover 后可见；inactive Tab 被关闭；原 active Tab 保持 active。

### SPT-E2E-005 Tooltip 独立等待 1500ms

- Setup：至少两个 Tab。
- Action：hover 第一个 Tab 不满 1500ms，移到第二个 Tab，再等待到第二个 Tab 自己满 1500ms。
- Assertions：第一个等待窗口内不显示 Tooltip；跨 Tab 后不会继承已等待时长；第二个 Tab 满 1500ms 后显示包含完整标题的 Tooltip。

### SPT-E2E-006 鼠标中键关闭且不激活

- Setup：至少两个 Tab，第二个为 active，第一个为 inactive。
- Action：在 inactive Tab 的标签主体上派发鼠标中键（`button=1`）事件。
- Assertions：inactive Tab 被关闭；原 active Tab 保持 active；事件默认行为被阻止，且不会触发标签激活。

### SPT-E2E-007 插件面板的空态与新标签页双入口

- Setup：真实 `AnimatedSidePanePanel`、插件发现 hook 与打开动作；fixture 通过 `activateNewTabSidePane` 和统一归属函数创建并激活标签。推荐名单收录两个 surface，另一个开发 surface 不推荐；覆盖 1200px/en-US/亮色与 390px/zh-CN/暗色。
- Action：从空态 launcher 打开插件，再点击「+」创建 new-tab，从 active tabpanel 的 launcher 重复打开同一插件；新建另一个标签，使用 Tab/Enter 打开第二个插件。
- Assertions：两入口展示相同推荐与本地化标题；请求保留工作区/会话字段，重复打开复用 plugin tab；安装、启用后必须另点打开。草稿会话隐藏整个应用插件区及分隔线、查看所有插件入口；已有会话从默认空态或显式新标签页进入市场均可返回来源，默认空态返回后保持面板展开。无宿主、无 bridge 无插件项；推荐为空或配置失败显示空态；冷加载显示 skeleton。新标签页保持可见，窄屏无横向溢出。
- 操作进度回归：控制安装/启用响应，确认只有目标插件显示加载，其他未安装、未启用与已启用插件保留原文案；列表在操作期间继续禁用。失败后恢复并切换另一插件重试，成功后清除进度且不自动打开。覆盖空态与新标签页、桌面亮色英文与手机暗色中文。
- 加载图标回归：等待响应期间，目标入口显示可见的旋转图标与 `aria-busy`；成功或失败后全部清除。同一插件的两个 surface 同步显示进度，其他插件无进度；减少动画偏好下图标保留但不旋转。
- 边界：服务由浏览器 fixture 注入，在 plugin tab owner 边界检查请求，不启动沙箱、Agent 或真实手机远控。
- 当前验证：2026-10-15 自动浏览器 E2E 12/12 通过，包含 8 组操作进度与加载图标回归，以及同插件多 surface / 减少动画偏好用例；仍为 manual-review/pending，不代表插件沙箱或真实手机远控验证。

### SPT-E2E-008 对话隔离的关闭与恢复（manual-review/pending）

- Setup：同一工作区的 A/B 两个对话各有 Browser 和站点权限设置 tab。
- Action：B 关闭其他、关闭全部；切回 A 检查保留，再关闭 A 的设置 tab；切 B 检查最近关闭，再切回 A 重新打开。
- Assertions：B 的关闭不删除 A 的隐藏 tab；最近关闭仅显示当前 owner 的记录；A 重新打开恢复原设置 tab；Browser main 关闭与 UI 一致。
- 证据：真实 Electron 菜单/标签/设置页面与 renderer 日志。不请求模型，不改网页权限决策，不需要 provider fixture。自动通过仍保持人工 review pending。
- 单测补充：同路径不同 workspaceIdentity、公共/对话/草稿 tab、各 intrinsic owner 类型、无可见标签、异步关闭等待中切换工作区/对话或打开新 tab、main 拒绝关闭。

## 不变量

- `+` 不参与 Tab 等宽计算。
- 滚动只能发生在所有 Tab 已达到 60px 下限之后。
- 关闭按钮点击不得触发 Tab 激活或拖拽。
- 鼠标中键关闭不得先激活目标 Tab，也不得触发浏览器默认中键滚动。
- Tooltip 的定时状态不得改变 Tab 的 flex shrink 行为。
- 本组测试不得启动模型请求或依赖 provider replay fixture。

## 通用 / 编程界面模式 M1

范围与 MODE-01～07 用例见 [模式验证矩阵](general-coding-mode-verification.md)。新增桌面用例位于 `packages/desktop/test/e2e/ui-shell/general-coding-mode.test.ts`，覆盖设置偏好、入口隐藏和已有面板保留；已人工验收并转为 ui-shell 正式用例，尚未加入 Docker preset。对话展示由组件单测补充，验证状态以该矩阵为准。

### 新标签页多开与标准标签行为

- Setup：打开一个 Terminal 标签。
- Action：连续点击两次「+」，选择第一个新标签页，再分别关闭两个新标签页。
- Assert：两个 id 独立、最新页激活、标题为新标签页、宽度不超过 156px；旧页可重新聚焦并显示启动入口，关闭仅移除目标标签。
- 入口调整：原加号菜单选择改为新标签页内的启动行，仍使用既有应用打开动作。

### SPT-E2E-009 默认新标签页与工具替换

- Setup：新任务草稿，无当前 scope 标签。
- Action：展开、选择终端、收起再展开、点击加号、关闭新增标签及最后一个工具标签。
- Assertions：首次恰有一个新标签页及加号；终端替换该标签；收起恢复保留原 id；加号独立新增；关闭最后一个标签后面板收起；再次展开创建新标签页。
- 范围：桌面交互及共享 UI 状态，跨 scope 和异步关闭由 hook 回归补充。

SPT-E2E-009 补充：末标签关闭后面板收起且无补建；重新展开创建新标签页。真实关闭菜单命令关闭唯一新标签页后，下一次关闭上下文事件不被 App 拦截，可进入关窗 fallback。

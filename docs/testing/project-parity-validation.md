# #79 非官方服务能力对齐：实现与验收

## 基线与交付边界

- 固定官方源码：`zai-org/ZCode@3c5b227649371507ddc4eb46ac5133afe6db1cab`，package 版本 3.16.2，无同名官方 tag。
- 本仓起点：`61eef508`，开发分支 `feat/upstream-project-parity`。最初实现阶段没有发布授权；2026-10-24 用户已明确授权发布新版，现按 `1.17.0` 进入 PR/发布流程，不覆盖公开 v1.16.3。发布成功与否以实际 GitHub Release 和资产验证结果为准。
- 产品合同见 [spec](../superpowers/specs/2026-10-23-zcodium-upstream-parity.md)，远端/手机接缝见 [交接记录](project-parity-seams-handoff.md)。
- 保留 ZCodium、MIT、`.zcodium` 数据根、官方服务开关及遥测剥离。没有恢复官方账号、购买、分享或公网 relay。

## 自动化结果

2026-10-23 集成验证，2026-10-24 完成修后沙箱实包复验；不叠加重复执行的子批次数：

| 验证                                                  | 实际结果                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 显式选择 packages 内本次新增/修改的根 UT              | 84 文件、622 项通过；不是全仓 UT                                                                     |
| 根 `pnpm typecheck`                                   | 通过                                                                                                 |
| 根 `pnpm lint`                                        | 0 errors、117 warnings；没有将 warnings 写成零                                                       |
| 根 `pnpm fmt:check`                                   | 通过                                                                                                 |
| `pnpm architecture:check --changed`                   | 0 violations                                                                                         |
| `node --test packages/ui/tests/no-telemetry.test.mjs` | 3/3 通过                                                                                             |
| CLI typecheck                                         | 30/30 通过；最终复跑 30 项命中 Turbo 缓存，源码未变                                                  |
| CLI 目录与后台工具事件定向回归                        | 附加目录、create/resume/cold subscribe、fork/workflow、成功 MCP 通知及隔离用例通过；详见对应测试文件 |
| CLI 扩展批次与只读 HEAD 对照                          | 273 通过、41 失败；失败标识与 HEAD 完全相同，无新增失败；不能写成全通过                              |

根 Vitest 的 jsdom canvas 提示不代表真实沙箱或截图验证。CLI 已有失败包括被移除的遥测包引用、品牌夹具及历史路径等；没有为了变绿恢复这些模块。

10-24 收尾时再次执行根 typecheck、Lint（117 warnings / 0 errors）、格式、架构（0 violations）与无遥测检查（3/3），全部符合上述结果；没有重复整批 UT，也没有将旧批次计数与新执行相加。

## 1.17.0 发版专项

- 根版本改为 `1.17.0` 后再次执行 typecheck、Lint（117 warnings / 0 errors）、架构（0 violations）与无遥测防回流（3/3），通过。
- `node --test scripts/third-party-notices.test.mjs scripts/test/release-update-metadata.test.mjs packages/desktop/tests/remote-assets-github-release.test.mjs`：77 项通过；与前述功能 UT 分开计数。
- `readVerifiedNotices()` 验证通知正文与全部输入哈希新鲜。根版本是唯一变化的台账输入，仅回填该输入哈希；没有在 macOS 重生成或伪造 Linux 安装树。Linux 冻结安装重生成/零 diff 由 PR `licenses-notices` 验证。
- 许可台账仍有 15 项既有材料待审项；基础新鲜度检查与非 strict CI 通过不代表材料完整性通过，没有删除缺口或宣称严格合规检查通过。
- 受影响测试 dry-run 选择完整根套件 1804 个规格，按仓库现行合同跳过全量选择；不是执行了 1804 项，也没有调用全仓 UT。
- 新的正式安装包必须由合并后的 `1.17.0` 源码重新构建。此前本机实测目录包仍带 `1.16.3` 号，不上传为新版本资产。发布状态以 GitHub Release 及门禁结果为准。

## 桌面实测

环境：macOS arm64，独立打包 `.app`，隔离 HOME/userData/sessionData/数据根；全部为 `QA79-*` 合成项目、目录、消息和模型配置。模型是 loopback 合成服务，只检验真实发送、运行范围与 UI，不证明模型质量。

| 场景                            | 结果与证据                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 原生一次多选 first/second/third | 真实系统目录选择器完成，设 second 为主要目录，信任确认后保存；Host SQLite 为一项目三 roots                                              |
| 所有 roots 文件提及             | first/second 的 `same.ts` 同时出现并显示来源；选择非 cwd 的文件生成绝对链接                                                             |
| 项目首次发送                    | 真实 Host task 属于所选项目，cwd=second；实际模型请求包含三个目录；出现 assistant 回复                                                  |
| 修改项目                        | 设 third 为主要目录并移除 second；旧任务 cwd 仍为 second，新任务 cwd=third，新实例范围不再含已移除的 second                             |
| 同 cwd 双项目                   | P/Q 共用 third，分别保存并恢复精确的 P/Q 草稿；key 按 client/host/project 隔离                                                          |
| 正常退出、换装本轮目录包后重启  | 项目 roots/主目录/旧任务归属与 cwd 不变；P/Q 草稿分别精确恢复                                                                           |
| 旧任务冷恢复并继续发送          | 原始正文可见；真实新增 assistant 回复；旧 cwd 保持 second，重新 materialize 的上下文包含当前附加 roots                                  |
| 完整视图                        | 进入面板完整视图、对话 tab、浮窗、退出；同一个编辑器 DOM、唯一 Pane、未发送正文均保持                                                   |
| Gen UI 修后实包（10-24）        | 真实 sandbox ready，按钮将计数 3→4；确认续写后，原会话出现 Gen UI 来源消息与实际 assistant 回复；展开/收起保持同一 guest DOM 和页面状态 |
| 设备管理入口                    | 设置 → Remote devices、新建连接向导与取消可用；不代表真实 SSH 升级/force 已验收                                                         |
| 配置目录                        | Skills 的目录菜单包含当前未打开的 first root；可选择并加载，不只枚举打开的 tab                                                          |
| 视觉                            | Zai Dark 中文、Zai Light 英文；390×844 编辑框无横向溢出，Save 在视口内；不是实体手机远控验证                                            |

实测纠正了两类自动化操作问题：原生 Go To 进入父级后全选会选错目录，已在保存前移除并重选；Lexical `fill` 可能追加，最终正文使用真实聚焦 → 全选 → inserttext 精确重验。未将这些操作误差记作产品失败或跳过断言。

## 运行中发现的接缝

- 远端导航审查确认：attachment 已激活草稿后等待刷新，旧 continuation 会再次初始化草稿；任务 attachment 返回后也会覆盖后来选择。已用真实 callback/deferred 先红后绿，Root 完整贯穿同步激活端口；只在唯一提交边界交接草稿，刷新不再提交导航，真正后选使旧任务导航失效。
- Gen UI 真实消息入口先显示卡片，非法输出目录被 Host 正确拒绝。合法输出片段进一步暴露 Main 的 sandbox owner IPC 缺少注册。已补 ready 前的 privileged scheme、数据根决策后且窗口/Host 启动前的完整沙箱 host、窗口 Host 登记端口；真实启动回归先红后绿。10-24 重建隔离目录包后，真实 guest、按钮、确认续写与展开/收起均已通过，不是只验证卡片出现。
- 历史输入框已有文字不等于读错项目草稿：正式 session 使用独立 session scope，不读取项目 `__draft__` key。缺少替换前的 session 草稿证据，未据此臆断根因或修改恢复规则。

## 证据位置

本轮本机证据目录为 OpenCode 临时目录下的 `issue79/`，不提交本机绝对路径、模型请求原文或任何真实凭据：

原 `issue79/` 在服务重启期间被清理，下列旧文件名用于标识此前已执行的验证，不能声称当前仍可打开。10-24 新的实包复验证据在 `issue79-final/`；没有通过重建文件伪造早期证据。

- `qa-runtime-proof.json`：首发 Host task/cwd/roots 与合成模型请求的断言。
- `qa-before-restart.json` / `qa-after-restart.json`：正常退出与重启的项目/任务比对。
- `qa-cold-resume-proof.json`：旧任务冷恢复后的实际发送断言。
- `qa-mentions-both-roots.png`、`qa-new-primary-task.png`、`qa-same-cwd-drafts.png`、`qa-restart-draft-q.png`、`qa-cold-resume.png`。
- `qa-full-view-floating.png`、`qa-source-settings-empty.png`、`qa-config-all-roots.png`、`qa-editor-light-en-wide.png`、`qa-editor-light-en-390.png`。
- `changed-focused-final.log`、`typecheck-final.log`、`lint-final.log`、`format-final.log`、`audit-final.log`；CLI 批次另有 `cli-parity-*` 日志。
- 10-24 新证据：`app.sha256`、`build-app.log`、`package-dir.log`、`genui-validation.json`、`genui-followup-proof.json`、`genui-expand-proof.json`、`genui-after-increment.json`、`genui-after-collapse.png`、`genui-followup-complete.png`、`genui-expanded.png`。
- 10-24 门禁日志：`typecheck.log`、`lint.log`、`fmt.log`、`architecture.log`、`audit.log`。隔离 QA 应用、CDP 自动化会话和 loopback 模型均已停止；保留本轮目录包、隔离数据和报告供复核。

## 构建与未验证项

- `pnpm prepare:desktop-runtime` 成功；fresh CLI bundle 包含多目录和成功 MCP UI 通知。
- 第一次完整打包在 `hdiutil create` 报“设备上无剩余空间”，继而 `dmgbuild` 解析 plist 失败。应用本身编译和 `.app` 生成成功，不能据此写 DMG 成功。
- 随后使用 `build:no-runtime-assets` 和 `electron-builder --dir --mac --arm64` 成功生成未签名目录包，隔离安装后做上述重启验证。未替换公开 release、安装包、运行时或 tag。
- 最后一次修后重建也曾因空间不足写不出 renderer sourcemap；没有把未执行的后续封装算成功。10-24 空间恢复后，同一源码以 Node 24.14.0 / pnpm 10.33.2 重新完成生产构建与目录打包，安装隔离副本执行了 Gen UI 真正的 guest/原会话续写验证。
- 真正的 SSH 管理/升级/force/身份变更、多文档编辑、插件长时间后台/最小化、Bot 多人真实入口、Windows/Linux GUI 尚未完整实测；确定性回归不能代替这些结果。
- 已配对 bridge 的项目链路有真实 adapter/Host admission 回归，但默认 `/remote` 启动分支和官方登录依赖已下线。自有授权配对入口仍需单独设计，未冒充真实公网手机入口贯通。
- 没有运行全仓 UT；功能语义图已有 4 条基线悬空 edge，本轮无新增悬空引用，codegraph 工具不可用。

# GitHub Release 版本说明文件

关联：[#79](https://github.com/ZCodium-project/ZCodium/issues/79)。本合同仅约束 `.github/workflows/release.yml` 的说明生成，不改版本命名、tag、构建或公开发布条件。

## 产品规则与所有者

- 仓库中的 `docs/releases/v${VERSION}.md` 是对应完整版本的人工维护正文；`VERSION` 为已校验 `TAG` 去掉开头的 `v`，包括完整 audit 日期和序号，不按基础版本猜测。
- 文件存在时，以文件全文作为最终正文，仅替换 `<VERSION>` 占位符为该完整版本。不拼接自动 commit changelog、通用功能宣传或安装段落。根 `CHANGELOG.md` 只是版本索引，不是另一份正文来源。
- 文件不存在时，沿用现有通用模板和相对最近正式 tag 的双语 commit changelog。模板必须符合当前产品：仅插件市场、客户端远端配置可选开启；官方账号、购买、分享已下线，不能宣称开关可以恢复。
- 两条分支生成正文后，最后将非空 `NOTICE` 原样置顶，保留换行，不进行 shell 求值。所有发布仍先创建 draft；原有 prerelease 参数、构建、资产验证、keep_draft 和 publish 门禁不变。
- 本轮是 v1.17.0 功能发行，不覆盖 v1.16.3，不把 #79 能力追记为 v1.16.3 已交付。说明区分新增能力、修复、继承的 #68/#76 基线及实际验证限制。

```text
已校验 TAG → 当前 Release step（唯一正文生成者）
               ├→ 精确版本文件存在 → 全文 + 占位符替换
               └→ 不存在 → 修正后的模板 + 正式 tag 差异
           → NOTICE 原样置顶 → gh release create --draft
           → 原有构建/资产验证/公开发布门禁（不变）
```

## 验收与回归

- 执行从真实 workflow step 抽取的 bash 正文生成代码，隔离临时文件；Git 查询、commit 渲染和 `gh release create` 仅在进程边界替身，不实际创建 tag 或访问 GitHub。
- 有版本文件：逐字对比正文；覆盖有/无占位符、稳定版/完整 audit 版，保证不混入模板或自动提交摘要。
- NOTICE：多行和含 shell 字符内容原样位于版本说明之前；稳定版与预发布的 draft 参数均保持。
- 无版本文件：有正式基线时继续生成 commit 差异，无基线时不伪造差异；基础版本文件不能冒充完整 audit 版本文件；两种情况均不出现已移除账号/购买可恢复的宣传。
- 正式 v1.17.0 文件走同一真实生成路径；安装说明不得把 macOS 目录包验证描述为 DMG 验收，focused UT 不得称作全量通过。

执行：`node --test packages/desktop/tests/release-body.test.mjs`。先在旧实现上确认失败，再修改 workflow 并复跑；原有 changelog 和元数据专项同时回归。

## 本轮验证记录（2026-10-24）

- 先补 spec/回归，旧实现未读取人工正文、仍包含账号/购买开关宣传，回归失败后才修改 workflow。测试环境单独适配 macOS BSD sed 和 Bash 3 locale，不改选择分支或替换表达式；最终再次只读回放 `61eef508` 的真实 step，5 项均为预期断言失败，新实现同 5 项通过。
- `node --test packages/desktop/tests/release-body.test.mjs packages/desktop/tests/render-release-changelog.test.mjs scripts/test/release-update-metadata.test.mjs`：70/70 通过，属于发布专项，不计入 #79 功能报告的 84 文件/622 项，不是全仓 UT。
- 根 `pnpm typecheck` 通过；`pnpm lint` 为 117 warnings / 0 errors；架构检查 0 violations。没有构建、创建 tag、调用真实 GitHub 发布或修改公开版本。
- YAML 结构与 `61eef508` 对照：除说明生成外，版本校验、tag/push、NOTICE、draft 参数及其余全部 job 保持相同；测试边界替身不替代真正发布后的资产/安装验收。

# #76：GitHub Release 更新清单唯一收口

## 范围与修改依据

当前 fork 的发布入口是 `.github/workflows/release.yml`，不修改上游 GitLab/OSS 发布协议。v1.16.3 公开复验已确认：两个 macOS matrix job 用 `--clobber` 上传同名 `latest-mac.yml`，后完成者覆盖另一架构；Linux 清单包含未上传的 deb/rpm/pacman 条目。本版已人工修正，此任务防止后续发布复发，不重打既有 tag、不替换已公开安装包或运行时，不新增应用版本。

## 产品与发布规则

- 本仓当前分发：macOS arm64/x64 的 dmg + zip，Windows x64 的 exe，Linux arm64/x64 的 AppImage。Linux deb/rpm/pacman 虽可能由 builder 生成，但本流水线不分发，不允许出现在更新清单里。
- 每个构建 job 只上传自己平台/架构的安装包和对应 blockmap，不上传任何 `latest*.yml`。
- 每个 job 从 builder 原始清单提取当前架构的必需条目，校验版本、普通文件、大小和 SHA-512，再流式计算同一份文件的 SHA-256，产出独立 `fragment.json` 和校验片段。缺必需安装包、重复引用、URL 非扁平文件名、损坏或错版本必须失败，不能静默过滤缺失的必需包。
- 后置 `update-metadata` job 是所有最终清单的唯一 owner。它必须恰好收到 mac-arm64、mac-x64、win-x64、linux-x64、linux-arm64 五个片段；重复架构、重复资产名、版本冲突一律拒绝。
- 汇总之前读取目标 Release 的真实资产列表，核对每个已验证文件已上传且 size / GitHub SHA-256 digest 与片段一致。缺包、上传内容变化或 digest 缺失即失败，不以单纯文件名存在证明完整性。
- 汇总生成四份清单：`latest-mac.yml` 同时包含两个架构的 zip/dmg；`latest.yml` 只含 Windows exe；两份 Linux 清单只含各自 AppImage。macOS 的兼容 `path` 指向 x64 zip，现代 updater 根据 `files` 选择本机架构；排序确定，不受构建完成顺序影响。
- 最终清单的每个 URL 都必须引用真实发布资产；其 sha512/size 必须等于已在构建端校验、且经远端 SHA-256 digest 确认的文件。上传后重新读取资产列表，核对四份清单本身的 digest；验证通过前不允许公开 Release。
- 所有新增生产流程只写 draft Release。`publish` 必须显式等待 `update-metadata` 成功；任一片段/校验/上传失败保持 draft，不回退到 builder 的原始清单。
- `build_artifacts=false` 时跳过本链路，保持原有仅建 Release 的显式行为。`keep_draft=true` 时可执行构建和元数据验证，但不公开。

## #108：macOS runner 与目标架构分离

`.github/workflows/release.yml` 的 `desktop.strategy.matrix.include` 是构建 runner 与目标架构映射的唯一来源。两个 macOS job 必须独立、原生构建，不能将 Intel 目标交给 ARM64 runner，也不使用会自动迁移系统版本的 `macos-latest`：

| runner label     | target | arch  | 分发产物  |
| ---------------- | ------ | ----- | --------- |
| `macos-15`       | `mac`  | arm64 | dmg + zip |
| `macos-15-intel` | `mac`  | x64   | dmg + zip |

`runs-on` 继续消费 `matrix.runner`，`bundle:desktop` 继续消费 `matrix.target` / `matrix.arch`；阶段片段、文件名、checksums 和最终更新清单规则不变。不修改 Windows/Linux 矩阵、版本、tag 或发布正文，不恢复已删除的 workflow/模块。

修改依据（2026-11-02 核验）：

- [GitHub runner-images 退役公告 #13518](https://github.com/actions/runner-images/issues/13518)（搜索索引日期 2026-01-10；以当日抓取的正文为准）：macOS 14/14 ARM64 于 2026-11-02 退役，brownout/退役期间旧 label 的 job 会被终止；公告建议将 `macos-14` 迁至 `macos-15` 等支持的 label。
- [GitHub 官方 runner-images 标签表](https://github.com/actions/runner-images#available-images) 与 [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)（均于 2026-11-02 查阅）：`macos-15` 为 ARM64，`macos-15-intel` 为 Intel/x64；不能只按系统版本推断架构。

验收边界：现有 Release YAML 合同回归必须精确检查这两个 runner/target/arch 组合，以及 job 调度与打包参数对同一矩阵的消费；旧标签、两架构错配、缺失/重复 macOS job 均失败。静态测试不证明 GitHub 调度、镜像工具链或真实产物已通过，下一轮正式候选仍须执行完整 Actions 构建，核对两种 runner 的实际架构和产物；任何失败保持 draft，不承诺 runner 未来持续可用。

## 所有权和事件顺序

```text
各 matrix job：builder 原始清单 + 本机文件
  → stage 校验 → 平台/架构独立片段 → 上传安装包 → artifact 保存片段
                                                          │
update-metadata（唯一写者）等待全部 desktop job 成功 ←──────┘
  → 获取 draft 的真实资产列表 → merge 校验五片段/远端 digest
  → 生成四份清单 → 单点上传 → 重读资产列表 → verify 清单内容 digest
  → publish 等待 CLI/desktop/remote-assets/checksums/update-metadata 全部成功
```

片段幂等键为版本 + platform/arch；同键重复视为错误而非 last-writer-wins。工作流以现有 release concurrency 串行、片段使用 run-scoped artifact 隔离；不读取其他 run 或另一个版本的片段。汇总全部验证成功后才写输出，不因一份成功先上传半套清单。网络重试仅重传相同已验证内容；不会放宽失败准入。此链路不涉及 Desktop continuous、手机 replayable、workspace 身份或会话状态。

## 验收与验证入口

- 正常五片段、任意输入顺序得到相同四份清单；macOS updater 对 arm64/x64 各自选中正确 zip。
- Linux builder 中未发布的其它包不进入结果；缺 AppImage 必须失败。
- 缺架构/重复片段/重复文件/版本冲突/坏 SHA-512/大小/远端 SHA-256/缺真实资产/非法 URL/符号链接拒绝。
- 上传后清单被覆盖或内容不符必须失败；失败不能经过 publish 门禁。
- 工作流合同测试确认 matrix 不上传 latest，唯一汇总 job 的依赖及 publish 门禁正确。
- stage 与上传明确使用 Bash；Windows runner 默认 PowerShell 不识别 `$VERSION`，不能依赖仅 Ubuntu 运行的测试掩盖跨平台环境变量展开错误。
- `node --test scripts/test/release-update-metadata.test.mjs`：小型合成文件执行 stage→merge→verify；并用真实 electron-updater 的文件选择逻辑验证架构。
- `.github/workflows/release-metadata.yml` 在 PR 执行相同回归；可显式手动对已有 Release 运行只读演练，下载实际安装包并跑 stage→merge→verify，不上传、不改 Release/tag。
- 必须执行根 `pnpm typecheck`、`pnpm lint`、格式、架构检查。没有修改 UI 交互或应用运行时，不重复全量 UT 或 GUI E2E。

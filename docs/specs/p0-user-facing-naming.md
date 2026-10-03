# Spec：P0 用户可见命名统一（zcode → zcodium）

## 范围（P0）

仅覆盖用户/外部可见的命名层；内部标识符、`@zcode/*` 包名、内部进程间
`ZCODE_*` 变量、产物文件名（`dist/zcode.cjs`）与项目级 `.zcode` 目录属于
P1a/P2，本 PR 不动。

1. **bin 命令**：`package.json#bin.zcode` → `bin.zcodium`（仍指向
   `./dist/zcode.cjs`）；`CLI_COMMAND_NAME` → `"zcodium"`（进程标题）。
   上游 README 中引用的 `dist/ln`（半途改名、与产物不符）一并修正。
2. **deep link 协议**：`zcode://` → `zcodium://`。覆盖桌面协议注册
   （`setAsDefaultProtocolClient`）、Linux `.desktop` 注册、macOS finder
   工作流、OAuth redirectUri（dormant，随账号体系）与全部引用。
3. **i18n 用户可见文案**：产品名 "ZCode" → "ZCodium"；数据目录提示中
   过时的 `.zcode/v2` 修正为 `.zcodium/v2`（#13 遗留）。key 名、
   `.zcodeignore`（项目级文件）、Z.AI dormant 文案不动。
4. **README / 文档**：产品名与命令统一为 zcodium；GitHub 链接保持上游
   ZCodium-project 不变。

## 兼容性

- deep link 旧链接 `zcode://` 不再被新版本处理（无存量包袱，不设兼容）。
- bin 旧名 `zcode` 不保留 alias（全局安装文档更新即可）。

## 验收

1. `npx zcodium --help` 经 bin 正常入口可用（bin 指向产物成功）。
2. 桌面应用注册 `zcodium://` 协议；deep link 打开工作区/导入流程正常。
3. 界面文案不再出现 "ZCode"（dormant 的 Z.AI 服务页除外）。
4. typecheck / lint / 测试全绿。

# Spec：用户级数据根归属、初始化与迁移（`.zcode` → `.zcodium`）

> 本 spec 取代旧版“自动迁移”方案。旧方案在 `~/.zcodium` 已存在（其它分支/产品遗留）
> 时静默跳过迁移，且迁移失败后会被 logger 抢先创建新根导致永不重试；本方案以
> **归属文件 + 用户决策 + 唯一初始化器** 解决这两个问题。

## 背景与目标

1. ZCodium 与官方 ZCode 客户端、其它分支曾共用 `~/.zcode` / `~/.zcodium`，存在数据互踩。
2. 数据根从 `.zcode` 收敛到 `.zcodium`，并满足：
   - **归属识别**：`~/.zcodium` 是否属于本产品，不能凭“目录存在”判断；
   - **用户知情**：旧数据是否带入由用户选择，只复制、不删除；
   - **零污染**：归属文件落盘前，正式根不允许任何写入；
   - **可重试**：迁移/初始化失败不阻断进程，且下一次启动状态可判定、可重试。

## 归属文件（合法性唯一依据）

- 路径：`{base}/.zcodium/.zcodium-root.json`，`base` 默认 `homedir()`，
  跟随 `ZCODE_DATA_BASE_DIR` 与设置中的 `dataBaseDir`。
- 内容：

```json
{
  "product": "dev.zcodium.app",
  "schemaVersion": 1,
  "createdBy": "desktop",
  "createdAt": "2026-10-03T00:00:00.000Z",
  "firstSeenVersion": "3.15.0",
  "migration": { "from": "~/.zcode", "at": "2026-10-03T00:00:00.000Z", "mode": "copy" }
}
```

- 字段规则：
  - `product`：产品家族标识，取 appId（Preview 与正式版共用同一家族值，见“已知边界”）；
  - `schemaVersion`：归属文件/布局格式版本，当前为 `1`；高版本触发 `corrupt`（禁止降级读取）；
  - `createdBy`：`desktop | cli | server`；
  - 不写入用户名、机器名、内部路径等敏感信息。
- 写入规则：唯一写入者是数据根初始化器；采用“目录内临时文件 + rename”原子写；
  写盘失败不得留下半截 JSON。
- 放置于根目录而非 `v2/`：清除所有数据只删 `v2`，归属保留，避免清数据后被误判为首次运行。

## 合法性状态

| 状态 | 条件 | 处理 |
| --- | --- | --- |
| `normal` | 归属文件存在、可解析、product 匹配、schemaVersion 支持 | 复用，正常启动 |
| `absent` | `.zcodium` 不存在 | 有旧根 → 桌面决策；无旧根 → 直接初始化 |
| `unowned` | 无归属文件，或 product 不匹配 | 桌面决策（先备份让路）；无 UI 入口备份后全新 |
| `corrupt` | 归属文件不可解析，或 schemaVersion 高于当前支持 | 同 unowned，但文案区分“损坏/版本不兼容”；不静默复用 |

## 初始化器（唯一所有者）

服务层新增 `initializeDataRootInteractive()`（桌面）与 `initializeDataRootNonInteractive()`（CLI/server），
判定逻辑统一：

```ts
type DataRootInitResult =
  | { state: "ready"; status: DataRootStatus; manifest: DataRootManifest }
  | { state: "initialized"; status: Extract<DataRootStatus, { kind: "absent" }> }
  | { state: "pending"; status: Exclude<DataRootStatus, { kind: "normal" | "absent" }>;
      legacyCandidates: LegacyDataRootCandidate[] };
```

- 桌面（有 UI）：`pending` 时进入决策；`ready`/`initialized` 正常启动。
- CLI / server / 远端（无 UI）：`initializeDataRootNonInteractive()`：
  - `normal` → ready；
  - `absent`（无旧根）→ 初始化归属 → initialized；
  - `unowned` / `corrupt` → 备份让路 → 初始化归属 → initialized（**不自动迁移旧数据**，
    用户可在桌面使用“再次导入”）。
- 并发保护：初始化/迁移使用根目录锁（`O_EXCL` 锁文件），后到方读结果而非重复写入。
- **pending 期间路径重定向**：初始化器把 `getZCodeDataRootDir()` 解析重定向到进程级
  诊断根（`os.tmpdir()/zcodium-startup-<pid>`），保证任何模块在决策前都无法写正式根；
  决策完成执行操作后进程重启（relaunch），重定向消失。

## 启动时序（桌面）

```
main 模块加载
  └─ desktopEarlyDataBaseDirBootstrap：initializeDataRoot()
       ├─ ready / initialized ──► 正常启动（主窗口 + Host + services）
       └─ pending
            ├─ logger 等诊断写入 → 诊断根
            └─ app.whenReady() → 决策窗口（先于主窗口 / Host / deviceMid / settings）
                 ├─ 迁移 ──► 备份让路 → 复制 → 写归属 → relaunch
                 ├─ 全新 ──► 备份让路 → 初始化 + 归属 → relaunch
                 └─ 关闭 ──► app.quit()（正式根零写入，下次重新提示）
```

- 决策结果总是 relaunch，因此不存在“热切换数据根”；决策进程的 logger 写诊断根即可。
- 自定义 `dataBaseDir`：NORMAL 态读正式根 `setting.json` 应用；pending 态读**旧根**
  `setting.json` 仅用于发现附加迁移源（只读），不应用、不写入。

## 决策窗口

- 载体：独立轻量 BrowserWindow（参照 `cua-permission-panel` 入口模式），
  复用 DESIGN.md 组件与 i18n；不依赖 Host/services。
- 展示：旧数据候选（路径、大小、修改时间）、冲突目录说明、磁盘空间预检。
- 出口：
  1. 迁移（复制旧根，旧目录保留）；
  2. 全新开始（不导入；旧目录保留；以后可在设置再次导入）；
  3. 关闭（退出应用；不写任何状态）。
- 迁移分支显示进度、可取消；取消回到决策窗口；失败显示错误并可重试。

## 迁移与备份规则

1. 冲突目录（unowned/corrupt 的 `.zcodium`）先整体重命名为
   `{base}/.zcodium.unowned-<timestamp>`（corrupt 用 `.corrupt-`），不删除、不合并。
2. 迁移源：默认 base 与旧 `setting.json` 中 `dataBaseDir` 指向的 base 下存在的 `.zcode`；
   V1 支持多候选逐一复制，候选为空则不显示“迁移”。
3. 复制：同卷 staging `{base}/.zcodium.migrating-<uuid>` → `renameSync` 落位；
   目标已存在时保留已知安全结果并发方完成。
4. 成功：写归属文件（含 `migration` 元数据）；deviceMid（`v2/telemetry-state.json`）
   随复制带入，保持设备身份连续。
5. 失败：清理 staging、保留现场、不写归属；下次启动仍为 pending，可重试。
6. 强杀：staging 残留由下次启动清理；正式根未被合法化。

## 再次导入（设置页，V1）

- 入口：设置 → 数据存储路径区域。
- 行为：从旧数据根的候选列出可导入项；确认后先备份现有 `.zcodium`，
  再执行复制并写归属（`migration.mode = "import"`）；完成后重启。
- 冲突策略：不合并，整体替换（备份保留）。

## 无 UI 入口行为

| 入口 | unowned / corrupt | absent（有旧根） | normal |
| --- | --- | --- | --- |
| CLI | 备份 + 全新初始化 | 全新初始化（不迁移） | 复用 |
| server / zcode-server-cli | 备份 + 全新初始化 | 全新初始化（不迁移） | 复用 |
| E2E / dev 隔离 base | 自动全新初始化，不弹窗 | 自动全新初始化 | 复用 |
| 手机远控 | 跟随宿主桌面；宿主 pending 时提示“请在桌面完成设置” | 同左 | 复用 |

- 显式迁移入口：`ZCODIUM_DATA_ROOT_ACTION=migrate|fresh|fail`（无 UI 环境可选；
  默认行为按上表）。

## 与现有机制的关系

- 移除 `migrateLegacyZCodeDataRoot()` 及其四处自动调用（desktop bootstrap、main、
  CLI main、server 入口、zcode-server-cli core）；迁移只能在决策/导入流程中执行。
- `LEGACY_MIGRATION_MARKER_FILE`（`.migrated-to-zcodium`）废弃，由归属文件承担完成标记。
- 路径字面量收敛：所有用户级数据根拼接统一走初始化器 API，禁止模块内直接拼 `.zcodium`。

## 已知边界（本期不解决，发布说明覆盖）

- Preview（`dev.zcodium.app.preview`）与正式版共用 `~/.zcodium` 且归属互认；
  渠道数据隔离不在本期范围。
- 官方 ZCode 客户端继续使用 `~/.zcode`；复制后两边数据各自演化，不提供自动同步。
- 远端 SSH 主机：由远端 agent 供给的新二进制执行远端初始化/迁移；
  旧版已安装的 `~/.zcode/server` 不保证被带走，供给流程会重新布局。
- 迁移期间旧客户端若正在写 sqlite（WAL），快照可能缺最后几笔事务。
- `ZCODE_HOME` 显式指向旧根时，相关 CUA 路径继续使用该目录（不在本期收敛）。

## 验收场景

1. 全新机器（无 `.zcode`、无 `.zcodium`）→ 无弹窗，直接初始化，归属文件正确。
2. 正常升级（`.zcode` 有数据、`.zcodium` 不存在）→ 弹窗 → 迁移 → 数据完整、
   旧根保留、归属含 migration 记录。
3. 升级选全新 → 新根干净、旧根保留、设置可再次导入。
4. 他产品残留（`.zcodium` 无归属文件）→ 弹窗 → 迁移/全新都先备份 `unowned-<ts>`。
5. 已有合法根二次启动 → 不提示。
6. 决策窗口关闭 → 应用退出、正式根零写入、下次重新提示。
7. 迁移中强杀/失败 → 下次启动仍 pending、可重试、staging 清理。
8. 清除所有数据（删 `v2`）→ 归属保留、不重新引导。
9. CLI 遇 unowned → 备份 + 全新，不阻塞。
10. E2E/dev 隔离 base → 自动初始化，不弹窗。
11. `ZCODE_DATA_BASE_DIR` 隔离实例 → 决策/初始化发生在隔离 base 内。
12. 降级（schemaVersion 过新）→ corrupt 分支，不静默读取。

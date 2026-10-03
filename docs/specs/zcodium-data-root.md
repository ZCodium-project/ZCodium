# Spec：数据根目录更名 `.zcode` → `.zcodium` 与一次性迁移

## 背景

ZCodium 与官方 ZCode 客户端共用 `~/.zcode`，双方读写彼此的凭据、配置与会话数据
（dev 实例污染事故的根因之一）。ZCodium 作为独立产品线，数据根必须拥有自己的
命名空间。同时代码中存在**两套路径权威**：

1. `packages/services/src/paths.ts` 的 `getZCodeDataRootDir()`（跟随 `ZCODE_DATA_BASE_DIR`）；
2. 散落在 services / adapters / desktop 里的 `join(resolveUserHomeDir(), ".zcode", ...)`
   （**不跟随** `ZCODE_DATA_BASE_DIR`，settings、skills、hooks、mcp-sync、plugin-sync、
   settings-sync 均属此类——这也是 dev 隔离实例仍会写真实 `setting.json` 的原因）。

## 行为规则

1. 数据根字面量统一为 `.zcodium`，常量 `ZCODE_DATA_ROOT_DIR_NAME` 定义于 `@zcode/shared`；
   旧值 `LEGACY_ZCODE_DATA_ROOT_DIR_NAME = ".zcode"` 仅供迁移逻辑使用。
2. 所有"用户主目录数据根"拼接统一改走 `getZCodeDataRootDir()`（或新常量），
   使其跟随 `ZCODE_DATA_BASE_DIR`；**工作区项目级 `.zcode` 目录（项目内 skills/commands/
   plugins/config）属于项目命名空间，保持 `.zcode` 不变**。
3. 迁移 `migrateLegacyZCodeDataRoot()`（paths.ts，幂等、base 相对）：
   - 跳过条件：新根已存在 / 旧根不存在 / 旧根内有 `.migrated-to-zcodium` 标记；
   - 过程：复制旧根 → 同卷临时目录 `~/.zcodium.migrating-<pid>` → `renameSync`
     原子落到新根（目标已存在则视为并发方已迁移，清理临时目录）；
   - 成功后在旧根写入 `.migrated-to-zcodium` 标记（用户删除新根视为重置，不重复灌入）；
   - 任何失败不阻断启动：清理临时目录、记录错误，下次启动重试（无标记即重试）；
   - 采用**复制而非移动**：官方 ZCode 客户端可能仍在使用旧根，不能使其中断。
4. 触发点：桌面早期 bootstrap（读 setting.json 前 + `setDataBaseDir` 后）、
   `main/index.ts` 装配后、CLI `main()` 入口、zcode-server-cli / server 入口。
   env 锁定的隔离 base 内天然无 `.zcode` 旧根，迁移自动 no-op。
5. 用户可见路径（`~/.zcode/cli/config.json`、`~/.zcode/skills` 等）在文档与展示文案
   中同步更名；`ZCODE_*` 环境变量名与内部标识符不在本 PR 范围。

## 已知风险（发布说明需覆盖）

- 远程 SSH 主机上由旧版桌面安装的 agent 位于远端 `~/.zcode/server`，新版桌面会在
  远端 `~/.zcodium/server` 重新布局（由远端 agent 供给流程自动安装）。
- 迁移期间旧客户端若正在写入 sqlite（WAL），复制出的库可能不含最后几笔事务；
  失败无标记、下次启动自动重试。

## 验收场景

1. 全新机器（无 `~/.zcode`）→ 启动后只有 `~/.zcodium`，无迁移痕迹。
2. 存在 `~/.zcode` → 首次启动后 `~/.zcodium` 含全部旧数据，旧根原样保留并带标记；
   二次启动不再复制；删除 `~/.zcodium` 后重启不会重新灌入（标记生效）。
3. 官方 ZCode 客户端继续使用 `~/.zcode`，双方互不干扰。
4. `ZCODE_DATA_BASE_DIR=/isolated` 的 dev/e2e 实例：skills/settings-sync 等此前
   绕过隔离的服务现在全部落在 `/isolated/.zcodium`。
5. 工作区项目级 `.zcode`（skills/commands/plugins/config.json）路径不变。

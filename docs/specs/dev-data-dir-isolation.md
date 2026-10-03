# Spec：开发/E2E 运行的数据目录隔离硬边界

## 背景

桌面开发实例（`pnpm dev:desktop:test`）曾绕过 mise 任务直接启动，缺少
`ZCODE_DATA_BASE_DIR`，实例直接读写开发者真实 `~/.zcode`，重写了
`credentials.json` / `provider_config.json`，导致宿主应用官方模型凭据失效。
事后检查发现两层缺陷：

1. `scripts/dev-desktop-env.mjs` 自身不注入隔离目录，隔离依赖 mise 任务层环境变量，
   任何绕过 mise 的调用方式都会落到真实数据。
2. `paths.ts` 文档声明优先级为 `setDataBaseDir() > env > homedir()`，而桌面主进程会在
   启动期读取**真实 HOME** 的 `setting.json` 并调用 `setDataBaseDir(dataBaseDir)`
   （`desktopDataBaseDirBootstrap.ts` 与 `main/index.ts`）。一旦开发者真实设置里配置了
   自定义数据目录，即使显式设置了 `ZCODE_DATA_BASE_DIR` 也会被拉回真实数据目录。

## 行为规则

- `ZCODE_DATA_BASE_DIR` 一旦显式注入，即为本次进程的数据目录**硬边界**：
  - `getDataBaseDir()` 返回该值；
  - 任何 `setDataBaseDir()` 调用不再生效（含设置文件 bootstrap、设置页改目录），
    设置文件改为从隔离目录内读取，真实 HOME 的 `setting.json` 不再被读取。
- 未注入环境变量时保持现状：设置文件 `dataBaseDir` 继续生效（重定位数据目录的正式用户）。
- `dev-desktop-env.mjs test` 模式在 `ZCODE_DATA_BASE_DIR` 未设置时注入默认隔离目录
  `~/.zcode-dev-home`（与 mise 任务一致），并在启动日志打印本次实际数据目录；
  `production` 模式不注入（dogfood 语义），但同样打印数据目录来源。

## 状态所有者

- 数据目录解析唯一 owner：`packages/services/src/paths.ts`。
- 桌面 bootstrap 只负责"无环境变量时从设置文件发现目录"，不再拥有覆盖环境变量的能力。

## 验收场景

1. 设置 `ZCODE_DATA_BASE_DIR=/isolated` 后调用 `setDataBaseDir(/real)` →
   `getDataBaseDir()` 仍返回 `/isolated`。
2. 未设置环境变量时 `setDataBaseDir(/real)` 生效（回归不受影响）。
3. 环境变量生效时，桌面早期 bootstrap 不读取真实 HOME 的 `setting.json`。
4. `pnpm dev:desktop:test` 不经过 mise 时，启动日志显示数据目录为 `~/.zcode-dev-home`。

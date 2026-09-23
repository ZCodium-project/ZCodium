# ZCodium

<div align="center">
  <img src="public/logo/open-audit.svg" alt="ZCodium" width="96" height="96" />
  <p><strong>ZCode 开源代码的独立审计版本</strong></p>
</div>
<p align="center">
  简体中文 | <a href="README.md">English</a> ·
  <a href="https://zcodium-project.github.io/">项目网站</a>
</p>

> 本仓库 fork 自智谱 2026 年 9 月 21 日开源的 [zai-org/ZCode](https://github.com/zai-org/ZCode)。名字沿用 Chrome → Chromium、VS Code → VSCodium 的变形逻辑：**ZCode → ZCodium**。所有结论以代码和可复现的验证为准。

## 和官方版本的对比

| 对比项       | ZCodium（本仓库）                                          | 官方客户端（闭源）               | 官方开源版                 |
| ------------ | ---------------------------------------------------------- | -------------------------------- | -------------------------- |
| 监控与遥测   | **全部移除**（约 2.6 万行），并加防回归检查                | 全套默认开启，开关管不到打包上传 | 与闭源版相同               |
| 仓库上传逻辑 | 已移除                                                     | 有（直到 2026-09-18 被曝光）     | 已移除（自 2026-09-21 起） |
| 历史版本回溯 | **保留全部历史版本与提交记录**，供审计回溯                 | 旧版本下载链接已下架             | 旧版本下载链接已下架       |
| 构建透明度   | **GitHub Actions 从仓库源码透明构建**，产物随 Release 发布 | 官方二进制，构建不可复现         | 不提供公开构建             |
| Issue 与共建 | **开放**（Issue 与 Discussions），欢迎共建讨论             | 不开放                           | 关闭                       |

## ZCodium 比 ZCode 官方改了什么

相比上游开源版本：

- **官方服务默认全部关闭**：账号登录、反馈、编码套餐、官方 MCP、插件市场等官方接口默认关闭，设置里可逐个开关。打开任意一个都会连接 ZCode 官方服务器，如无必要请保持关闭。
- **删掉了所有监控与遥测**，约 2.6 万行：ARMS RUM、OTLP 上报、崩溃采集、资源与网络采样、UI 埋点。另外加了防回归检查，防止这些出口被重新引入（见下文"我们移除了什么"）。
- **检索了敏感路径**：快照打包、加密、直传相关的代码全仓库过了一遍，当前版本没有未经确认的数据外发实现。
- **接通了构建和发布**：GitHub Actions 构建安装包、部署项目站点；应用内更新指向本仓库的 GitHub Releases，走自己的发布链路。

审计是静态代码检索，不等于完整动态取证。发现和局限会持续更新。

## 我们会持续审计

- 上游 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的每次提交都会做 diff 审计，不等发版才看。
- 只同步无风险的改动。数据外发、监控遥测、权限扩张这类代码会剥离或拒绝合入，并在审计记录里写明原因。
- 每次同步后重新构建、发布新的审计版本（见 [Releases](https://github.com/ZCodium-project/ZCodium/releases)）。
- 审计方法和结论留在仓库和[项目网站](https://zcodium-project.github.io/)，欢迎复核和质疑。

## 背景

事情的起因和细节以外部报道为准，这里不做事实认定：

| 来源                     | 链接                                                                   |
| ------------------------ | ---------------------------------------------------------------------- |
| ferstar 原始技术分析     | https://blog.ferstar.org/posts/zcode-silent-workspace-snapshot-upload/ |
| 魔都水滴独立复现         | https://blog.margrop.net/post/zcode-silent-git-upload-investigation/   |
| 智谱官方开源仓库（上游） | https://github.com/zai-org/ZCode                                       |
| 澎湃新闻相关报道         | https://www.thepaper.cn/newsDetail_forward_34111815                    |
| 界面新闻相关报道         | https://www.jiemian.com/article/15120609.html                          |
| IT之家相关报道           | https://www.ithome.com/1/005/046.htm                                   |
| 虎嗅相关报道             | https://www.huxiu.com/article/4892416.html                             |
| 凤凰网相关报道           | https://tech.ifeng.com/c/8waIS4X7FAe                                   |

## 我们移除了什么

与上游开源版本相比，本仓库不再包含任何监控与遥测（telemetry）实现：

| 类别           | 移除内容                                                                              |
| -------------- | ------------------------------------------------------------------------------------- |
| 客户端监控 SDK | 阿里云 ARMS RUM（`@arms/rum-electron`）及其补丁、初始化、路由埋点与渲染进程桥接       |
| 使用与网络遥测 | 网络指标聚合与上报、API 事件摄入、Host/调度器转发、远程会话使用采样                   |
| 资源与性能遥测 | 周期资源采样、内存诊断、数据体积统计、TTFT 导出、MCP 遥测                             |
| 崩溃采集       | 崩溃转储上报、OOM 注解、稳定性遥测                                                    |
| CLI 遥测       | `@zcode/telemetry` 包整体移除（OTLP 导出、模型 API 记录、Agent 指标与 trace）         |
| UI 埋点        | 会话打开、订阅错误、自动化、提示模板、用户操作等全部埋点，以及平台上报方法与其 IPC 桥 |
| 协议与配置     | 遥测事件协议与上报链路；并新增过滤，阻止旧遥测环境变量重新进入 Agent                  |

**保留说明**：本地日志（排障用）、用户主动提交的反馈、正常业务请求（模型调用、更新检查等）不受影响；设备标识仅用于业务身份与本地锁。

**验证**：以上改动通过 `pnpm typecheck`、`pnpm lint`（0 error）与各模块防回归测试。完整清单与验证边界见移除报告：[桌面端](packages/desktop/specs/telemetry-removal-report.md)、[CLI](apps/zcode-cli/specs/telemetry-removal-report.md)、[UI](packages/ui/specs/telemetry-removal-report.md)。

## 下载与安装

[Releases](https://github.com/ZCodium-project/ZCodium/releases) 提供桌面客户端（macOS / Windows / Linux）和 CLI 发行包。

**关于签名**：所有安装包都**没有 ZCode 官方签名**，首次打开会被系统安全机制拦截。这是预期行为，按下面各平台的方式放行一次即可。放行前可以先用 Release 页提供的 `sha256.txt` 校验下载文件。

### macOS（.dmg）

1. 按机型下载 `ZCodium-*-mac-arm64.dmg`（Apple Silicon）或 `ZCodium-*-mac-x64.dmg`（Intel），打开后把 ZCodium 拖进“应用程序”。
2. 因为没有 ZCode 官方签名，Gatekeeper 会提示“无法验证开发者”或“已损坏”。**先把应用拖进「应用程序」，再执行**下面命令（提示输入密码时输入开机密码，输入过程屏幕上不显示任何字符）：

   ```bash
   # 命令行放行并启动（命令会立即退出，不会占用终端）：
   sudo /usr/bin/xattr -rd com.apple.quarantine "/Applications/ZCodium.app" && open -a "ZCodium"
   ```

   命令使用 `/usr/bin/xattr` 绝对路径，避免 PATH 里其他同名工具（例如 Python 的 xattr）报 “option -r not recognized”。也可以右键（Control-点击）应用 → 选择“打开” → 弹窗里再点“打开”。之后就能正常双击启动了。

### Windows（.exe）

1. 下载 `ZCodium-*-win-x64.exe`，双击运行。
2. 安装包没有 ZCode 官方签名，Windows SmartScreen 会弹出“Windows 已保护你的电脑”的警告。点击“**更多信息**” → “**仍要运行**”，按提示完成安装即可。

   这是预期提示，不是文件损坏；介意的话可以先按 Release 页的 `sha256.txt` 校验安装包。

### Linux（.AppImage）

```bash
chmod +x ZCodium-*-linux-x86_64.AppImage
./ZCodium-*-linux-x86_64.AppImage
```

### CLI 发行包（.tar.gz）

CLI 发行包是免安装的独立运行包（TUI + Web + Agent 三合一），需要 Node.js 24；安装脚本和运行时代码都可以在本仓库复核：

```bash
tar -xzf zcodium-*.tar.gz
cd zcodium
./install.sh        # 安装 zcode 命令（默认到 ~/.zcode/runtime，并在 ~/.local/bin 建立入口）
zcode --help        # 或直接运行：node bin/zcode.mjs --help
```

## 构建与发布

- **GitHub 构建**：审计后的代码在本仓库通过 GitHub Actions 构建，CLI 发行包随版本发布到 [Releases](https://github.com/ZCodium-project/ZCodium/releases)，站点由独立仓库构建，部署在 https://zcodium-project.github.io/。所有产物都来自本仓库经过审计的源码，不包含上游未同步的改动。
- **发版流程**：在 Actions 中手动运行 [Release](https://github.com/ZCodium-project/ZCodium/actions/workflows/release.yml) workflow，版本号填 `3.14.0`：勾选“预发布”生成 `3.14.0-audit.<当天日期>`（同一天重复构建自动追加 `.2`、`.3`，也可直接填完整形式 `3.14.0-audit.20260922[.2]`）；不勾选则发布正式版 `v3.14.0`（干净版本号，成为 GitHub Latest）。Release 说明固定为“相对 ZCode 的改动”在前、安装说明在后，英文在上、中文在下（内容严格对应），末尾列出产物。所有产物先上传到 **draft** release，只有 CLI 与各桌面平台全部上传成功后才发布；构建失败会保持 draft，下载页不会解析到仍在构建中的版本。
- **上游同步**：先审阅改动，再逐版本 diff 审计，只合入无风险部分；结论写在审计记录里。

## 社区

欢迎加入社区交流、反馈问题：

| Discord | QQ 群 |
| --- | --- |
| <img src="docs/community/discord-qr.png" alt="Discord 邀请二维码" width="220" /> | <img src="docs/community/qq-group-qr.jpg" alt="QQ 群二维码" width="220" /> |
| https://discord.gg/HeDkhY9nV | 群号：344502652 |

## 免责声明

本仓库为开源社区驱动，与任何现有商业公司无关。文中事实均来自公开报道与独立代码审计，并已注明出处。如相关方认为内容有误，欢迎通过 Issue 提交更正。

---

# 官方 ZCode README（以下为上游原文）

> **提示**：以下章节来自上游官方仓库 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的 README，仅用于说明上游项目自身的安装与开发方式；其中的社群、链接、服务与承诺均由上游维护，与本审计仓库无关。

---

ZCode 是 AI 编程工作台，提供桌面应用、浏览器界面和终端 Agent。本仓库包含客户端、后端服务、共享 UI，以及 Agent CLI 与运行时源码。

| 入口                 | 用途                                                           | 开发命令                       |
| -------------------- | -------------------------------------------------------------- | ------------------------------ |
| Desktop              | Electron 桌面应用                                              | `pnpm dev:desktop`             |
| Web / ZCode 命令行版 | 终端与浏览器工作台；将 TUI、Web、后端和 Agent 组装为独立运行包 | `pnpm dev:web`                 |
| Agent CLI            | 在终端中使用 `zcode`，也为 Desktop 和 Web 提供 Agent 运行时    | `pnpm --filter @zcode/cli dev` |

## 初始化

准备 Git、Node.js **24.14.0** 和 pnpm **10.33.2**，版本以 [mise.toml](mise.toml) 为准。以下开发和打包命令均在仓库根目录执行。

```bash
pnpm bootstrap
```

`pnpm bootstrap` 安装 workspace 依赖、准备桌面本地运行资源，再执行 `build:bootstrap`。

Agent CLI 与运行时源码位于 [apps/zcode-cli/](apps/zcode-cli/)，作为普通目录随本仓库一起克隆，无需单独拉取或初始化 Git submodule。

根据需要选择其他初始化或构建入口：

| 命令                           | 用途                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `pnpm install`                 | 安装依赖                                                          |
| `pnpm prepare:desktop-runtime` | 准备桌面运行资源，默认包含远程资源准备                            |
| `pnpm prepare:remote-assets`   | 单独准备远程运行资源                                              |
| `pnpm bootstrap:with-remote`   | 初始化依赖、本地与远程资源，并串行构建相关包；跳过桌面应用 bundle |
| `pnpm build`                   | 递归执行各 workspace 包的构建脚本，包括包内的资源准备步骤         |

默认 `bootstrap` 跳过远程资源准备，适合本地桌面开发。使用远程工作区或验证远程发行资源时，再运行对应准备命令。

## 开发与运行

### 桌面版

```bash
pnpm dev:desktop

# 使用测试环境
pnpm dev:desktop:test
```

`pnpm dev:desktop` 默认等同于 `pnpm dev:desktop:prod`，使用生产服务配置。启动脚本会准备本地运行资源、构建桌面 Agent，再启动 Electron 和源码监听。

需要独立开发数据目录时，可设置 `ZCODE_DATA_BASE_DIR`。例如在 macOS / Linux 中：

```bash
ZCODE_DATA_BASE_DIR="$HOME/.zcode-dev-home" pnpm dev:desktop:test
```

### 远程功能（SSH/WSL）

先执行 `pnpm bootstrap:with-remote` 准备远程资源（mock-cdn），再 `pnpm dev:desktop`；连接远程项目时资源选择「本地下载后上传」。开发态资源取自本地 `packages/desktop/mock-cdn` 和本地构建产物，经 SFTP 上传到远程，不访问 CDN。

### Web 开发

修改 Web 或后端源码时，使用开发模式：

```bash
pnpm dev:web

# 指定后端工作区（macOS / Linux）
ZCODE_SERVER_WORKSPACE=/path/to/project pnpm dev:web
```

该命令同时启动 Web 开发服务器（默认 `http://localhost:5173`）和后端（默认 `http://localhost:3030`）；浏览器访问前者。`/ws` 和一般 `/api` 请求代理到本地后端，`/api/v1/oauth/token` 单独代理到当前配置的产品服务。

Agent 源码修改后，执行 `pnpm --filter @zcode/cli... build` 并重启服务。需要验证完整发行包时，按下方“ZCode 命令行版”打包章节解压运行。

### ZCode 命令行版

命令行发行包包含 TUI、Web 和 Agent，统一使用 `zcode` 启动：无参数进入 TUI；第一个参数为 `--web` 时启动 Web；其他参数交给现有 Agent CLI 处理。两种模式都在本机运行，无需 Electron。

```bash
# 默认进入终端交互界面
zcode

# 启动 Web 界面
zcode --web

# 指定项目和端口，不自动打开浏览器
zcode --web --workspace /path/to/project --port 3030 --no-open

# 查看 CLI 或 Web 参数
zcode --help
zcode --web --help
```

Web 模式默认工作目录为当前目录，监听 `127.0.0.1`，默认不启用访问令牌，自动选择空闲端口并打开浏览器。访问终端输出的地址，按 `Ctrl+C` 停止服务。局域网访问可使用 `--host 0.0.0.0`；监听非本机地址时默认生成访问令牌，使用终端输出的带令牌链接。可通过 `--token` 指定令牌或 `--no-token` 关闭令牌认证。

直接启动通用 Web 服务的 HTTP 入口时，通过 `ZCODE_SERVER_AUTH_TOKEN` 配置 API／WebSocket 认证；通过程序接口创建服务时，使用 `authToken` 选项。

构建方式见下方打包章节。`pnpm build:zcode` 只生成发行包，不会替换 `PATH` 中已有的 `zcode`。如果命令仍指向旧安装或其他源码目录，macOS / Linux 可用 `command -v zcode` 检查，Windows 可用 `where.exe zcode` 检查。

### CLI 源码开发

直接开发 TUI 或 Agent 时，运行源码入口：

```bash
pnpm --filter @zcode/cli dev --help
pnpm --filter @zcode/cli dev

# 构建 CLI 及其 workspace 依赖
pnpm --filter @zcode/cli... build
node apps/zcode-cli/packages/cli/dist/zcode.cjs --help
```

这个入口直接运行 Agent CLI，不经过发行包的 `--web` 分流。开发 Web 用 `pnpm dev:web`；验证统一的 `zcode` 命令，用下方解压后的 `bin/zcode.mjs`。

## 配置

根目录 [.env.example](.env.example) 提供服务地址与构建配置示例，可按需复制到 `.env`，本地覆盖放入 `.env.local`。Desktop 的开发环境通过 `dev:desktop:test` / `dev:desktop:prod` 选择。

| 配置                                 | 用途                                             |
| ------------------------------------ | ------------------------------------------------ |
| `ZCODE_DATA_BASE_DIR`                | 应用数据基目录，数据写入其下的 `.zcode/`         |
| `ZCODE_SERVER_WORKSPACE`             | Web 后端的工作区路径                             |
| `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` | 本地 Provider 配置文件路径；未设置时使用内置配置 |
| `ZCODE_DIST_BASE_URL`                | 命令行安装脚本使用的下载根地址                   |

运行时变量可在启动命令的环境中显式设置。随客户端发布的默认配置见 [config/README.md](config/README.md)。

## 打包

第三方声明生成、发行校验流程及声明在发行物中的位置见 [third-party/README.md](third-party/README.md)。

### 桌面版

```bash
pnpm bundle:desktop

# 指定目标平台与 CPU 架构
pnpm bundle:desktop -- --os win --arch x64

pnpm bundle:desktop -- --help
```

默认目标为 macOS arm64，默认输出目录为 `packages/desktop/dist/`。`--os` 支持 `mac`、`win`、`linux`，`--arch` 支持 `x64`、`arm64`；实际打包与签名需要目标平台对应的工具和配置。

安装：双击打开产物 DMG，将 ZCodium 拖入"应用程序"。本地构建未签名，首次打开若被 macOS 拦截，执行：

```bash
sudo /usr/bin/xattr -rd com.apple.quarantine /Applications/ZCodium.app && open -a "ZCodium"
```

### ZCode 命令行版

构建入口为 `pnpm build:zcode`。脚本会依次构建 CLI/TUI、后端和 Web，收集 TUI 的原生库、worker 与运行时依赖，再组装发行包；运行发行包仍需要 Node.js，版本以 `mise.toml` 为准。

打包前必须设置下载根地址 `ZCODE_DIST_BASE_URL`（可放在 `.env`、`.env.local` 或环境变量中），也可以通过 `--base-url` 传入。以下地址是占位示例，发布时替换为实际托管地址：

```bash
pnpm build:zcode --base-url https://downloads.example.com/zcode/

# 已配置 ZCODE_DIST_BASE_URL 时
pnpm build:zcode

# 仅重新组包，复用已有的 Agent、后端和 Web 构建产物
pnpm build:zcode --skip-build

# 查看版本、输出目录等可选参数
pnpm build:zcode --help
```

默认版本取根目录 `package.json`，输出目录为 `dist/zcode/`：

- `releases/<version>/zcode-<version>.tar.gz`：运行包。
- `releases/<version>/sha256.txt`：校验摘要。
- `latest.json`、`install.sh`：版本索引和安装脚本。

完整目录可上传到配置的下载根地址。安装脚本从该地址下载运行包，默认安装到 `~/.zcode/runtime`，并在 `~/.local/bin` 创建 `zcode` 命令。安装目录可通过 `ZCODE_DIST_HOME` 修改，命令目录可通过 `ZCODE_DIST_BIN_DIR` 修改。

旧 Lite 用户需要改用上述构建命令、环境变量和新的安装脚本。新安装不会删除旧 Lite 目录，也不会迁移或删除已有会话数据。

本地调试打包产物时，可直接解压运行，无需上传或安装：

```bash
zcode_version=$(node -p "require('./dist/zcode/latest.json').version")
mkdir -p dist/zcode/debug
tar -xzf "dist/zcode/releases/$zcode_version/zcode-$zcode_version.tar.gz" \
  -C dist/zcode/debug
# 默认启动 TUI
node dist/zcode/debug/zcode/bin/zcode.mjs

# 启动 Web
node dist/zcode/debug/zcode/bin/zcode.mjs --web \
  --workspace "$PWD" --port 3030 --no-open
```

浏览器打开 `http://127.0.0.1:3030`，即可验证同一后端服务托管 Web 页面和 Agent 的完整链路。该端口需要空闲；如正在运行 `pnpm dev:web`，可改用其他 `--port`。

## 仓库结构

| 目录                                                 | 职责                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/desktop`                                   | Electron Main、Host、Renderer 与桌面打包   |
| `packages/web`                                       | Web 客户端                                 |
| `packages/server`                                    | HTTP / WebSocket 服务与远程连接            |
| `packages/zcode-server-cli`                          | 独立 Server 启动与进程管理                 |
| `packages/ui`                                        | 共享 React 组件、hooks 与 Zustand 状态     |
| `packages/services`                                  | 业务服务与持久化                           |
| `packages/shared`、`packages/rpc`、`packages/client` | 共享协议和类型、RPC 框架、Agent 客户端 SDK |
| `packages/provider`、`packages/provider-node`        | Provider 公共能力与 Node 实现              |
| `apps/zcode-cli`                                     | Agent CLI、TUI、运行时与工具               |
| `scripts`、`config`、`third-party`                   | 构建维护脚本、内置配置与第三方声明材料     |

项目网站源码独立在 [zcodium-project.github.io](https://github.com/ZCodium-project/zcodium-project.github.io) 仓库，使用 Vite + Svelte + Tailwind CSS v4 构建，通过 GitHub Actions 部署到 <https://zcodium-project.github.io/>。

## 开源协议

第一方代码（含全部审计与改动）采用 **MIT** 协议（见 [LICENSE](LICENSE)）；仓库包含来自 [zai-org/ZCode](https://github.com/zai-org/ZCode) 的上游代码，该部分保持 **Apache-2.0**（全文见 [LICENSE-APACHE](LICENSE-APACHE)），原有版权与署名声明保留。第三方组件许可见 [NOTICE.zh-CN.md](NOTICE.zh-CN.md)。

## 项目声明

功能与优惠范围、维护规则、执行与数据风险，以及许可和第三方版权说明，详见 [NOTICE.zh-CN.md](NOTICE.zh-CN.md)。

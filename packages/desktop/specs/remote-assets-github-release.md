# 远程资源：自有 GitHub Release、镜像与离线加载

本规范描述当前 Source Server descriptor 布局；#68 的所有权、提交点和验收见 [remote-runtime-offline.md](remote-runtime-offline.md)。桌面安装包不携带全平台远端运行时，不默认访问官方 CDN。

## 发布与消费

- `pnpm prepare:remote-assets` 调用 `@zcode/server-cli stage:remote-assets`，生成 `packages/desktop/mock-cdn/releases/<version>/source-server-release.json` 及四个平台归档。
- 描述文件包含 `schemaVersion`、`version`、`archives`；每个归档包含 target/version/fileName/sha256/sizeBytes/urls，由 `packages/shared/src/source-server/release.ts` 严格校验。
- 当前文件名是 `zcode-server-linux-x64.tar.gz`、`zcode-server-linux-arm64.tar.gz`、`zcode-server-darwin-x64.tar.gz`、`zcode-server-darwin-arm64.tar.gz`。新布局不使用旧 `zz-manifest-*` 组件清单。
- `scripts/publish-remote-assets.mjs` 将 descriptor 与归档复制成 Release 扁平布局；旧 manifest 分支仅用于读取历史目录，不是当前发布入口。
- `sourceServerReleaseResolver` 校验版本、大小和 SHA-256，通过既有 transport 安装器部署。Host 是唯一解析/导入 owner；不另建 Agent、队列或远程身份。

## 完整版本源

- 默认完整地址是 `https://github.com/<repository>/releases/download/v<version>`，不能写成 `/download/v/<version>`。
- `release.yml` 已传 `ZCODIUM_REMOTE_ASSET_CDN_BASE_URL`，tsup 必须消费为 `__ZCODIUM_REMOTE_ASSET_RELEASE_BASE__`；只在 YAML 中声明环境变量而不编译入 main 不会生效。
- 运行时显式源覆盖构建内置源；兼容旧 `ZCODE_REMOTE_ASSET_CDN_BASE_URL` 名称。设置中的自定义镜像针对完整版本目录，不因失败回退其他公网源。
- 完整 tag 目录直接寻址，不探测重复版本子目录；不读取 latest，也不把审计版 1.x 改成上游 3.x。
- descriptor 内其它 origin 的绝对 URL 不得绕过用户指定的镜像边界。SHA-256 证明内容完整性，不替代用户对镜像/离线包来源的信任。

## 离线使用（1.16.3 起）

1. 在可联网机器上，从**与应用完全相同版本**的 Release 下载 `source-server-release.json` 与目标平台的 `zcode-server-<target>.tar.gz`，放在同一个目录。不必下载其它平台包。
2. 将目录带入内网；在添加 SSH 的连接设置中点「导入离线运行时」，选择该目录。
3. 本机 Host 严格校验，再复制到独立内容代并复验副本，最后原子发布缓存指针。失败不会覆盖旧的可用导入。
4. 成功后自动选择「仅离线」，本机经 SSH 上传并安装；不要求远端可访问 GitHub/CDN。
5. 即使已有线路偏好 remote-download，仅离线返回的也是本地归档；部署器复用现有本地路径优先级。缺包立即提示，不先超时探测公网。

缓存由应用 userData 下 `remote-assets-cache/source-server/<version>` 管理，可用 `ZCODE_REMOTE_ASSET_CACHE_DIR` 覆盖缓存根。用户不需要手工更改缓存布局。在线模式完整缓存命中同样不请求网络。

## CI 与验收

- 顺序：创建 draft → CLI/桌面/远端资产构建 → 上传 → 校验清单 → 全部成功才公开。不得对已公开版本重打 tag 或替换运行时身份。
- 桌面更新元数据由唯一后置 job 汇总，各 matrix job 不直接上传 latest；双架构、真实资产摘要与失败门禁见 [github-release-update-metadata.md](github-release-update-metadata.md)。
- 桌面、descriptor、server bundle 使用同一 `ZCODE_APP_VERSION`/根 package.json 版本。
- 必测：完整 GitHub URL、构建常量接线、镜像独占、有效缓存零请求、离线新装/握手/重连、错版本/平台/损坏/符号链接拒绝，以及安装升级 busy guard/取消。
- 只有打包应用真实交互与 SSH 部署证据可支持「功能可用」结论；类型检查、单测和下载成功不能替代真实连接验收。

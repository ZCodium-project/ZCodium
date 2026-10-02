# Spec：P1a 对外契约环境变量改名 ZCODE_ → ZCODIUM_（旧名兼容一版）

## 范围

用户/CI/文档/安装器真实会设置的 15 个对外契约变量，机械前缀改名
`ZCODE_ → ZCODIUM_`：

```
ZCODE_DATA_BASE_DIR                ZCODIUM_DATA_BASE_DIR
ZCODE_BASE_URL                     ZCODIUM_BASE_URL
ZCODE_CDN_BASE_URL                 ZCODIUM_CDN_BASE_URL
ZCODE_DEPS_BASE_URL                ZCODIUM_DEPS_BASE_URL
ZCODE_DIST_BASE_URL                ZCODIUM_DIST_BASE_URL
ZCODE_REMOTE_ASSET_CDN_BASE_URL    ZCODIUM_REMOTE_ASSET_CDN_BASE_URL
ZCODE_CONVERSATION_SHARE_WEB_URL   ZCODIUM_CONVERSATION_SHARE_WEB_URL
ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ZCODIUM_BUILTIN_PROVIDER_CONFIG_FILE
ZCODE_PERSONAL_PROVIDER_CONFIG_FILE ZCODIUM_PERSONAL_PROVIDER_CONFIG_FILE
ZCODE_STORAGE_DIR                  ZCODIUM_STORAGE_DIR
ZCODE_SERVER_WORKSPACE             ZCODIUM_SERVER_WORKSPACE
ZCODE_SERVER_AUTH_TOKEN            ZCODIUM_SERVER_AUTH_TOKEN
ZCODE_PROJECT_DIR                  ZCODIUM_PROJECT_DIR
ZCODE_DIST_HOME / ZCODE_DIST_BIN_DIR ZCODIUM_DIST_HOME / ZCODIUM_DIST_BIN_DIR
ZCODE_PLUGIN_ROOT / ZCODE_PLUGIN_DATA ZCODIUM_PLUGIN_ROOT / ZCODIUM_PLUGIN_DATA
```

不在名单的 ~330 个 `ZCODE_*` 进程间内部变量保持不变（P2，转独立维护时处理）。

## 兼容规则

- 读取端：新名优先、旧名兜底（`readExternalEnvVar(env, legacyName)`，
  shared `env-names.ts`）。
- 进程内写入端（给子进程传值处）：新名 + 旧名双写，覆盖新旧二进制混布
  （如 SSH 远端旧 agent）。
- dev 脚本（mise/dev-desktop-env/build-desktop-agent-cli）：设置新名；
  宿主泄漏剔除逻辑同时覆盖两个前缀。
- 弃用提示：读到旧名时 `logger.warn` 一次性提示（Host 侧）。
- 文档/.env.example/mise.toml：主示例用新名，标注旧名兼容期。

## 验收

1. `ZCODIUM_DATA_BASE_DIR` 生效；仅设置旧名同样生效且打弃用警告。
2. dev:desktop:test 隔离链路在纯新名下工作正常。
3. typecheck / lint / services 测试全绿。

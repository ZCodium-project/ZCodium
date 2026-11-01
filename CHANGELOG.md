# 更新日志 / Changelog

本索引从 v1.17.0 起维护；不补造此前版本的发布历史。每版完整说明在 `docs/releases/`，GitHub Release 使用对应版本文件作为正文。

## v1.17.3

恢复归档会话管理入口和项目文件树返回操作，修复可用模型检测的运行时装配及错误凭据脱敏，新增 Cheaper Inference 预设，并补齐根类型检查与浏览器安全入口门禁。详见[完整发布说明](docs/releases/v1.17.3.md)。

Restores archive management and file-tree navigation, repairs model discovery with credential-safe errors, adds the Cheaper Inference preset, and strengthens quality gates. See the [release notes](docs/releases/v1.17.3.md).

## v1.17.2

修复更新源指向 localhost 的问题；未签名 macOS 安装包改为明确提示并打开官方页面手动安装，不再承诺原生自动安装。包含 Windows 关闭窗口隐藏到托盘修复，以及 SQLite schema 只增门禁与 CI。详见[完整发布说明](docs/releases/v1.17.2.md)。

Fixes the update feed and provides explicit manual-install guidance for unsigned macOS builds. Includes Windows close-to-tray repair and SQLite schema compatibility gates. See the [release notes](docs/releases/v1.17.2.md).

## v1.17.1

补丁发行：修复 macOS DMG 图标压住安装说明文字、`解除拦截.txt` / `Unblock.txt` 未随包分发的问题，并恢复发布构建的 `ZCODE_APP_VERSION` 注入。详见[完整发布说明](docs/releases/v1.17.1.md)。

Patch release: restores the DMG layout and bundled unblock notes, and fixes release version injection. See the [release notes](docs/releases/v1.17.1.md).

## v1.17.0

[#79](https://github.com/ZCodium-project/ZCodium/issues/79) 功能更新：本地同项目多目录、主要目录和文件/能力来源；草稿隔离与冷恢复修复；GenUI、完整视图、自有 Source、插件后台/文档、消息呈现及所有 roots 配置与工作流归属。

保留审计版数据根、个人 Provider 和遥测/上传剥离。远程仍单固定 root，公网手机配对未恢复；验证及未完整实测项见[完整发布说明](docs/releases/v1.17.0.md)。本轮变化在 v1.17.0 发行后提供，不追记为公开 v1.16.3 已包含。

Feature release for local multi-folder projects and independent workbench capabilities; includes recovery, navigation and sandbox fixes. See the [release notes](docs/releases/v1.17.0.md) for validation scope and limitations. No historical releases are reconstructed here.

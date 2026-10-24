# #79 项目 UI 三个接缝交接

## 已完成的 Root 调用接线

1. `useRootPlatformEffects` 已删除旧角标写入及 `totalUnreadTaskCount` 参数。Root 同步完成：
   - 删除 `countAllUnreadTasks` import；
   - 删除 `const totalUnreadTaskCount = useZCodeSessionStore(...)`；
   - 从 `useRootPlatformEffects({ ... })` 调用删除 `totalUnreadTaskCount`。
   - 保持 ProjectDirectoryProvider 常驻；它是唯一角标写者，计数来自 Host 项目树。

2. `useRemoteWorkspaceHistory().handleSelectRemoteProject` 的真实签名现在是：

```ts
(
  sessionId,
  path,
  localWorkspacePath?,
  preparedWorkspaceIdentity?,
  isCurrent?,
  onWorkspaceActivated?,
) => Promise<void>;
```

Root `attachRemoteProjectWorkspace.bind` 的调用已从：

```ts
await handleSelectRemoteProject(sessionId, path);
```

改为：

```ts
await handleSelectRemoteProject(
  sessionId,
  path,
  undefined,
  identity,
  guard,
  target.onWorkspaceActivated,
);
```

Root 的临时 `remoteDraftIntent` 已保留本次对象引用；`finally` 仅在 `ref.current === 本次对象` 时清空，
不能让已取消的旧 bind 清掉后来发起者的项目草稿交接。

普通 SSH 目录选择不传 prepared identity，继续原 realpath → Host bind ACK → canonical descriptor → port ready。
已准备项目则不再 realpath、不按线路重建 identity；只接受 bind 返回的同一 cwd/identity。
Helper 在解析、绑定、持久化和导航前后复验异步资格；hook 内按 session 的在途 lease 防旧请求取消新 owner。

最后一参是可选的同步激活端口：bind ACK/port ready 后在 addTab 的同一提交边界交接草稿配置、正文与附件，随后才等待 pinned/timeline 刷新。刷新返回不能再次初始化草稿，避免抹掉期间用户后来选择的任务。已有五参仍保持原含义；`rootPreparedProjectBindWiring` 与 `projectNavigationCommit` 执行真实 callback 验证端口贯穿和晚回不抢导航。

## 手机项目链路的实际发现

```text
已配对 Web transport → workspace-bridge-open(project/task)
  → WebRemoteControlManager → Main 原窗口请求关联
  → Host PrepareProjectWorkspace → 既有 ProjectWorkspaceNavigation
  → Host canonical scope → 原 Provider Provisioning readiness
  → web-remote-replayable attachment → Root(initialTaskDraft, composerClientNamespace)
```

- Host 已有 `PrepareProjectWorkspace` handler；Main manager 已有 project bridge 逻辑，但没有装配 prepare/cancel 端口。
- A 在 `desktopRemoteSessions` 补充真实 Main→Host request/ACK/cancel 关联与 mobile-only route，并在 Main index 注入端口。
  它不创建桌面 continuous attachment，不启动额外 Agent/Host；同 scope 加入既有首次 Provisioning。
- Web 新增 `web-remote-control` managed 模块：项目意图/稳定 namespace 交付，实际 paired bridge RPC adapter、capability 校验和恢复入口。
  不新增登录、认证或 accepted queue。

## 未经裁决不能伪装完成的授权入口阻塞

当前 `packages/web/src/main.tsx` **整个 /remote 配对启动分支已被移除**，不是只有项目字段丢失。
当前 `packages/desktop/src/main/index.ts` 仍明确注入 `getLogin: async () => undefined`，注释要求 auth-required；
官方 3.16.2 QR 已移除旧 hash/t 凭据，只有 sid/mid，现存旧 Web transport 的 passHash 不能据此构造。

因此，不能为了“可点击”恢复官方账号/JWT/设备注册服务，也不能把普通 Web Server 的 /ws 会话冒充手机 shared-host。
新 paired session adapter 的入口必须接到一个真实、经产品授权的自有配对传输 owner；在该 owner/授权规则明确前，
手机公网入口仍是**未完成项**，不能以定向 paired adapter 测试声称真实手机已贯通。

Parent 若决定恢复自有授权入口，配对成功后只需创建 `createPairedWebRemoteControlProjectSession`，将实际传输的
`sendPayload/onPayload` 接到 adapter，并将其 `openProjectDraft/switchWorkspace/listWorkspaces/...` 交给 Root switcher；
`renderRoot` 接收真实 Host bridge、initialTaskDraft、稳定 composerClientNamespace。不得用临时 bridge ID 生成 namespace。

模块同时提供 `PairedProjectBridgeRoot`，已经实际将这些字段和 switcher 交给 Root，不要求调用方再手工复制 props。
实际查看发布通过 adapter 的 `updateMobileTaskView`，只在有效配对 epoch/bridge 下上报；`updateMobileViewState`
只保存恢复地址，不制造“正在查看”的事实。Parent 若改移动端 Shell，只有聊天页实际可见且有正式 task 时传 view，
主页/隐藏/卸载传 null；不要拿最后导航位置代替该调用。

## 验证记录

- 角标先复现旧 Root 写入 99/42 覆盖 Host 树；修复后与 prepared 导航、既有远端 history 共 3 文件 46 项通过。
- Main 手机准备先复现缺少 prepareProjectWorkspace；补充后 4 项通过（Host 请求、退出、取消、共享 readiness/仅手机 port）。
- 首批项目 UI 18 文件 /154 项在本轮复跑通过。Parent 工作流项目参数扩展使一个旧源码字符串断言过时，
  已改为抽取实际 callback 做运行级 guard/参数断言，保留原 154 项而不是降低产品断言。
- 新接缝及紧邻回归最终为 9 文件 /78 项通过；与原 18 文件合计 27 文件 /232 项（原批次和新批次分别实跑）。
- Shared/UI/Web references 局部 typecheck、Desktop remote-main 局部 typecheck 均已通过；架构 0 违规，
  本轮接缝范围 lint 0 warnings /0 errors，未跑全量、打包或 GUI。
- Root 旧角标调用、prepared identity/guard/同步激活端口传递和按对象引用清理已全部接入；后续验证见 [本轮验收报告](project-parity-validation.md)，不能只以类型通过代替运行证据。
- Shared 类型现与已有 runtime schema 对齐了 project/task bridge、窗口目录 capability 和实际查看 epoch；
  auth-required 仅表达现有禁用事实，遥测 payload 仍拒绝，Main 的遗留遥测分支和已移除类型引用已清除。

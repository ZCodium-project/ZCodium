import type { PublicZCodeErrorCode } from "@zcode/shared";
import type { RemoteEnvironment } from "@zcode/server/remote/backend.js";

export const WINDOWS_NATIVE_REMOTE_UNSUPPORTED_MESSAGE =
  "当前 remote 模式仅支持 POSIX shell 环境，暂不支持 Windows 原生远程主机";

/**
 * 远端平台不在支持范围时的错误；带公开码，让 UI 显示专用原因，
 * 而不是笼统的“远端环境检查失败”或“下载失败”。
 */
export function createUnsupportedRemotePlatformError(message: string): Error {
  return Object.assign(new Error(message), {
    code: "remote-platform-unsupported" satisfies PublicZCodeErrorCode,
  });
}

export function assertSupportedRemoteEnvironment(env: RemoteEnvironment): void {
  if (env.platform !== "win32") {
    return;
  }

  // deploy/connect 之前各自硬编码 Windows 拒绝逻辑，后续容易出现 skipDeploy 绕过或错误信息不一致。
  // 当前 remote 后端和启动命令仍依赖 POSIX shell；先集中能力边界，等 Windows shell strategy 接入后再统一放开。
  throw createUnsupportedRemotePlatformError(WINDOWS_NATIVE_REMOTE_UNSUPPORTED_MESSAGE);
}

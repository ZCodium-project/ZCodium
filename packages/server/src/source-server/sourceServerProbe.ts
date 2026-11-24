import {
  normalizeRemoteArch,
  normalizeRemotePlatform,
  resolveRemotePlatform,
} from "@zcode/server/remote/detectEnv.js";
import type { IRemoteBackend } from "@zcode/server/remote/backend.js";
import {
  assertSupportedRemoteEnvironment,
  createUnsupportedRemotePlatformError,
  WINDOWS_NATIVE_REMOTE_UNSUPPORTED_MESSAGE,
} from "@zcode/server/remote/remotePlatformSupport.js";
import {
  collectCommand,
  readLastJsonLine,
  readUniqueVersion,
  throwIfAborted,
} from "@zcode/server/source-server/sourceServerTransportRuntime.js";
import type {
  SourceServerProbeOptions,
  SourceServerProbeResult,
  TransportContext,
} from "@zcode/server/source-server/transportAdapter.js";

const SERVER_ROOT_SHELL = '"$HOME/.zcode/server"';
const SERVER_BIN_SHELL = '"$HOME/.zcode/server/bin/zcode"';
const SERVER_CURRENT_SHELL = `${SERVER_ROOT_SHELL}/current.json`;
const SERVER_STATUS_SHELL = `${SERVER_ROOT_SHELL}/run/status.json`;
const SERVER_DOWNGRADE_SHELL = `${SERVER_ROOT_SHELL}/downgrade.json`;
const SOURCE_SERVER_PROBE_MARKER_PREFIX = "__ZCODE_PROBE_";

function buildSourceServerProbeCommand(includeReleaseIdentity: boolean): string {
  return [
    "set +e",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}PLATFORM__\\n'`,
    // Bug 原因：set +e 加末尾 printf 会把 uname 失败覆盖为退出 0，空字段随后被误报为系统不支持。
    // 系统与架构是必需结果；只让这两条命令的失败终止探测，可选元数据仍允许缺失。
    "uname -s || exit $?",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}ARCH__\\n'`,
    "uname -m || exit $?",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}ROOT__\\n'`,
    `printf '%s\\n' ${SERVER_ROOT_SHELL}`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}KERNEL__\\n'`,
    "if [ -r /proc/sys/kernel/ostype ]; then cat /proc/sys/kernel/ostype; else printf '\\n'; fi",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}LIBC__\\n'`,
    // 内置 Node 需要 glibc 2.28。musl 没有 GNU_LIBC_VERSION，只能看它的动态链接器；先查 glibc，
    // 因为 Debian 等 glibc 系统安装 musl 包后也会有 /lib/ld-musl-*.so.1。macOS 两项都没有输出。
    "if libc_version=$(getconf GNU_LIBC_VERSION 2>/dev/null); then printf '%s\\n' \"$libc_version\"; else for musl_loader in /lib/ld-musl-*.so.1; do if [ -e \"$musl_loader\" ]; then printf 'musl\\n'; break; fi; done; fi",
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}INSTALLED__\\n'`,
    `if [ -f ${SERVER_BIN_SHELL} ]; then printf '1\\n'; else printf '0\\n'; fi`,
    ...(includeReleaseIdentity
      ? [
          `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}RELEASE__\\n'`,
          `if [ -r ${SERVER_CURRENT_SHELL} ]; then cat ${SERVER_CURRENT_SHELL}; fi`,
        ]
      : []),
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}RELEASEID__\\n'`,
    `if [ -r ${SERVER_CURRENT_SHELL} ]; then sed -n 's/^[[:space:]]*"releaseId"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' ${SERVER_CURRENT_SHELL} | head -n 1; fi`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}DOWNGRADE__\\n'`,
    `if [ -r ${SERVER_DOWNGRADE_SHELL} ]; then tr -d '\\r\\n' < ${SERVER_DOWNGRADE_SHELL}; printf '\\n'; fi`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}VERSION__\\n'`,
    `if [ -r ${SERVER_CURRENT_SHELL} ]; then sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' ${SERVER_CURRENT_SHELL} | head -n 1; fi`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}STATUS__\\n'`,
    // Bug 原因：每次 probe 启动两次完整 Server CLI，冷缓存时仅版本/状态读取就会耗尽
    // 10 秒启动预算。current/status 是 CLI 自身的权威持久化文件；status 仅在 PID 仍存活时复用。
    `if [ -r ${SERVER_STATUS_SHELL} ]; then status_pid=$(sed -n 's/^[[:space:]]*"pid"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' ${SERVER_STATUS_SHELL} | head -n 1); if [ -n "$status_pid" ] && kill -0 "$status_pid" 2>/dev/null; then tr -d '\\r\\n' < ${SERVER_STATUS_SHELL}; printf '\\n'; fi; fi`,
    `printf '${SOURCE_SERVER_PROBE_MARKER_PREFIX}END__\\n'`,
  ].join("; ");
}

function readSourceServerProbeSections(output: string): Map<string, string> {
  const parts = output.split(/__ZCODE_PROBE_([A-Z]+)__\r?\n/gu);
  const sections = new Map<string, string>();
  for (let index = 1; index + 1 < parts.length; index += 2) {
    sections.set(parts[index]!, parts[index + 1]!.trim());
  }
  return sections;
}

/** 远端环境检查本身的失败；只有它归入预检失败，建立连接或执行命令的传输失败不借探测阶段兜底。 */
export class SourceServerProbeEnvironmentError extends Error {
  public override readonly name = "SourceServerProbeEnvironmentError";
}

// cmd.exe / PowerShell 找不到 `/bin/sh` 时的英文特征。uname 失败也会非零退出，
// 因此只凭明确的 Windows shell 错误判定目标不支持，不能把所有探测失败都归入此类。
// Bug 原因：旧逻辑还把 U+FFFD（非 UTF-8 字节）当成 GBK 的 Windows 报错。乱码只说明解码有损失：
// POSIX 登录 shell 的启动脚本可在 probe 执行前输出本地编码错误并退出，WSL 里 wsl.exe 的中文提示是
// UTF-16LE，两者都被说成“不支持 Windows 原生远程主机”。只有乱码时保留预检失败与原始 stderr。
const WINDOWS_NATIVE_SHELL_FAILURE_PATTERN =
  /CommandNotFoundException|FullyQualifiedErrorId|is not recognized as (?:an internal or external command|the name of a cmdlet)|The system cannot find the path specified/iu;

// archive 内置官方 Node（SERVER_RUNTIME_NODE_VERSION）Linux 构建的动态链接下限，随 Node 大版本同步。
const SOURCE_SERVER_MIN_GLIBC_VERSION = [2, 28] as const;

function warnUnsupportedLibc(platform: string, libcText: string, context: TransportContext): void {
  if (platform !== "linux") return;
  // 旧实现把系统 glibc 报告当作拒连依据，连已有服务也无法尝试连接。
  // 保留随包 runtime 的兼容风险提示，实际能否运行由后续安装/启动决定；未知版本不猜测。
  let detected: string;
  const match = /^glibc\s+(\d+)\.(\d+)/iu.exec(libcText);
  if (match) {
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const [minMajor, minMinor] = SOURCE_SERVER_MIN_GLIBC_VERSION;
    if (major > minMajor || (major === minMajor && minor >= minMinor)) return;
    detected = `Remote glibc ${major}.${minor} is older than`;
  } else if (libcText === "musl") {
    // musl 下随包 Node 实测无法运行（装 gcompat 后仍报 fcntl64: symbol not found），同样只提示。
    detected = "Remote uses musl libc instead of";
  } else {
    return;
  }
  const required = SOURCE_SERVER_MIN_GLIBC_VERSION.join(".");
  context.onLog?.({
    phase: "probe",
    level: "warn",
    message:
      `${detected} glibc ${required} required by the bundled ZCode Source Server runtime. ZCode Source Server may fail to start. ` +
      "Continuing installation or connection.",
  });
}

function isWindowsNativeShellFailure(stderr: string): boolean {
  return WINDOWS_NATIVE_SHELL_FAILURE_PATTERN.test(stderr);
}

/** 降级标记只属于写入时的 release；current 已换成其他 release 时标记作废。 */
function readDowngradedFrom(markerText: string, currentReleaseId: string): string | undefined {
  if (!markerText || !currentReleaseId) return undefined;
  try {
    const marker = JSON.parse(markerText) as { releaseId?: unknown; fromVersion?: unknown };
    return marker.releaseId === currentReleaseId &&
      typeof marker.fromVersion === "string" &&
      marker.fromVersion.trim()
      ? marker.fromVersion.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

export async function probeSourceServer(
  backend: IRemoteBackend,
  context: TransportContext,
  options: SourceServerProbeOptions,
): Promise<SourceServerProbeResult> {
  throwIfAborted(context.signal);
  // Bug 原因：冷启动曾串行/并发创建多个 SSH channel 读取环境、安装、release、version、status；
  // 串行会超出 10 秒预算，并发又会在首次握手期触发 Bad packet length。一个只读 POSIX channel
  // 同时给三种 Backend 使用，既保留 Adapter 合同，也把 probe 收敛为单次远端 round-trip。
  const result = await collectCommand(
    await backend.exec(buildSourceServerProbeCommand(options.includeReleaseIdentity === true)),
  );
  if (result.exitCode !== 0) {
    // Bug 原因：Docker 的 `docker exec` 在 daemon 不可用时也只是退出码 1，与远端脚本失败无法区分，
    // docker CLI 的报错被当成远端环境检查失败；socket 无权限时还被原因文本归成“没有容器写入权限”。
    // 先让 backend 确认传输本身可用；不可用时抛出它的传输错误，不归入预检失败。
    await backend.diagnoseExecFailure?.();
    // Bug 原因：Windows OpenSSH 的默认 shell 是 cmd/PowerShell，固定的 `/bin/sh` 无法启动，
    // 旧逻辑只报“远端环境检查失败”并把 GBK 乱码当原因展示，用户看不出是不支持 Windows 原生主机。
    if (isWindowsNativeShellFailure(result.stderr)) {
      throw Object.assign(
        createUnsupportedRemotePlatformError(WINDOWS_NATIVE_REMOTE_UNSUPPORTED_MESSAGE),
        { cause: new Error(result.stderr.trim()) },
      );
    }
    throw new SourceServerProbeEnvironmentError(
      result.stderr.trim() || "Source Server environment probe failed",
    );
  }
  const sections = readSourceServerProbeSections(result.stdout);
  // Bug 原因（ZCT-2114700808714715136）：退出 0 不保证脚本执行完整；缺失字段被默认为空，
  // 不仅误报系统不支持，还会把缺失的 INSTALLED 当作未安装并覆盖已有 Source 的安装状态。
  // 在唯一的探测边界拒绝不完整结果，不让上层依据未知值选包或修改安装状态。
  const invalidFields = ["PLATFORM", "ARCH", "ROOT"].filter((field) => !sections.get(field));
  if (!["0", "1"].includes(sections.get("INSTALLED") ?? "")) invalidFields.push("INSTALLED");
  if (!sections.has("END")) invalidFields.push("END");
  if (invalidFields.length) {
    const stderr = result.stderr.trim().slice(0, 2_048);
    throw new SourceServerProbeEnvironmentError(
      `Source Server environment probe returned incomplete or invalid output: ${invalidFields.join(", ")}` +
        (stderr ? `; ${stderr}` : ""),
    );
  }
  const reportedPlatform = sections.get("PLATFORM") ?? "";
  const kernelOstype = sections.get("KERNEL") ?? "";
  const environment = {
    platform: resolveRemotePlatform(normalizeRemotePlatform(reportedPlatform), kernelOstype),
    arch: normalizeRemoteArch(sections.get("ARCH") ?? ""),
    ...(sections.get("ROOT") ? { installPath: sections.get("ROOT") } : {}),
  };
  // 不支持的平台带公开码 remote-platform-unsupported，直接上抛，不包装成笼统的预检失败。
  assertSupportedRemoteEnvironment(environment);
  warnUnsupportedLibc(environment.platform, sections.get("LIBC") ?? "", context);
  const installed = sections.get("INSTALLED") === "1";
  if (!installed) return { ...environment, installed: false };

  let installedArchiveSha256: string | undefined;
  const releaseText = sections.get("RELEASE");
  if (releaseText) {
    try {
      const current = JSON.parse(releaseText) as { archiveSha256?: unknown };
      if (
        typeof current.archiveSha256 === "string" &&
        /^[a-f0-9]{64}$/iu.test(current.archiveSha256)
      ) {
        installedArchiveSha256 = current.archiveSha256.toLowerCase();
      }
    } catch (error) {
      // Bug 原因：同 version 的旧开发安装可能没有 archive 身份；缺失必须投影为未知，
      // 由开发态内容寻址策略触发刷新，不能让旧 Server 的元数据格式阻断 probe。
      context.onLog?.({
        phase: "probe",
        message: `Source Server release identity is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const versionText = sections.get("VERSION") ?? "";
  const statusText = sections.get("STATUS") ?? "";
  let installedVersion: string | undefined;
  let daemonStatus: SourceServerProbeResult["daemonStatus"];
  try {
    if (versionText) installedVersion = readUniqueVersion(versionText);
  } catch {
    installedVersion = undefined;
  }
  try {
    if (statusText) daemonStatus = readLastJsonLine(statusText) as typeof daemonStatus;
  } catch {
    daemonStatus = undefined;
  }
  const downgradedFrom = readDowngradedFrom(
    sections.get("DOWNGRADE") ?? "",
    sections.get("RELEASEID") ?? "",
  );
  return {
    ...environment,
    installed: true,
    ...(installedArchiveSha256 ? { installedArchiveSha256 } : {}),
    ...(installedVersion ? { installedVersion } : {}),
    ...(downgradedFrom ? { downgradedFrom } : {}),
    ...(daemonStatus ? { daemonStatus } : {}),
  };
}

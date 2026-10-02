/* eslint-disable max-lines -- CLI 入口集中编排子命令分发与进程管理，oxfmt 换行后略超 400 行，拆分会割裂编排流程。 */
import { fork } from "node:child_process";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
import { ZCODE_VERSION } from "@zcode/shared";
import {
  controlRequestSchema,
  createStoppedServerStatus,
  serverStatusSchema,
  type ServerStatus,
} from "./contracts.js";
import { requestControl } from "./ipc/controlClient.js";
import {
  resolveCanonicalServerLayout,
  resolveServerLayout,
  validateUninstallTarget,
} from "./runtime/paths.js";
import { validateServerInstallOwnership } from "./runtime/installationOwnership.js";
import { createReleaseAgentWiring, type BundledAgentWiring } from "./runtime/agentWiring.js";
import { writeStableLauncher } from "./runtime/stableLauncher.js";
import { runUpdateCommand } from "./runtime/updateCommand.js";
import { DataRootLock } from "./runtime/lock.js";
import {
  acquireUninstallLock,
  describeLockInspection,
  removeRunContentsExceptLock,
} from "./runtime/uninstallGuard.js";
import { readPersistedStatus, readPersistedStatusDetailed } from "./runtime/statusSnapshot.js";
import { waitForServerStopped } from "./runtime/shutdownWait.js";
export { readPersistedStatus } from "./runtime/statusSnapshot.js";
import {
  hasLegacyServiceRegistration,
  unregisterInstalledService,
  unregisterLegacyServiceForRoot,
} from "./runtime/serviceInstallation.js";

export interface CliIO {
  stdout?: { write(value: string): void };
  stderr?: { write(value: string): void };
  confirm?: (prompt: string) => Promise<string>;
  legacyDelegate?: (argv: readonly string[]) => Promise<number>;
}

export interface ServerCliRuntimeOptions {
  bundledAgentWiring?: BundledAgentWiring | null;
}

const stdout = (io: CliIO, value: unknown): void =>
  io.stdout?.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
const stderr = (io: CliIO, value: unknown): void =>
  io.stderr?.write(`${value instanceof Error ? value.message : String(value)}\n`);

export function serviceRegistrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZCODE_SERVER_SKIP_SERVICE_REGISTRATION !== "1";
}

export function daemonStartupMode(env: NodeJS.ProcessEnv = process.env): "service" | "fallback" {
  return serviceRegistrationEnabled(env) ? "service" : "fallback";
}

export function isRegisteredServiceEntry(args: readonly string[]): boolean {
  return args.includes("--service-entry");
}

export const SERVER_SERVICE_ARGS = ["serve", "--supervisor"] as const;

export function shouldRegisterService(
  daemonRequested: boolean,
  supervisorProcess: boolean,
): boolean {
  return daemonRequested && !supervisorProcess;
}

export async function runServerCli(
  argv: readonly string[],
  io: CliIO = {},
  runtimeOptions: ServerCliRuntimeOptions = {},
): Promise<number> {
  const json = argv.includes("--json");
  try {
    const parsed = parseServerCliArguments(argv);
    const command = parsed.argv[0];
    if (!command) {
      return await (io.legacyDelegate?.(parsed.argv) ?? delegateLegacyCli(parsed.argv, io));
    }
    // 同一物理 data-root 的符号链接别名会派生不同 control endpoint 和 OS service
    // identity。生命周期命令统一在 IO 前收敛 root，避免第二个 Supervisor 绕过探测重复注册。
    const layout = ["serve", "status", "stop", "restart", "update", "uninstall"].includes(command)
      ? await resolveCanonicalServerLayout(parsed.layout.serverRoot)
      : parsed.layout;
    switch (command) {
      case "serve":
        return await runServe(parsed.argv.slice(1), io, json, layout, runtimeOptions);
      case "status":
      case "stop":
      case "restart":
        return await runControl(command, io, json, {}, layout);
      case "update":
        return await runUpdateCommand(parsed.argv, io, json, layout, () =>
          runControl("apply-update", io, json, { force: parsed.argv.includes("--force") }, layout),
        );
      case "uninstall":
        return await runUninstall(io, json, layout);
      default:
        return await (io.legacyDelegate?.(parsed.argv) ?? delegateLegacyCli(parsed.argv, io));
    }
  } catch (error: unknown) {
    if (json)
      stdout(io, { ok: false, error: error instanceof Error ? error.message : String(error) });
    else stderr(io, error);
    return 1;
  }
}

function parseServerCliArguments(argv: readonly string[]): {
  argv: readonly string[];
  layout: ReturnType<typeof resolveServerLayout>;
} {
  const rootOptionIndexes = argv.flatMap((value, index) =>
    value === "--server-root" ? [index] : [],
  );
  if (rootOptionIndexes.length > 1) throw new Error("--server-root may only be specified once");
  const rootOptionIndex = rootOptionIndexes[0];
  if (rootOptionIndex === undefined) return { argv, layout: resolveServerLayout() };
  const serverRoot = argv[rootOptionIndex + 1];
  if (!serverRoot) throw new Error("--server-root requires an absolute path");
  if (!isAbsolute(serverRoot)) throw new Error("--server-root must be an absolute path");
  return {
    argv: argv.filter(
      (_value, index) => index !== rootOptionIndex && index !== rootOptionIndex + 1,
    ),
    layout: resolveServerLayout(serverRoot),
  };
}

async function runServe(
  args: readonly string[],
  io: CliIO,
  json: boolean,
  layout: ReturnType<typeof resolveServerLayout>,
  runtimeOptions: ServerCliRuntimeOptions,
): Promise<number> {
  const daemonRequested = args.includes("--daemon");
  const supervisorProcess = args.includes("--supervisor");
  if (shouldRegisterService(daemonRequested, supervisorProcess)) {
    const startupMode = daemonStartupMode();
    const legacyIdentityMigration =
      startupMode === "service" && (await hasLegacyServiceRegistration(layout));
    const existing = await readControlStatus(layout, 500);
    if (existing && (existing.state === "ready" || existing.state === "starting")) {
      if ((existing.serviceRegistered && !legacyIdentityMigration) || startupMode === "fallback") {
        if (json) stdout(io, existing);
        else
          stdout(
            io,
            `ZCode Server ${existing.state} at ${existing.host ?? ""}:${existing.port ?? ""}`,
          );
        return 0;
      }
      if (existing.runningTaskCount > 0) {
        throw new Error(
          `Cannot replace fallback daemon while ${existing.runningTaskCount} task(s) are running; stop the server first`,
        );
      }
      // 旧 fallback 会持有 data-root lock，直接注册并启动 OS service 只能
      // 拉起一个立即锁冲突的 Supervisor。空闲时先收口 fallback，再重试真实注册。
      const persistedBeforeStop = await readPersistedStatusDetailed(layout);
      if (persistedBeforeStop.state === "invalid" || persistedBeforeStop.state === "unreadable") {
        throw new Error("Cannot verify fallback Server status before migration");
      }
      const stopBaselineUpdatedAt = persistedBeforeStop.status?.updatedAt ?? 0;
      await requestControl(layout.controlEndpoint, { command: "stop" });
      await waitForServerStopped(layout, stopBaselineUpdatedAt, true);
    }
    const baselineUpdatedAt = (await readPersistedStatus(layout))?.updatedAt ?? 0;
    let serviceStarted = false;
    let childEarlyExit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
    if (startupMode === "service") {
      const { createDaemonServiceDescriptor, registerService, serviceDescriptorPath } =
        await import("./platform/serviceManager.js");
      const platform =
        process.platform === "darwin" || process.platform === "linux" ? process.platform : "win32";
      await writeStableLauncher(layout, platform, {
        command: process.execPath,
        entry: process.argv[1] ?? fileURLToPath(import.meta.url),
      });
      const descriptor = createDaemonServiceDescriptor({ platform, layout });
      await mkdir(layout.serviceDir, { recursive: true, mode: 0o700 });
      const descriptorPath = serviceDescriptorPath(layout, descriptor);
      await writeFile(descriptorPath, descriptor.content, "utf8");
      await unregisterLegacyServiceForRoot(layout);
      // 注册失败必须向调用方返回真实错误；只有显式 opt-out 才允许 detached fallback。
      await registerService(descriptor, descriptorPath);
      serviceStarted = true;
    }
    if (!serviceStarted) {
      const child = fork(
        fileURLToPath(import.meta.url),
        [...SERVER_SERVICE_ARGS, "--server-root", layout.serverRoot],
        {
          detached: true,
          stdio: "ignore",
          env: {
            ...process.env,
            ZCODIUM_DATA_BASE_DIR: layout.dataBaseDir,
            ZCODE_DATA_BASE_DIR: layout.dataBaseDir,
            ZCODE_SERVER_ROOT: layout.serverRoot,
          },
        },
      );
      child.unref();
      // Supervisor 是独立 daemon，不需要保留 CLI↔Supervisor 的 IPC 通道；关闭该通道
      // 才能让一次性的 `serve --daemon` CLI 在返回 ready 后真正退出。
      child.disconnect();
      // 子 Supervisor 以 detached + stdio ignore 启动，锁冲突等启动失败时静默退出；
      // 记录早退信息让等待循环立即报告真实原因。
      child.once("exit", (code, signal) => {
        childEarlyExit = { code, signal };
      });
    }
    const started = await waitForPersistedStatus(
      layout,
      "ready",
      baselineUpdatedAt,
      () => {
        if (childEarlyExit) {
          throw new Error(
            `ZCode Server daemon exited before ready (code=${childEarlyExit.code ?? "null"} signal=${childEarlyExit.signal ?? "none"}); check ${layout.statusFile} for details`,
          );
        }
      },
      serviceStarted,
    );
    if (json) stdout(io, started);
    else stdout(io, `ZCode Server ${started.state} at ${started.host ?? ""}:${started.port ?? ""}`);
    process.stdin.pause();
    process.stdin.destroy();
    return 0;
  }
  const daemon = supervisorProcess;
  const { Supervisor } = await import("./supervisor/supervisor.js");
  const serviceRegistered = supervisorProcess && isRegisteredServiceEntry(args);
  let foregroundStopped: (() => void) | undefined;
  const supervisor = new Supervisor({
    layout,
    launcher: {
      launch: (generation, release) => {
        const runtimeRoot = release?.releaseDir ? join(release.releaseDir, "runtime") : null;
        const corePath = runtimeRoot
          ? join(runtimeRoot, "server-core.js")
          : fileURLToPath(new URL("./server-core.js", import.meta.url));
        const runtimeNode = runtimeRoot
          ? join(runtimeRoot, process.platform === "win32" ? "node.exe" : "node")
          : process.execPath;
        const inheritedEnv = {
          ...process.env,
          ZCODE_DATA_BASE_DIR: layout.dataBaseDir,
          ZCODE_SERVER_ROOT: layout.serverRoot,
        };
        const releaseWiring = runtimeRoot
          ? createReleaseAgentWiring(runtimeRoot, runtimeNode, inheritedEnv)
          : runtimeOptions.bundledAgentWiring;
        return fork(corePath, [String(generation)], {
          execPath: runtimeNode,
          env: {
            ...inheritedEnv,
            ...releaseWiring,
            ...(runtimeRoot ? { ZCODE_SERVER_RUNTIME_ROOT: runtimeRoot } : {}),
          },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
      },
    },
    version: ZCODE_VERSION,
    serviceRegistered,
    onStopped: () => {
      process.stdin.pause();
      foregroundStopped?.();
      if (supervisorProcess) process.disconnect?.();
    },
  });
  await supervisor.start();
  let status: ServerStatus;
  try {
    status = await waitForSupervisorReady(supervisor);
  } catch (error) {
    // Core 进入 crash-loop 时不能把错误直接抛给 CLI 顶层返回：control
    // socket 仍持有事件循环导致前台进程假死；用户 Ctrl+C（此时信号 handler 尚未注册，
    // 走默认强杀）后锁文件与 socket 残留，后续 serve 永远报 "already running"。
    // 启动失败必须先停 Supervisor 收口锁与 socket，再上抛错误。
    await supervisor.stop("startup-failed").catch(() => undefined);
    throw error;
  }
  if (json) stdout(io, status);
  else stdout(io, `ZCode Server ${status.state} at ${status.host ?? ""}:${status.port ?? ""}`);
  await new Promise<void>((resolve) => {
    foregroundStopped = resolve;
    if (!daemon) {
      const finish = () => {
        void supervisor.stop("signal").then(() => resolve());
      };
      process.once("SIGINT", finish);
      process.once("SIGTERM", finish);
    }
  });
  return 0;
}

// apply-update 服务端最坏路径包含旧 Core 停止、新 Core ready 等待、新 Core 回滚停止、
// 旧 Core ready 等待以及旧 Core ready 超时后的再次停止，默认有界预算约为 51 秒，另需
// 为 current/pending 文件操作和 IPC 调度留出余量。客户端超时必须覆盖完整回滚路径，
// 否则 CLI 会在 update 仍在后台执行时误报超时。
export const APPLY_UPDATE_TIMEOUT_MS = 90_000;

async function runControl(
  command: string,
  io: CliIO,
  json: boolean,
  extra: Record<string, unknown> = {},
  layout = resolveServerLayout(),
): Promise<number> {
  const request = controlRequestSchema.parse({ id: "cli", command, ...extra });
  let result: unknown;
  try {
    result = await requestControl(
      layout.controlEndpoint,
      request,
      command === "apply-update" ? APPLY_UPDATE_TIMEOUT_MS : undefined,
    );
  } catch (error: unknown) {
    if (command === "status") {
      const persisted = await readPersistedStatusDetailed(layout);
      result = persisted.status ?? createStoppedServerStatus(ZCODE_VERSION);
    } else if (command === "stop" && isControlEndpointUnavailable(error)) {
      const persisted = await readPersistedStatusDetailed(layout);
      if (persisted.state === "invalid" || persisted.state === "unreadable") {
        throw error;
      }
      if (
        persisted.status &&
        persisted.status.state !== "stopped" &&
        persisted.status.state !== "uninstalled"
      ) {
        throw error;
      }
      // Supervisor 停止时会先关闭 control socket，再由 CLI 落盘 stopped 状态。
      // 重复 stop 发生在这个窗口后不应因为 socket 不存在而变成失败。
      result = persisted.status ?? createStoppedServerStatus(ZCODE_VERSION);
    } else {
      throw error;
    }
  }
  if (json) stdout(io, result);
  else stdout(io, result ?? "ok");
  return 0;
}

function isControlEndpointUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ECONNREFUSED" || error.code === "EINVAL";
}

async function runUninstall(
  io: CliIO,
  json: boolean,
  layout: ReturnType<typeof resolveServerLayout>,
): Promise<number> {
  const first = await (io.confirm?.("Type DELETE to uninstall ZCode Server: ") ??
    Promise.resolve(""));
  if (first !== "DELETE") throw new Error("Uninstall cancelled");
  const second = await (io.confirm?.("Type DELETE again to confirm: ") ?? Promise.resolve(""));
  if (second !== "DELETE") throw new Error("Uninstall cancelled");
  // 不能把同一个 --server-root 同时作为 allowlist 根和删除目标：包含关系
  // 恒成立，任何绝对目录都能被卸载流程递归删除。停止服务前必须先验证安装归属。
  const ownership = await validateServerInstallOwnership(layout);
  try {
    await runControl("confirm-uninstall", io, json, { confirmation: "DELETE" }, layout);
  } catch (error: unknown) {
    const persisted = await readPersistedStatusDetailed(layout);
    if (persisted.status?.state === "stopped" || persisted.status?.state === "uninstalled")
      return await finishUninstall(io, json, layout, ownership);
    const lockInspection = await new DataRootLock(layout.lockFile).inspect();
    if (lockInspection.state === "active") {
      throw new Error(`Cannot uninstall while Server lock is held by pid ${lockInspection.pid}`, {
        cause: error,
      });
    }
    if (lockInspection.state === "invalid" || lockInspection.state === "unreadable") {
      throw new Error(
        `Cannot verify Server shutdown before uninstall (${describeLockInspection(lockInspection)})`,
        { cause: error },
      );
    }
  }
  await waitForServerStopped(layout);
  return await finishUninstall(io, json, layout, ownership);
}

async function finishUninstall(
  io: CliIO,
  json: boolean,
  layout: ReturnType<typeof resolveServerLayout>,
  ownership: Awaited<ReturnType<typeof validateServerInstallOwnership>>,
): Promise<number> {
  await unregisterInstalledService(layout);
  const uninstallLock = await acquireUninstallLock(layout);
  const uninstallEntries = [
    "releases",
    "run",
    "cache",
    "bin",
    "service",
    "current.json",
    "pending.json",
    "install.json",
    "uninstalled.json",
    "update-transaction.json",
  ] as const;
  try {
    for (const entry of uninstallEntries) {
      const target = validateUninstallTarget(
        ownership.canonicalServerRoot,
        join(ownership.canonicalServerRoot, entry),
      );
      if (!target.ok || !target.canonicalPath) {
        throw new Error(`Unsafe uninstall target: ${target.reason ?? "unknown"}`);
      }
      if (entry === "run") {
        await removeRunContentsExceptLock(layout);
      } else {
        await rm(target.canonicalPath, { recursive: true, force: true });
      }
    }
    const preservedPaths = (await readdir(ownership.canonicalServerRoot))
      .filter((entry) => entry !== "run")
      .sort();
    // server root 允许用户显式指定，不能递归删除未知内容。卸载只清理上面的
    // ZCode allowlist，并把保留项写入结果供用户审计。先落盘 marker，再释放 lock，
    // 让并发 Supervisor 在删除 run 目录的最后窗口也会 fail-closed。
    await writeFile(
      layout.uninstalledFile,
      `${JSON.stringify({ uninstalled: true, uninstalledAt: Date.now(), version: ZCODE_VERSION, preservedPaths }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await uninstallLock.release();
    await rm(layout.runDir, { recursive: true, force: true });
    if (json) stdout(io, { uninstalled: true, preservedPaths });
    else stdout(io, "uninstalled");
    return 0;
  } catch (error: unknown) {
    await uninstallLock.release().catch(() => undefined);
    throw error;
  }
}

async function waitForPersistedStatus(
  layout: ReturnType<typeof resolveServerLayout>,
  expectedState: "ready" | "stopped",
  minUpdatedAt = 0,
  assertStillWaiting?: () => void,
  expectedServiceRegistered?: boolean,
): Promise<ServerStatus> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const status = await readPersistedStatus(layout);
    if (
      status?.state === expectedState &&
      status.updatedAt > minUpdatedAt &&
      (expectedServiceRegistered === undefined ||
        status.serviceRegistered === expectedServiceRegistered)
    )
      return status;
    assertStillWaiting?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for Server ${expectedState}`);
}

async function waitForSupervisorReady(supervisor: {
  status: () => ServerStatus;
}): Promise<ServerStatus> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = supervisor.status();
    if (status.state === "ready") return status;
    if (status.state === "crash-loop-stopped")
      throw new Error("Server Core entered crash-loop-stopped");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for Server Core ready");
}

async function readControlStatus(
  layout: ReturnType<typeof resolveServerLayout>,
  timeoutMs: number,
): Promise<ServerStatus | null> {
  try {
    const result = await requestControl(layout.controlEndpoint, { command: "status" }, timeoutMs);
    return serverStatusSchema.parse(result);
  } catch {
    return null;
  }
}

async function delegateLegacyCli(argv: readonly string[], io: CliIO): Promise<number> {
  const candidate =
    process.env.ZCODE_LEGACY_CLI_ENTRY?.trim() ||
    join(dirname(fileURLToPath(import.meta.url)), "zcode.cjs");
  try {
    await access(candidate);
  } catch {
    stdout(io, argv.length ? `Unknown command: ${argv[0]}` : "ZCode TUI");
    return argv.length ? 1 : 0;
  }
  const child = fork(candidate, [...argv], { stdio: "inherit" });
  return await new Promise<number>((resolve) => child.once("exit", (code) => resolve(code ?? 1)));
}

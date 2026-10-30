import { execFile } from "node:child_process";
import type { WSLDistro } from "@zcode/shared";
export type { WSLDistro } from "@zcode/shared";

const WSL_COMMAND = "wsl.exe";
const WSL_EXEC_MAX_BUFFER = 8 * 1024 * 1024;

export const WSL_DISCOVERY_CACHE_TTL_MS = 5_000;

function decodeWslOutput(buffer: Buffer): string {
  if (buffer.length === 0) {
    return "";
  }

  // `wsl.exe -l -v` 在 Windows 上常返回 UTF-16LE。
  // 如果这里直接按 UTF-8 解码，行内会夹满 `\0`，distro 解析会全部失效。
  // 通过检测 NUL 字节优先走 UTF-16LE，可以同时兼容 UTF-8/UTF-16LE 两种输出。
  if (buffer.includes(0)) {
    return buffer.toString("utf16le");
  }

  return buffer.toString("utf8");
}

function normalizeWslOutput(raw: string): string {
  return raw
    .replaceAll("\u0000", "")
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "");
}

/**
 * 生成 wsl.exe 执行失败的错误。
 *
 * Bug 原因：旧逻辑只取 stderr，否则退回 execFile 的 "Command failed: …"。wsl.exe 常把
 * “找不到发行版”等错误写到 UTF-16 stdout，退出码也只在 error.code 上，日志里只剩
 * "Command failed" 或 `{}`，无法判断失败原因。这里在 stderr 为空时带上 stdout，并附退出码。
 */
export function createWslExecError(
  error: Error & { code?: unknown },
  stdout: Buffer,
  stderr: Buffer,
): Error {
  const detail =
    normalizeWslOutput(decodeWslOutput(stderr)).trim() ||
    normalizeWslOutput(decodeWslOutput(stdout)).trim() ||
    error.message;
  const exitCode = typeof error.code === "number" ? error.code : undefined;
  return Object.assign(
    new Error(exitCode === undefined ? detail : `${detail}（退出码 ${exitCode}）`, {
      cause: error,
    }),
    exitCode === undefined ? {} : { exitCode },
  );
}

export function parseWSLDistroList(rawOutput: string): WSLDistro[] {
  const lines = normalizeWslOutput(rawOutput)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  const distros: WSLDistro[] = [];
  for (const line of lines) {
    const parts = line
      .trim()
      .split(/\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 3) {
      continue;
    }

    const versionToken = parts.at(-1) ?? "";
    const parsedVersion = Number.parseInt(versionToken, 10);
    if (!Number.isFinite(parsedVersion)) {
      continue;
    }

    const state = parts.at(-2) ?? "";
    const nameToken = parts.slice(0, -2).join(" ").trim();
    const isDefault = nameToken.startsWith("*");
    const name = nameToken.replace(/^\*\s*/, "").trim();
    if (!name) {
      continue;
    }

    distros.push({
      name,
      isDefault,
      state,
      version: parsedVersion === 1 || parsedVersion === 2 ? parsedVersion : null,
    });
  }

  return distros;
}

async function execWslForBuffer(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      WSL_COMMAND,
      args,
      {
        encoding: "buffer",
        maxBuffer: WSL_EXEC_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const stdoutBuffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? "");
        const stderrBuffer = Buffer.isBuffer(stderr) ? stderr : Buffer.from(stderr ?? "");

        if (error) {
          reject(createWslExecError(error, stdoutBuffer, stderrBuffer));
          return;
        }

        resolve(stdoutBuffer);
      },
    );
  });
}

export type WSLBufferExecutor = (args: string[]) => Promise<Buffer>;

interface WSLDiscoveryCacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

let availabilityCache = new WeakMap<WSLBufferExecutor, WSLDiscoveryCacheEntry<boolean>>();
let distroListCache = new WeakMap<WSLBufferExecutor, WSLDiscoveryCacheEntry<WSLDistro[]>>();

function getCachedDiscovery<T>(
  cache: WeakMap<WSLBufferExecutor, WSLDiscoveryCacheEntry<T>>,
  executor: WSLBufferExecutor,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(executor);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  const entry: WSLDiscoveryCacheEntry<T> = {
    expiresAt: Date.now() + WSL_DISCOVERY_CACHE_TTL_MS,
    promise: Promise.resolve().then(load),
  };
  cache.set(executor, entry);
  void entry.promise.catch(() => {
    // 临时 WSL CLI 错误不能把 rejected Promise 固化到 TTL 结束，
    // 后续显式重试需要立刻重新执行探测。
    if (cache.get(executor) === entry) {
      cache.delete(executor);
    }
  });
  return entry.promise;
}

export function invalidateWSLDiscoveryCache(executor?: WSLBufferExecutor): void {
  if (executor) {
    availabilityCache.delete(executor);
    distroListCache.delete(executor);
    return;
  }
  availabilityCache = new WeakMap();
  distroListCache = new WeakMap();
}

export async function isWSLAvailable(
  executor: WSLBufferExecutor = execWslForBuffer,
): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }

  return getCachedDiscovery(availabilityCache, executor, async () => {
    try {
      await executor(["--status"]);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return !/not recognized|enoent/i.test(message);
    }
  });
}

export async function listWSLDistros(
  executor: WSLBufferExecutor = execWslForBuffer,
): Promise<WSLDistro[]> {
  if (process.platform !== "win32") {
    return [];
  }

  return getCachedDiscovery(distroListCache, executor, async () => {
    const output = await executor(["-l", "-v", "--all"]);
    return parseWSLDistroList(decodeWslOutput(output));
  });
}

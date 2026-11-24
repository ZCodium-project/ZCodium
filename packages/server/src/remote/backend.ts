import type { IDisposable, Event } from "@zcode/rpc";

export interface RemoteEnvironment {
  platform: string; // "linux" | "darwin"
  arch: string; // "x64" | "arm64"
}

export interface StdioStream {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  onClose: Event<number>; // exit code
}

export type RemoteDisconnectReason = "error" | "close" | "end";

export interface RemoteDisconnectEvent {
  reason: RemoteDisconnectReason;
  error?: Error;
}

export interface RemoteUploadProgress {
  uploadedBytes: number;
  totalBytes: number;
}

export interface RemoteUploadOptions {
  onProgress?: (progress: RemoteUploadProgress) => void;
  signal?: AbortSignal;
}

export interface IRemoteBackend extends IDisposable {
  /** WSL 可选的运行时网络解析；其它远端类型保持未注入。 */
  resolveRuntimeProxy?(proxyUrl: string): Promise<string>;
  /** 等待当前 backend 自己创建的底层进程/连接完成回收；不允许扩大到共享运行时。 */
  disposeAndWait?(options?: { graceTimeoutMs?: number; killWaitTimeoutMs?: number }): Promise<void>;
  /** 远端底层连接断开事件；用于补偿 stdio channel 没有及时 close 的半开连接。 */
  onDidDisconnect?: Event<RemoteDisconnectEvent>;
  /** Detect remote environment (no Node.js required) */
  detect(): Promise<RemoteEnvironment>;
  /** Upload a file to the remote machine */
  upload(localPath: string, remotePath: string, options?: RemoteUploadOptions): Promise<void>;
  /** Execute a command on the remote machine, returning stdio streams */
  exec(command: string): Promise<StdioStream>;
  /**
   * exec 的命令非零退出后调用：失败来自 backend 自身的传输（如 Docker daemon 不可用）时，
   * 抛出带公开码的传输错误；传输正常时直接返回，由调用方按命令失败处理。
   */
  diagnoseExecFailure?(): Promise<void>;
  /** Check if a remote file exists */
  exists(remotePath: string): Promise<boolean>;
  /** Read a small remote file (e.g. version string) */
  readFile(remotePath: string): Promise<string>;
}

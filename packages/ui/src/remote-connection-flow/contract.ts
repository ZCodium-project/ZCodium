import type { RemoteTarget } from "@zcode/shared";

export type { RemoteTarget } from "@zcode/shared";
export { redactFeedbackText } from "@zcode/shared";

/** 白名单展示地址，禁止将连接凭据、私钥路径或安装参数存入 Context。 */
export type RemoteConnectionProgressTarget =
  | Pick<Extract<RemoteTarget, { kind: "ssh" }>, "kind" | "host" | "port" | "username">
  | Pick<Extract<RemoteTarget, { kind: "wsl" }>, "kind" | "distro" | "user">
  | Pick<Extract<RemoteTarget, { kind: "docker" }>, "kind" | "container">
  | Pick<Extract<RemoteTarget, { kind: "server" }>, "kind" | "url">;

export interface RemoteConnectionProgressLog {
  id: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
  timestamp: string;
}

/** 只读展示事实和原 owner 的交互动作，不含 service、session 对象或准入队列。 */
export interface RemoteConnectionProgress {
  view: "kind" | "settings" | "connecting" | "directory";
  loading: boolean;
  selectingDirectory: boolean;
  dialogOpen: boolean;
  error: string;
  ready: boolean;
  requestId?: string;
  sourceServerId?: string;
  profileId?: string;
  target?: RemoteConnectionProgressTarget;
  logs: readonly RemoteConnectionProgressLog[];
  onResume: () => void;
  onCancel: () => Promise<void> | void;
}

export interface RemoteConnectionProgressInput {
  currentStep: RemoteConnectionProgress["view"];
  loading: boolean;
  selectingDirectory: boolean;
  open: boolean;
  error: string;
  connectedSessionId: string | null;
  connectingRequestId: string | null;
  pendingRemoteTarget: RemoteTarget | null;
  connectionLogs: readonly RemoteConnectionProgressLog[];
  sourceServerId?: string;
  profileId?: string;
  onResume: () => void;
  onCancel: () => Promise<void> | void;
}

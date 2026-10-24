import type { RemoteConnectionProgressInput } from "./contract.js";

/** 值来自原 SSHDialog，不创建连接或把 Context 当作可写 Host 状态。 */
export const remoteConnectionProgressExample = {
  currentStep: "connecting",
  loading: true,
  selectingDirectory: false,
  open: false,
  error: "",
  connectedSessionId: null,
  connectingRequestId: "original-request",
  pendingRemoteTarget: { kind: "ssh", host: "example.test", username: "user" },
  connectionLogs: [],
  onResume() {},
  onCancel() {},
} satisfies RemoteConnectionProgressInput;

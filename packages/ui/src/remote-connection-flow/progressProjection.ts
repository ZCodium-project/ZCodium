import { redactFeedbackText } from "./contract.js";
import type {
  RemoteConnectionProgress,
  RemoteConnectionProgressInput,
  RemoteConnectionProgressTarget,
  RemoteTarget,
} from "./contract.js";

function redactText(text: string, secrets: readonly string[]): string {
  let sanitized = text;
  for (const secret of secrets) if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  return redactFeedbackText(sanitized);
}

function targetSecrets(target: RemoteTarget | null): string[] {
  if (target?.kind === "ssh") return [target.password ?? "", target.privateKeyPassphrase ?? ""];
  if (target?.kind !== "server") return [];
  const secrets = [target.token ?? ""];
  try {
    const url = new URL(target.url);
    secrets.push(decodeURIComponent(url.password));
    for (const [key, value] of url.searchParams)
      if (/token|secret|password|credential|api.?key/i.test(key)) secrets.push(value);
  } catch {
    /* 无效 URL 不进入展示地址；不暴露原始输入。 */
  }
  return secrets;
}

function displayTarget(
  target: RemoteTarget | null,
  secrets: readonly string[],
): RemoteConnectionProgressTarget | undefined {
  if (!target) return undefined;
  const redact = (text: string) => redactText(text, secrets);
  switch (target.kind) {
    case "ssh":
      return {
        kind: "ssh",
        host: redact(target.host),
        username: redact(target.username),
        ...(target.port !== undefined ? { port: target.port } : {}),
      };
    case "wsl":
      return {
        kind: "wsl",
        ...(target.distro ? { distro: redact(target.distro) } : {}),
        ...(target.user ? { user: redact(target.user) } : {}),
      };
    case "docker":
      return { kind: "docker", container: redact(target.container) };
    case "server": {
      try {
        const url = new URL(target.url);
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return { kind: "server", url: redact(url.toString()) };
      } catch {
        return { kind: "server", url: "" };
      }
    }
  }
}

/** 只投影原 owner 的事实，不创建、清理或推进任何连接。 */
export function buildRemoteConnectionProgress(
  input: RemoteConnectionProgressInput,
): RemoteConnectionProgress | null {
  if (
    !input.loading &&
    !input.connectedSessionId &&
    !input.connectingRequestId &&
    !input.pendingRemoteTarget
  )
    return null;
  const secrets = targetSecrets(input.pendingRemoteTarget);
  const target = displayTarget(input.pendingRemoteTarget, secrets);
  return {
    view: input.currentStep,
    loading: input.loading,
    selectingDirectory: input.selectingDirectory,
    dialogOpen: input.open,
    error: redactText(input.error, secrets),
    ready:
      input.currentStep === "directory" &&
      Boolean(input.connectedSessionId) &&
      !input.loading &&
      !input.selectingDirectory,
    ...(input.connectingRequestId ? { requestId: input.connectingRequestId } : {}),
    ...(input.sourceServerId ? { sourceServerId: input.sourceServerId } : {}),
    ...(input.profileId ? { profileId: input.profileId } : {}),
    ...(target ? { target } : {}),
    logs: input.connectionLogs.map((entry) => ({
      id: entry.id,
      level: entry.level,
      timestamp: entry.timestamp,
      message: redactText(entry.message, secrets),
    })),
    onResume: input.onResume,
    onCancel: input.onCancel,
  };
}

export function formatRemoteConnectionProgressTarget(
  target: RemoteConnectionProgressTarget | undefined,
): string {
  if (!target) return "";
  switch (target.kind) {
    case "ssh":
      return `${target.username}@${target.host}${target.port ? `:${target.port}` : ""}`;
    case "wsl":
      return [target.user, target.distro].filter(Boolean).join(" · ");
    case "docker":
      return target.container;
    case "server":
      return target.url;
  }
}

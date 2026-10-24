import { isValidWslUser, SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE } from "./contract.js";
import type {
  SourceServerUpdateAction,
  SourceServerUpdateResult,
  SourceServerProfileTarget,
  RemoteAssetInstallMode,
  UpdateConnectionProfileInput,
} from "./contract.js";

/** 固定上游的升级 guard：required 不是 force，只有明确同意中断任务才重试。 */
export async function runSourceServerUpdate(
  options: SourceServerUpdateAction,
): Promise<SourceServerUpdateResult> {
  const request = {
    profileId: options.profileId,
    ...(options.expectedTarget ? { expectedTarget: options.expectedTarget } : {}),
  };
  try {
    return await options.management.updateSource({ ...request, force: false });
  } catch (error) {
    if (
      !error ||
      typeof error !== "object" ||
      !("code" in error) ||
      error.code !== SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE
    )
      throw error;
    if (!(await options.confirmForce())) return null;
    return await options.management.updateSource({ ...request, force: true });
  }
}

export interface ProfileEditFields {
  host: string;
  port: string;
  username: string;
  sshAuthMethod: "password" | "privateKey";
  assetInstallMode: RemoteAssetInstallMode;
  password: string;
  privateKeyPath: string;
  privateKeyPassphrase: string;
  wslDistro: string;
  wslUser: string;
  dockerContainer: string;
  manualDockerContainer: string;
  selectedSshConfigAlias: string | null;
  originalAliasCleared?: boolean;
}

export function validateProfileEdit(
  target: SourceServerProfileTarget,
  fields: ProfileEditFields,
): string | null {
  if (target.kind === "ssh") {
    if (!fields.host.trim() || !fields.username.trim()) return "ssh.validation.required";
    const port = Number(fields.port.trim() || "22");
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "settings.source.invalidPort";
    if (fields.sshAuthMethod === "password" && !fields.password && !target.passwordCredentialKey)
      return "ssh.validation.passwordRequired";
    if (fields.sshAuthMethod === "privateKey" && !fields.privateKeyPath.trim())
      return "ssh.validation.privateKeyRequired";
  } else if (target.kind === "wsl") {
    if (fields.wslUser.trim() && !isValidWslUser(fields.wslUser.trim()))
      return "wsl.validation.invalidUser";
  } else if (!(fields.manualDockerContainer || fields.dockerContainer).trim())
    return "docker.validation.required";
  return null;
}

export function buildProfileEditTarget(
  target: SourceServerProfileTarget,
  fields: ProfileEditFields,
): UpdateConnectionProfileInput["target"] {
  if (target.kind === "wsl")
    return {
      kind: "wsl",
      ...(fields.wslDistro.trim() ? { distro: fields.wslDistro.trim() } : {}),
      ...(fields.wslUser.trim() ? { user: fields.wslUser.trim() } : {}),
    };
  if (target.kind === "docker")
    return {
      kind: "docker",
      container: (fields.manualDockerContainer || fields.dockerContainer).trim(),
    };
  // 留空 secret 不写占位符；凭据保留/清理仍由 Host 按 sshAuthMethod 唯一裁决。
  const unchangedEndpoint =
    fields.host.trim() === target.host &&
    Number(fields.port || "22") === (target.port ?? 22) &&
    fields.username.trim() === target.username &&
    fields.privateKeyPath.trim() === (target.privateKeyPath ?? "");
  const alias =
    fields.selectedSshConfigAlias ??
    (!fields.originalAliasCleared && unchangedEndpoint ? target.sshConfigAlias : undefined);
  return {
    kind: "ssh",
    host: fields.host.trim(),
    port: Number(fields.port.trim() || "22"),
    username: fields.username.trim(),
    assetInstallMode: fields.assetInstallMode,
    ...(alias ? { sshConfigAlias: alias } : {}),
    ...(target.resourcePackages ? { resourcePackages: target.resourcePackages } : {}),
    ...(fields.sshAuthMethod === "password" && fields.password
      ? { password: fields.password }
      : {}),
    ...(fields.sshAuthMethod === "privateKey"
      ? {
          privateKeyPath: fields.privateKeyPath.trim(),
          ...(fields.privateKeyPassphrase
            ? { privateKeyPassphrase: fields.privateKeyPassphrase }
            : {}),
        }
      : {}),
  };
}

/** Host 原始错误只放详情和日志，面板使用稳定错误码文案。 */
export function getSourceServerManagementErrorMessage(
  cause: unknown,
  formatMessage: (descriptor: { id: string }) => string,
): string {
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  if (typeof code === "string") {
    const id = `settings.source.error.${code}`;
    const text = formatMessage({ id });
    if (text !== id) return text;
  }
  return formatMessage({ id: "settings.source.operationFailed" });
}

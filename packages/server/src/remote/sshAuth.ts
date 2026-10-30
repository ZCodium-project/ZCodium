import type { ConnectConfig } from "ssh2";
import type { PublicZCodeErrorCode } from "@zcode/shared";

export const SSH_READY_TIMEOUT_MS = 60_000;
export const SSH_KEEPALIVE_INTERVAL_MS = 15_000;
export const SSH_KEEPALIVE_COUNT_MAX = 3;
// ssh2 每个间隔发一次心跳，第 COUNT_MAX + 1 次仍无响应时才报错，所以是 4 个间隔。
const SSH_KEEPALIVE_TIMEOUT_MS = SSH_KEEPALIVE_INTERVAL_MS * (SSH_KEEPALIVE_COUNT_MAX + 1);

interface SSHConnectConfigInput {
  host: string;
  port?: number;
  username: string;
  privateKey?: string | Buffer;
  passphrase?: string;
  password?: string;
  agent?: string;
}

function isMissingPrivateKeyPassphraseMessage(message: string): boolean {
  return /encrypted .*private .*key detected, but no passphrase given/i.test(message);
}

function isInvalidPrivateKeyPassphraseMessage(message: string): boolean {
  return /(bad passphrase|key integrity check failed|unable to authenticate data)/i.test(message);
}

export function buildSSHConnectConfig(input: SSHConnectConfigInput): ConnectConfig {
  const hasPassword = typeof input.password === "string" && input.password.length > 0;

  // 密码登录场景里如果无条件带上 SSH_AUTH_SOCK，ssh2 会先走 agent 公钥尝试。
  // 某些主机 MaxAuthTries 很小，公钥阶段就会把认证次数耗尽，导致正确密码也无法进入认证。
  // 这里改成“显式传入 agent 才启用”；否则密码模式默认禁用隐式 agent。
  const resolvedAgent = input.agent ?? (hasPassword ? undefined : process.env["SSH_AUTH_SOCK"]);

  return {
    host: input.host,
    port: input.port ?? 22,
    username: input.username,
    privateKey: input.privateKey,
    passphrase: input.passphrase,
    password: hasPassword ? input.password : undefined,
    agent: resolvedAgent,
    // ssh2 默认 readyTimeout 是 20s，公网弱网或服务端抖动时容易误判超时。
    // 这里显式放宽连接握手超时，既给真实慢连接机会，也让错误归一化能和实际配置保持一致。
    readyTimeout: SSH_READY_TIMEOUT_MS,
    // SSH 项目空闲后如果被 NAT、防火墙或服务端静默断开，stdio channel 不一定会立刻 close。
    // 启用 SSH-level keepalive，让 ssh2 在连续无响应后主动触发 error/close，避免 UI 任务长期卡在 loading。
    keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
    keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
    // 一些 SSH 服务端只开启 keyboard-interactive（challenge-response）而关闭 plain password。
    // 开启 tryKeyboard + 交互回调后，同一份密码可以覆盖这类主机，避免“命令行可登录、应用里认证失败”。
    tryKeyboard: hasPassword,
  };
}

// 服务器明确要求动态口令或第二因子时的提示文字。提示轮数和个数不能作为证据：
// 错误密码后在同一轮里重复问 Password、其他模块再问一次密码，都只是还在要密码。
const ADDITIONAL_VERIFICATION_PROMPT_PATTERN =
  /verification code|one[- ]?time|\bOTP\b|pass ?code|(?:second|two|2nd)[- ]?factor|\b(?:2FA|MFA)\b|authenticator|动态口令|动态密码/iu;

export function createKeyboardInteractiveResponder(
  password?: string,
  onAdditionalVerificationPrompt?: () => void,
) {
  return (
    name: string,
    instructions: string,
    _lang: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (responses: string[]) => void,
  ) => {
    if (!password || prompts.length === 0) {
      finish([]);
      return;
    }

    // Bug 原因：2FA 主机会在密码之后再要动态口令。这里只回答同一个密码，认证失败后只能提示
    // “检查密码”，用户无法知道是不支持二次验证。旧逻辑把“多于一个提示或一轮”当作证据，
    // 重复问 Password 的主机输错密码也被判成二次验证，UI 失去补密码入口；计数还挂在 backend
    // 生命周期上，自动恢复重连时第一轮提示就被误判。现在只认提示文字，responder 不再保存状态。
    // 仍按原样回答，避免改变“多次询问同一密码”主机的成功路径。
    if (
      [name, instructions, ...prompts.map(({ prompt }) => prompt)].some((text) =>
        ADDITIONAL_VERIFICATION_PROMPT_PATTERN.test(text),
      )
    ) {
      onAdditionalVerificationPrompt?.();
    }
    finish(prompts.map(() => password));
  };
}

export interface NormalizeSSHConnectErrorOptions {
  /** 错误发生时 SSH 连接是否已经 ready。 */
  established?: boolean;
  /** 本次连接尝试中，keyboard-interactive 提示是否明确要求动态口令等额外验证。 */
  additionalVerificationPrompted?: boolean;
}

export function normalizeSSHConnectError(
  error: unknown,
  options: NormalizeSSHConnectErrorOptions = {},
): Error {
  if (
    typeof error === "object" &&
    error !== null &&
    "level" in error &&
    (error as { level?: string }).level === "client-authentication"
  ) {
    if (options.additionalVerificationPrompted) {
      return Object.assign(
        new Error(
          "SSH 认证失败：服务器在密码之后还要求额外验证（例如动态口令），当前不支持，请改用私钥或 SSH agent 登录",
          { cause: error },
        ),
        { code: "remote-authentication-unsupported" satisfies PublicZCodeErrorCode },
      );
    }
    return authenticationError("SSH 认证失败：请检查用户名、密码或私钥配置", error);
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "level" in error &&
    (error as { level?: string }).level === "client-timeout"
  ) {
    if (options.established) {
      // Bug 原因：ssh2 的 Keepalive timeout 与握手超时同为 client-timeout，只有 message 不同。
      // 旧逻辑统一写成“握手超时”，已运行数小时的连接断开也被记成首次握手失败。连接 ready
      // 之后只有 Keepalive 会产生 client-timeout，所以按连接阶段区分，不依赖 ssh2 的英文 message。
      return new Error(
        `SSH 连接无响应：约 ${SSH_KEEPALIVE_TIMEOUT_MS / 1000} 秒没有收到服务器的心跳响应，连接已断开，请检查网络或服务器状态`,
        { cause: error },
      );
    }
    return new Error(
      `SSH 连接握手超时：未能在 ${SSH_READY_TIMEOUT_MS / 1000} 秒内建立 SSH 会话，请检查网络、服务器 SSH 服务或终端 SSH 配置差异`,
    );
  }

  if (error instanceof Error) {
    // ssh2 对不同私钥格式（OpenSSH 旧/新格式、PPK）会返回不同文案。
    // 之前仅匹配单一字符串，导致部分“缺少口令/口令错误”场景泄露底层错误文本，用户难以判断应输入哪种凭据。
    // 这里改为模式化归一化，把同类错误稳定映射成产品语义提示，便于用户直接修正输入。
    if (isMissingPrivateKeyPassphraseMessage(error.message)) {
      return authenticationError("SSH 私钥需要口令：检测到加密私钥，但当前未提供私钥口令", error);
    }
    if (isInvalidPrivateKeyPassphraseMessage(error.message)) {
      return authenticationError("SSH 私钥口令错误：无法解密私钥，请检查私钥口令是否正确", error);
    }
    return error;
  }

  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }

  return new Error("SSH 连接失败");
}

function authenticationError(message: string, cause: unknown): Error {
  // 认证发生在懒连接的 probe 内；在仍有 ssh2 结构化原因的边界定码，避免被归成预检失败。
  return Object.assign(new Error(message, { cause }), {
    code: "remote-authentication-failed" satisfies PublicZCodeErrorCode,
  });
}

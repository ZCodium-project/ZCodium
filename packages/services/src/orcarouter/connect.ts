import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  buildOrcaAuthorizeUrl,
  buildOrcaExchangeBody,
  ORCAROUTER_CODE_CHALLENGE_METHOD,
  ORCAROUTER_EXCHANGE_PATH,
  ORCAROUTER_REQUESTED_SCOPE,
  type OrcaCredential,
  type OrcaOrigins,
} from "@zcode/shared";
import type { OrcaCredentialStore } from "./credentialStore.js";

/** base64url 无 padding 编码 */
function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** 每次尝试都必须用加密随机数新建 verifier 与 state */
export interface OrcaPkceMaterial {
  readonly verifier: string;
  readonly challenge: string;
  readonly state: string;
}

export function createOrcaPkceMaterial(
  generate: (byteLength: number) => Uint8Array = randomBytes,
): OrcaPkceMaterial {
  const verifier = base64Url(generate(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(generate(16));
  return Object.freeze({ verifier, challenge, state });
}

/** 恒定时间比较，避免用早退比较泄露 state 前缀 */
export function safeStateEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type OrcaConnectPhase = "idle" | "waiting" | "exchanging" | "connected" | "error";

/** 对外可见的登录状态；永不携带 verifier 或密钥 */
export interface OrcaConnectState {
  readonly phase: OrcaConnectPhase;
  readonly sessionId: string | null;
  readonly authorizeUrl: string | null;
  /** 用户可复制的提示（例如 OOB 提示），失败时是脱敏原因 */
  readonly hint: string | null;
  readonly error: string | null;
  readonly busy: boolean;
  readonly generation: number;
}

/** 交换失败的错误分类；便于 UI 给出可操作提示且不泄露响应中的凭据 */
export type OrcaConnectErrorKind =
  | "denied"
  | "state-mismatch"
  | "exchange-rejected"
  | "scope-downgraded"
  | "rate-limited"
  | "timeout"
  | "cancelled"
  | "network";

export class OrcaConnectError extends Error {
  readonly kind: OrcaConnectErrorKind;
  constructor(kind: OrcaConnectErrorKind, message: string) {
    super(message);
    this.name = "OrcaConnectError";
    this.kind = kind;
  }
}

export interface OrcaConnectDeps {
  readonly credentialStore: OrcaCredentialStore;
  readonly origins: OrcaOrigins;
  readonly appName: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
  readonly generate?: (byteLength: number) => Uint8Array;
  /** 只接收已脱敏文本；实现方负责落日志，绝不接收 verifier */
  readonly log?: (level: "info" | "warn", message: string) => void;
}

interface ActiveAttempt {
  readonly sessionId: string;
  readonly generation: number;
  readonly material: OrcaPkceMaterial;
  readonly authorizeUrl: string;
  readonly startedAt: number;
}

/**
 * OrcaRouter OAuth 2.0 + PKCE 连接适配器。
 *
 * 采用 **Flow B（out-of-band code）**：授权页把 code 显示给用户，由用户粘贴回来。
 * 选择理由见 integration-map.md —— 同一套连接 seam 同时服务 Electron host 与
 * 浏览器托管的 Web workspace，后者没有可预测的 loopback 地址；
 * OOB 不需要预注册 redirect URI，也不依赖安装地址。S256 为强制。
 *
 * PKCE 换回的是**长期 API key，不是 refresh token**：持久化后重复使用，
 * 直到用户撤销；不主动刷新、不伪造 refresh grant。
 */
export class OrcaConnectController {
  readonly #deps: Required<Pick<OrcaConnectDeps, "credentialStore" | "origins" | "appName">> &
    OrcaConnectDeps;
  #attempt: ActiveAttempt | null = null;
  #phase: OrcaConnectPhase = "idle";
  #error: string | null = null;
  #hint: string | null = null;
  /** 单调递增序号：旧异步响应不得覆盖新登录 */
  #generation = 0;

  constructor(deps: OrcaConnectDeps) {
    this.#deps = {
      fetchImpl: globalThis.fetch,
      timeoutMs: 30_000,
      now: Date.now,
      generate: randomBytes,
      ...deps,
    };
  }

  getState(): OrcaConnectState {
    return Object.freeze({
      phase: this.#phase,
      sessionId: this.#attempt?.sessionId ?? null,
      authorizeUrl: this.#attempt?.authorizeUrl ?? null,
      hint: this.#hint,
      error: this.#error,
      busy: this.#phase === "waiting" || this.#phase === "exchanging",
      generation: this.#generation,
    });
  }

  /**
   * 开始一次登录：新建 verifier/state，返回用户需要打开的授权 URL。
   *
   * verifier 只存在于本进程内存，直到 exchange 才使用；绝不进 URL、日志或遥测。
   */
  begin(): OrcaConnectState {
    const generate = this.#deps.generate ?? randomBytes;
    const now = this.#deps.now ?? Date.now;
    const generation = ++this.#generation;
    const material = createOrcaPkceMaterial(generate);
    const authorizeUrl = buildOrcaAuthorizeUrl({
      authBase: this.#deps.origins.authBase,
      callbackUrl: "oob",
      codeChallenge: material.challenge,
      state: material.state,
      appName: this.#deps.appName,
      scope: ORCAROUTER_REQUESTED_SCOPE,
    });
    const sessionId = base64Url(generate(8));
    this.#attempt = {
      sessionId,
      generation,
      material,
      authorizeUrl,
      startedAt: now(),
    };
    this.#phase = "waiting";
    this.#error = null;
    this.#hint = authorizeUrl;
    // 只记录状态，不记录 URL 中的 challenge/state 之外的内容；这里连 URL 都不落盘。
    this.#deps.log?.("info", `OrcaRouter 授权已开始（session ${sessionId}）`);
    return this.getState();
  }

  /**
   * 用户粘贴 code 后完成交换并持久化。
   *
   * 交换固定打到 auth origin 的 `/api/v1/auth/keys`；推理与目录使用另一个 origin。
   */
  async submitCode(code: string): Promise<OrcaCredential> {
    const attempt = this.#attempt;
    if (!attempt) {
      throw new OrcaConnectError("cancelled", "OrcaRouter 授权已取消或尚未开始");
    }
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      throw new OrcaConnectError("exchange-rejected", "授权码不能为空");
    }

    this.#phase = "exchanging";
    this.#hint = null;
    this.#error = null;

    const fetchImpl = this.#deps.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#deps.timeoutMs ?? 30_000);

    let response: Response;
    try {
      response = await fetchImpl(`${this.#deps.origins.authBase}${ORCAROUTER_EXCHANGE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOrcaExchangeBody(normalizedCode, attempt.material.verifier)),
        signal: controller.signal,
      });
    } catch (error) {
      if (this.#attempt?.generation !== attempt.generation) {
        // 旧尝试的失败不得污染新登录的状态。
        throw new OrcaConnectError("cancelled", "OrcaRouter 授权已被新的尝试取代");
      }
      this.#phase = "error";
      const aborted = error instanceof Error && error.name === "AbortError";
      const kind: OrcaConnectErrorKind = aborted ? "timeout" : "network";
      const message = aborted ? "OrcaRouter 授权超时，请重试" : "无法连接 OrcaRouter 授权服务";
      this.#error = message;
      this.#deps.log?.("warn", `OrcaRouter 交换失败：${kind}`);
      throw new OrcaConnectError(kind, message);
    } finally {
      clearTimeout(timeout);
    }

    if (this.#attempt?.generation !== attempt.generation) {
      throw new OrcaConnectError("cancelled", "OrcaRouter 授权已被新的尝试取代");
    }

    if (!response.ok) {
      const kind: OrcaConnectErrorKind =
        response.status === 403
          ? "exchange-rejected"
          : response.status === 429
            ? "rate-limited"
            : response.status === 400
              ? "exchange-rejected"
              : "network";
      const message =
        response.status === 403
          ? "授权码无效、已过期或已被使用，请重新发起授权"
          : response.status === 429
            ? "OrcaRouter 授权请求过于频繁（每 24 小时最多 10 次），请稍后再试"
            : response.status === 400
              ? "OrcaRouter 拒绝了本次授权请求，请重新发起"
              : "OrcaRouter 授权服务暂时不可用";
      this.#phase = "error";
      this.#error = message;
      this.#deps.log?.("warn", `OrcaRouter 交换返回 ${response.status}（${kind}）`);
      throw new OrcaConnectError(kind, message);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (this.#attempt?.generation !== attempt.generation) {
        throw new OrcaConnectError("cancelled", "OrcaRouter 授权已被新的尝试取代");
      }
      this.#phase = "error";
      this.#error = "OrcaRouter 返回的授权结果无法解析";
      throw new OrcaConnectError("network", "OrcaRouter 返回的授权结果无法解析");
    }

    // 解析与持久化之间再校验一次：并发的 begin()/cancel() 会让更早的交换覆盖更新的登录。
    if (this.#attempt?.generation !== attempt.generation) {
      throw new OrcaConnectError("cancelled", "OrcaRouter 授权已被新的尝试取代");
    }

    // 读取实际授予的 scope；不足时按失败处理，绝不把请求 scope 当已授权 scope。
    let parsed: { key: string; scope: string; userId: string };
    try {
      const record = (payload ?? {}) as Record<string, unknown>;
      const key = typeof record.key === "string" ? record.key.trim() : "";
      const scope = typeof record.scope === "string" ? record.scope.trim() : "";
      if (!key) throw new OrcaConnectError("exchange-rejected", "OrcaRouter 未返回 API key");
      if (scope !== ORCAROUTER_REQUESTED_SCOPE) {
        this.#phase = "error";
        this.#error = `OrcaRouter 只授予了 "${scope || "(empty)"}" 范围，无法用于本用途`;
        throw new OrcaConnectError("scope-downgraded", this.#error);
      }
      parsed = { key, scope, userId: typeof record.user_id === "string" ? record.user_id : "" };
    } catch (error) {
      if (error instanceof OrcaConnectError) throw error;
      this.#phase = "error";
      this.#error = "OrcaRouter 返回的授权结果无法解析";
      throw new OrcaConnectError("network", "OrcaRouter 返回的授权结果无法解析");
    }

    // store.save() 之前最后一道世代校验：旧交换不得覆盖新登录。
    if (this.#attempt?.generation !== attempt.generation) {
      throw new OrcaConnectError("cancelled", "OrcaRouter 授权已被新的尝试取代");
    }

    const credential = await this.#deps.credentialStore.save({
      apiKey: parsed.key,
      source: "pkce",
      grantedScope: parsed.scope,
      accountId: parsed.userId || undefined,
    });

    this.#phase = "connected";
    this.#hint = null;
    this.#error = null;
    this.#attempt = null;
    this.#deps.log?.("info", "OrcaRouter 授权完成，密钥已保存到本地凭据存储");
    return credential;
  }

  /** 显式取消：立即失效当前尝试并清空等待态，使第二次登录可以开始 */
  cancel(reason = "用户取消"): OrcaConnectState {
    this.#generation += 1;
    this.#attempt = null;
    this.#phase = "idle";
    this.#hint = null;
    this.#error = null;
    this.#deps.log?.("info", `OrcaRouter 授权已取消：${reason}`);
    return this.getState();
  }

  /** 失败后由 UI 主动复位 */
  reset(): OrcaConnectState {
    this.#attempt = null;
    this.#phase = "idle";
    this.#hint = null;
    this.#error = null;
    return this.getState();
  }

  /**
   * `pagehide` / 卸载同步清理。
   *
   * 同步清 busy 与 hint，并递增 generation；不能只依赖被 generation guard 拦下的
   * `finally` 分支，否则从 back-forward cache 恢复的页面会永久停留在 busy。
   */
  invalidateForPageHide(): OrcaConnectState {
    this.#generation += 1;
    this.#attempt = null;
    this.#phase = "idle";
    this.#hint = null;
    this.#error = null;
    return this.getState();
  }

  /** 当前尝试的 generation，供 RPC 层做陈旧响应防护 */
  currentGeneration(): number {
    return this.#generation;
  }

  /** 校验 state 是否仍然匹配当前尝试（Flow A 回调路径复用） */
  matchesState(state: string): boolean {
    const attempt = this.#attempt;
    if (!attempt) return false;
    return safeStateEquals(state, attempt.material.state);
  }
}

export { ORCAROUTER_CODE_CHALLENGE_METHOD };
export type { OrcaOrigins };

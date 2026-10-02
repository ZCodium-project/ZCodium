import { maskOrcaSecret, type OrcaCredential, type OrcaCredentialSource } from "@zcode/shared";
import type { ICredentialService } from "../credential/credential.js";

/**
 * OrcaRouter 凭据在 Credential Store 中的物理 key。
 *
 * 只使用项目既有的加密凭据存储（Desktop host 与 CLI 共用 `~/.zcode/v2/credentials.json`），
 * 不新建密钥库，也不把密钥写进日志、错误、遥测或提交。
 */
export const ORCAROUTER_CREDENTIAL_KEY = "provider:orcarouter:api-key";

interface PersistedOrcaCredential {
  readonly apiKey: string;
  readonly source: OrcaCredentialSource;
  readonly grantedScope?: string;
  readonly accountId?: string;
  readonly generation: number;
  readonly needsReauth?: boolean;
  readonly needsReauthGeneration?: number;
}

export interface OrcaCredentialStatus {
  readonly connected: boolean;
  /** 脱敏展示值；未连接时为空串 */
  readonly masked: string;
  readonly source: OrcaCredentialSource | null;
  readonly accountId?: string;
  readonly generation: number;
  /** 该账号凭据已被上游拒绝，必须重新认证，禁止伪造 refresh */
  readonly needsReauth: boolean;
}

export interface OrcaCredentialStore {
  /** 读取可用凭据；`needsReauth` 的凭据不再返回，避免继续使用死凭据 */
  loadUsable(): Promise<OrcaCredential | null>;
  /** 读取原始记录（含 needsReauth），仅供状态展示与测试 */
  read(): Promise<PersistedOrcaCredential | null>;
  /** 保存凭据；generation 单调递增，旧异步结果不得覆盖更新的凭据 */
  save(input: {
    readonly apiKey: string;
    readonly source: OrcaCredentialSource;
    readonly grantedScope?: string;
    readonly accountId?: string;
  }): Promise<OrcaCredential>;
  /** 清除凭据（显式断开连接） */
  clear(): Promise<void>;
  status(): Promise<OrcaCredentialStatus>;
  /**
   * 把**精确**的账号 + generation 标记为需要重新认证。
   *
   * 只匹配当前存储的 generation 与 accountId：迟到的旧请求失败不得污染刚完成的新登录。
   * 返回是否命中。
   */
  markNeedsReauth(input: {
    readonly generation?: number;
    readonly accountId?: string;
  }): Promise<boolean>;
}

export function createOrcaCredentialStore(options: {
  readonly credentialService: Pick<ICredentialService, "load" | "save" | "delete">;
}): OrcaCredentialStore {
  const parse = (raw: string | null): PersistedOrcaCredential | null => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<PersistedOrcaCredential>;
      const apiKey = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
      if (!apiKey) return null;
      return {
        apiKey,
        source: parsed.source === "pkce" ? "pkce" : "api-key",
        grantedScope: typeof parsed.grantedScope === "string" ? parsed.grantedScope : undefined,
        accountId: typeof parsed.accountId === "string" ? parsed.accountId : undefined,
        generation: Number.isInteger(parsed.generation) ? Number(parsed.generation) : 0,
        needsReauth: parsed.needsReauth === true,
        needsReauthGeneration:
          typeof parsed.needsReauthGeneration === "number"
            ? parsed.needsReauthGeneration
            : undefined,
      };
    } catch {
      // 损坏记录按未连接处理，但保留原值直到显式覆盖，避免把瞬时读取失败变成不可逆的账号丢失。
      return null;
    }
  };

  const write = async (record: PersistedOrcaCredential): Promise<void> => {
    await options.credentialService.save(ORCAROUTER_CREDENTIAL_KEY, JSON.stringify(record));
  };

  return {
    async read() {
      return parse(await options.credentialService.load(ORCAROUTER_CREDENTIAL_KEY));
    },

    async loadUsable() {
      const record = await this.read();
      if (!record || record.needsReauth) return null;
      return Object.freeze({
        apiKey: record.apiKey,
        source: record.source,
        grantedScope: record.grantedScope,
        accountId: record.accountId,
        generation: record.generation,
      });
    },

    async save(input) {
      const current = await this.read();
      const generation = (current?.generation ?? 0) + 1;
      const record: PersistedOrcaCredential = {
        apiKey: input.apiKey.trim(),
        source: input.source,
        grantedScope: input.grantedScope,
        accountId: input.accountId,
        generation,
        // 新登录成功后清除旧的 reauth 标记；旧失败由 generation 隔离。
        needsReauth: false,
      };
      await write(record);
      return Object.freeze({
        apiKey: record.apiKey,
        source: record.source,
        grantedScope: record.grantedScope,
        accountId: record.accountId,
        generation,
      });
    },

    async clear() {
      await options.credentialService.delete(ORCAROUTER_CREDENTIAL_KEY);
    },

    async status() {
      const record = await this.read();
      if (!record) {
        return Object.freeze({
          connected: false,
          masked: "",
          source: null,
          generation: 0,
          needsReauth: false,
        });
      }
      return Object.freeze({
        connected: !record.needsReauth,
        masked: maskOrcaSecret(record.apiKey),
        source: record.source,
        accountId: record.accountId,
        generation: record.generation,
        needsReauth: record.needsReauth === true,
      });
    },

    async markNeedsReauth(input) {
      const current = await this.read();
      if (!current) return false;
      // 精确匹配：账号与 generation 都必须是发出被拒请求的那一份。
      if (input.generation !== undefined && current.generation !== input.generation) {
        return false;
      }
      if (input.accountId !== undefined && current.accountId !== input.accountId) {
        return false;
      }
      if (current.needsReauth && current.needsReauthGeneration === current.generation) {
        return true;
      }
      await write({
        ...current,
        needsReauth: true,
        needsReauthGeneration: current.generation,
      });
      return true;
    },
  };
}

export type { PersistedOrcaCredential };

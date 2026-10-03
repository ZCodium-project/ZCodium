import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { atomicWritePrivateTextFile, backupCorruptFile, withFileLock } from "@zcode/shared/node";
import { createZCodeCredentialCipher, type ZCodeCredentialCipher } from "./credential-cipher.js";

const ZCODE_DATA_BASE_DIR_ENV_KEY = "ZCODE_DATA_BASE_DIR";
const ZAI_PROVIDER_ID = "zai";
const credentialChangeListeners = new Map<
  string,
  Set<() => void | Promise<void>>
>();

export const SHARED_ZCODE_CREDENTIAL_KEYS = {
  activeProvider: "oauth:active_provider",
  bigmodelAccessToken: "oauth:bigmodel:access_token",
  bigmodelRefreshToken: "oauth:bigmodel:refresh_token",
  bigmodelUserInfo: "oauth:bigmodel:user_info",
  zaiAccessToken: "oauth:zai:access_token",
  zaiRefreshToken: "oauth:zai:refresh_token",
  zaiUserInfo: "oauth:zai:user_info",
  zcodeJwtToken: "zcodejwttoken",
} as const;

export interface SharedZCodeCredentialStoreOptions {
  baseDir?: string;
  cipher?: ZCodeCredentialCipher;
  env?: Record<string, string | undefined>;
  filePath?: string;
}

export interface ZaiLoginCredentialUser {
  avatar?: string;
  email?: string;
  name?: string;
  user_id: string;
}

export interface ZaiLoginCredentialPayload {
  accessToken: string;
  jwtToken: string;
  user: ZaiLoginCredentialUser;
}

export interface SharedZCodeCredentialStore {
  readonly filePath: string;
  clearZaiLoginCredentials(): Promise<void>;
  delete(key: string): Promise<void>;
  deleteIfValue(key: string, expectedValue: string): Promise<boolean>;
  deleteIfValues(
    expectedValues: Readonly<Record<string, string>>,
  ): Promise<Record<string, boolean>>;
  deleteManyIfValue(
    guardKey: string,
    expectedGuardValue: string,
    keysToDelete: readonly string[],
  ): Promise<boolean>;
  load(key: string): Promise<string | null>;
  loadMany(keys: readonly string[]): Promise<Record<string, string | null>>;
  onDidChange?(listener: () => void | Promise<void>): () => void;
  save(key: string, value: string): Promise<void>;
  saveMany(entries: Readonly<Record<string, string>>): Promise<void>;
  saveReplacing(key: string, value: string, replacedKeys: readonly string[]): Promise<void>;
  saveZaiLoginCredentials(payload: ZaiLoginCredentialPayload): Promise<void>;
}

export function createSharedZCodeCredentialStore(
  options: SharedZCodeCredentialStoreOptions = {},
): SharedZCodeCredentialStore {
  const env = options.env ?? process.env;
  const filePath = resolveSharedZCodeCredentialsPath(options);
  const cipher = options.cipher ?? createZCodeCredentialCipher({ env });

  return {
    filePath,

    async clearZaiLoginCredentials(): Promise<void> {
      await mutateRawCredentialRecord(filePath, async (rawCredentials) => {
        const activeProviderRaw = rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.activeProvider];
        const activeProvider = activeProviderRaw ? cipher.decrypt(activeProviderRaw) : null;
        delete rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken];
        delete rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zaiRefreshToken];
        delete rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zaiUserInfo];
        delete rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zcodeJwtToken];
        if (activeProvider === ZAI_PROVIDER_ID) {
          delete rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.activeProvider];
        }
      });
    },

    async delete(key: string): Promise<void> {
      const validatedKey = validateCredentialKey(key);
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        delete rawCredentials[validatedKey];
      });
    },

    async deleteIfValue(key: string, expectedValue: string): Promise<boolean> {
      const validatedKey = validateCredentialKey(key);
      const validatedExpectedValue = validateCredentialValue(expectedValue);
      let deleted = false;
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        const encryptedValue = rawCredentials[validatedKey];
        if (
          encryptedValue === undefined ||
          cipher.decrypt(encryptedValue) !== validatedExpectedValue
        ) {
          return;
        }
        delete rawCredentials[validatedKey];
        deleted = true;
      });
      return deleted;
    },

    async deleteIfValues(
      expectedValues: Readonly<Record<string, string>>,
    ): Promise<Record<string, boolean>> {
      const validatedEntries = Object.entries(expectedValues).map(
        ([key, value]) => [validateCredentialKey(key), validateCredentialValue(value)] as const,
      );
      if (validatedEntries.length === 0) return {};
      const deleted: Record<string, boolean> = {};
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        for (const [key, expectedValue] of validatedEntries) {
          const encryptedValue = rawCredentials[key];
          const matches =
            encryptedValue !== undefined && cipher.decrypt(encryptedValue) === expectedValue;
          deleted[key] = matches;
          if (matches) delete rawCredentials[key];
        }
      });
      return deleted;
    },

    /**
     * 条件事务：`guardKey` 当前值与期望值相等才删除 `keysToDelete` 全部 key，否则一个都不删。
     *
     * `deleteIfValues` 是逐 key 比较、逐 key 删除，无法表达「canonical generation 匹配
     * 才整体失效」——canonical 比较失败时 legacy 镜像仍可能被删掉，反之亦然。OAuth 凭据失效必须
     * 是整对的：stale 事务不能删掉 winner 的 canonical，也不能只删掉它的一半镜像。
     */
    async deleteManyIfValue(
      guardKey: string,
      expectedGuardValue: string,
      keysToDelete: readonly string[],
    ): Promise<boolean> {
      const validatedGuardKey = validateCredentialKey(guardKey);
      const validatedExpectedValue = validateCredentialValue(expectedGuardValue);
      const validatedKeys = keysToDelete.map(validateCredentialKey);
      let deleted = false;
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        const encryptedGuard = rawCredentials[validatedGuardKey];
        if (
          encryptedGuard === undefined ||
          cipher.decrypt(encryptedGuard) !== validatedExpectedValue
        ) {
          return;
        }
        for (const key of validatedKeys) delete rawCredentials[key];
        deleted = true;
      });
      return deleted;
    },

    async load(key: string): Promise<string | null> {
      const rawCredentials = await readRawCredentialRecord(filePath);
      const rawValue = rawCredentials[validateCredentialKey(key)];
      if (rawValue === undefined) {
        return null;
      }
      return cipher.decrypt(rawValue);
    },

    async loadMany(keys: readonly string[]): Promise<Record<string, string | null>> {
      const validatedKeys = keys.map(validateCredentialKey);
      const rawCredentials = await readRawCredentialRecord(filePath);
      return Object.fromEntries(
        validatedKeys.map((key) => {
          const rawValue = rawCredentials[key];
          return [key, rawValue === undefined ? null : cipher.decrypt(rawValue)];
        }),
      );
    },

    onDidChange(listener: () => void | Promise<void>): () => void {
      let listeners = credentialChangeListeners.get(filePath);
      if (!listeners) {
        listeners = new Set();
        credentialChangeListeners.set(filePath, listeners);
      }
      listeners.add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) credentialChangeListeners.delete(filePath);
      };
    },

    async save(key: string, value: string): Promise<void> {
      const validatedKey = validateCredentialKey(key);
      const encryptedValue = cipher.encrypt(validateCredentialValue(value));
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        rawCredentials[validatedKey] = encryptedValue;
      });
    },

    async saveMany(entries: Readonly<Record<string, string>>): Promise<void> {
      const encryptedEntries = Object.entries(entries).map(
        ([key, value]) =>
          [validateCredentialKey(key), cipher.encrypt(validateCredentialValue(value))] as const,
      );
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        for (const [key, encryptedValue] of encryptedEntries) {
          rawCredentials[key] = encryptedValue;
        }
      });
    },

    async saveReplacing(
      key: string,
      value: string,
      replacedKeys: readonly string[],
    ): Promise<void> {
      const validatedKey = validateCredentialKey(key);
      const encryptedValue = cipher.encrypt(validateCredentialValue(value));
      const validatedReplacedKeys = replacedKeys.map(validateCredentialKey);
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        rawCredentials[validatedKey] = encryptedValue;
        for (const replacedKey of validatedReplacedKeys) {
          if (replacedKey !== validatedKey) delete rawCredentials[replacedKey];
        }
      });
    },

    async saveZaiLoginCredentials(payload: ZaiLoginCredentialPayload): Promise<void> {
      const encryptedCredentials = {
        activeProvider: cipher.encrypt(ZAI_PROVIDER_ID),
        accessToken: cipher.encrypt(validateCredentialValue(payload.accessToken)),
        jwtToken: cipher.encrypt(validateCredentialValue(payload.jwtToken)),
        userInfo: cipher.encrypt(JSON.stringify(payload.user)),
      };
      await mutateRawCredentialRecord(filePath, (rawCredentials) => {
        rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.activeProvider] =
          encryptedCredentials.activeProvider;
        rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zaiAccessToken] =
          encryptedCredentials.accessToken;
        rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zcodeJwtToken] = encryptedCredentials.jwtToken;
        rawCredentials[SHARED_ZCODE_CREDENTIAL_KEYS.zaiUserInfo] = encryptedCredentials.userInfo;
      });
    },
  };
}

export function loadSharedZCodeCredentialSync(
  key: string,
  options: SharedZCodeCredentialStoreOptions = {},
): string | undefined {
  const filePath = resolveSharedZCodeCredentialsPath(options);
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    const record = parseCredentialRecord(parsed);
    const rawValue = record[validateCredentialKey(key)];
    if (rawValue === undefined) {
      return undefined;
    }
    const cipher = options.cipher ?? createZCodeCredentialCipher({ env: options.env });
    const decrypted = cipher.decrypt(rawValue);
    return decrypted.trim().length > 0 ? decrypted : undefined;
  } catch {
    return undefined;
  }
}

export function resolveSharedZCodeCredentialsPath(
  options: SharedZCodeCredentialStoreOptions = {},
): string {
  if (options.filePath) {
    return resolveUserPath(options.filePath);
  }

  const env = options.env ?? process.env;
  const baseDir = options.baseDir ?? env[ZCODE_DATA_BASE_DIR_ENV_KEY] ?? homedir();
  return join(resolveUserPath(baseDir), ".zcodium", "v2", "credentials.json");
}

async function readRawCredentialRecord(filePath: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {};
    }
    throw new Error(`Unable to read shared ZCode credentials: ${filePath}`, { cause: error });
  }

  try {
    return parseCredentialRecord(JSON.parse(raw));
  } catch (error) {
    // 损坏的凭据文件若被当成空对象继续保存，会一次性抹掉其他进程的全部凭据。
    // 先保留现场再失败，调用方必须显式处理恢复，不能静默覆盖。
    const backupPath = await backupCorruptFile(filePath).catch(() => undefined);
    const evidence = backupPath ? ` Backup: ${backupPath}` : "";
    throw new Error(`Shared ZCode credentials are corrupt: ${filePath}.${evidence}`, {
      cause: error,
    });
  }
}

async function mutateRawCredentialRecord(
  filePath: string,
  mutation: (value: Record<string, string>) => void | Promise<void>,
): Promise<void> {
  // CLI、设置页和 session 可能位于不同 Node 进程；锁必须覆盖完整的
  // read-modify-write，单独原子 rename 只能防半写，不能防旧快照覆盖新 key。
  await withFileLock(filePath, async () => {
    const value = await readRawCredentialRecord(filePath);
    await mutation(value);
    await atomicWritePrivateTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  });
  const listeners = [...(credentialChangeListeners.get(filePath) ?? [])];
  // 同进程的 Registry Source 需要在登录返回前观察到新凭据；单个监听者失败不应
  // 把已经原子落盘的 Credential 伪装成写入失败。
  await Promise.allSettled(listeners.map((listener) => listener()));
}

function parseCredentialRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error("Credential record must be an object");
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`Credential record value must be a string: ${key}`);
    }
    result[key] = entry;
  }
  return result;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function validateCredentialKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    throw new Error("Credential key must not be empty");
  }
  return trimmed;
}

function validateCredentialValue(value: string): string {
  if (value.length === 0) {
    throw new Error("Credential value must not be empty");
  }
  return value;
}

function resolveUserPath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return join(homedir(), value.slice(2));
  }
  return resolve(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

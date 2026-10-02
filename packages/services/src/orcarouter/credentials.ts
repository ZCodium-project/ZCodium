import { looksLikeOrcaApiKey, type OrcaCredentialSource } from "@zcode/shared";
import type { OrcaCredentialStore } from "./credentialStore.js";

/**
 * 「获得/读取凭据」的唯一 seam。
 *
 * 两种入口（手填 API Key 与 PKCE 登录）只是这条 seam 上的两个 adapter；
 * provider 请求、模型目录以及各 AI 入口都只依赖这里产出的**同一种**凭据，
 * 不在自己的代码里复制认证逻辑。
 */
export interface OrcaCredentialAdapter {
  readonly source: OrcaCredentialSource;
  /** 取得一个可用的 OrcaRouter API key；失败时抛出具可操作提示的错误 */
  acquire(): Promise<string>;
}

/** 下游读取口：不关心凭据是手填还是 PKCE 换来的 */
export interface OrcaCredentialProvider {
  /** 当前可用密钥；未连接或需要重新认证时为 null */
  getApiKey(): Promise<string | null>;
  status(): ReturnType<OrcaCredentialStore["status"]>;
  clear(): Promise<void>;
}

export function createOrcaCredentialProvider(store: OrcaCredentialStore): OrcaCredentialProvider {
  return {
    async getApiKey() {
      return (await store.loadUsable())?.apiKey ?? null;
    },
    status: () => store.status(),
    clear: () => store.clear(),
  };
}

/**
 * Adapter 1：用户手填的 `sk-orca-…`。
 *
 * 只做轻量格式检查以拦截明显输入错误；前缀不是有效性证明，
 * 真实有效性由第一次实际请求决定，不会为了在设置页显示 "valid" 而发付费请求。
 */
export function createApiKeyAdapter(store: OrcaCredentialStore): OrcaCredentialAdapter {
  return {
    source: "api-key",
    async acquire() {
      const current = await store.loadUsable();
      if (!current) {
        throw new Error("尚未配置 OrcaRouter API Key");
      }
      return current.apiKey;
    },
  };
}

/**
 * Adapter 2：OAuth 2.0 + PKCE 登录。
 *
 * 密钥在提交授权码时已经持久化；这里只负责把它取回来，
 * 保证调用方与手填路径拿到完全相同的凭据形状。
 */
export function createPkceAdapter(store: OrcaCredentialStore): OrcaCredentialAdapter {
  return {
    source: "pkce",
    async acquire() {
      const current = await store.loadUsable();
      if (!current || current.source !== "pkce") {
        throw new Error("尚未完成 OrcaRouter 授权登录");
      }
      return current.apiKey;
    },
  };
}

/** Adapter 上的共同入口：无论凭据来自哪个 adapter，都返回同一种结果 */
export interface OrcaCredentialAdapters {
  readonly apiKey: OrcaCredentialAdapter;
  readonly pkce: OrcaCredentialAdapter;
}

export function createOrcaCredentialAdapters(input: {
  readonly store: OrcaCredentialStore;
}): OrcaCredentialAdapters {
  return Object.freeze({
    apiKey: createApiKeyAdapter(input.store),
    pkce: createPkceAdapter(input.store),
  });
}

/** 手填入参校验；返回 null 表示空值（用于清除），抛错表示格式明显有误 */
export function validateOrcaApiKeyInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!looksLikeOrcaApiKey(trimmed)) {
    throw new Error("OrcaRouter API Key 应以 sk-orca- 开头，请检查后重试");
  }
  return trimmed;
}

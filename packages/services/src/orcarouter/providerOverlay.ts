import { ORCAROUTER_PROVIDER_TEMPLATE_ID } from "@zcode/shared";
import type { ProviderConfigObject } from "@zcode/provider";
import type {
  IProviderSettingsService,
  ProviderSettingsView,
} from "../model-provider/providerFacadeServices.js";
import type { OrcaCredentialStore } from "./credentialStore.js";

/**
 * OrcaRouter 凭据 → provider 推理配置的唯一投递口。
 *
 * 推理路径（CLI 的 model-execution、RPC 的 header 解析）只读 provider 自身的
 * `access.apiKey`；OrcaRouter 的密钥则存在加密 Credential Store 的
 * `provider:orcarouter:api-key` 下。若不在保存/清除时把同一把 key 写回该 provider 的
 * Personal Overlay，就会出现「设置页显示已连接、但聊天请求不带 key」的断链。
 *
 * 本模块是这条断链的唯一修复点：它只依赖既有的 `savePersonalProviderOverlay` 写入边界，
 * 不把密钥写进日志、错误、遥测或任何非加密文件，也不新增第二套密钥库。
 */

/** 只取读视图与 Overlay 写入两个成员，避免把整个 ProviderSettings 服务拉进依赖。 */
export type OrcaSettingsTarget = Pick<
  IProviderSettingsService,
  "getView" | "savePersonalProviderOverlay"
>;

/** 只有模板实例才需要回写：Built-in 固定 Provider 的 access 由 Built-in Config 声明。 */
export function findOrcaRouterTemplateInstance(view: ProviderSettingsView): {
  readonly providerId: string;
  readonly personalConfig: ProviderConfigObject | undefined;
} | null {
  const match = view.providers.find(
    (provider) => provider.templateId === ORCAROUTER_PROVIDER_TEMPLATE_ID,
  );
  return match ? { providerId: match.providerId, personalConfig: match.personalConfig } : null;
}

export interface OrcaProviderCredentialBinding {
  /**
   * 把 store 当前凭据对齐到 provider 推理配置。
   *
   * 已连接 → 写入同一把 key；未连接或被标记 `needsReauth`（`loadUsable` 返回 null）
   * → 清除 provider 上的 key，让推理路径 fail closed 而不是继续使用死凭据。
   */
  sync(): Promise<void>;
}

export interface CreateOrcaProviderCredentialBindingInput {
  readonly store: OrcaCredentialStore;
  readonly settings: OrcaSettingsTarget;
  /** 回写失败只记录，不能反转调用方已经确认的凭据事实。 */
  readonly onError?: (error: unknown) => void;
}

export function createOrcaProviderCredentialBinding(
  input: CreateOrcaProviderCredentialBindingInput,
): OrcaProviderCredentialBinding {
  return {
    async sync() {
      let apiKey: string | null;
      try {
        apiKey = (await input.store.loadUsable())?.apiKey ?? null;
      } catch (error) {
        input.onError?.(error);
        return;
      }
      try {
        const view = await input.settings.getView();
        const instance = findOrcaRouterTemplateInstance(view);
        if (!instance) return;
        const base: ProviderConfigObject = instance.personalConfig ?? {
          access: { type: "api-key" },
        };
        // 幂等：已经与 store 一致时不再写盘，避免启动/每次刷新都产生一次配置文件写入。
        const current = readApiKey(base);
        if (current === apiKey) return;
        // 只改 access.apiKey 叶子：其余 Personal 叶子（baseUrl / modelOrder 等）保持原值。
        // apiKey 为 null 表示断开；显式传值让 overlay 覆盖掉旧 key。
        await input.settings.savePersonalProviderOverlay(instance.providerId, {
          ...base,
          access: { type: "api-key", apiKey },
        });
      } catch (error) {
        input.onError?.(error);
      }
    },
  };
}

function readApiKey(config: ProviderConfigObject): string | null {
  const access = config.access as { readonly type?: string; readonly apiKey?: unknown } | undefined;
  if (!access || access.type !== "api-key") return null;
  return typeof access.apiKey === "string" && access.apiKey.trim() ? access.apiKey.trim() : null;
}

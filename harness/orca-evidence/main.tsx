/**
 * OrcaRouter GUI 证据页入口。
 *
 * 只挂载仓库里真实的 OrcaRouter 组件（不重实现），通过 ZCodeIntlProvider +
 * ServiceProvider 注入一个纯内存假服务。假服务不触网、不含任何真实凭据；
 * 模型目录数据与 manifest 计数同源（catalog.js）。
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";
import { ServiceProvider } from "@/hooks/useServices.js";
import { OrcaRouterProviderFields } from "@/settings/model-provider-section/OrcaRouterProviderFields.js";
import { OrcaRouterModelSelector } from "@/settings/model-provider-section/OrcaRouterModelSelector.js";
import { ProviderModelsSection } from "@/settings/model-provider-section/ProviderCardSections.js";
import "@zcode/ui/styles.css";
import { CATALOG_SOURCE_URL, listOrcaModels, ORCA_MODEL_CATALOG } from "./catalog.js";

/** 固定的假脱敏值；含 U+2026 省略号，且不是任何真实密钥。 */
const FAKE_MASKED = "sk-orc\u20260001";

/** 固定假连接态；绝不使用真实 code/verifier/token。 */
const FAKE_CONNECT_STATE = Object.freeze({
  phase: "waiting",
  sessionId: "s1",
  authorizeUrl:
    "https://www.orcarouter.ai/auth?response_type=code&client_id=zcode&code_challenge=FAKE&code_challenge_method=S256&state=FAKE&callback_url=oob",
  hint: "Open https://www.orcarouter.ai/auth and paste the code",
  error: null,
  busy: true,
  generation: 1,
});

function createFakeOrcaRouterService() {
  let credential = Object.freeze({
    connected: true,
    masked: FAKE_MASKED,
    source: "api-key",
    needsReauth: false,
    generation: 1,
  });

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  return {
    async getEndpoints() {
      return Object.freeze({
        authBase: "https://www.orcarouter.ai",
        apiBase: "https://api.orcarouter.ai",
        inferenceBase: "https://api.orcarouter.ai/v1",
      });
    },

    async getCredentialStatus() {
      return credential;
    },

    async saveApiKey() {
      return credential;
    },

    async clearCredential() {
      credential = Object.freeze({ ...credential, connected: false, masked: "", source: null });
      return credential;
    },

    async resolveCredential() {
      return Object.freeze({
        masked: FAKE_MASKED,
        source: "api-key",
        generation: 1,
      });
    },

    async beginConnect() {
      return { ...FAKE_CONNECT_STATE };
    },

    async submitConnectCode() {
      return { ok: true, state: { ...FAKE_CONNECT_STATE, phase: "connected", busy: false } };
    },

    async cancelConnect() {
      return { ...FAKE_CONNECT_STATE, phase: "idle", busy: false, hint: null, authorizeUrl: null };
    },

    async invalidateConnect() {
      return { ...FAKE_CONNECT_STATE, phase: "idle", busy: false, hint: null, authorizeUrl: null };
    },

    async listModels({ capability, requiredInputModality }) {
      // 120ms 延迟让 loading 态真实可见，而不是瞬间完成。
      await delay(120);
      const models = listOrcaModels({ capability, requiredInputModality }).map((model) =>
        Object.freeze({
          modelId: model.modelId,
          inputModalities: model.inputModalities,
          supportedEndpointTypes: model.supportedEndpointTypes,
        }),
      );
      return Object.freeze({
        capability,
        source: "live",
        degraded: false,
        fetchedAt: Date.now(),
        totalBeforeFilter: ORCA_MODEL_CATALOG.length,
        models: Object.freeze(models),
      });
    },

    async reportUnauthorized() {
      return { marked: false, status: credential };
    },
  };
}

/** 仅提供 UI 需要的 orcaRouterService；IServiceAccessor 其余字段均为可选。 */
const fakeAccessor = { orcaRouterService: createFakeOrcaRouterService() };

/** 与 catalog.js 同源的模型列表，供 ProviderModelsSection 的选中值展示。 */
const EVIDENCE_MODELS = ORCA_MODEL_CATALOG.map((model) => ({
  kind: "candidate",
  modelId: model.modelId,
  builtin: false,
  personalConfig: { access: undefined },
  config: { properties: { contextWindow: 128000 } },
  hasPersonalConfig: true,
  executable: true,
  selectable: true,
}));

function noop() {}

function Harness() {
  const [selectedModelId, setSelectedModelId] = useState(null);
  const [multimodalModelId, setMultimodalModelId] = useState(null);
  return (
    <div
      data-evidence-root="orca-evidence"
      style={{ minHeight: "100vh", background: "#161616", padding: "32px" }}
    >
      <div style={{ margin: "0 auto", maxWidth: "768px" }}>
        <OrcaRouterProviderFields providerId="orcarouter" />
        <div
          style={{
            marginTop: "16px",
            border: "1px solid #3f3f46",
            borderRadius: "12px",
            background: "#1c1c1c",
            padding: "16px",
          }}
          data-evidence-model-selector-container
        >
          <OrcaRouterModelSelector
            capability="chat"
            hasImageAttachment={false}
            selectedModelId={selectedModelId}
            onSelectModel={setSelectedModelId}
          />
        </div>
        <div
          style={{
            marginTop: "16px",
            border: "1px solid #3f3f46",
            borderRadius: "12px",
            background: "#1c1c1c",
            padding: "16px",
          }}
          data-evidence-multimodal-selector
        >
          <OrcaRouterModelSelector
            capability="chat"
            hasImageAttachment={true}
            selectedModelId={multimodalModelId}
            onSelectModel={setMultimodalModelId}
          />
        </div>
        {/* 真实 Provider 设置区块：证明 OrcaRouter 下没有 Add Model / 自由填写入口。 */}
        <div
          style={{
            marginTop: "16px",
            border: "1px solid #3f3f46",
            borderRadius: "12px",
            background: "#1c1c1c",
            padding: "16px",
          }}
          data-evidence-provider-models-section
        >
          <ProviderModelsSection
            providerId="orcarouter"
            providerName="OrcaRouter"
            models={EVIDENCE_MODELS}
            discoveryTemplateId="orcarouter"
            onModelCommit={noop}
            onDeleteModel={noop}
            onAddModel={noop}
          />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ZCodeIntlProvider initialLocale="en-US">
      <ServiceProvider services={fakeAccessor}>
        <Harness />
      </ServiceProvider>
    </ZCodeIntlProvider>
  </StrictMode>,
);

// 便于 run.mjs 断言数据源与计数同源，不参与界面。
window.__ORCA_EVIDENCE_CATALOG__ = {
  source: CATALOG_SOURCE_URL,
  chatCount: listOrcaModels({ capability: "chat" }).length,
  imageCount: listOrcaModels({ capability: "chat", requiredInputModality: "image" }).length,
};

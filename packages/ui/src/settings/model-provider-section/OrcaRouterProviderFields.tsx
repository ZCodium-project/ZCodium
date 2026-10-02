import { ClipboardCopyIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ORCAROUTER_DEFAULT_API_V1_BASE,
  TID_ORCAROUTER_SPEC,
  type OrcaCredentialSource,
} from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import { ApiKeyInput } from "./ApiKeyInput.js";
import { ProviderLogo } from "./ProviderLogo.js";

type ConnectPhase = "idle" | "waiting" | "exchanging" | "connected" | "error";

interface OrcaRouterCredentialState {
  readonly connected: boolean;
  readonly masked: string;
  readonly source: OrcaCredentialSource | null;
  readonly needsReauth: boolean;
  readonly generation: number;
}

function emptyState(): OrcaRouterCredentialState {
  return { connected: false, masked: "", source: null, needsReauth: false, generation: 0 };
}

/**
 * OrcaRouter 供应商的凭据面板。
 *
 * 两个入口并列且都可用：
 * - **API Key**：沿用项目既有 secret 习惯（加密 Credential Store），支持更新与清除；
 * - **Connect with OrcaRouter**：OAuth 2.0 + PKCE（out-of-band code），
 *   换回的是同一把长期 OrcaRouter API key，与手填路径产出完全相同的凭据。
 *
 * 登录锁的释放覆盖：成功、拒绝、换取失败、超时、显式取消、切换认证方式、
 * 卸载、以及 `pagehide`（back-forward cache 恢复后仍可重新开始登录）。
 */
export function OrcaRouterProviderFields({
  providerId,
  readOnly,
}: {
  providerId: string;
  readOnly?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const { orcaRouterService } = useServices();
  const [credential, setCredential] = useState<OrcaRouterCredentialState>(emptyState);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [phase, setPhase] = useState<ConnectPhase>("idle");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 单调递增序号：旧响应不得覆盖新登录 */
  const generationRef = useRef(0);
  const sessionRef = useRef<string | null>(null);

  const refreshCredential = useCallback(async () => {
    if (!orcaRouterService) return;
    setCredential(await orcaRouterService.getCredentialStatus());
  }, [orcaRouterService]);

  useEffect(() => {
    void refreshCredential();
  }, [refreshCredential]);

  /** 同步清 busy/hint，并让在途响应失效 */
  const clearLoginState = useCallback(() => {
    generationRef.current += 1;
    sessionRef.current = null;
    setBusy(false);
    setHint(null);
    setPhase("idle");
  }, []);

  const invalidateOnServer = useCallback(
    (reason: "pagehide" | "unmount" | "provider-switch" | "auth-method-switch") => {
      void orcaRouterService?.invalidateConnect({ reason });
    },
    [orcaRouterService],
  );

  useEffect(() => {
    if (!orcaRouterService) return;
    const handlePageHide = () => {
      // 不能只依赖被 generation guard 拦下的 finally：bfcache 恢复后页面会永久 busy。
      clearLoginState();
      invalidateOnServer("pagehide");
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      // 卸载时只取消服务端任务，不写 React 状态。
      void orcaRouterService.invalidateConnect({ reason: "unmount" });
    };
  }, [clearLoginState, invalidateOnServer, orcaRouterService]);

  // provider 切换时重算：旧 provider 的登录不得出现在新 provider 下。
  useEffect(() => {
    clearLoginState();
    setError(null);
  }, [clearLoginState, providerId]);

  const handleSaveApiKey = useCallback(async () => {
    if (!orcaRouterService) return;
    setError(null);
    try {
      // 切换认证方式：先释放 PKCE 登录锁，再走 API Key adapter。
      clearLoginState();
      invalidateOnServer("auth-method-switch");
      const status = await orcaRouterService.saveApiKey({ apiKey: apiKeyDraft });
      setCredential(status);
      setApiKeyDraft("");
      setApiKeyVisible(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : intl.formatMessage({ id: "orcaRouter.apiKey.invalid" }),
      );
    }
  }, [apiKeyDraft, clearLoginState, intl, invalidateOnServer, orcaRouterService]);

  const handleClear = useCallback(async () => {
    if (!orcaRouterService) return;
    setError(null);
    clearLoginState();
    setCredential(await orcaRouterService.clearCredential());
  }, [clearLoginState, orcaRouterService]);

  const handleStartConnect = useCallback(async () => {
    if (!orcaRouterService) return;
    const attempt = ++generationRef.current;
    setError(null);
    setBusy(true);
    setPhase("waiting");
    try {
      const state = await orcaRouterService.beginConnect();
      if (attempt !== generationRef.current) return;
      sessionRef.current = state.sessionId;
      setHint(state.authorizeUrl);
      if (state.authorizeUrl) {
        window.open(state.authorizeUrl, "_blank", "noopener,noreferrer");
      }
    } catch (caught) {
      if (attempt !== generationRef.current) return;
      setPhase("error");
      setBusy(false);
      setHint(null);
      setError(
        caught instanceof Error
          ? caught.message
          : intl.formatMessage({ id: "orcaRouter.connect.failed" }),
      );
    }
  }, [intl, orcaRouterService]);

  const handleCancelConnect = useCallback(async () => {
    clearLoginState();
    invalidateOnServer("auth-method-switch");
    if (orcaRouterService) await orcaRouterService.cancelConnect({ reason: "用户取消" });
  }, [clearLoginState, invalidateOnServer, orcaRouterService]);

  const handleSubmitCode = useCallback(
    async (code: string) => {
      if (!orcaRouterService) return;
      const attempt = generationRef.current;
      setBusy(true);
      setPhase("exchanging");
      setError(null);
      const result = await orcaRouterService.submitConnectCode({ code });
      if (attempt !== generationRef.current) return;
      if (!result.ok) {
        setPhase("error");
        setBusy(false);
        setHint(null);
        setError(result.message);
        return;
      }
      setPhase("connected");
      setBusy(false);
      setHint(null);
      await refreshCredential();
    },
    [orcaRouterService, refreshCredential],
  );

  const handleCopy = useCallback(async () => {
    if (!hint) return;
    try {
      await navigator.clipboard.writeText(hint);
      setCopied(true);
    } catch {
      // 剪贴板不可用时保留可见 URL，用户可以手动复制。
      setCopied(false);
    }
  }, [hint]);

  const hasApiKey = credential.connected && credential.source === "api-key";
  const hasPkce = credential.connected && credential.source === "pkce";
  const waiting = phase === "waiting" || phase === "exchanging";

  return (
    <section
      className="rounded-xl border border-border bg-surface p-4"
      data-testid={TID_ORCAROUTER_SPEC.section}
      data-orcarouter-provider-id={providerId}
    >
      <header className="flex items-center gap-2">
        <ProviderLogo logo={{ type: "builtin", key: "orcarouter" }} className="size-5" />
        <h3 className="text-ui-base font-medium text-foreground">
          {intl.formatMessage({ id: "orcaRouter.title" })}
        </h3>
      </header>
      <p className="mt-1 text-ui-sm leading-6 text-foreground-subtle">
        {intl.formatMessage(
          { id: "orcaRouter.description" },
          { baseUrl: ORCAROUTER_DEFAULT_API_V1_BASE },
        )}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {/* 入口 1：手填 API Key */}
        <div
          className="rounded-lg border border-border bg-background p-3"
          data-testid={TID_ORCAROUTER_SPEC.apiKeyPane}
          data-auth-method="api-key"
        >
          <div className="flex items-center justify-between">
            <span className="text-ui-sm font-medium text-foreground">
              {intl.formatMessage({ id: "orcaRouter.apiKey.title" })}
            </span>
            <span
              className="text-ui-xs text-foreground-subtle"
              data-testid={TID_ORCAROUTER_SPEC.apiKeyStatus}
              data-connected={hasApiKey ? "true" : "false"}
            >
              {hasApiKey
                ? intl.formatMessage({ id: "orcaRouter.connected" }, { masked: credential.masked })
                : intl.formatMessage({ id: "orcaRouter.notConnected" })}
            </span>
          </div>
          <div className="mt-2">
            <ApiKeyInput
              value={apiKeyDraft}
              visible={apiKeyVisible}
              readOnly={readOnly}
              onChange={setApiKeyDraft}
              onBlur={() => undefined}
              onToggleVisibility={() => setApiKeyVisible((value) => !value)}
            />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly || !apiKeyDraft.trim()}
              data-testid={TID_ORCAROUTER_SPEC.saveApiKey}
              onClick={() => void handleSaveApiKey()}
            >
              {intl.formatMessage({ id: "orcaRouter.apiKey.save" })}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={readOnly || !credential.connected}
              data-testid={TID_ORCAROUTER_SPEC.clearApiKey}
              onClick={() => void handleClear()}
            >
              {intl.formatMessage({ id: "orcaRouter.clear" })}
            </Button>
          </div>
          <p
            className="mt-1 text-ui-xs text-foreground-subtle"
            data-testid={TID_ORCAROUTER_SPEC.secretMasked}
          >
            {credential.connected ? credential.masked : ""}
          </p>
        </div>

        {/* 入口 2：OAuth 2.0 + PKCE */}
        <div
          className="rounded-lg border border-border bg-background p-3"
          data-testid={TID_ORCAROUTER_SPEC.pkcePane}
          data-auth-method="pkce"
        >
          <span className="text-ui-sm font-medium text-foreground">
            {intl.formatMessage({ id: "orcaRouter.pkce.title" })}
          </span>
          <p className="mt-1 text-ui-xs leading-5 text-foreground-subtle">
            {intl.formatMessage({ id: "orcaRouter.pkce.description" })}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={readOnly || waiting}
              data-testid={TID_ORCAROUTER_SPEC.connect}
              onClick={() => void handleStartConnect()}
            >
              {waiting ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              {intl.formatMessage({ id: "orcaRouter.pkce.connect" })}
            </Button>
            {waiting ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-testid={TID_ORCAROUTER_SPEC.cancelConnect}
                onClick={() => void handleCancelConnect()}
              >
                {intl.formatMessage({ id: "common.cancel" })}
              </Button>
            ) : null}
          </div>
          {hasPkce ? (
            <p
              className="mt-1 text-ui-xs text-success"
              data-testid={TID_ORCAROUTER_SPEC.pkceStatus}
            >
              {intl.formatMessage({ id: "orcaRouter.connected" }, { masked: credential.masked })}
            </p>
          ) : null}
          {hint ? (
            <div className="mt-2 space-y-2">
              <label
                className="block text-ui-xs text-foreground-subtle"
                htmlFor="orca-authorize-url"
              >
                {intl.formatMessage({ id: "orcaRouter.pkce.openHint" })}
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="orca-authorize-url"
                  readOnly
                  size="lg"
                  className="h-9"
                  value={hint}
                  data-testid={TID_ORCAROUTER_SPEC.authorizeUrl}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  data-testid={TID_ORCAROUTER_SPEC.copyAuthorizeUrl}
                  onClick={() => void handleCopy()}
                >
                  <ClipboardCopyIcon className="size-3.5" />
                  <span className="sr-only">
                    {copied
                      ? intl.formatMessage({ id: "orcaRouter.pkce.copied" })
                      : intl.formatMessage({ id: "orcaRouter.pkce.copy" })}
                  </span>
                </Button>
                <a
                  href={hint}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex size-8 items-center justify-center rounded-md text-foreground-subtle hover:bg-accent"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  <span className="sr-only">
                    {intl.formatMessage({ id: "orcaRouter.pkce.open" })}
                  </span>
                </a>
              </div>
              <OrcaRouterCodeForm disabled={readOnly} onSubmit={handleSubmitCode} />
            </div>
          ) : null}
        </div>
      </div>

      {credential.needsReauth ? (
        <p className="mt-2 text-ui-sm text-warning" data-testid={TID_ORCAROUTER_SPEC.reauthNotice}>
          {intl.formatMessage({ id: "orcaRouter.needsReauth" })}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-ui-sm text-destructive" data-testid={TID_ORCAROUTER_SPEC.error}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

function OrcaRouterCodeForm({
  disabled,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (code: string) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [code, setCode] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(code);
      }}
    >
      <Input
        size="lg"
        className="h-9"
        value={code}
        disabled={disabled}
        data-testid={TID_ORCAROUTER_SPEC.codeInput}
        placeholder={intl.formatMessage({ id: "orcaRouter.pkce.codePlaceholder" })}
        onChange={(event) => setCode(event.target.value)}
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={disabled || !code.trim()}
        data-testid={TID_ORCAROUTER_SPEC.submitCode}
      >
        {intl.formatMessage({ id: "orcaRouter.pkce.submitCode" })}
      </Button>
    </form>
  );
}

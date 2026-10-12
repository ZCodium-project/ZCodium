// @vitest-environment jsdom

/**
 * 审计版登录入口（无官方账号体系）
 *
 * oauthService.getProviders 在审计版恒返回空（官方账号能力已随去智谱化下线），
 * 登录页必须直接进入 API Key 配置：
 * - 不展示「没有可用的登录提供方」提示；
 * - 不展示渠道列表与「使用 API key」切换按钮；
 * - 无渠道可返回时，表单「取消」与「暂时跳过」同义（完成登录入口）。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TID_LOGIN_API_KEY_CANCEL_BUTTON,
  TID_LOGIN_API_KEY_CONTINUE_BUTTON,
  TID_LOGIN_USE_API_KEY_BUTTON,
} from "@zcode/shared";

const oauthState = vi.hoisted(() => ({
  status: "idle" as "idle" | "waiting" | "error",
  error: null as string | null,
  loadingProviders: false,
  providers: [] as Array<{ id: string; displayName: string; enabled: boolean; order: number }>,
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ executeDesktopCommand: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: vi.fn(),
    cancel: vi.fn(),
    reset: vi.fn(),
    status: oauthState.status,
    error: oauthState.error,
    providers: oauthState.providers,
    activeProvider: null,
    loadingProviders: oauthState.loadingProviders,
    pendingProvider: null,
    refreshProviders: vi.fn(),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useZCodeStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: null,
      oauthError: null,
      setOAuthError: vi.fn(),
      oauthSuccessSeq: 0,
      lastOAuthSuccessProvider: null,
      loginEntryRequest: null,
      loginEntryAttempt: null,
      clearLoginEntryRequest: vi.fn(),
      markLoginEntryAttemptStatus: vi.fn(),
      markApiKeyLoginSuccess: vi.fn(),
    }),
}));

vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({
    modelSelectionService: { getView: vi.fn().mockResolvedValue({ providers: [] }) },
    providerSettingsService: {
      getView: vi.fn().mockResolvedValue({ providerTemplates: [] }),
      createPersonalProvider: vi.fn(),
    },
    settingService: { update: vi.fn().mockResolvedValue(undefined) },
  }),
}));

vi.mock("@/hooks/useProviderSettingsView.js", () => ({
  useProviderSettingsView: () => ({ state: { status: "loading" }, reload: vi.fn() }),
}));

async function renderWelcomeScreen() {
  const onComplete = vi.fn();
  const { WelcomeScreen } = await import("@/WelcomeScreen.js");
  render(createElement(WelcomeScreen, { onComplete }));
  return { onComplete };
}

describe("无官方账号体系时的登录入口", () => {
  beforeEach(() => {
    oauthState.status = "idle";
    oauthState.error = null;
    oauthState.loadingProviders = false;
    oauthState.providers = [];
  });

  afterEach(() => {
    cleanup();
  });

  it("provider 为空时直接展示 API Key 配置，不再展示「没有可用的登录提供方」提示", async () => {
    await renderWelcomeScreen();

    await waitFor(() => {
      expect(screen.getByTestId(TID_LOGIN_API_KEY_CONTINUE_BUTTON)).toBeTruthy();
    });
    expect(screen.getByText("login.apiKey.title")).toBeTruthy();
    expect(screen.queryByText("login.oauth.noProviders")).toBeNull();
    // 渠道列表模式的切换按钮不应出现。
    expect(screen.queryByTestId(TID_LOGIN_USE_API_KEY_BUTTON)).toBeNull();
  });

  it("无渠道可返回时表单「取消」与「暂时跳过」同义：完成登录入口", async () => {
    const { onComplete } = await renderWelcomeScreen();

    await waitFor(() => {
      expect(screen.getByTestId(TID_LOGIN_API_KEY_CANCEL_BUTTON)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(TID_LOGIN_API_KEY_CANCEL_BUTTON));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith("skip");
    });
  });
});

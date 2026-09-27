/**
 * WelcomeScreen —— 首次启动的 API Key 配置入口。
 *
 * 审计版没有账号体系：不调用任何官方 OAuth/账号登录，也没有"可登录提供方"的提示。
 * 首次启动直接进入 API Key 配置（或跳过，稍后在设置里配置）。
 */
import { LoginApiKeyForm } from "./login/LoginApiKeyForm.js";
import { ThemeHeroVisual } from "./openWorkspacePageThemeHero.js";

interface WelcomeScreenProps {
  onComplete: (reason: LoginCompleteReason) => void | Promise<void>;
}

export type LoginCompleteReason = "oauth" | "apiKey" | "skip";

export function WelcomeScreen({ onComplete }: WelcomeScreenProps) {
  return (
    <main className="relative flex h-full min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-6 text-foreground sm:px-6">
      <ThemeHeroVisual className="absolute inset-0" />
      <div className="pointer-events-none absolute start-0 top-0 end-0 z-10 flex h-12 w-full items-center [app-region:drag]" />
      <section className="relative z-10 w-full flex flex-col gap-10 max-w-sm rounded-2xl border border-popover-border bg-background p-8 text-ui-base/relaxed shadow-md sm:p-10">
        <LoginApiKeyForm
          onCancel={() => void onComplete("skip")}
          onSaved={() => void onComplete("apiKey")}
          onSkipped={() => void onComplete("skip")}
        />
      </section>
    </main>
  );
}

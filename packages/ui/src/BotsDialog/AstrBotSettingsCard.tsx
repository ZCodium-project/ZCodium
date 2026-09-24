import { Copy, ExternalLink, Unlink } from "lucide-react";
import type { BotConfig, BotServiceStatus } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { BindCodePanel } from "./ProviderSettingsCard.js";
import type { BindCodeState } from "./shared.js";

/**
 * AstrBot 是官方 BotsService 的桥接 provider（loopback WS + `botsBridgeServer`）：
 * 没有平台凭据/二维码，绑定走官方 bind code，连接状态来自官方 runtime。
 * 这里只负责展示桥接运行时文件 + 插件入口，并复用官方绑定/解绑流程。
 */
export const ASTRBOT_BRIDGE_RUNTIME_FILE = ".zcode/v2/bots-bridge.runtime.v2.json";
export const ASTRBOT_PLUGIN_URL = "https://github.com/axiom-desu/astrbot-zcodium-plugin";

export function AstrBotSettingsCard({
  bot,
  runtime,
  bindCode,
  bindExpired,
  bindRemainingMs,
  bindCountdownProgress,
  onCreateBindCode,
  onUnbind,
  onCopyBindCommand,
  onOpenPlugin,
}: {
  bot: BotConfig;
  runtime: BotServiceStatus["botRuntime"][number] | undefined;
  bindCode: BindCodeState | null;
  bindExpired: boolean;
  bindRemainingMs: number;
  bindCountdownProgress: number;
  onCreateBindCode: () => void;
  onUnbind: () => void;
  onCopyBindCommand: () => void;
  onOpenPlugin: () => void;
}) {
  const { intl } = useZCodeIntl();
  const hasRuntimeError = runtime?.status === "error";
  const isBound = Boolean(bot.providerUserId);
  const showBindCode = bindCode?.botId === bot.id;

  const handleCopyPath = () => {
    void navigator.clipboard?.writeText(ASTRBOT_BRIDGE_RUNTIME_FILE).catch((error: unknown) => {
      logger.warn("[BotsDialog] 复制 AstrBot 桥接配置路径失败", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  const control = isBound ? (
    <div className="flex items-center justify-end gap-3">
      <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui-base text-foreground-subtle">
        <span
          className={cn("size-2 rounded-full", hasRuntimeError ? "bg-destructive" : "bg-success")}
        />
        {intl.formatMessage({
          id: hasRuntimeError ? "bots.runtime.boundConnectionInterrupted" : "bots.connected",
        })}
      </span>
      <Button variant="outline" size="lg" onClick={onUnbind}>
        <Unlink className="size-4" />
        {intl.formatMessage({ id: "bots.unbind" })}
      </Button>
    </div>
  ) : (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {!showBindCode ? (
        <Button variant="outline" size="lg" onClick={onCreateBindCode}>
          {intl.formatMessage({ id: "bots.bind" })}
        </Button>
      ) : null}
      <Button variant="outline" size="lg" onClick={onOpenPlugin}>
        <ExternalLink className="size-4" />
        {intl.formatMessage({ id: "bots.astrbot.openPlugin" })}
      </Button>
    </div>
  );

  const detail = showBindCode ? (
    <BindCodePanel
      bindCode={bindCode}
      bindExpired={bindExpired}
      bindRemainingMs={bindRemainingMs}
      bindCountdownProgress={bindCountdownProgress}
      onCreateBindCode={onCreateBindCode}
      onCopyBindCommand={onCopyBindCommand}
    />
  ) : (
    <div className="rounded-lg bg-background p-3 text-ui-base leading-5 text-foreground-subtle">
      <div className="flex items-center justify-between gap-2">
        <div>{intl.formatMessage({ id: "bots.astrbot.runtimeFilePath" })}</div>
        <Button variant="outline" size="sm" onClick={handleCopyPath}>
          <Copy className="size-3" />
          {intl.formatMessage({ id: "bots.astrbot.copyPath" })}
        </Button>
      </div>
      <div className="mt-1 break-all rounded-md bg-surface px-2 py-1 font-mono text-foreground">
        {ASTRBOT_BRIDGE_RUNTIME_FILE}
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>{intl.formatMessage({ id: "bots.astrbot.step.install" })}</li>
        <li>{intl.formatMessage({ id: "bots.astrbot.step.configure" })}</li>
        <li>{intl.formatMessage({ id: "bots.astrbot.step.bind" })}</li>
      </ol>
    </div>
  );

  return (
    <SettingsGroupCard>
      <SettingsRow
        label={intl.formatMessage({ id: "bots.astrbot.bridgeLabel" })}
        description={intl.formatMessage({
          id: isBound ? "bots.astrbot.boundDescription" : "bots.astrbot.unboundDescription",
        })}
        control={control}
        detail={
          bot.enabled && runtime?.deliveryError ? (
            <>
              <div className="rounded-lg bg-background p-3">
                <div role="alert" className="min-w-0 space-y-2 text-ui-base">
                  <div className="font-medium text-destructive">
                    {intl.formatMessage({ id: "bots.runtime.deliveryFailed" })}
                  </div>
                  <div className="text-foreground-subtle">
                    {intl.formatMessage({ id: "bots.runtime.deliveryFailedDescription" })}
                  </div>
                  <div className="whitespace-pre-wrap break-all text-foreground-subtle">
                    {runtime.deliveryError}
                  </div>
                </div>
              </div>
              {detail}
            </>
          ) : (
            detail
          )
        }
      />
    </SettingsGroupCard>
  );
}
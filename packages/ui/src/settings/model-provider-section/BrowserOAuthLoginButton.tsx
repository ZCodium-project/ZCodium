import { Loader2Icon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { OAuthProviderId } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { useOAuth } from "@/hooks/useOAuth.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useZCodeStore } from "@/store/StoreProvider.js";

/**
 * 浏览器授权登录入口。
 *
 * 只挂在用户主动打开的模型设置页（provider 详情），不在首次启动的 WelcomeScreen 出现：
 * 新用户仍然只看到 API Key 表单并且可以直接跳过，不会被强制登录。
 * 点击后走与 CLI 相同的 OAuth 流程（浏览器授权 + Host 轮询 + deep link 回调），
 * 登录成功由 Root 的常驻 effect 收敛账号态；account 开关关闭时流程在服务层被拒绝。
 */
export function BrowserOAuthLoginButton({
  oauthProviderId,
  providerName,
  disabled,
}: {
  oauthProviderId: OAuthProviderId;
  providerName: string;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const { startLogin, cancel, status, reset } = useOAuth({ bootstrapProviders: false });
  const oauthSuccessSeq = useZCodeStore((state) => state.oauthSuccessSeq);
  const initialSuccessSeqRef = useRef(oauthSuccessSeq);

  useEffect(() => {
    // 登录成功由 Root 常驻 effect 处理；这里只在自己的成功序号前进时收敛等待态。
    if (oauthSuccessSeq === initialSuccessSeqRef.current) {
      return;
    }
    initialSuccessSeqRef.current = oauthSuccessSeq;
    reset();
  }, [oauthSuccessSeq, reset]);

  const waiting = status === "waiting";
  const failed = status === "error";

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={disabled || waiting}
          onClick={() => void startLogin(oauthProviderId)}
        >
          {waiting ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          {waiting
            ? intl.formatMessage({ id: "login.oauth.waiting" }, { provider: providerName })
            : intl.formatMessage({ id: "settings.modelProvider.codingPlan.browserLogin" })}
        </Button>
        {waiting ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => void cancel(oauthProviderId)}
          >
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
        ) : null}
      </div>
      {failed ? (
        <p className="text-ui-sm text-warning">
          {intl.formatMessage({ id: "settings.modelProvider.codingPlan.browserLoginHint" })}
        </p>
      ) : null}
    </div>
  );
}

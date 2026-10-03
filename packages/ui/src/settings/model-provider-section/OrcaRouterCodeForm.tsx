import { useState } from "react";
import { TID_ORCAROUTER_SPEC } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** PKCE 授权码输入：只负责收集用户粘贴的 OOB code，提交语义在面板层。 */
export function OrcaRouterCodeForm({
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

import { useMemo } from "react";
import { Loader2Icon, Radar } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { TID_MODEL_PROVIDER_DETECT_MODELS_BUTTON } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

/** 检测状态由 ProviderModelsSection 持有；本组件只渲染按钮与候选列表。 */
export interface RemoteModelDetectionControl {
  readonly pending: boolean;
  readonly error: string | null;
  readonly models: readonly string[] | null;
  readonly onDetect: () => void;
}

export function RemoteModelDetectionSection({
  control,
  typedModelId,
  saving,
  onPick,
}: {
  control: RemoteModelDetectionControl;
  typedModelId: string;
  saving: boolean;
  onPick: (modelId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  // 已输入文本作为过滤词：帮助用户在长列表中定位；精确匹配自身则不再重复展示。
  const detectedModelChoices = useMemo(() => {
    if (!control.models) return [];
    const query = typedModelId.trim().toLowerCase();
    return control.models.filter(
      (modelId) =>
        modelId !== typedModelId.trim() && (!query || modelId.toLowerCase().includes(query)),
    );
  }, [control.models, typedModelId]);
  return (
    <div className="mt-2 space-y-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        disabled={control.pending || saving}
        onClick={control.onDetect}
        data-testid={TID_MODEL_PROVIDER_DETECT_MODELS_BUTTON}
      >
        {control.pending ? (
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Radar className="size-3.5" aria-hidden="true" />
        )}
        {intl.formatMessage({ id: "settings.modelProvider.detectModels" })}
      </Button>
      {control.error ? (
        <div className="text-ui-sm text-destructive" role="alert">
          {control.error}
        </div>
      ) : null}
      {detectedModelChoices.length > 0 ? (
        <div
          className="max-h-40 overflow-y-auto rounded-lg border border-popover-border bg-menu p-1 shadow-md"
          data-model-detection-list="true"
        >
          {detectedModelChoices.map((modelId) => (
            <button
              key={modelId}
              type="button"
              // 阻止点击时输入框失焦：失焦会触发配置解析 flush，打断正在输入的草稿。
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(modelId)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-start font-mono text-ui-base text-foreground hover:bg-menu-hover"
            >
              <span className="truncate">{modelId}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

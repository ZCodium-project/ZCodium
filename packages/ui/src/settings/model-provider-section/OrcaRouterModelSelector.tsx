import { Loader2Icon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TID_ORCAROUTER_SPEC, type OrcaCapability } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useServices } from "@/hooks/useServices.js";
import {
  reconcileOrcaSelection,
  resolveOrcaSelectorRequirements,
  type OrcaCatalogModel,
} from "./orcaRouterModelOptions.js";

type CatalogSource = "live" | "last-known-good" | "verified-seed";

/**
 * OrcaRouter 的模型选择器。
 *
 * 选项来自当前 origin 下真实的 `GET /v1/models`，并按入口能力过滤；
 * 不允许自由输入 model 字符串，也不用手写示例冒充完整列表。
 * live discovery 失败时只回退到明确标注的 verified seed / last-known-good。
 */
export function OrcaRouterModelSelector({
  capability = "chat",
  hasImageAttachment = false,
  selectedModelId,
  onSelectModel,
  disabled,
}: {
  capability?: OrcaCapability;
  hasImageAttachment?: boolean;
  selectedModelId: string | null;
  onSelectModel: (modelId: string | null) => void;
  disabled?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const { orcaRouterService } = useServices();
  const [models, setModels] = useState<readonly OrcaCatalogModel[]>([]);
  const [source, setSource] = useState<CatalogSource>("live");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const requirements = useMemo(
    () => resolveOrcaSelectorRequirements({ capability, hasImageAttachment }),
    [capability, hasImageAttachment],
  );

  const load = useCallback(
    async (forceRefresh: boolean) => {
      if (!orcaRouterService) return;
      setLoading(true);
      setError(null);
      try {
        const view = await orcaRouterService.listModels({
          capability: requirements.capability,
          ...(requirements.requiredInputModality
            ? { requiredInputModality: requirements.requiredInputModality }
            : {}),
          ...(forceRefresh ? { forceRefresh } : {}),
        });
        setModels(view.models);
        setSource(view.source);
        if (view.error) setError(view.error);
      } catch (caught) {
        setModels([]);
        setError(
          caught instanceof Error
            ? caught.message
            : intl.formatMessage({ id: "orcaRouter.catalog.failed" }),
        );
      } finally {
        setLoading(false);
      }
    },
    [intl, orcaRouterService, requirements],
  );

  // provider 变化或能力/模态需求变化时重算下拉内容。
  useEffect(() => {
    void load(false);
  }, [load]);

  const reconciliation = useMemo(
    () => reconcileOrcaSelection({ models, requirements, selectedModelId }),
    [models, requirements, selectedModelId],
  );

  // 已选模型不再兼容时必须清空，不能静默保留错误值。
  useEffect(() => {
    if (reconciliation.cleared) {
      onSelectModel(null);
    }
  }, [onSelectModel, reconciliation.cleared]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return reconciliation.options;
    return reconciliation.options.filter((model) => model.modelId.toLowerCase().includes(keyword));
  }, [query, reconciliation.options]);

  const degraded = source !== "live";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-expanded={open}
          data-testid={TID_ORCAROUTER_SPEC.modelSelectTrigger}
          onClick={() => setOpen((value) => !value)}
        >
          {loading ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : (
            <SearchIcon className="size-3.5" />
          )}
          {reconciliation.selectedModelId ??
            intl.formatMessage({ id: "orcaRouter.model.selectPlaceholder" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          disabled={loading}
          onClick={() => void load(true)}
        >
          <RefreshCwIcon className="size-3.5" />
          <span className="sr-only">
            {intl.formatMessage({ id: "settings.modelProvider.refresh" })}
          </span>
        </Button>
      </div>

      {degraded ? (
        <p className="text-ui-xs text-warning" data-testid={TID_ORCAROUTER_SPEC.catalogDegraded}>
          {intl.formatMessage(
            {
              id:
                source === "last-known-good"
                  ? "orcaRouter.catalog.degradedLastKnownGood"
                  : "orcaRouter.catalog.degradedSeed",
            },
            { count: reconciliation.options.length },
          )}
        </p>
      ) : null}

      {open ? (
        <div className="rounded-lg border border-border bg-background p-2" role="listbox">
          <Input
            size="lg"
            className="mb-2 h-8"
            value={query}
            placeholder={intl.formatMessage({ id: "orcaRouter.model.search" })}
            onChange={(event) => setQuery(event.target.value)}
          />
          {filtered.length === 0 ? (
            <p
              className="px-2 py-3 text-ui-sm text-foreground-subtle"
              data-testid={TID_ORCAROUTER_SPEC.modelSelectEmpty}
            >
              {loading
                ? intl.formatMessage({ id: "common.loading" })
                : intl.formatMessage({ id: "orcaRouter.model.empty" })}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {filtered.map((model) => (
                <li key={model.modelId}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={model.modelId === reconciliation.selectedModelId}
                    data-testid={TID_ORCAROUTER_SPEC.modelSelectOption}
                    data-model-id={model.modelId}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-start text-ui-sm hover:bg-accent"
                    onClick={() => {
                      onSelectModel(model.modelId);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{model.modelId}</span>
                    <span className="text-ui-xs text-foreground-subtle">
                      {model.inputModalities.join("/")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {error ? (
        <p className="text-ui-xs text-destructive" data-testid={TID_ORCAROUTER_SPEC.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

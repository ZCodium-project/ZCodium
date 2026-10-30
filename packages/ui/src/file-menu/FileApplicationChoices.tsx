import { useMemo } from "react";
import { ContextMenuItem } from "@/components/ui/context-menu.js";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu.js";
import { DefaultFileApplicationLabel } from "@/file-menu/DefaultFileApplicationLabel.js";
import { FileApplicationIcon } from "@/file-menu/FileApplicationIcon.js";
import { FileApplicationSubmenu } from "@/file-menu/FileApplicationSubmenu.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

interface ApplicationChoice {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault?: boolean;
}

/** 少量候选直接可见；默认快捷项占同一个名额，更多菜单只接收剩余项。 */
export function FileApplicationChoices<T extends ApplicationChoice>({
  applications,
  loading = false,
  disabled = false,
  variant = "dropdown",
  onSelect,
  onOpenDefault,
}: {
  applications: readonly T[];
  loading?: boolean;
  disabled?: boolean;
  variant?: "dropdown" | "context";
  onSelect: (application: T) => void;
  onOpenDefault?: () => void;
}) {
  const { intl } = useZCodeIntl();
  const ordered = useMemo(() => {
    const unique = new Map<string, T>();
    for (const application of applications)
      if (!unique.has(application.id)) unique.set(application.id, application);
    return [...unique.values()].sort(
      (left, right) => Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)),
    );
  }, [applications]);
  const direct = ordered.slice(0, 3);
  const remaining = ordered.slice(3);
  const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  return (
    <>
      {direct.map((application) => (
        <Item
          key={application.id}
          data-file-application-direct={application.id}
          disabled={disabled}
          onSelect={() => onSelect(application)}
        >
          {application.isDefault ? (
            <DefaultFileApplicationLabel application={{ ...application, isDefault: true }} />
          ) : (
            <>
              <FileApplicationIcon
                applicationId={application.id}
                iconDataUrl={application.iconDataUrl}
              />
              <span className="min-w-0 flex-1 truncate" title={application.name}>
                {application.name}
              </span>
            </>
          )}
        </Item>
      ))}
      {remaining.length > 0 && (
        <FileApplicationSubmenu
          variant={variant}
          applications={remaining}
          disabled={disabled}
          onSelect={onSelect}
          label={intl.formatMessage({ id: "fileActions.moreOpenWith" })}
        />
      )}
      {ordered.length === 0 &&
        (loading ? (
          <Item disabled>{intl.formatMessage({ id: "common.loading" })}</Item>
        ) : onOpenDefault ? (
          <Item disabled={disabled} onSelect={onOpenDefault}>
            <DefaultFileApplicationLabel />
          </Item>
        ) : null)}
    </>
  );
}

import "@/file-menu/fileApplicationSubmenu.css";
import { useMemo } from "react";
import { AppWindow, ChevronsUpDown } from "lucide-react";
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu.js";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu.js";
import { FileApplicationIcon } from "@/file-menu/FileApplicationIcon.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

interface ApplicationItem {
  id: string;
  name: string;
  iconDataUrl?: string;
  isDefault?: boolean;
}

const VISIBLE_ROWS = 6;
const ROW_HEIGHT = 28;
const ROW_GAP = 2;
const CONTENT_PADDING = 4;
const CONTENT_BORDER = 1;
const SCROLL_HINT_HEIGHT = 16;
const LIST_HEIGHT = VISIBLE_ROWS * ROW_HEIGHT + (VISIBLE_ROWS - 1) * ROW_GAP;

/** 所有文件入口共用候选列表：主菜单高度不再随系统安装的应用数量增长。 */
export function FileApplicationSubmenu<T extends ApplicationItem>({
  applications,
  loading = false,
  disabled = false,
  variant = "dropdown",
  onSelect,
  label,
}: {
  applications: readonly T[];
  loading?: boolean;
  disabled?: boolean;
  variant?: "dropdown" | "context";
  onSelect: (application: T) => void;
  label?: string;
}) {
  const { intl } = useZCodeIntl();
  const sorted = useMemo(
    () =>
      [...applications].sort(
        (left, right) => Number(Boolean(right.isDefault)) - Number(Boolean(left.isDefault)),
      ),
    [applications],
  );
  if (!loading && sorted.length === 0) return null;
  const Sub = variant === "context" ? ContextMenuSub : DropdownMenuSub;
  const Trigger = variant === "context" ? ContextMenuSubTrigger : DropdownMenuSubTrigger;
  const Content = variant === "context" ? ContextMenuSubContent : DropdownMenuSubContent;
  const Item = variant === "context" ? ContextMenuItem : DropdownMenuItem;
  const scrollable = sorted.length > VISIBLE_ROWS;
  const chromeHeight =
    2 * (CONTENT_PADDING + CONTENT_BORDER) + (scrollable ? SCROLL_HINT_HEIGHT + ROW_GAP : 0);
  return (
    <Sub>
      <Trigger className="file-application-more-trigger" disabled={disabled}>
        <AppWindow aria-hidden="true" className="size-4" />
        {label ?? intl.formatMessage({ id: "chat.previewCards.openWith" })}
      </Trigger>
      <Content
        className="w-64 min-w-0 max-w-[calc(100vw-1rem)]"
        style={{
          maxWidth:
            "min(calc(100vw - 1rem), var(--radix-popper-available-width, calc(100vw - 1rem)))",
        }}
      >
        <div
          className="flex min-h-0 flex-col gap-0.5 overflow-x-hidden overflow-y-auto overscroll-contain"
          data-file-application-list=""
          style={{
            // 6×28px + 5×2px；额外扣除外层留白和提示，避免小视口把最后一项挤出屏幕。
            maxHeight: `min(${LIST_HEIGHT}px, max(0px, calc(var(--radix-popper-available-height, 100dvh) - ${chromeHeight}px)))`,
            scrollbarWidth: "thin",
            scrollbarColor: "var(--color-foreground-subtlest) transparent",
            scrollbarGutter: scrollable ? "stable" : undefined,
          }}
        >
          {sorted.length ? (
            sorted.map((application) => (
              <Item
                key={application.id}
                className="h-7 min-h-7 shrink-0"
                onSelect={() => onSelect(application)}
              >
                <FileApplicationIcon
                  applicationId={application.id}
                  iconDataUrl={application.iconDataUrl}
                />
                <span className="min-w-0 flex-1 truncate" title={application.name}>
                  {application.name}
                </span>
                {application.isDefault && (
                  <span className="shrink-0 text-ui-sm text-foreground-subtlest">
                    {intl.formatMessage({ id: "fileActions.defaultApp" })}
                  </span>
                )}
              </Item>
            ))
          ) : (
            <Item disabled className="h-7 min-h-7">
              {intl.formatMessage({ id: "common.loading" })}
            </Item>
          )}
        </div>
        {scrollable && (
          <div className="flex h-4 shrink-0 items-center justify-center gap-1 text-ui-xs text-foreground-subtle">
            <ChevronsUpDown aria-hidden="true" className="size-3" />
            {intl.formatMessage({ id: "fileActions.scrollMoreApps" })}
          </div>
        )}
      </Content>
    </Sub>
  );
}

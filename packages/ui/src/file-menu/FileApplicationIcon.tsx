import { useState } from "react";
import { AppWindow } from "lucide-react";
import { cn } from "@/components/lib/utils.js";

/** 文件菜单共用系统应用图标；缺图和加载失败不能让不同入口出现空白图标位。 */
export function FileApplicationIcon({
  applicationId,
  iconDataUrl,
  className,
}: {
  applicationId: string;
  iconDataUrl?: string;
  className?: string;
}) {
  const source = iconDataUrl?.trim();
  const iconKey = `${applicationId}\u0000${source ?? ""}`;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const classes = cn("size-4 shrink-0", className);
  // 菜单行会随文件切换复用；按应用和来源记失败，不能把上一个 App 的失败带给新 App。
  return source && failedKey !== iconKey ? (
    <img
      key={iconKey}
      alt=""
      aria-hidden="true"
      className={cn(classes, "object-contain")}
      data-slot="file-application-icon"
      onError={() => setFailedKey(iconKey)}
      src={source}
    />
  ) : (
    <AppWindow
      aria-hidden="true"
      className={cn(classes, "text-foreground-subtle")}
      data-slot="file-application-icon-fallback"
    />
  );
}

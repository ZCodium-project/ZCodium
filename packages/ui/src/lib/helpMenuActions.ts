import { ZCODIUM_ISSUES_URL, ZCODIUM_SITE_URL, type IPlatformService } from "@zcode/shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import { runExportLogsAction } from "@/lib/exportLogsAction.js";

interface HelpMenuActionHandlers {
  openIssueReport: () => Promise<void>;
  openProductDocs: () => void;
  exportLogs: () => void;
}

export function createHelpMenuActionHandlers({
  platform,
  intl,
}: {
  platform: Pick<IPlatformService, "captureWindowScreenshot" | "exportLogs" | "openExternal">;
  intl: IntlInstance;
}): HelpMenuActionHandlers {
  return {
    openIssueReport: async () => {
      // 审计版：问题反馈直接指向本仓库 Issues，不再打开官方反馈弹窗。
      platform.openExternal(ZCODIUM_ISSUES_URL);
    },
    openProductDocs: () => {
      // 审计版：产品文档入口指向 ZCodium 项目站点。
      platform.openExternal(ZCODIUM_SITE_URL);
    },
    exportLogs: () => {
      void runExportLogsAction(platform, intl);
    },
  };
}

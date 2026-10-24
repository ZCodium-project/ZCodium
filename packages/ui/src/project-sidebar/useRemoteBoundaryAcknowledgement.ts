import { useCallback } from "react";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useConfirmDialog } from "@/hooks/useConfirmDialog.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";

/** 只为明确的远程目录浏览确认边界，不改旧 SSH 向导或离线资源 owner。 */
export function useRemoteBoundaryAcknowledgement() {
  const settings = useOptionalBaseWorkspaceServices()?.settingService;
  const platform = useOptionalPlatform();
  const confirm = useConfirmDialog();
  const { intl } = useZCodeIntl();
  return useCallback(
    async (isCurrent: () => boolean): Promise<boolean> => {
      if (!settings) return isCurrent();
      try {
        if ((await settings.get()).remoteBoundaryIntroAcknowledgedVersion === 1) return isCurrent();
        if (!isCurrent()) return false;
        if (
          !(await confirm({
            title: intl.formatMessage({ id: "remote.sourceServerBoundaryTitle" }),
            description: intl.formatMessage({ id: "remote.sourceServerBoundaryDescription" }),
            confirmLabel: intl.formatMessage({ id: "common.gotIt" }),
          })) ||
          !isCurrent()
        )
          return false;
        const patch = { remoteBoundaryIntroAcknowledgedVersion: 1 as const };
        await settings.update(patch);
        platform?.syncAppSettings?.(patch);
        return isCurrent();
      } catch (cause) {
        logger.warn("[project-sidebar] 读取或保存远程介绍失败", cause);
        return isCurrent();
      }
    },
    [settings, platform, confirm, intl],
  );
}

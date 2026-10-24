import { useCallback, useEffect, useRef, useState } from "react";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useSourceServerManagementSnapshot } from "@/hooks/useSourceServerManagementSnapshot.js";
import { useSourceServerOperationLogs } from "@/hooks/useSourceServerOperationLogs.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { SourceServerManagementSnapshot } from "./contract.js";
import { getSourceServerManagementErrorMessage } from "./sourceServerSettingsActions.js";

/** 只读投影和在途按钮状态；真正的设备/attachment/日志 owner 仍在原 Host。 */
export function useSourceServerSettings() {
  const management = useBaseWorkspaceServices().sourceServerManagementService;
  const { intl } = useZCodeIntl();
  const [error, setError] = useState<string | null>(null);
  const { snapshot, ready, applySnapshot, refresh } = useSourceServerManagementSnapshot(
    management,
    {
      onError: (cause) =>
        setError(getSourceServerManagementErrorMessage(cause, intl.formatMessage)),
    },
  );
  const { logsByProfileId } = useSourceServerOperationLogs(
    management,
    snapshot?.profiles.map((profile) => profile.profileId),
  );
  const operations = useRef(new Map<string, { scope: string }>());
  const [busy, setBusy] = useState<ReadonlyMap<string, string>>(new Map());
  const owner = useRef(management);
  owner.current = management;
  useEffect(() => {
    operations.current.clear();
    setBusy(new Map());
    setError(null);
  }, [management]);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(
    async (
      key: string,
      scope: string,
      operation: () => Promise<SourceServerManagementSnapshot | void>,
    ) => {
      if (
        !mounted.current ||
        owner.current !== management ||
        [...operations.current.values()].some((entry) => entry.scope === scope)
      )
        return;
      const entry = { scope };
      operations.current.set(key, entry);
      const projectBusy = () =>
        new Map([...operations.current].map(([id, item]) => [id, item.scope]));
      if (mounted.current) {
        setBusy(projectBusy());
        setError(null);
      }
      try {
        const next = await operation();
        // 关闭设置页只取消展示，不接管或中断已经准入的 Host 更新。
        if (mounted.current && owner.current === management) {
          if (next) applySnapshot(next);
          else refresh();
        }
      } catch (cause) {
        if (mounted.current && owner.current === management)
          setError(getSourceServerManagementErrorMessage(cause, intl.formatMessage));
      } finally {
        // 旧 Host/旧调用的结束不能删除同名新操作，也不能把旧快照写入新 owner。
        if (operations.current.get(key) === entry) operations.current.delete(key);
        if (mounted.current && owner.current === management) setBusy(projectBusy());
      }
    },
    [applySnapshot, refresh, intl, management],
  );
  return { management, snapshot, ready, refresh, logsByProfileId, busy, error, run };
}

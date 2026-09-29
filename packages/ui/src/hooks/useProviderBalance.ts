import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderBalanceSnapshot } from "@zcode/shared";
import { logger } from "@/logger.js";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

interface ProviderBalanceState {
  snapshot: ProviderBalanceSnapshot | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: ProviderBalanceState = {
  snapshot: null,
  loading: false,
  error: null,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  return String(error);
}

/**
 * 读取外部 API Key Provider 的账户余额。
 *
 * Provider 设置视图来自根 Environment（`useProviderSettingsView`），
 * 余额查询必须走同一份 base services，避免远端 tab 下读到不同 Environment 的 Provider。
 * Web/SSR 未注册 base services 时按 `null` 降级，不发起查询。
 */
export function useProviderBalance(
  providerId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const services = useOptionalBaseWorkspaceServices();
  const usageStatsService = services?.usageStatsService;
  const [state, setState] = useState<ProviderBalanceState>(INITIAL_STATE);
  const requestVersionRef = useRef(0);
  const scopeRef = useRef(providerId);
  const enabled = (options.enabled ?? true) && Boolean(providerId);

  const refresh = useCallback(async () => {
    if (!enabled || !providerId || !usageStatsService) {
      setState(INITIAL_STATE);
      return;
    }
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const sameScope = scopeRef.current === providerId;
    scopeRef.current = providerId;
    setState((current) => ({
      // 同一 Provider 刷新时保留旧余额，避免刷新瞬间余额区域闪空；
      // 切换 Provider 时必须清空，否则会短暂展示上一家的余额。
      snapshot: sameScope ? current.snapshot : null,
      loading: true,
      error: null,
    }));
    try {
      const snapshot = await usageStatsService.getProviderBalanceSnapshot({ providerId });
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setState({ snapshot, loading: false, error: null });
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      const message = getErrorMessage(error);
      logger.warn("[useProviderBalance] 读取供应商余额失败", { providerId, error: message });
      setState((current) => ({
        snapshot: current.snapshot,
        loading: false,
        error: message,
      }));
    }
  }, [enabled, providerId, usageStatsService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}

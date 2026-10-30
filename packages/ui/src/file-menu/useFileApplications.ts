import { useCallback, useEffect, useRef, useState } from "react";
import type { FileApplicationInfo, FileApplicationTarget } from "@zcode/shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { toast } from "@/components/ui/toast.js";
import { logger } from "@/logger.js";

export function useFileApplications(target: FileApplicationTarget | null, isRemote = false) {
  const platform = usePlatform();
  const { intl } = useZCodeIntl();
  const key = target ? `${target.path}\u0000${target.workspaceIdentity ?? ""}` : "";
  const targetRef = useRef(target);
  targetRef.current = target;
  const platformRef = useRef(platform);
  platformRef.current = platform;
  const getFileApplications = platform.getFileApplications;
  const currentKey = useRef(key);
  currentKey.current = key;
  const request = useRef(0);
  const [state, setState] = useState<{
    key: string;
    apps: FileApplicationInfo[];
    loading: boolean;
  }>({
    key: "",
    apps: [],
    loading: false,
  });
  const available = Boolean(
    target?.pathKind === "file" &&
    !isRemote &&
    platform.canOpenLocalFiles &&
    platform.getFileApplications &&
    platform.openFileWithApplication,
  );
  useEffect(
    () => () => {
      request.current += 1;
    },
    [key, available],
  );
  const load = useCallback(async () => {
    const currentTarget = targetRef.current;
    if (!available || !currentTarget || !getFileApplications) return;
    const id = ++request.current;
    setState({ key, apps: [], loading: true });
    try {
      const apps = await getFileApplications(currentTarget);
      if (request.current !== id || currentKey.current !== key) return;
      setState({
        key,
        apps: [...apps].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
        loading: false,
      });
    } catch (error) {
      if (request.current !== id || currentKey.current !== key) return;
      setState({ key, apps: [], loading: false });
      logger.warn("[FileApplications] 获取系统关联应用失败", {
        path: currentTarget.path,
        error: String(error),
      });
    }
  }, [available, key, getFileApplications]);
  const apps = state.key === key && available ? state.apps : [];
  const defaultApplication = apps.find((app) => app.isDefault) ?? null;
  const open = useCallback(
    async (app: FileApplicationInfo) => {
      const currentTarget = targetRef.current;
      const currentPlatform = platformRef.current;
      if (!available || !currentTarget || !currentPlatform.openFileWithApplication) return;
      try {
        const result = await currentPlatform.openFileWithApplication(app.id, currentTarget);
        if (!result.success) throw new Error(result.error || "open_failed");
      } catch (error) {
        logger.warn("[FileApplications] 打开文件失败", {
          path: currentTarget.path,
          applicationId: app.id,
          error: String(error),
        });
        toast(intl.formatMessage({ id: "chat.previewCards.openFileFailed" }));
      }
    },
    [available, intl],
  );
  const openDefault = useCallback(async () => {
    if (defaultApplication) return open(defaultApplication);
    const currentTarget = targetRef.current;
    const currentPlatform = platformRef.current;
    if (
      isRemote ||
      !currentTarget ||
      !currentPlatform.canOpenLocalFiles ||
      !currentPlatform.openExternalFile
    )
      return;
    try {
      const result = await currentPlatform.openExternalFile(currentTarget.path);
      if (!result.success) throw new Error(result.error || "open_failed");
    } catch (error) {
      logger.warn("[FileApplications] 默认应用打开失败", {
        path: currentTarget.path,
        error: String(error),
      });
      toast(intl.formatMessage({ id: "chat.previewCards.openFileFailed" }));
    }
  }, [defaultApplication, isRemote, open, intl]);

  return {
    available,
    apps,
    defaultApplication,
    openDefault,
    loading: state.key === key && available && state.loading,
    load,
    open,
  };
}

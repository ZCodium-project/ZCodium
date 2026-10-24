import { useEffect, useMemo, useState } from "react";
import { parseRemoteWorkspaceIdentity, type ConfigCatalogSnapshot } from "./contract.js";
import { readConfigCatalog, projectConfigTargets } from "./catalog.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { logger } from "@/logger.js";

const EMPTY: ConfigCatalogSnapshot = { projects: [], directory: { hosts: [], entries: [] } };

export function useConfigWorkspaceCatalog(sourceServerId?: string | null) {
  const services = useBaseWorkspaceServices();
  const tabs = useTabStore((state) => state.tabs);
  const [owned, setOwned] = useState({ services, snapshot: EMPTY, loaded: false });
  // 旧 Host 的投影不能在新 owner 的首帧继续充当可写配置目标。
  const snapshot = owned.services === services ? owned.snapshot : EMPTY;
  useEffect(() => {
    let serial = 0;
    const refresh = async () => {
      const request = ++serial;
      try {
        if (!services.projectService) throw new Error("project.service-unavailable");
        const result = await readConfigCatalog({
          projectService: services.projectService,
          remoteProjectService: services.remoteProjectService,
        });
        if (serial === request) setOwned({ services, snapshot: result, loaded: true });
      } catch (error) {
        if (serial !== request) return;
        setOwned({ services, snapshot: EMPTY, loaded: true });
        logger.error("[workspace-config-catalog] 读取配置目录失败", error);
      }
    };
    void refresh();
    const listener = services.broadcastService.onMessage((event) => {
      if (event.channel === "state:projects") void refresh();
    });
    return () => {
      ++serial;
      listener.dispose();
    };
  }, [services]);
  const targets = useMemo(() => {
    const targets = projectConfigTargets(snapshot, tabs.filter(isWorkspaceTab));
    if (sourceServerId === undefined) return targets;
    return targets.filter((target) => {
      const identity = target.workspaceIdentity?.trim();
      if (!identity) return sourceServerId === null;
      const parsed = parseRemoteWorkspaceIdentity(identity);
      return parsed?.kind === "server" && parsed.sourceServerId === sourceServerId;
    });
  }, [snapshot, sourceServerId, tabs]);
  return { targets, loading: owned.services !== services || !owned.loaded };
}

export function useConfigWorkspaceTargets(sourceServerId?: string | null) {
  return useConfigWorkspaceCatalog(sourceServerId).targets;
}

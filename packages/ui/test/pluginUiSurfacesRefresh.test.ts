// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePluginUiSurfaces } from "@/plugin-ui/adapters/usePluginUiSurfaces.js";
import { notifyPluginManagementChange } from "@/store/pluginManagementStoreLoading.js";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fake = vi.hoisted(() => ({ listSurfaces: vi.fn() }));
vi.mock("@/hooks/useServices.js", () => ({
  useOptionalServices: () => ({ pluginUiBridgeService: fake }),
}));
vi.mock("@/logger.js", () => ({ logger: { warn: vi.fn() } }));
function View() {
  const surfaces = usePluginUiSurfaces({ workspacePath: "/repo" });
  return createElement("span", {}, surfaces.map((surface) => surface.id).join(","));
}
afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});
describe("插件成功变更刷新真实面板入口", () => {
  it("同 Host user 和当前 workspace 成功触发查询，其他 identity 不触发；旧响应不能覆盖新结果", async () => {
    let resolveOld: (value: unknown[]) => void = () => {};
    fake.listSurfaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fake.listSurfaces.mockResolvedValue([{ id: "enabled" }]);
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    await act(async () => {
      root.render(createElement(View));
    });
    expect(fake.listSurfaces).toHaveBeenCalledTimes(1);
    await act(async () => {
      notifyPluginManagementChange({
        workspacePath: "/other",
        workspaceIdentity: null,
        scope: "workspace",
      });
    });
    expect(fake.listSurfaces).toHaveBeenCalledTimes(1);
    await act(async () => {
      notifyPluginManagementChange({
        workspacePath: "/other",
        workspaceIdentity: null,
        scope: "user",
      });
    });
    expect(fake.listSurfaces).toHaveBeenCalledTimes(2);
    expect(node.textContent).toBe("enabled");
    await act(async () => {
      resolveOld([{ id: "stale" }]);
    });
    expect(node.textContent).toBe("enabled");
    await act(async () => {
      root.unmount();
    });
    notifyPluginManagementChange({
      workspacePath: "/repo",
      workspaceIdentity: null,
      scope: "workspace",
    });
    expect(fake.listSurfaces).toHaveBeenCalledTimes(2);
  });
});

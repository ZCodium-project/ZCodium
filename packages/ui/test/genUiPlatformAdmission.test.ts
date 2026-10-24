// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGenUi } from "@/hooks/useGenUi.js";

const harness = vi.hoisted(() => ({
  platform: undefined as Record<string, unknown> | undefined,
  acquire: vi.fn(),
  services: { genUiService: {} },
}));
vi.mock("@/gen-ui/host.js", () => ({ acquireGenUiPage: harness.acquire }));
vi.mock("@/hooks/usePlatform.js", () => ({ useOptionalPlatform: () => harness.platform }));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({
  useOptionalBaseWorkspaceServices: () => harness.services,
  useWorkspaceServicesResolution: () => ({
    services: harness.services,
    rpcReady: true,
  }),
}));
beforeEach(() => {
  harness.acquire.mockReset();
  harness.platform = { openExternal: vi.fn() };
});
afterEach(cleanup);

describe("ZUP08 手机沙箱边界", () => {
  it("手机 Web 无 pluginSandbox 能力时不创建本地沙箱", () => {
    const { result } = renderHook(() =>
      useGenUi(
        {
          workspacePath: "/work",
          sessionId: "session",
          path: "/work/chart.html",
          instanceKey: "message:0",
        },
        async () => null,
        0,
      ),
    );
    expect(result.current.supported).toBe(false);
    expect(result.current.page).toBeNull();
    expect(harness.acquire).not.toHaveBeenCalled();
  });
});

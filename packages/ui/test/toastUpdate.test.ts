// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, toast, updateToast } from "@/components/ui/toast.js";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("toast updates", () => {
  it("delivers and updates toasts even when animation frames never run", async () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    let id = toast("导入状态初始化", { durationMs: 0, dedupeKey: "share-import" });
    const cancelled = toast("挂载前已取消", { durationMs: 0 });
    const following = toast("第二条有效提示", { durationMs: 0 });
    dismissToast(cancelled);
    updateToast(id, { message: "正在下载分享文件：0/1", variant: "info" });
    await waitFor(() => {
      const hosts = document.querySelectorAll("#zcode-toast-host");
      expect(hosts).toHaveLength(1);
      expect(
        [...hosts[0].querySelectorAll(".rounded-2xl")].map((item) => item.textContent),
      ).toEqual(["正在下载分享文件：0/1", "第二条有效提示"]);
      expect(hosts[0].querySelector(".rounded-2xl")?.classList.contains("opacity-100")).toBe(true);
    });
    dismissToast(following);

    // 同一操作的替代提示仍须去重，同时保留紧接着到达的进度更新。
    id = toast("正在完成导入", { durationMs: 0, dedupeKey: "share-import" });
    updateToast(id, { message: "已从分享导入：示例会话", durationMs: 10 });
    await waitFor(() => {
      const hostText = document.querySelector("#zcode-toast-host")?.textContent ?? "";
      expect(hostText).toContain("已从分享导入：示例会话");
      expect(hostText).not.toContain("正在下载分享文件：0/1");
      expect(document.querySelectorAll("#zcode-toast-host .rounded-2xl")).toHaveLength(1);
    });
    await waitFor(
      () => expect(document.querySelectorAll("#zcode-toast-host .rounded-2xl")).toHaveLength(0),
      { timeout: 1000 },
    );
  });
});

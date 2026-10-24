import { expect, it } from "vitest";
import { offlineDevice } from "./contract.example.js";
it("只提供只读设备展示，不把离线状态转换为连接副作用", () => {
  expect(offlineDevice).toEqual({ id: "example", label: "Device", status: "offline" });
});

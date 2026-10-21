import { describe, expect, it } from "vitest";
import { isVersionGreaterThan } from "../src/main/autoUpdateVersion.js";

describe("auto-update 版本线迁移（#50）", () => {
  it("legacy 3.x 安装能看到 fork 1.x 迁移包", () => {
    expect(isVersionGreaterThan("1.0.2", "3.14.7")).toBe(true);
    expect(isVersionGreaterThan("1.0.0", "3.14.7")).toBe(true);
  });

  it("fork 1.x 内部仍按 SemVer 比较", () => {
    expect(isVersionGreaterThan("1.0.3", "1.0.2")).toBe(true);
    expect(isVersionGreaterThan("1.0.1", "1.0.2")).toBe(false);
    expect(isVersionGreaterThan("1.0.2", "1.0.2")).toBe(false);
  });

  it("legacy 与其他大版本仍按 SemVer 比较，不把普通降级误判成迁移", () => {
    expect(isVersionGreaterThan("3.14.8", "3.14.7")).toBe(true);
    expect(isVersionGreaterThan("3.14.7", "3.15.0")).toBe(false);
    expect(isVersionGreaterThan("2.0.0", "1.0.0")).toBe(true);
    expect(isVersionGreaterThan("1.0.0", "2.0.0")).toBe(false);
  });
});

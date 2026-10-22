import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 审计版不接入官方账号，但 web 远控 manager 的依赖接口要求 getLogin。
// v3.16.2 同步时遗漏该注入，点击“手机扫码连接”会在 main 进程抛
// “getLogin is not a function”。这里锁住注入，避免下次同步再次丢掉。
describe("web remote control auth injection", () => {
  it("injects a getLogin that degrades to auth-required when no account exists", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/desktop/src/main/index.ts"),
      "utf8",
    );

    expect(source).toContain("getLogin: async () => undefined");
    expect(source).toContain("createWebRemoteControlManager({");
  });
});

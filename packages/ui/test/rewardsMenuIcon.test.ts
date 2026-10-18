import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

it("真实入口 JSX 在匿名时不渲染，登录后展示邀请好友和奖励徽标", async () => {
  const source = await readFile("packages/ui/src/WorkspaceSidebarFooter.tsx", "utf8");
  // #49 移除登录入口后，rewards 条目是自包含的 {user ? (<DropdownMenuItem>…) : null} 块；
  // 按锚点切片并校验边界，标记漂移时给断言失败而不是转译期 SyntaxError。
  const anchor = source.indexOf('data-testid="rewards-menu-item"');
  const start = source.lastIndexOf("{user ? (", anchor);
  const end = source.indexOf(") : null}", anchor);
  expect(anchor).toBeGreaterThanOrEqual(0);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(anchor);
  const expression = `${source.slice(start + 1, end).trim()}) : null`;
  const script = ts.transpileModule(`const result = (${expression}); result;`, {
    compilerOptions: { jsx: ts.JsxEmit.React },
    fileName: "entry.tsx",
  }).outputText;
  const render = (user: object | null) =>
    renderToStaticMarkup(
      runInNewContext(script, {
        React,
        user,
        DropdownMenuItem: "div",
        Gift: "svg",
        Badge: "span",
        intl: { formatMessage: ({ id }: { id: string }) => id },
        openRewards: () => {},
      }),
    );
  expect(render(null)).toBe("");
  expect(render({ id: "test-user" })).toContain('data-testid="rewards-menu-item"');
  expect(render({ id: "test-user" })).toContain('data-testid="rewards-reward-badge"');
});

it("内嵌网页导航保留顶部和左右间距，移除底部内边距", async () => {
  const source = await readFile("packages/ui/src/components/EmbeddedWebsiteHeader.tsx", "utf8");
  expect(source).toContain('className="bg-background px-6 py-4 pb-0 max-sm:px-4"');
});

it("奖励中心使用礼物图标，账号头像仍使用 User", async () => {
  const source = await readFile("packages/ui/src/WorkspaceSidebarFooter.tsx", "utf8");
  const entry = source.split('data-testid="rewards-menu-item"')[1]?.split("</DropdownMenuItem>")[0];
  expect(entry).toContain('<Gift className="size-4" />');
  expect(entry).toContain("<Badge");
  expect(entry).toContain('id: "rewards.menuTitle"');
  expect(entry).toContain('id: "rewards.menuBadge"');
  expect(source).toMatch(/\{user \? \(\s*<DropdownMenuItem[^\n]*data-testid="rewards-menu-item"/);
  expect(source).toContain('<User className="size-4" />');
});

it("菜单保留邀请好友及奖励徽标，页面标题独立为奖励中心", async () => {
  expect(await readFile("packages/ui/src/i18n/locales/zh-CN.ts", "utf8")).toContain(
    '"rewards.menuTitle": "邀请好友"',
  );
  expect(await readFile("packages/ui/src/i18n/locales/zh-CN.ts", "utf8")).toContain(
    '"rewards.menuBadge": "奖励"',
  );
  expect(await readFile("packages/ui/src/i18n/locales/en-US.ts", "utf8")).toContain(
    '"rewards.menuTitle": "Refer a friend"',
  );
  expect(await readFile("packages/ui/src/i18n/locales/en-US.ts", "utf8")).toContain(
    '"rewards.menuBadge": "Rewards"',
  );
  expect(await readFile("packages/ui/src/i18n/locales/zh-CN.ts", "utf8")).toContain(
    '"rewards.title": "奖励中心"',
  );
  expect(await readFile("packages/ui/src/i18n/locales/en-US.ts", "utf8")).toContain(
    '"rewards.title": "Rewards"',
  );
});

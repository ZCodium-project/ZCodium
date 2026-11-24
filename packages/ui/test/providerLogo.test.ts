// @vitest-environment jsdom

import { createElement } from "react";
import { readFile } from "node:fs/promises";
import { URL as NodeURL } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import bigModelLogo from "@/assets/provider-icons/logo-bigmodel.svg";
import {
  ProviderLogo,
  resolveBuiltinProviderLogoAsset,
} from "@/settings/model-provider-section/ProviderLogo.js";

describe("ProviderLogo", () => {
  it.each(["light", "dark"] as const)(
    "Z.AI 在 %s 主题复用系统图标，BigModel 保持原素材",
    (theme) => {
      expect(resolveBuiltinProviderLogoAsset({ type: "builtin", key: "zai" }, theme)).toMatch(
        /model-provider-zai-app\.png(?:\?|$)/,
      );
      expect(resolveBuiltinProviderLogoAsset({ type: "builtin", key: "bigmodel" }, theme)).toBe(
        bigModelLogo,
      );
    },
  );

  it("Z.AI 渲染 Dock 应用 PNG 并保留原尺寸和装饰图片语义", () => {
    const { container } = render(
      createElement(ProviderLogo, {
        logo: { type: "builtin", key: "zai" },
        className: "size-5",
      }),
    );
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toMatch(/model-provider-zai-app\.png(?:\?|$)/);
    expect(image.classList.contains("size-5")).toBe(true);
    expect(image.getAttribute("alt")).toBe("");
    expect(image.getAttribute("aria-hidden")).toBe("true");
    fireEvent.error(image);
    expect(container.querySelector(".lucide-package")).not.toBeNull();
  });

  it.each(["openrouter", "opencode", "cheaperinference"])(
    "聚合供应商 %s 使用已打包的深浅主题资源",
    (key) => {
      const light = resolveBuiltinProviderLogoAsset({ type: "builtin", key }, "light");
      const dark = resolveBuiltinProviderLogoAsset({ type: "builtin", key }, "dark");
      expect(light).toBeTypeOf("string");
      expect(dark).toBeTypeOf("string");
      expect(light).not.toBe(dark);
      expect(light).not.toMatch(/^https?:/);
      expect(dark).not.toMatch(/^https?:/);
    },
  );
  it("Cheaper Inference 的模板品牌引用、方形主题资产与 MIT 来源完整可追溯", async () => {
    const directory = new NodeURL("../src/assets/provider-icons/", import.meta.url);
    const manifest = JSON.parse(
      await readFile(new NodeURL("model-provider-logo-sources.json", directory), "utf8"),
    );
    const source = manifest.logos.find((logo: { providerIds: string[] }) =>
      logo.providerIds.includes("cheaperinference"),
    );
    expect(source).toMatchObject({
      file: "model-provider-cheaperinference-light.svg",
      darkFile: "model-provider-cheaperinference-dark.svg",
      license: "MIT",
    });
    expect(source.sourceUrl).toMatch(/github\.com\/lobehub\/lobe-icons\/blob\/[a-f0-9]{40}\//);
    expect(source.licenseUrl).toMatch(/\/LICENSE$/);
    const paths: string[][] = [];
    for (const [file, fill] of [
      [source.file, "#000000"],
      [source.darkFile, "#ffffff"],
    ]) {
      const svg = await readFile(new NodeURL(file, directory), "utf8");
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain(`fill="${fill}"`);
      expect(svg).toContain("Copyright (c) 2023 LobeHub");
      expect(svg).toContain("Permission is hereby granted, free of charge");
      expect(svg).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
      expect(svg).not.toMatch(/<script|<foreignObject|(?:href|src)=|url\(/i);
      paths.push([...svg.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1]!));
    }
    expect(paths[0]).toHaveLength(3);
    expect(paths[0]).toEqual(paths[1]);
    expect(paths[0]![0]).toBe("M21.941 0L15.084 5.357 16.403 0H21.941Z");
  });
  it("解析已知资源，并让未知或缺失 key 回退通用图标", () => {
    expect(resolveBuiltinProviderLogoAsset({ type: "builtin", key: "deepseek" }, "light")).toBe(
      resolveBuiltinProviderLogoAsset({ type: "builtin", key: "deepseek" }, "dark"),
    );
    expect(resolveBuiltinProviderLogoAsset({ type: "builtin", key: "future-brand" }, "light")).toBe(
      null,
    );
    expect(resolveBuiltinProviderLogoAsset(undefined, "light")).toBe(null);

    const known = renderToStaticMarkup(
      createElement(ProviderLogo, {
        logo: { type: "builtin", key: "deepseek" },
        className: "size-5",
      }),
    );
    const unknown = renderToStaticMarkup(
      createElement(ProviderLogo, {
        logo: { type: "builtin", key: "future-brand" },
        className: "size-5",
      }),
    );
    expect(known).toContain("<img");
    expect(known).toContain('alt=""');
    expect(unknown).toContain("lucide-package");
  });

  it("打包资源加载失败时回退通用图标", () => {
    const { container } = render(
      createElement(ProviderLogo, {
        logo: { type: "builtin", key: "deepseek" },
        className: "size-5",
      }),
    );
    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    fireEvent.error(image!);

    expect(container.querySelector(".lucide-package")).not.toBeNull();
  });
});

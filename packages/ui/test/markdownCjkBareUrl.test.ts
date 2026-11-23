import { describe, expect, it } from "vitest";
import { normalizeMarkdownCjkBareUrls } from "@/lib/markdownCjkBareUrl.js";

describe("normalizeMarkdownCjkBareUrls", () => {
  it("按中文字符边界截断裸 URL，恢复被吞掉的强调符", () => {
    expect(normalizeMarkdownCjkBareUrls("**https://a.site**（说明")).toBe(
      "**<https://a.site>**（说明",
    );
  });

  it("在全角标点处结束 URL 并改写为尖括号链接", () => {
    expect(normalizeMarkdownCjkBareUrls("看https://a.site。后续")).toBe(
      "看<https://a.site>。后续",
    );
  });

  it("www 开头的中文边界链接改写为标准 Markdown 链接", () => {
    expect(normalizeMarkdownCjkBareUrls("www.example.com，说明")).toBe(
      "[www.example.com](http://www.example.com)，说明",
    );
  });

  it("保持 ASCII 裸 URL 原文不变", () => {
    expect(normalizeMarkdownCjkBareUrls("https://a.site/path")).toBe("https://a.site/path");
  });

  it("跳过围栏代码块与行内代码中的 URL", () => {
    const fenced = "```\nhttps://a.site。\n```";
    expect(normalizeMarkdownCjkBareUrls(fenced)).toBe(fenced);
    const inline = "`https://a.site。`";
    expect(normalizeMarkdownCjkBareUrls(inline)).toBe(inline);
  });
});

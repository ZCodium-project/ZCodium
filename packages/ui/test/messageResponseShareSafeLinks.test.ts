// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageResponse } from "@/components/ai-elements/message.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { ZCodeIntlProvider } from "@/i18n/IntlProvider.js";

function message(markdown: string, streaming = false, onOpenExternalUrl = vi.fn()) {
  return createElement(
    TooltipProvider,
    null,
    createElement(
      ZCodeIntlProvider,
      { initialLocale: "en-US" },
      createElement(MessageResponse, { onOpenExternalUrl, streaming, theme: "light" }, markdown),
    ),
  );
}

afterEach(cleanup);

describe("MessageResponse share-safe links", () => {
  it("renders an external link without requiring a Desktop platform provider", () => {
    const html = renderToStaticMarkup(message("[公开链接](https://example.com/share)"));

    expect(html).toContain("公开链接");
    expect(html).toContain("cursor-pointer");
  });

  it.each([
    ["**", "strong", "（说明"],
    ["**", "strong", "说明"],
    ["__", "strong", "。说明"],
    ["*", "em", "，说明"],
    ["_", "em", "（说明"],
    ["~~", "del", "。说明"],
  ])(
    "keeps %s around a bare link in CJK prose through streaming completion",
    (marker, tag, tail) => {
      const url = "https://example.com/路径/版本";
      const markdown = `参见 ${marker}${url}${marker}${tail}`;
      const open = vi.fn();
      const view = render(message(markdown, true, open));
      for (const streaming of [true, false]) {
        view.rerender(message(markdown, streaming, open));
        const link = view.getByRole("button", { name: url });
        expect(link.closest(tag)?.textContent).toBe(url);
        expect(link.getAttribute("title")).toBe(encodeURI(url));
        expect(view.container.textContent).toBe(`参见 ${url}${tail}`);
        fireEvent.click(link);
        expect(open).toHaveBeenLastCalledWith(encodeURI(url));
      }
    },
  );

  it.each([true, false])(
    "preserves explicit, reference and Unicode destinations (streaming=%s)",
    (streaming) => {
      const withPunctuation = "https://example.com/版本。说明";
      const unicodePath = "https://example.com/文档/版本";
      const view = render(
        message(
          `> [文档]( ${withPunctuation} ) **https://example.com**（说明） [引用][manual]\n>\n> [manual]: ${withPunctuation}\n\n${unicodePath}`,
          streaming,
        ),
      );
      for (const name of ["文档", "引用"]) {
        expect(view.getByRole("button", { name }).getAttribute("title")).toBe(
          encodeURI(withPunctuation),
        );
      }
      expect(view.getByRole("button", { name: unicodePath }).getAttribute("title")).toBe(
        encodeURI(unicodePath),
      );
      expect(
        view.getByRole("button", { name: "https://example.com" }).closest("strong"),
      ).not.toBeNull();
    },
  );

  it.each([true, false])(
    "leaves escaped markers and multiline inline code literal (streaming=%s)",
    (streaming) => {
      const url = "https://example.com/版本";
      const view = render(
        message(
          `\\**${url}**（说明\n\n**${url}\\**（说明\n\n\`首行\n**${url}**。说明\``,
          streaming,
        ),
      );
      expect(view.container.querySelector("strong")).toBeNull();
      expect(view.container.querySelector("code")?.textContent).toBe(`首行 **${url}**。说明`);
      expect(view.getByRole("button", { name: `${url}**` }).getAttribute("title")).toBe(
        encodeURI(`${url}**`),
      );
    },
  );

  it("leaves unpaired underscores alone without blocking valid bold links in the same paragraph", () => {
    const view = render(
      message("latin__https://example.com/路径__。说明 **https://example.com/版本**。详情"),
    );
    expect(
      view.getByRole("button", { name: "https://example.com/路径__" }).closest("strong"),
    ).toBeNull();
    expect(
      view.getByRole("button", { name: "https://example.com/版本" }).closest("strong"),
    ).not.toBeNull();
  });

  it.each([true, false])(
    "copies the original code from a list-item fence (streaming=%s)",
    async (streaming) => {
      const code = "https://example.com/版本。说明\n**https://example.com**（不用改）";
      const writeText = vi.fn().mockResolvedValue(undefined);
      const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      try {
        const { getByRole } = render(
          message(`- \`\`\`text\n  ${code.replaceAll("\n", "\n  ")}\n  \`\`\``, streaming),
        );
        fireEvent.click(getByRole("button", { name: "Copy code" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledWith(code));
      } finally {
        if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
        else Reflect.deleteProperty(navigator, "clipboard");
      }
    },
  );
});

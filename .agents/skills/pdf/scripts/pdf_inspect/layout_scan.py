"""Scan the visual layout of a non-fillable PDF.

Walks each page with pdfplumber and emits a JSON document containing:

- ``pages``: page geometry (size in PDF points)
- ``glyphs``: every text run with its bounding box
- ``rules``: long horizontal lines (candidates for row separators)
- ``ticks``: small square rectangles likely to be checkboxes
- ``bands``: derived row boundaries (pairs of consecutive rule y-values)

Run from the skill root::

    python -m scripts.pdf_inspect.layout_scan input.pdf out.json \\
        --min-checkbox-px 5 --max-checkbox-px 15
"""

from __future__ import annotations

import json
import sys

import pdfplumber

from scripts.lib.cli_utils import emit, fail, make_parser


def scan_layout(
    src_pdf: str,
    *,
    min_checkbox_px: float = 5.0,
    max_checkbox_px: float = 15.0,
) -> dict:
    layout: dict = {
        "pages": [],
        "glyphs": [],
        "rules": [],
        "ticks": [],
        "bands": [],
    }

    with pdfplumber.open(src_pdf) as pdf:
        for page_no, page in enumerate(pdf.pages, 1):
            layout["pages"].append(
                {
                    "page_no": page_no,
                    "pdf_w": float(page.width),
                    "pdf_h": float(page.height),
                }
            )

            for word in page.extract_words():
                layout["glyphs"].append(
                    {
                        "page_no": page_no,
                        "text": word["text"],
                        "x0": round(float(word["x0"]), 1),
                        "top": round(float(word["top"]), 1),
                        "x1": round(float(word["x1"]), 1),
                        "bottom": round(float(word["bottom"]), 1),
                    }
                )

            for line in page.lines:
                if abs(float(line["x1"]) - float(line["x0"])) > page.width * 0.5:
                    layout["rules"].append(
                        {
                            "page_no": page_no,
                            "y": round(float(line["top"]), 1),
                            "x0": round(float(line["x0"]), 1),
                            "x1": round(float(line["x1"]), 1),
                        }
                    )

            for rect in page.rects:
                w = float(rect["x1"]) - float(rect["x0"])
                h = float(rect["bottom"]) - float(rect["top"])
                if (
                    min_checkbox_px <= w <= max_checkbox_px
                    and min_checkbox_px <= h <= max_checkbox_px
                    and abs(w - h) < 2
                ):
                    layout["ticks"].append(
                        {
                            "page_no": page_no,
                            "x0": round(float(rect["x0"]), 1),
                            "top": round(float(rect["top"]), 1),
                            "x1": round(float(rect["x1"]), 1),
                            "bottom": round(float(rect["bottom"]), 1),
                            "center_x": round(
                                (float(rect["x0"]) + float(rect["x1"])) / 2, 1
                            ),
                            "center_y": round(
                                (float(rect["top"]) + float(rect["bottom"])) / 2, 1
                            ),
                        }
                    )

    rules_by_page: dict[int, list[float]] = {}
    for rule in layout["rules"]:
        rules_by_page.setdefault(rule["page_no"], []).append(rule["y"])

    for page_no, rule_ys in rules_by_page.items():
        rule_ys = sorted(set(rule_ys))
        for i in range(len(rule_ys) - 1):
            layout["bands"].append(
                {
                    "page_no": page_no,
                    "row_top": rule_ys[i],
                    "row_bottom": rule_ys[i + 1],
                    "row_height": round(rule_ys[i + 1] - rule_ys[i], 1),
                }
            )

    return layout


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "layout_scan",
        "Extract glyphs / rules / checkboxes from a non-fillable PDF.",
    )
    parser.add_argument("src_pdf", help="Input PDF without AcroForm fields.")
    parser.add_argument("dst_json", help="Output JSON path.")
    parser.add_argument(
        "--min-checkbox-px",
        type=float,
        default=5.0,
        help="Minimum side length (PDF points) for a rect to count as a checkbox.",
    )
    parser.add_argument(
        "--max-checkbox-px",
        type=float,
        default=15.0,
        help="Maximum side length (PDF points) for a rect to count as a checkbox.",
    )
    args = parser.parse_args(argv)

    try:
        emit(f"Scanning layout of {args.src_pdf}...", quiet=args.quiet)
        layout = scan_layout(
            args.src_pdf,
            min_checkbox_px=args.min_checkbox_px,
            max_checkbox_px=args.max_checkbox_px,
        )
    except FileNotFoundError:
        fail(f"PDF not found: {args.src_pdf}", code=2)
    except Exception as exc:  # noqa: BLE001
        fail(f"Could not scan {args.src_pdf}: {exc}", code=2)

    with open(args.dst_json, "w") as handle:
        json.dump(layout, handle, indent=2)

    emit("Layout summary:", quiet=args.quiet)
    emit(f"  pages : {len(layout['pages'])}", quiet=args.quiet)
    emit(f"  glyphs: {len(layout['glyphs'])}", quiet=args.quiet)
    emit(f"  rules : {len(layout['rules'])}", quiet=args.quiet)
    emit(f"  ticks : {len(layout['ticks'])}", quiet=args.quiet)
    emit(f"  bands : {len(layout['bands'])}", quiet=args.quiet)
    emit(f"Saved to {args.dst_json}", quiet=args.quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Lay text on top of a non-fillable PDF using FreeText annotations.

Consumes the new-style ``fields.json`` produced by the operator (see
docs/forms-guide.md, "Overlay schema") and writes a new PDF with each
slot populated by a FreeText annotation. Coordinates can come from
either the PDF (``pdf_w``/``pdf_h``) or a rasterised image
(``img_w``/``img_h``); the script picks the right transform per page.

Run from the skill root::

    python -m scripts.fill.overlay_apply input.pdf fields.json out.pdf
"""

from __future__ import annotations

import json
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.annotations import FreeText

from scripts.lib.cli_utils import emit, fail, make_parser
from scripts.lib.geometry import image_box_to_pdf_rect, pdf_box_to_pypdf_rect


def apply_overlay_text(
    src_pdf: str,
    cfg_path: str,
    dst_pdf: str,
    *,
    quiet: bool = False,
) -> int:
    with open(cfg_path, "r") as handle:
        cfg = json.load(handle)

    pdf_doc = PdfReader(src_pdf)
    out_doc = PdfWriter()
    out_doc.append(pdf_doc)

    page_dim: dict[int, tuple[float, float]] = {}
    for idx, pg in enumerate(pdf_doc.pages):
        mb = pg.mediabox
        page_dim[idx + 1] = (float(mb.width), float(mb.height))

    written = 0
    for slot in cfg.get("slots", []):
        page_no = slot["page_no"]
        meta = next(p for p in cfg["pages"] if p["page_no"] == page_no)
        pdf_w, pdf_h = page_dim[page_no]

        if "pdf_w" in meta:
            pypdf_rect = pdf_box_to_pypdf_rect(slot["slot_box"], pdf_h)
        else:
            pypdf_rect = image_box_to_pdf_rect(
                slot["slot_box"],
                meta["img_w"],
                meta["img_h"],
                pdf_w,
                pdf_h,
            )

        glyph_spec = slot.get("value")
        if not glyph_spec or not glyph_spec.get("text"):
            continue
        text = glyph_spec["text"]
        face = glyph_spec.get("face", "Arial")
        size = f"{glyph_spec.get('size', 14)}pt"
        color = glyph_spec.get("color", "000000")

        annot = FreeText(
            text=text,
            rect=pypdf_rect,
            font=face,
            font_size=size,
            font_color=color,
            border_color=None,
            background_color=None,
        )
        out_doc.add_annotation(page_number=page_no - 1, annotation=annot)
        written += 1

    with open(dst_pdf, "wb") as handle:
        out_doc.write(handle)

    emit(f"Wrote overlaid PDF to {dst_pdf} ({written} annotations)", quiet=quiet)
    return written


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "overlay_apply",
        "Stamp text annotations onto a PDF based on a fields.json config.",
    )
    parser.add_argument("src_pdf", help="Input PDF (any kind).")
    parser.add_argument("cfg_path", help="fields.json config (new schema).")
    parser.add_argument("dst_pdf", help="Output PDF path.")
    args = parser.parse_args(argv)

    try:
        apply_overlay_text(args.src_pdf, args.cfg_path, args.dst_pdf, quiet=args.quiet)
    except FileNotFoundError as exc:
        fail(f"File not found: {exc.filename}", code=2)
    except KeyError as exc:
        fail(f"fields.json missing required key: {exc}", code=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

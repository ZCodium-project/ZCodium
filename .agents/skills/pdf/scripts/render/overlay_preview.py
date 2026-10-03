"""Draw bounding-box previews on top of a rasterised page.

Reads the new-style ``fields.json`` config (see docs/forms-guide.md
for the schema) and overlays each entry/tag rectangle onto a single
page image so the operator can eyeball the geometry before running
``scripts.fill.overlay_apply``.

Run from the skill root::

    python -m scripts.render.overlay_preview \\
        1 fields.json out_dir/page_1.png out_dir/page_1_overlay.png
"""

from __future__ import annotations

import json
import sys

from PIL import Image, ImageDraw

from scripts.lib.cli_utils import emit, fail, make_parser


def render_overlay_preview(
    page_no: int,
    cfg_path: str,
    base_img: str,
    out_img: str,
    *,
    quiet: bool = False,
) -> int:
    with open(cfg_path, "r") as handle:
        cfg = json.load(handle)

    canvas = Image.open(base_img)
    painter = ImageDraw.Draw(canvas)
    drawn_boxes = 0

    for slot in cfg.get("slots", []):
        if slot.get("page_no") != page_no:
            continue
        slot_box = slot.get("slot_box")
        tag_box = slot.get("tag_box")
        if slot_box:
            painter.rectangle(slot_box, outline="red", width=2)
            drawn_boxes += 1
        if tag_box:
            painter.rectangle(tag_box, outline="blue", width=2)
            drawn_boxes += 1

    canvas.save(out_img)
    emit(
        f"Rendered overlay preview to {out_img} ({drawn_boxes} boxes drawn)",
        quiet=quiet,
    )
    return drawn_boxes


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "overlay_preview",
        "Draw slot/tag bounding boxes on top of a rasterised page image.",
    )
    parser.add_argument("page_no", type=int, help="1-based page number.")
    parser.add_argument("cfg_path", help="Path to fields.json (new schema).")
    parser.add_argument("base_img", help="Input page PNG.")
    parser.add_argument("out_img", help="Output PNG with overlay drawn.")
    args = parser.parse_args(argv)

    try:
        render_overlay_preview(
            args.page_no,
            args.cfg_path,
            args.base_img,
            args.out_img,
            quiet=args.quiet,
        )
    except FileNotFoundError as exc:
        fail(f"File not found: {exc.filename}", code=2)
    except Exception as exc:  # noqa: BLE001
        fail(f"Overlay preview failed: {exc}", code=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

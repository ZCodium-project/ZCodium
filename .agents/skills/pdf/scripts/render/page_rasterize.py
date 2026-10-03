"""Rasterise PDF pages to PNG images.

Each page becomes ``page_<N>.png`` inside the destination directory.
Pages larger than ``--max-edge`` (in pixels along the longer side)
are downsampled with PIL before being written, which keeps the output
manageable for visual inspection.

Run from the skill root::

    python -m scripts.render.page_rasterize input.pdf out_dir/ \\
        --max-edge 1200 --dpi 200
"""

from __future__ import annotations

import os
import sys

from pdf2image import convert_from_path

from scripts.lib.cli_utils import emit, fail, make_parser


def rasterize(
    src_pdf: str,
    dst_dir: str,
    *,
    max_edge: int = 1000,
    dpi: int = 200,
    quiet: bool = False,
) -> int:
    os.makedirs(dst_dir, exist_ok=True)
    page_imgs = convert_from_path(src_pdf, dpi=dpi)

    for idx, img in enumerate(page_imgs):
        w, h = img.size
        if w > max_edge or h > max_edge:
            shrink = min(max_edge / w, max_edge / h)
            img = img.resize((int(w * shrink), int(h * shrink)))
        out_png = os.path.join(dst_dir, f"page_{idx + 1}.png")
        img.save(out_png)
        emit(f"  page {idx + 1} -> {out_png} ({img.size[0]}x{img.size[1]})", quiet=quiet)

    emit(f"Rasterised {len(page_imgs)} page(s) into {dst_dir}", quiet=quiet)
    return len(page_imgs)


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "page_rasterize",
        "Convert each PDF page into a PNG file under the output directory.",
    )
    parser.add_argument("src_pdf", help="Input PDF path.")
    parser.add_argument("dst_dir", help="Output directory for PNGs.")
    parser.add_argument(
        "--max-edge",
        type=int,
        default=1000,
        help="Cap the longer side (pixels). Set 0 to disable resizing.",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=200,
        help="Initial render resolution before optional resizing.",
    )
    args = parser.parse_args(argv)

    try:
        rasterize(
            args.src_pdf,
            args.dst_dir,
            max_edge=args.max_edge if args.max_edge > 0 else 10**9,
            dpi=args.dpi,
            quiet=args.quiet,
        )
    except FileNotFoundError:
        fail(f"PDF not found: {args.src_pdf}", code=2)
    except Exception as exc:  # noqa: BLE001
        fail(f"Rasterisation failed: {exc}", code=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

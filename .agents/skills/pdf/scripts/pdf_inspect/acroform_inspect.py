"""Dump AcroForm field metadata to JSON.

Reads a PDF that has fillable fields and writes a JSON array of
records ready for ``scripts.fill.acroform_apply``. The schema is
documented in docs/forms-guide.md (see "AcroForm metadata schema").

Run from the skill root::

    python -m scripts.pdf_inspect.acroform_inspect input.pdf out.json
"""

from __future__ import annotations

import json
import sys

from pypdf import PdfReader

from scripts.lib.acroform_io import enumerate_acroform_fields
from scripts.lib.cli_utils import emit, fail, make_parser


def dump_acroform_metadata(src_pdf: str, dst_json: str, *, quiet: bool = False) -> int:
    try:
        pdf_doc = PdfReader(src_pdf)
    except FileNotFoundError:
        fail(f"PDF not found: {src_pdf}", code=2)
    except Exception as exc:  # noqa: BLE001
        fail(f"Could not open {src_pdf}: {exc}", code=2)

    records = enumerate_acroform_fields(pdf_doc)
    with open(dst_json, "w") as handle:
        json.dump(records, handle, indent=2)
    emit(f"Wrote {len(records)} field records to {dst_json}", quiet=quiet)
    return len(records)


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "acroform_inspect",
        "Enumerate AcroForm fields and write them to JSON.",
    )
    parser.add_argument("src_pdf", help="Input PDF with fillable fields.")
    parser.add_argument("dst_json", help="Output JSON path.")
    args = parser.parse_args(argv)

    dump_acroform_metadata(args.src_pdf, args.dst_json, quiet=args.quiet)
    return 0


if __name__ == "__main__":
    sys.exit(main())

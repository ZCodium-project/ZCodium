"""Probe a PDF for AcroForm fields.

Prints a single line ``acroform=true`` or ``acroform=false`` so a
calling shell or another script can branch on the result. Exit code is
always 0 on success (whether or not the form exists); non-zero only if
the input cannot be opened.

Run from the skill root::

    python -m scripts.pdf_inspect.acroform_probe path/to/document.pdf
"""

from __future__ import annotations

import sys

from pypdf import PdfReader

from scripts.lib.cli_utils import emit, fail, make_parser


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "acroform_probe",
        "Detect whether a PDF carries AcroForm (fillable) fields.",
    )
    parser.add_argument("pdf_path", help="Path to the PDF to probe.")
    args = parser.parse_args(argv)

    try:
        pdf_doc = PdfReader(args.pdf_path)
    except FileNotFoundError:
        fail(f"PDF not found: {args.pdf_path}", code=2)
    except Exception as exc:  # noqa: BLE001  (pypdf raises a zoo of types)
        fail(f"Could not open {args.pdf_path}: {exc}", code=2)

    has_form = bool(pdf_doc.get_fields())
    # Always emit the machine-readable line, even in --quiet mode, so
    # downstream pipelines stay deterministic.
    print(f"acroform={'true' if has_form else 'false'}")
    if has_form:
        emit(
            "Hint: this PDF has fillable fields; use scripts.pdf_inspect.acroform_inspect "
            "next.",
            quiet=args.quiet,
        )
    else:
        emit(
            "Hint: this PDF has no fillable fields; you will need to lay text on "
            "top with scripts.fill.overlay_apply.",
            quiet=args.quiet,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Apply user-supplied values to AcroForm fields.

Reads the fillable PDF, validates the values against the schema
discovered by ``scripts.pdf_inspect.acroform_inspect``, and writes a new
PDF with the field values populated.

The value-config JSON is an array of records::

    [
      {
        "qname": "person.last_name",
        "page_no": 1,
        "set_to": "Simpson"
      },
      {
        "qname": "is_adult",
        "page_no": 1,
        "set_to": "/On"          # for checkboxes use the on_value
      }
    ]

Run from the skill root::

    python -m scripts.fill.acroform_apply input.pdf values.json output.pdf
"""

from __future__ import annotations

import json
import sys

from pypdf import PdfReader, PdfWriter

from scripts.lib.acroform_io import (
    enumerate_acroform_fields,
    patch_pypdf_inheritance,
)
from scripts.lib.cli_utils import emit, fail, make_parser


def value_violation(known_record: dict, supplied_value) -> str | None:
    field_type = known_record["type"]
    qname = known_record["qname"]
    if field_type == "checkbox":
        on = known_record["on_value"]
        off = known_record["off_value"]
        if supplied_value != on and supplied_value != off:
            return (
                f'ERROR: invalid value "{supplied_value}" for checkbox "{qname}". '
                f'Use on_value="{on}" or off_value="{off}".'
            )
    elif field_type == "radio_group":
        valid = [opt["set_to"] for opt in known_record["radio_choices"]]
        if supplied_value not in valid:
            return (
                f'ERROR: invalid value "{supplied_value}" for radio "{qname}". '
                f"Valid values: {valid}"
            )
    elif field_type == "choice":
        valid = [opt["set_to"] for opt in known_record["choice_options"]]
        if supplied_value not in valid:
            return (
                f'ERROR: invalid value "{supplied_value}" for choice "{qname}". '
                f"Valid values: {valid}"
            )
    return None


def apply_acroform_values(
    src_pdf: str,
    value_cfg: str,
    dst_pdf: str,
    *,
    quiet: bool = False,
) -> int:
    with open(value_cfg) as handle:
        supplied = json.load(handle)

    values_by_page: dict[int, dict[str, object]] = {}
    for entry in supplied:
        if "set_to" not in entry:
            continue
        page = entry["page_no"]
        values_by_page.setdefault(page, {})[entry["qname"]] = entry["set_to"]

    pdf_doc = PdfReader(src_pdf)
    record_by_qname = {r["qname"]: r for r in enumerate_acroform_fields(pdf_doc)}

    failed = False
    for entry in supplied:
        known_record = record_by_qname.get(entry["qname"])
        if not known_record:
            failed = True
            print(f"ERROR: `{entry['qname']}` is not a known field id")
            continue
        if entry["page_no"] != known_record["page_no"]:
            failed = True
            print(
                f"ERROR: page_no mismatch for `{entry['qname']}` "
                f"(supplied {entry['page_no']}, expected {known_record['page_no']})"
            )
            continue
        if "set_to" in entry:
            problem = value_violation(known_record, entry["set_to"])
            if problem:
                failed = True
                print(problem)

    if failed:
        sys.exit(1)

    out_doc = PdfWriter(clone_from=pdf_doc)
    for page_no, values in values_by_page.items():
        out_doc.update_page_form_field_values(
            out_doc.pages[page_no - 1],
            values,
            auto_regenerate=False,
        )
    out_doc.set_need_appearances_writer(True)

    with open(dst_pdf, "wb") as handle:
        out_doc.write(handle)

    emit(f"Wrote filled PDF to {dst_pdf}", quiet=quiet)
    return len(supplied)


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "acroform_apply",
        "Fill AcroForm fields using a JSON config and write a new PDF.",
    )
    parser.add_argument("src_pdf", help="Input fillable PDF.")
    parser.add_argument("value_cfg", help="JSON file describing the values to set.")
    parser.add_argument("dst_pdf", help="Output PDF path.")
    args = parser.parse_args(argv)

    patch_pypdf_inheritance()

    try:
        apply_acroform_values(
            args.src_pdf,
            args.value_cfg,
            args.dst_pdf,
            quiet=args.quiet,
        )
    except FileNotFoundError as exc:
        fail(f"File not found: {exc.filename}", code=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())

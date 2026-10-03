"""AcroForm metadata enumeration for the MiniMax PDF skill.

The functions here produce the JSON-shaped records that the
``inspect`` and ``fill`` script groups consume. The schema is:

    [
      {
        "qname": str,           # fully qualified field name
        "page_no": int,         # 1-based page number
        "box": [l, b, r, t],    # rectangle in PDF user space
        "type": "text" | "checkbox" | "radio_group" | "choice" | "unknown (...)",
        # type-specific extras:
        "on_value": str,        # checkbox: the value that ticks the box
        "off_value": str,       # checkbox: the value that unticks it
        "radio_choices": [...], # radio: [{"set_to": str, "box": [...]}]
        "choice_options": [...] # choice: [{"set_to": str, "label": str}]
      }
    ]

The qname is the dotted path of every ``/T`` from the leaf annotation
up to the root, joined with "." (so "address.line2" stays distinct
from "shipping.line2"). When pypdf cannot resolve the parent chain we
return ``None``.
"""

from __future__ import annotations

from typing import Any


def resolve_full_qualified_name(annot: Any) -> str | None:
    """Walk the ``/Parent`` chain of an annotation/field and join names."""
    parts: list[str] = []
    cursor = annot
    while cursor is not None:
        leaf = cursor.get("/T")
        if leaf:
            parts.append(leaf)
        cursor = cursor.get("/Parent")
    if not parts:
        return None
    return ".".join(reversed(parts))


def build_field_record(raw_field: Any, qname: str) -> dict:
    """Turn a pypdf field object into our JSON record (without box/page)."""
    record: dict = {"qname": qname}
    ft = raw_field.get("/FT")
    if ft == "/Tx":
        record["type"] = "text"
    elif ft == "/Btn":
        record["type"] = "checkbox"
        states = raw_field.get("/_States_", [])
        if len(states) == 2:
            if "/Off" in states:
                on = states[0] if states[0] != "/Off" else states[1]
                record["on_value"] = on
                record["off_value"] = "/Off"
            else:
                # Unusual two-state checkbox without an explicit /Off.
                # Fall back to positional guess and warn the caller.
                print(
                    f"WARN: checkbox `{qname}` has non-standard states "
                    f"{states}; verify the rendered PDF before relying on it."
                )
                record["on_value"] = states[0]
                record["off_value"] = states[1]
    elif ft == "/Ch":
        record["type"] = "choice"
        states = raw_field.get("/_States_", [])
        record["choice_options"] = [
            {"set_to": pair[0], "label": pair[1]} for pair in states
        ]
    else:
        record["type"] = f"unknown ({ft})"
    return record


def enumerate_acroform_fields(pdf_doc) -> list[dict]:
    """Return every fillable field in reading order, with location info.

    ``pdf_doc`` is a ``pypdf.PdfReader``. Fields without a resolvable
    page/box are skipped with a printed warning so a caller scanning the
    JSON output never sees half-populated records.
    """
    raw_fields = pdf_doc.get_fields() or {}

    record_by_qname: dict[str, dict] = {}
    candidate_radio_qnames: set[str] = set()

    for qname, field in raw_fields.items():
        if field.get("/Kids"):
            if field.get("/FT") == "/Btn":
                candidate_radio_qnames.add(qname)
            continue
        record_by_qname[qname] = build_field_record(field, qname)

    radio_groups_by_qname: dict[str, dict] = {}

    for page_index, pg in enumerate(pdf_doc.pages):
        for ann in pg.get("/Annots", []):
            qname = resolve_full_qualified_name(ann)
            if qname in record_by_qname:
                record_by_qname[qname]["page_no"] = page_index + 1
                record_by_qname[qname]["box"] = ann.get("/Rect")
            elif qname in candidate_radio_qnames:
                try:
                    on_states = [v for v in ann["/AP"]["/N"] if v != "/Off"]
                except KeyError:
                    continue
                if len(on_states) != 1:
                    continue
                box = ann.get("/Rect")
                if qname not in radio_groups_by_qname:
                    radio_groups_by_qname[qname] = {
                        "qname": qname,
                        "type": "radio_group",
                        "page_no": page_index + 1,
                        "radio_choices": [],
                    }
                radio_groups_by_qname[qname]["radio_choices"].append(
                    {"set_to": on_states[0], "box": box}
                )

    placed_records: list[dict] = []
    for record in record_by_qname.values():
        if "page_no" in record:
            placed_records.append(record)
        else:
            print(
                f"WARN: cannot place field `{record.get('qname')}`, "
                "skipping it in the output."
            )

    def reading_order_key(rec: dict):
        if "radio_choices" in rec:
            box = rec["radio_choices"][0]["box"] or [0, 0, 0, 0]
        else:
            box = rec.get("box") or [0, 0, 0, 0]
        # sort top-to-bottom (negative y so larger y first), then left-to-right
        return [rec.get("page_no"), [-box[1], box[0]]]

    ordered_records = placed_records + list(radio_groups_by_qname.values())
    ordered_records.sort(key=reading_order_key)
    return ordered_records


def patch_pypdf_inheritance() -> None:
    """Smooth over a pypdf quirk for choice fields.

    pypdf's ``DictionaryObject.get_inherited`` returns the raw ``/Opt``
    list which, for choice widgets that store ``[value, display]`` pairs,
    breaks downstream value validation. We unwrap the pair so callers see
    a flat list of valid values.
    """
    from pypdf.generic import DictionaryObject
    from pypdf.constants import FieldDictionaryAttributes

    original = DictionaryObject.get_inherited

    def patched(self, key: str, default=None):
        result = original(self, key, default)
        if key == FieldDictionaryAttributes.Opt:
            if isinstance(result, list) and all(
                isinstance(v, list) and len(v) == 2 for v in result
            ):
                result = [r[0] for r in result]
        return result

    DictionaryObject.get_inherited = patched

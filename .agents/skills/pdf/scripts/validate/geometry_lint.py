"""Lint bounding-box geometry inside a fields.json config.

Catches the two mistakes operators make most often when hand-editing
``fields.json``:

1. **Overlapping rectangles** (slot vs. slot, slot vs. tag, tag vs.
   tag), which cause text to land on top of other text.
2. **Slot boxes that are too short** for the configured font size,
   which clips glyphs.

The script returns exit code 0 only if no findings are produced.

Run from the skill root::

    python -m scripts.validate.geometry_lint fields.json --max-findings 20
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass

from scripts.lib.cli_utils import make_parser
from scripts.lib.geometry import boxes_overlap


@dataclass
class BoxRecord:
    bbox: list[float]
    kind: str            # "slot" or "tag"
    owner: dict          # the original slot dict


def _label_for(slot: dict) -> str:
    return slot.get("description") or slot.get("tag_text") or "<unnamed>"


def lint(cfg_path: str, max_findings: int = 20) -> tuple[bool, list[str]]:
    with open(cfg_path) as handle:
        cfg = json.load(handle)

    findings: list[str] = []
    findings.append(f"Read {len(cfg['slots'])} slots from {cfg_path}")

    boxes: list[BoxRecord] = []
    for slot in cfg["slots"]:
        if "tag_box" in slot:
            boxes.append(BoxRecord(slot["tag_box"], "tag", slot))
        if "slot_box" in slot:
            boxes.append(BoxRecord(slot["slot_box"], "slot", slot))

    failed = False

    # --- intersection scan ---
    for i, left in enumerate(boxes):
        for right in boxes[i + 1 :]:
            if left.owner["page_no"] != right.owner["page_no"]:
                continue
            if not boxes_overlap(left.bbox, right.bbox):
                continue
            failed = True
            if left.owner is right.owner:
                findings.append(
                    f"FAILURE: slot/tag overlap inside `{_label_for(left.owner)}`: "
                    f"{left.bbox} vs {right.bbox}"
                )
            else:
                findings.append(
                    f"FAILURE: {left.kind} of `{_label_for(left.owner)}` "
                    f"({left.bbox}) overlaps {right.kind} of "
                    f"`{_label_for(right.owner)}` ({right.bbox})"
                )
            if len(findings) >= max_findings:
                findings.append("Too many findings; aborting further checks.")
                return True, findings

    # --- height check ---
    for record in boxes:
        if record.kind != "slot":
            continue
        glyph_spec = record.owner.get("value")
        if not glyph_spec:
            continue
        glyph_pt = glyph_spec.get("size", 14)
        slot_h = record.bbox[3] - record.bbox[1]
        if slot_h < glyph_pt:
            failed = True
            findings.append(
                f"FAILURE: slot height {slot_h} for `{_label_for(record.owner)}` "
                f"is shorter than glyph size {glyph_pt}; either grow the box or "
                "shrink value.size."
            )
            if len(findings) >= max_findings:
                findings.append("Too many findings; aborting further checks.")
                return True, findings

    if not failed:
        findings.append("SUCCESS: all bounding boxes look sane.")
    return failed, findings


def main(argv: list[str] | None = None) -> int:
    parser = make_parser(
        "geometry_lint",
        "Validate bounding-box geometry inside a fields.json file.",
    )
    parser.add_argument("cfg_path", help="Path to fields.json.")
    parser.add_argument(
        "--max-findings",
        type=int,
        default=20,
        help="Stop reporting after this many findings (default 20).",
    )
    args = parser.parse_args(argv)

    failed, findings = lint(args.cfg_path, max_findings=args.max_findings)
    for line in findings:
        print(line)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

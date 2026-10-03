import argparse
import json
import sys
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def load_styles(path: Path) -> set[str]:
    with ZipFile(path, "r") as archive:
        try:
            xml_bytes = archive.read("word/styles.xml")
        except KeyError:
            return set()
    root = ET.fromstring(xml_bytes)
    style_ids = set()
    for style in root.findall(".//w:style", NS):
        style_id = style.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId") or style.get("styleId")
        if style_id:
            style_ids.add(style_id)
    return style_ids


def validate(template_path: Path, manifest_path: Path) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    style_ids = load_styles(template_path)
    required = manifest.get("style_requirements", {})
    missing = []
    for _, value in required.items():
        if isinstance(value, str) and value not in style_ids:
            missing.append(value)
    return {
        "template": str(template_path),
        "manifest": str(manifest_path),
        "ok": not missing,
        "missingStyleIds": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a DOCX template manifest against the template styles.")
    parser.add_argument("template_path")
    parser.add_argument("manifest_path")
    args = parser.parse_args()

    template_path = Path(args.template_path).expanduser().resolve()
    manifest_path = Path(args.manifest_path).expanduser().resolve()
    result = validate(template_path, manifest_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"validate_template_manifest.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
ANCHOR_RE = re.compile(r"@@[A-Z]+:[A-Za-z0-9_-]+@@")


def qn(name: str) -> str:
    return f"{{{NS['w']}}}{name}"


def load_document_xml(path: Path) -> ET.Element:
    with ZipFile(path, "r") as archive:
        with archive.open("word/document.xml") as handle:
            return ET.fromstring(handle.read())


def paragraph_text_nodes(paragraph: ET.Element):
    return paragraph.findall(".//w:t", NS)


def paragraph_location(index: int) -> str:
    return f"/word/document.xml#p[{index}]"


def analyze(path: Path) -> dict:
    root = load_document_xml(path)
    paragraphs = root.findall(".//w:body//w:p", NS)
    results = []

    for idx, paragraph in enumerate(paragraphs, start=1):
        text_nodes = paragraph_text_nodes(paragraph)
        full_text = "".join(node.text or "" for node in text_nodes)
        anchors = ANCHOR_RE.findall(full_text)
        if not anchors:
            continue

        for anchor in anchors:
            matching_nodes = []
            for node in text_nodes:
                node_text = node.text or ""
                if anchor in node_text:
                    matching_nodes.append(node)
            status = "ok" if len(matching_nodes) == 1 else "cross_run"
            results.append(
                {
                    "anchor": anchor,
                    "status": status,
                    "location": paragraph_location(idx),
                    "textNodeHits": len(matching_nodes),
                }
            )

    return {
        "file": str(path),
        "ok": all(item["status"] == "ok" for item in results),
        "anchors": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify that DOCX anchors are atomic within single w:t nodes.")
    parser.add_argument("input_path", help="Path to the .docx file")
    args = parser.parse_args()

    input_path = Path(args.input_path).expanduser().resolve()
    if not input_path.exists():
        raise RuntimeError(f"Input file does not exist: {input_path}")
    if input_path.suffix.lower() != ".docx":
        raise RuntimeError("verify_anchor_atomicity.py currently supports .docx only")

    result = analyze(input_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"verify_anchor_atomicity.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

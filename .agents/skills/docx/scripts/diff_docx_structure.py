import argparse
import json
import sys
from pathlib import Path

from read_docx_structure import analyze  # type: ignore


def diff(before: Path, after: Path) -> dict:
    left = analyze(before)
    right = analyze(after)
    return {
        "before": str(before),
        "after": str(after),
        "summary": {
            "paragraphDelta": right["summary"]["paragraphs"] - left["summary"]["paragraphs"],
            "tableDelta": right["summary"]["tables"] - left["summary"]["tables"],
            "imageDelta": right["summary"]["images"] - left["summary"]["images"],
            "sectionDelta": right["summary"]["sections"] - left["summary"]["sections"],
        },
        "structure": {
            "beforeSectionBreakTypes": left["structure"]["sectionBreakTypes"],
            "afterSectionBreakTypes": right["structure"]["sectionBreakTypes"],
            "beforeHeaderRefs": left["structure"]["headerReferences"],
            "afterHeaderRefs": right["structure"]["headerReferences"],
            "beforeFooterRefs": left["structure"]["footerReferences"],
            "afterFooterRefs": right["structure"]["footerReferences"],
        },
        "styles": {
            "beforeUsedParagraphStyles": left["styles"]["usedParagraphStyles"],
            "afterUsedParagraphStyles": right["styles"]["usedParagraphStyles"],
        },
        "annotations": {
            "before": left["annotations"],
            "after": right["annotations"],
        },
        "references": {
            "before": left["references"],
            "after": right["references"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Diff two DOCX files at the structure-summary level.")
    parser.add_argument("before")
    parser.add_argument("after")
    args = parser.parse_args()

    before = Path(args.before).expanduser().resolve()
    after = Path(args.after).expanduser().resolve()
    print(json.dumps(diff(before, after), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"diff_docx_structure.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize a lightweight DOCX edit request into a patch-plan shell.")
    parser.add_argument("instruction_json", help="Path to a JSON file containing an 'ops' array")
    args = parser.parse_args()

    instruction_path = Path(args.instruction_json).expanduser().resolve()
    payload = json.loads(instruction_path.read_text(encoding="utf-8"))
    result = {
        "source": str(instruction_path),
        "opCount": len(payload.get("ops", [])),
        "ops": payload.get("ops", []),
        "note": "This script validates and echoes a candidate patch plan shell. It does not mutate DOCX files.",
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"build_patch_plan.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

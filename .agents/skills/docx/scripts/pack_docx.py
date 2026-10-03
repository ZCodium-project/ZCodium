import argparse
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile


def main() -> int:
    parser = argparse.ArgumentParser(description="Pack a directory into a DOCX file.")
    parser.add_argument("input_dir")
    parser.add_argument("output_path")
    args = parser.parse_args()

    input_dir = Path(args.input_dir).expanduser().resolve()
    output_path = Path(args.output_path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with ZipFile(output_path, "w", compression=ZIP_DEFLATED) as archive:
        for path in sorted(input_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(input_dir))

    print(f"Packed {input_dir} -> {output_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"pack_docx.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

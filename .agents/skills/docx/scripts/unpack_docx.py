import argparse
import sys
from pathlib import Path
from zipfile import ZipFile


def main() -> int:
    parser = argparse.ArgumentParser(description="Unpack a DOCX file into a directory.")
    parser.add_argument("input_path")
    parser.add_argument("output_dir")
    args = parser.parse_args()

    input_path = Path(args.input_path).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    with ZipFile(input_path, "r") as archive:
        archive.extractall(output_dir)

    print(f"Unpacked {input_path} -> {output_dir}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"unpack_docx.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

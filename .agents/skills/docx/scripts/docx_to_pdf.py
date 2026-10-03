import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Optional, Sequence


def find_tool(*names: str) -> Optional[str]:
    for name in names:
        resolved = shutil.which(name)
        if resolved:
            return resolved
    return None


def run_checked(command: Sequence[str]) -> None:
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace").strip()
        detail = f"{' '.join(command)} exited with status {exc.returncode}"
        if stderr:
            detail = f"{detail}: {stderr}"
        raise RuntimeError(detail) from exc


def convert_to_pdf(input_path: Path, output_path: Path) -> None:
    office = find_tool("soffice", "libreoffice")
    if not office:
        raise RuntimeError("Missing LibreOffice executable (soffice/libreoffice)")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_pdf = output_path.parent / f"{input_path.stem}.pdf"
    if temp_pdf.exists():
        temp_pdf.unlink()
    if output_path.exists() and output_path != temp_pdf:
        output_path.unlink()

    with tempfile.TemporaryDirectory(prefix="docx-lo-profile-") as profile_dir:
        command = [
            office,
            f"-env:UserInstallation=file://{profile_dir}",
            "--headless",
            "--invisible",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(output_path.parent),
            str(input_path),
        ]
        run_checked(command)

    if not temp_pdf.exists():
        raise RuntimeError(f"LibreOffice did not produce {temp_pdf.name}")

    if temp_pdf != output_path:
        temp_pdf.replace(output_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert a DOCX file into a rendered PDF via LibreOffice.")
    parser.add_argument("--input", required=True, help="Path to the input .docx file")
    parser.add_argument("--output", required=True, help="Path to the output .pdf file")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not input_path.exists():
        raise RuntimeError(f"Input file does not exist: {input_path}")
    if input_path.suffix.lower() != ".docx":
        raise RuntimeError("docx_to_pdf.py currently supports .docx only")

    convert_to_pdf(input_path, output_path)
    print(f"Wrote {output_path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"docx_to_pdf.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

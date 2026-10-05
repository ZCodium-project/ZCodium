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
        command_text = " ".join(command)
        detail = f"{command_text} exited with status {exc.returncode}"
        if stderr:
            detail = f"{detail}: {stderr}"
        raise RuntimeError(detail) from exc


def convert_to_pdf(input_path: Path, output_dir: Path) -> Path:
    office = find_tool("soffice", "libreoffice")
    if not office:
        raise RuntimeError("Missing LibreOffice executable (soffice/libreoffice)")
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
            str(output_dir),
            str(input_path),
        ]
        run_checked(command)

    pdf_path = output_dir / f"{input_path.stem}.pdf"
    if not pdf_path.exists():
        raise RuntimeError(f"LibreOffice did not produce {pdf_path.name}")
    return pdf_path


def normalize_rendered_pages(render_dir: Path) -> None:
    generated = sorted(render_dir.glob("page-*.png"))
    if not generated:
        raise RuntimeError("Render command finished without producing any page PNGs")

    for index, image_path in enumerate(generated, start=1):
        target = render_dir / f"page-{index}.png"
        if image_path != target:
            image_path.replace(target)


def clear_output_pages(output_dir: Path) -> None:
    for image_path in output_dir.glob("page-*.png"):
        image_path.unlink()


def publish_rendered_pages(render_dir: Path, output_dir: Path) -> None:
    clear_output_pages(output_dir)
    generated = sorted(render_dir.glob("page-*.png"))
    if not generated:
        raise RuntimeError("No rendered page PNGs were available to publish")

    for image_path in generated:
        image_path.replace(output_dir / image_path.name)


def render_pdf_pages(pdf_path: Path, render_dir: Path, dpi: int) -> None:
    pdftoppm = find_tool("pdftoppm")
    if not pdftoppm:
        raise RuntimeError("Missing pdftoppm")
    prefix = render_dir / "page"
    command = [
        pdftoppm,
        "-r",
        str(dpi),
        "-png",
        str(pdf_path),
        str(prefix),
    ]
    run_checked(command)

    normalize_rendered_pages(render_dir)


def render_full_fidelity(input_path: Path, output_dir: Path, dpi: int) -> None:
    with tempfile.TemporaryDirectory(prefix="docx-render-") as temp_dir:
        render_dir = Path(temp_dir)
        pdf_path = convert_to_pdf(input_path, render_dir)
        render_pdf_pages(pdf_path, render_dir, dpi)
        publish_rendered_pages(render_dir, output_dir)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a Word-style document into page PNGs.")
    parser.add_argument("input_path", help="Path to the input .docx/.doc/.rtf/.odt file")
    parser.add_argument(
        "--output-dir",
        required=True,
        help="Directory for rendered page images",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=150,
        help="Rasterization DPI for generated PNG pages when pdftoppm is available",
    )
    args = parser.parse_args()

    input_path = Path(args.input_path).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_path.exists():
        raise RuntimeError(f"Input file does not exist: {input_path}")

    office = find_tool("soffice", "libreoffice")
    pdftoppm = find_tool("pdftoppm")
    if not office:
        raise RuntimeError("Missing LibreOffice executable (soffice/libreoffice)")
    if not pdftoppm:
        raise RuntimeError("Missing pdftoppm; full-fidelity page rendering cannot proceed")

    render_full_fidelity(input_path, output_dir, args.dpi)
    print(f"Rendered {input_path.name} to {output_dir} using libreoffice+pdftoppm")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"render_docx_pages.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

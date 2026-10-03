#!/usr/bin/env python3
"""read_pdf_vision.py — image-vision PDF read via native Matrix tools.

Renders selected pages with pdf2image (poppler), stitches them vertically into
≤ --max-bytes images (3 MB default; page-count uncapped), then sends each
chunk to the Matrix `images_understand` tool via the local runtime's HTTP API
(POST /mavis/api/matrix/tool/call). Internal chunking is hidden from the caller —
just pick pages.

This is the only wrapped read script in pdf: vision needs page
rendering, byte-budget chunking, and HTTP plumbing that don't fit in a
cookbook recipe. Other read scenarios (text / tables / coordinates /
raster / decrypt / metadata) live as inline recipes in docs/read-guide.md.

Usage (run from the pdf skill root):
    python3 -m scripts.read_pdf_vision --input file.pdf [--pages 1-20]
                                       [--dpi 150] [--max-bytes 3000000]
                                       [--prompt "..."] [--keep-tmp DIR]
                                       [--json] [--max-stdout-bytes N]

Dependencies (all `pip3 install --user`):
  - pdf2image (also needs `brew install poppler` for the pdftoppm backend)
  - Pillow

Local runtime must be running with authenticated native Matrix tools; the script
reads __MAVIS_RUNTIME_PORT first, then the active MiniMax Code data directory's daemon.port file
name (fallback 5321).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

from scripts._pdf_read_lib import (
    add_common_args,
    cache_dir,
    die,
    emit,
    format_pages,
    info,
    resolve_input_or_exit,
    resolve_pages_or_exit,
    to_ranges,
    warn,
)

try:
    from pdf2image import convert_from_path  # type: ignore
except ImportError:
    die("pdf2image not installed. Install: pip3 install --user pdf2image (and brew install poppler)")

try:
    from PIL import Image  # type: ignore
except ImportError:
    die("Pillow not installed. Install: pip3 install --user pillow")

DEFAULT_DPI = 150
FALLBACK_DPI = 100
DEFAULT_MAX_BYTES = 3_000_000
DEFAULT_PROMPT = (
    "请把这张图里的全部文字按阅读顺序输出，保留段落、列表、表格等结构。"
    "如有图表请简要描述。"
)
VISION_TOOL = "images_understand"
CALL_TIMEOUT_SEC = 1500


def _safe_tmp_root() -> Path:
    env_tmp = os.environ.get("TMPDIR", "")
    if env_tmp and not env_tmp.startswith("/tmp"):
        return Path(env_tmp)
    return cache_dir().parent  # ~/.cache/mavis/


def _runtime_port() -> int:
    if env := os.environ.get("__MAVIS_RUNTIME_PORT"):
        try:
            return int(env)
        except ValueError:
            pass
    data_dir = Path(
        os.environ.get("__MAVIS_RUNTIME_DATA_DIR")
        or os.environ.get("__MAVIS_PARENT_DATA_DIR")
        or os.environ.get("MINIMAX_DATA_DIR")
        or str(Path.home() / ".minimax")
    )
    port_file = data_dir / "daemon.port"
    if port_file.is_file():
        try:
            return int(port_file.read_text(encoding="utf-8").strip())
        except ValueError:
            pass
    return 5321


def _runtime_call_matrix_tool(tool: str, args: dict) -> dict:
    url = f"http://127.0.0.1:{_runtime_port()}/mavis/api/matrix/tool/call"
    body = json.dumps(
        {
            "tool": tool,
            "arguments": args,
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=CALL_TIMEOUT_SEC) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            payload = e.read().decode("utf-8", errors="ignore")
        except Exception:
            payload = ""
        die(f"Local runtime error (HTTP {e.code}): {payload[:500]}")
    except urllib.error.URLError as e:
        die(
            f"Cannot connect to local runtime at port {_runtime_port()}: {e.reason}. "
            f"Restart the MiniMax Code app, or set __MAVIS_RUNTIME_PORT to the runtime port."
        )


def _extract_envelope_text(tool_result: dict) -> tuple[str, bool]:
    """matrix biz-gateway wraps the LLM output as a JSON envelope inside the
    single text content item:
        { code: 0, message: "ok", results: [{ description, success, error }, ...] }
    Unwrap to per-image descriptions; fall back to raw text otherwise."""
    if tool_result.get("success") is False:
        return f"[error] {tool_result.get('error', 'local Matrix route failed')}", True

    result = tool_result.get("result") if isinstance(tool_result.get("result"), dict) else tool_result
    is_error = bool(result.get("isError"))
    details = result.get("details") if isinstance(result.get("details"), dict) else {}
    if details.get("ok") is False:
        is_error = True

    pieces: list[str] = []
    for item in result.get("content") or []:
        if item.get("type") != "text" or not isinstance(item.get("text"), str):
            continue
        raw = item["text"]
        try:
            env = json.loads(raw)
        except (ValueError, TypeError):
            pieces.append(raw)
            continue
        if not isinstance(env, dict) or not isinstance(env.get("results"), list):
            pieces.append(raw)
            continue
        if env.get("code", 0) != 0:
            pieces.append(f"[envelope code={env.get('code')} {env.get('message','')}] {raw}")
            continue
        for r in env["results"]:
            if r.get("success") is False or (r.get("error") or ""):
                pieces.append(f"[error] {r.get('error','unknown')}")
            elif isinstance(r.get("description"), str):
                pieces.append(r["description"])
    if is_error and not pieces:
        fallback = result.get("text") if isinstance(result.get("text"), str) else ""
        pieces.append(f"[error] {fallback or 'Matrix vision tool failed'}")
    return "\n\n".join(pieces), is_error


def _render(pdf: Path, pages: list[int], dpi: int, tmp_root: Path) -> list[tuple[int, Image.Image, int]]:
    """Render selected pages → list of (page_num, PIL Image, png_bytes)."""
    rendered: list[tuple[int, Image.Image, int]] = []
    for lo, hi in to_ranges(pages):
        # pdf2image numbers from `first_page`; results length == hi - lo + 1
        imgs = convert_from_path(
            str(pdf),
            dpi=dpi,
            first_page=lo,
            last_page=hi,
            fmt="png",
            output_folder=str(tmp_root),
            paths_only=False,
        )
        for i, img in enumerate(imgs):
            page_num = lo + i
            buf = io.BytesIO()
            img.save(buf, format="PNG", optimize=False)
            rendered.append((page_num, img, len(buf.getvalue())))
    return rendered


def _stitch(images: list[Image.Image]) -> tuple[Image.Image, bytes, int]:
    """Vertically stitch a list of PIL images. Returns (stitched_image, png_bytes, byte_size)."""
    if len(images) == 1:
        only = images[0]
        buf = io.BytesIO()
        only.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        return only, data, len(data)
    target_w = max(img.width for img in images)
    total_h = sum(img.height for img in images)
    stitched = Image.new("RGB", (target_w, total_h), color=(255, 255, 255))
    y = 0
    for img in images:
        # Paste left-aligned (anchor x=0).
        stitched.paste(img.convert("RGB"), (0, y))
        y += img.height
    buf = io.BytesIO()
    stitched.save(buf, format="PNG", optimize=True)
    data = buf.getvalue()
    return stitched, data, len(data)


def _stitch_and_grow(
    rendered: list[tuple[int, Image.Image, int]],
    max_bytes: int,
) -> tuple[list[dict], list[int]]:
    """Pack pages into byte-bounded chunks via measure-then-grow.

    Returns:
      chunks: [{pages, buffer (bytes), width, height, bytes}, ...]
      oversize_indices: chunk indices whose stitched PNG still > max_bytes
    """
    chunks: list[dict] = []
    oversize_indices: list[int] = []
    i = 0
    n = len(rendered)
    while i < n:
        count = 1
        imgs = [rendered[i][1]]
        stitched_img, data, sz = _stitch(imgs)
        if sz > max_bytes:
            # Single page over budget — accept alone and warn.
            chunks.append(
                {
                    "pages": [rendered[i][0]],
                    "buffer": data,
                    "width": stitched_img.width,
                    "height": stitched_img.height,
                    "bytes": sz,
                }
            )
            oversize_indices.append(len(chunks) - 1)
            i += 1
            continue
        # Greedy grow.
        while i + count < n:
            trial_imgs = imgs + [rendered[i + count][1]]
            trial_img, trial_data, trial_sz = _stitch(trial_imgs)
            if trial_sz > max_bytes:
                break
            imgs = trial_imgs
            stitched_img = trial_img
            data = trial_data
            sz = trial_sz
            count += 1
        chunks.append(
            {
                "pages": [rendered[i + k][0] for k in range(count)],
                "buffer": data,
                "width": stitched_img.width,
                "height": stitched_img.height,
                "bytes": sz,
            }
        )
        i += count
    return chunks, oversize_indices


def _downscale_oversize(
    pdf: Path,
    rendered: list[tuple[int, Image.Image, int]],
    max_bytes: int,
    tmp_root: Path,
) -> list[tuple[int, Image.Image, int]]:
    """Re-render any single page that exceeds max_bytes at FALLBACK_DPI."""
    out: list[tuple[int, Image.Image, int]] = []
    for n, img, sz in rendered:
        if sz <= max_bytes:
            out.append((n, img, sz))
            continue
        warn(f"page {n} {sz} bytes > {max_bytes}; re-rendering at {FALLBACK_DPI} DPI")
        re_imgs = convert_from_path(
            str(pdf),
            dpi=FALLBACK_DPI,
            first_page=n,
            last_page=n,
            fmt="png",
            output_folder=str(tmp_root),
            paths_only=False,
        )
        if not re_imgs:
            die(f"failed to re-render page {n}")
        re_img = re_imgs[0]
        buf = io.BytesIO()
        re_img.save(buf, format="PNG", optimize=False)
        out.append((n, re_img, len(buf.getvalue())))
    return out


def _dump_keep_tmp(
    keep_dir: Path,
    rendered: list[tuple[int, Image.Image, int]],
    chunks: list[dict],
) -> None:
    keep_dir.mkdir(parents=True, exist_ok=True)
    for n, img, _ in rendered:
        img.save(keep_dir / f"page_{n:04d}.png", format="PNG")
    for i, c in enumerate(chunks, 1):
        first, last = c["pages"][0], c["pages"][-1]
        (keep_dir / f"chunk_{i:02d}_p{first:04d}-p{last:04d}.png").write_bytes(c["buffer"])


def main() -> None:
    p = argparse.ArgumentParser(
        description="Image-vision PDF read via native Matrix tools (calls local-runtime HTTP).",
    )
    add_common_args(p)
    p.add_argument(
        "--dpi", type=int, default=DEFAULT_DPI, help=f"Render DPI (default {DEFAULT_DPI})."
    )
    p.add_argument(
        "--max-bytes",
        type=int,
        default=DEFAULT_MAX_BYTES,
        help=f"Per-chunk byte budget (default {DEFAULT_MAX_BYTES}).",
    )
    p.add_argument(
        "--prompt",
        default=DEFAULT_PROMPT,
        help="Prompt sent to the native Matrix vision per chunk.",
    )
    p.add_argument(
        "--keep-tmp",
        default=None,
        help="Persist intermediate page/chunk PNGs to this directory (debug).",
    )
    args = p.parse_args()

    if shutil.which("pdftoppm") is None:
        die("'pdftoppm' (poppler) not found. Install: brew install poppler")

    pdf_path = resolve_input_or_exit(args.input)

    # Probe the PDF with pdfinfo *before* anything heavy — this is the
    # double-safety net: page count, encryption status, and a corrupt-PDF
    # detector that runs in milliseconds. Downstream code (page clamping,
    # render budgeting) depends on `total_pages` being trustworthy.
    if shutil.which("pdfinfo") is None:
        die("'pdfinfo' (poppler) not found. Install: brew install poppler")
    try:
        out = subprocess.check_output(
            ["pdfinfo", str(pdf_path)], stderr=subprocess.STDOUT
        ).decode("utf-8", errors="ignore")
    except subprocess.CalledProcessError as e:
        err_tail = (e.output or b"").decode("utf-8", errors="ignore").strip()[-300:]
        die(
            f"pdfinfo failed on {pdf_path} (exit {e.returncode}). "
            f"PDF may be corrupt or password-protected. pdfinfo said: {err_tail}"
        )
    except FileNotFoundError:
        die("'pdfinfo' (poppler) not found. Install: brew install poppler")

    total_pages = next(
        (int(line.split(":", 1)[1].strip()) for line in out.splitlines() if line.startswith("Pages:")),
        0,
    )
    if total_pages == 0:
        die(f"Could not determine page count for {pdf_path} (pdfinfo output had no 'Pages:' line)")
    info(f"PDF probe: {total_pages} page(s) total")

    selected = resolve_pages_or_exit(args.pages, total_pages)

    tmp_root = _safe_tmp_root()
    tmp_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="pdf-vis-", dir=tmp_root) as tmp:
        info(f"Rendering {len(selected)} page(s) at {args.dpi} DPI…")
        rendered = _render(pdf_path, selected, args.dpi, Path(tmp))
        rendered = _downscale_oversize(pdf_path, rendered, args.max_bytes, Path(tmp))

        info("Stitching pages into chunks…")
        chunks, oversize_idx = _stitch_and_grow(rendered, args.max_bytes)
        info(f"Built {len(chunks)} chunk(s)")
        if oversize_idx:
            warn(
                f"{len(oversize_idx)} chunk(s) still exceed {args.max_bytes} bytes; "
                f"Matrix vision may reject them."
            )

        if args.keep_tmp:
            _dump_keep_tmp(Path(args.keep_tmp), rendered, chunks)

        chunk_results: list[dict] = []
        for i, c in enumerate(chunks, 1):
            span = format_pages(c["pages"])
            info(f"Vision chunk {i}/{len(chunks)} (pages {span}, {c['bytes']} bytes)…")
            tool_args = {
                "image_info": [
                    {
                        "data": base64.b64encode(c["buffer"]).decode("ascii"),
                        "mime_type": "image/png",
                        "prompt": args.prompt,
                    }
                ]
            }
            tool_result = _runtime_call_matrix_tool(VISION_TOOL, tool_args)
            text, is_err = _extract_envelope_text(tool_result)
            chunk_results.append(
                {
                    "pages": c["pages"],
                    "sizeBytes": c["bytes"],
                    "width": c["width"],
                    "height": c["height"],
                    "text": text,
                    "isError": is_err,
                }
            )
            info(f"chunk {i}/{len(chunks)} done{' (isError)' if is_err else ''}")
            if is_err and re.search(r"\b(502|413)\b|Bad Gateway|payload too large", text, re.I):
                warn(
                    f"chunk {i} got an upstream gateway error. "
                    f"This usually means the stitched image is too large for Matrix vision. "
                    f"Retry with smaller chunks: --max-bytes 2000000 (or 1500000), "
                    f"or narrow --pages, or lower --dpi (current {args.dpi})."
                )

    result = {
        "mode": "vision",
        "file": str(pdf_path),
        "pageCount": total_pages,
        "selectedPages": selected,
        "dpi": args.dpi,
        "chunks": chunk_results,
    }

    if args.json:
        emit(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            "json",
            args.max_stdout_bytes,
        )
        return

    sel_spec = format_pages(selected)
    out_lines: list[str] = [
        f"# {pdf_path.name}",
        "",
        f"> {total_pages} pages • selected {sel_spec} • {len(chunk_results)} vision chunk(s) @ {args.dpi} DPI",
        "",
    ]
    for i, c in enumerate(chunk_results, 1):
        out_lines.append(f"## Chunk {i}/{len(chunk_results)} — pages {format_pages(c['pages'])}")
        out_lines.append("")
        if c["isError"]:
            out_lines.append("> ⚠️ vision returned isError=true; output may be incomplete.")
        out_lines.append(c["text"] or "_(empty response)_")
        out_lines.append("")
        out_lines.append("---")
        out_lines.append("")
    emit("\n".join(out_lines), "md", args.max_stdout_bytes)


if __name__ == "__main__":
    main()

# vision-guide — `read_pdf_vision.py` reference

> **Read this first — `read_pdf_vision.py` is a fallback, not the default vision path.** The script
> ships rendered pages to native Matrix vision because text-only models (e.g. M2.7) cannot see
> images themselves. **If the model running this skill is multimodal / vision-capable (e.g. M3), you
> do not need this script at all:** rasterise the target page(s) to PNG (read-guide §3.2 `pypdfium2`
> / `pdftoppm`, or `scripts/render/page_rasterize.py`) and read the PNG(s) directly with the Read
> tool — faster, offline, and no upstream LLM call. Use `read_pdf_vision.py` only on a text-only
> model, or when native page reading is unavailable. Everything below describes that fallback.

> Detailed reference for the only in-skill wrapped read route — `read_pdf_vision.py`, which exposes
> MiniMax's native Matrix vision via local-runtime. All other read scenarios (text / tables /
> coordinates / raster / decrypt / metadata) are cookbook recipes in [`SKILL.md`](../SKILL.md) §3-§4
> and §7. There is no wrapped script for them — pdfplumber, pypdfium2, poppler, and qpdf are called
> directly from a few lines of Python or shell.

## Why a script instead of a recipe

`vision` cannot be expressed as a one-liner: it has to render selected pages with poppler /
pdf2image, pack them into multi-page chunks under a per-request byte ceiling (Matrix vision rejects
images larger than ~5 MB), POST each chunk to the local-runtime, and concatenate the descriptions
back. The chunking, spill-to-disk rule, and JSON envelope unwrap are too much to ask the LLM to
re-derive every time. Hence the wrapped script.

## Command

```bash
python3 -m scripts.read_pdf_vision --input file.pdf [opts]
```

Run from the `pdf` skill root (where `scripts/` lives) so the `scripts` package is importable.

## Common parameters

| Argument                 | Purpose                                                                                                                                                                                                                                                            | Default  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `--input <path>`         | Path to the PDF (required)                                                                                                                                                                                                                                         | —        |
| `--pages <spec>`         | Page range: `1-20` / `1,3,5` / `1-3,7,10-15` / `all`. Out-of-range pages are silently dropped with a stderr warning — e.g. `--pages 1-50` on a 26-page PDF runs on 1-26 and warns about 27-50. The script aborts only if **every** requested page is past the end. | `all`    |
| `--json`                 | Emit structured JSON instead of Markdown                                                                                                                                                                                                                           | Markdown |
| `--max-stdout-bytes <n>` | Spill outputs larger than `n` bytes to `~/.cache/mavis/pdf-out/<hash>.{md,json}` and return only a preview + path. `0` disables spilling and writes the full output to stdout.                                                                                     | `2048`   |

## Mode-specific arguments

| Argument           | Purpose                                                               | Default   |
| ------------------ | --------------------------------------------------------------------- | --------- |
| `--dpi <n>`        | Page-to-PNG render DPI                                                | `150`     |
| `--max-bytes <n>`  | Per-chunk byte ceiling (default ~3 MB; upstream nginx caps near 5 MB) | `3000000` |
| `--prompt <text>`  | Custom vision prompt                                                  | see below |
| `--keep-tmp <dir>` | Keep intermediate page / chunk PNGs for debugging                     | —         |

Default prompt (in Chinese, baked into the script):

> Please output every piece of text in this image in reading order while preserving paragraphs,
> lists, and tables. Briefly describe any charts.

## Internal chunking (transparent to the model)

1. `pdf2image` renders the selected pages to PNGs (poppler / pdftoppm backend).
2. **Stitch-and-grow:** assemble one image, measure its true byte size, append the next page if
   there is room, roll back one page on overflow. Each chunk sits as close to `--max-bytes` as
   possible.
3. Multi-page chunks are stitched vertically with PIL (no page cap; only bytes).
4. A single page that already exceeds the limit is re-rendered at 100 DPI.
5. Each chunk produces one native `images_understand` call
   (`POST http://127.0.0.1:5321/mavis/api/matrix/tool/call`); results are concatenated.
6. The envelope `{code, results: [{description, ...}]}` is unwrapped to the description text
   automatically.

## Time budget

| Page count | Typical runtime | Suggested caller timeout |
| ---------- | --------------- | ------------------------ |
| 5 pages    | 30 s – 1 min    | 3 min                    |
| 10 pages   | ~1 min          | 5 min                    |
| 30 pages   | 3 – 5 min       | 10 min                   |
| 50 pages   | 5 – 8 min       | 15 min                   |
| 100 pages  | 10 – 15 min     | 25 min                   |

The script applies its own 25-minute per-chunk timeout, but the **outer caller** (bash / agent
harness) must also raise its timeout — the default 2-minute bash timeout will cut a long run in
half. For 100+ pages, batch with `--pages 1-30`, `--pages 31-60`, etc., and call the script once per
batch.

## Error handling

| Error                                                     | Meaning                                          | Action                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `502 Bad Gateway` / `413 payload too large`               | Upstream nginx rejected the stitched image       | Add `--max-bytes 2000000` (or 1500000), shrink `--pages`, drop to `--dpi 100`                                           |
| `gemini analysis failed` / `unexpected end of JSON input` | Transient upstream LLM hiccup                    | Retry the same command unchanged                                                                                        |
| `Cannot connect to local runtime at port 5321`            | Local runtime is down or the port could not be discovered | Restart the MiniMax Code app; if the runtime is up, pass the port explicitly via `__MAVIS_RUNTIME_PORT` |
| `auth failed` / `401`                                     | Matrix backend token expired or environment mismatch | Verify the managed login token matches the managed Matrix host, or set `MATRIX_TOKEN` for a custom `MATRIX_BASE_URL`     |

The script also prints a one-line stderr hint on 502 / 413 so the model does not need to consult
this guide first.

## Dependencies

```bash
pip3 install --user pdf2image pillow
brew install poppler        # pdftoppm (pdf2image backend) + pdfinfo
```

Runtime side: managed Matrix hosts use the Mavis login token. For a custom `MATRIX_BASE_URL`, set
`MATRIX_TOKEN` in the runtime environment, then restart the MiniMax Code app so local-runtime picks it up.

## Output spill (preventing context blow-up)

**Default:** when the output exceeds 2 KB, the script does NOT print the full text to stdout.
Instead it:

1. Writes the full content to `~/.cache/mavis/pdf-out/<sha256-prefix>.{md,json}` (named by content
   hash so identical outputs reuse the same file).
2. Returns the first 2 KB as a preview plus the absolute path on stdout.
3. Lets the model decide what to do next:
   - Read the whole file: `cat ~/.cache/mavis/pdf-out/abc...md`
   - Search for something specific: `grep -i "keyword" ~/.cache/mavis/pdf-out/abc...md`
   - Re-extract a narrower range: `python3 -m scripts.read_pdf_vision --input <file> --pages 14-18`

**Markdown mode** prepends the preview with:

```markdown
<!-- mavis-pdf: output truncated, full text spilled to disk -->

> Full output: 12,345 bytes -> /Users/.../<hash>.md Showing first 2,048 bytes below. Read the file
> with `cat` / `grep`, or re-run with narrower `--pages`.
```

**JSON mode** wraps the spilled output:

```json
{
  "truncated": true,
  "totalBytes": 12345,
  "outputFile": "/Users/.../<hash>.json",
  "previewBytes": 2048,
  "preview": "..."
}
```

**Disable truncation** (full output to stdout): `--max-stdout-bytes 0`. **Adjust threshold:**
`--max-stdout-bytes 8192`, etc.

## JSON output schema

```jsonc
{
  "mode": "vision",
  "file": "/abs/path.pdf",
  "pageCount": 18,
  "selectedPages": [1, 2, ..., 18],
  "dpi": 150,
  "chunks": [
    {
      "pages": [1, 2, ..., 7],
      "sizeBytes": 2870055,
      "width": 1241,
      "height": 12278,
      "text": "...",
      "isError": false
    }
  ]
}
```

When truncated by `--max-stdout-bytes`, stdout returns the wrapper:

```jsonc
{
  "truncated": true,
  "totalBytes": 12345,
  "outputFile": "/Users/.../<hash>.json",
  "previewBytes": 2048,
  "preview": "...", // first 2 KB of the full JSON above; trailing bytes may be invalid JSON
}
```

## Shared helper module

`scripts/_pdf_read_lib.py` — helpers used by `read_pdf_vision.py`:

- `parse_pages(raw)` / `validate_pages(pages, total)` / `format_pages(pages)`
- `maybe_spill_to_file(content, ext, max_bytes)`
- `add_common_args(parser)` / `emit(content, ext, max_bytes)`
- `info(msg)` / `warn(msg)` / `die(msg)` for stderr progress

Kept under the original name `_pdf_read_lib.py` even though `vision` is now the only consumer — the
helpers are read-side concerns (page spec parsing, output spill, stderr progress) and the leading
underscore already signals "internal".

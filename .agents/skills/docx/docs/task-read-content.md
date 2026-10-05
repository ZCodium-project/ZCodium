# Task: READ_CONTENT

Use this task family when the user wants to know what the DOCX says, not how Word structures it and
not whether the pages look correct.

## Required inputs

- one source `.docx`
- the user's reading goal: summarize, quote, search, extract, retrieve, or locate content

## Evidence profile

Default evidence: **content truth** only.

Escalate out of this task if the user's real question is about:
- TOC or numbering -> `READ_STRUCTURE`
- styles or section topology -> `READ_STRUCTURE`
- layout or page truth -> `READ_RENDERED`

## Execution path

The bundled extractor is the default. It walks `word/document.xml`, the document
relationships, `footnotes.xml`, `endnotes.xml`, `comments.xml`, every
`header*.xml` / `footer*.xml`, and resolves `mc:AlternateContent` so drawing
text isn't double-counted. It is stdlib-only — no `python-docx`, `pandoc`, or
`dotnet` required.

### Option A — bundled extractor (default)

```bash
python3 <skill_dir>/scripts/extract_docx_text.py <input.docx>
```

What you get out of the box (text mode):

- paragraphs in reading order
- hyperlinks rendered inline as ``label (→ target)`` (external URLs from
  ``word/_rels/document.xml.rels``; internal anchors as ``#bookmark``)
- footnote markers ``[fn:N]`` and endnote markers ``[en:N]`` inline, with the
  footnote / endnote bodies listed in a trailing ``FOOTNOTES`` / ``ENDNOTES``
  section
- comment markers ``[cmt:N]`` inline, with author + date + text in a trailing
  ``COMMENTS`` section
- tables rendered row-by-row as ``cell | cell | cell`` lines (one table row =
  one line, never collapsed into a single string)
- text inside drawing shapes / VML text boxes listed in a ``TEXT BOXES``
  section (so the body text isn't polluted with anchored shape text)
- a ``WARNINGS`` section that loudly reports what was deliberately dropped (e.g.
  tracked deletions when ``--revisions accept`` is in effect)

Track-changes read policy is selectable:

- ``--revisions accept`` (default) — keep insertions, drop deletions
- ``--revisions reject`` — drop insertions, keep deletions
- ``--revisions raw`` — keep both, no warning

Optional flags (default behaviour shown above):

- ``--include-headers`` / ``--include-footers`` — section-attributed header /
  footer text (``section=N role=default|first|even`` per part)
- ``--no-footnotes`` / ``--no-endnotes`` / ``--no-comments`` /
  ``--no-textboxes`` / ``--no-hyperlinks`` — drop a side channel; a warning is
  emitted when the body actually referenced it
- ``--no-comment-markers`` — drop the inline ``[cmt:N]`` markers but keep the
  comments section

### Option A.json — structured content truth

```bash
python3 <skill_dir>/scripts/extract_docx_text.py <input.docx> --format json
```

Use this when you need a machine-readable view (RAG, audit, diff). Schema:

| Key | Meaning |
|------|---------|
| ``file`` | absolute input path |
| ``options`` | options actually applied |
| ``body`` | ordered list of ``paragraph`` / ``table`` blocks |
| ``body[].runs`` | per-run text + ``revision`` (none/ins/del) + hyperlink key |
| ``body[].hyperlinks`` | per-paragraph hyperlinks (text + target + anchor + tooltip) |
| ``body[].footnoteRefs`` / ``endnoteRefs`` / ``commentRefs`` | ids referenced from the paragraph |
| ``footnotes`` / ``endnotes`` / ``comments`` | full text of each side-channel entry, with author / date for comments |
| ``hyperlinks`` | every external hyperlink in document order |
| ``textboxes`` | text from drawing shapes / text boxes |
| ``headers`` / ``footers`` | per-section, per-role part text |
| ``revisions`` | ``{policy, rawInsertions, rawDeletions, retainedInsertions, retainedDeletions}`` |
| ``warnings`` | anything we deliberately did not silently drop |

### Option A.markdown — Markdown digest

```bash
python3 <skill_dir>/scripts/extract_docx_text.py <input.docx> --format markdown
```

Light heading + table + footnote / comment Markdown. Use this when feeding the
content downstream into a Markdown-native reviewer.

### Option B — pandoc to Markdown

```bash
pandoc -f docx -t markdown <input.docx>
```

Use this when you specifically need pandoc's heading / list / image embedding
behaviour and `pandoc` is already available. Note that pandoc collapses several
of the side channels (text boxes, comment ranges, header/footer attribution),
so it is not a substitute for Option A.

## Output contract

Return:

- the requested summary / quote / search result
- enough local context to show where the text came from (paragraph index, table
  cell address, "footnote N", "comment by Alice", "header section 0", etc.)
- the ``warnings`` block if anything was deliberately dropped — never silently
  hide it from the user
- no invented structural claims unless you also ran `READ_STRUCTURE`

## Acceptance profile

`light`

## Coverage matrix

| Content channel | Status | Notes |
|-----------------|--------|-------|
| paragraphs | ✅ | reading-order, style id + style name |
| tables | ✅ | structured rows × cells × paragraphs (json) and one row per line (text) |
| hyperlinks | ✅ | text + external target via rels; internal anchors as ``#name`` |
| footnotes | ✅ | inline ``[fn:N]`` + body |
| endnotes | ✅ | inline ``[en:N]`` + body |
| comments | ✅ | inline ``[cmt:N]`` + author / date / body |
| track changes | ✅ | selectable policy: accept / reject / raw |
| headers / footers | ✅ | opt-in (`--include-headers` / `--include-footers`); per section + role |
| text boxes / shape text | ✅ | listed under ``TEXT BOXES``; mc:AlternateContent collapsed first |
| field codes (`fldSimple`, `instrText`) | partial | instructions captured under ``fields``; the *result* run is captured as visible text |
| embedded objects / OLE | not surfaced | escalate to ``READ_STRUCTURE`` to inspect |
| numbering / list level meaning | not surfaced | escalate to ``READ_STRUCTURE`` |
| images / pictures | not surfaced | escalate to ``READ_RENDERED`` |
| equations / OMML | not surfaced | content truth keeps the surrounding text only |

## Common mistake

Do not answer “why is the TOC wrong” or “what section owns this header” from extracted text alone.
Do not silently drop tracked deletions when answering "what does this document say" — pick a
policy and report it.

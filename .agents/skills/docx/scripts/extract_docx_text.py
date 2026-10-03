"""Content-truth extractor for DOCX files.

This script lifts ``READ_CONTENT`` from "concatenated paragraph text" to a real
content-truth view. It walks ``word/document.xml`` (and the supporting parts:
``footnotes.xml``, ``endnotes.xml``, ``comments.xml``, ``header*.xml``,
``footer*.xml`` plus the document relationships) and emits the body content in
reading order while keeping side channels addressable.

Output formats
==============

``--format text`` (default, back-compatible with the previous behaviour but
richer):

* one paragraph per line, with hyperlink targets shown as ``text (→ url)``
* footnote / endnote / comment markers shown inline as ``[fn:1]`` / ``[en:1]``
  / ``[cmt:0]``
* tables rendered as ``cell | cell`` rows, one row per line
* tracked changes resolved by ``--revisions`` (default ``accept``: insertions
  in, deletions out)
* a trailing "FOOTNOTES", "ENDNOTES", "COMMENTS", "HEADERS", "FOOTERS" and
  "TEXT BOXES" section when those parts contain anything.  These can be turned
  off individually with ``--no-*`` flags.

``--format json`` produces a structured document suitable for downstream
consumers (RAG, audit, diff).  Schema (top-level keys):

* ``file`` — absolute path
* ``options`` — the options actually applied
* ``body`` — list of block dicts (``paragraph`` or ``table``) in reading order
* ``footnotes`` / ``endnotes`` / ``comments`` — lists with id, author, text
* ``hyperlinks`` — every external hyperlink reference with ``text`` + ``target``
* ``textboxes`` — text inside ``w:txbxContent`` / drawing shapes
* ``headers`` / ``footers`` — text per header/footer part with ``role`` (``default``/
  ``first``/``even``)
* ``revisions`` — ``{policy, insertions, deletions, retainedInsertions,
  retainedDeletions}``
* ``warnings`` — anything we deliberately did not silently drop

``--format markdown`` produces a lightweight, human-readable Markdown digest.

The script is stdlib-only (zipfile + xml.etree) so it has no dependency on
``python-docx`` and never silently degrades when that package is missing.
"""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional
from zipfile import ZipFile

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
V_NS = "urn:schemas-microsoft-com:vml"
WPS_NS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
MC_NS = "http://schemas.openxmlformats.org/markup-compatibility/2006"

NS = {
    "w": W_NS,
    "r": R_NS,
    "v": V_NS,
    "wps": WPS_NS,
    "mc": MC_NS,
    "pkg": PKG_REL_NS,
}

W_TAGS = {
    "p": f"{{{W_NS}}}p",
    "tbl": f"{{{W_NS}}}tbl",
    "tr": f"{{{W_NS}}}tr",
    "tc": f"{{{W_NS}}}tc",
    "r": f"{{{W_NS}}}r",
    "t": f"{{{W_NS}}}t",
    "delText": f"{{{W_NS}}}delText",
    "tab": f"{{{W_NS}}}tab",
    "br": f"{{{W_NS}}}br",
    "ins": f"{{{W_NS}}}ins",
    "del": f"{{{W_NS}}}del",
    "hyperlink": f"{{{W_NS}}}hyperlink",
    "footnoteReference": f"{{{W_NS}}}footnoteReference",
    "endnoteReference": f"{{{W_NS}}}endnoteReference",
    "commentRangeStart": f"{{{W_NS}}}commentRangeStart",
    "commentRangeEnd": f"{{{W_NS}}}commentRangeEnd",
    "commentReference": f"{{{W_NS}}}commentReference",
    "fldSimple": f"{{{W_NS}}}fldSimple",
    "instrText": f"{{{W_NS}}}instrText",
    "txbxContent": f"{{{W_NS}}}txbxContent",
    "drawing": f"{{{W_NS}}}drawing",
    "pStyle": f"{{{W_NS}}}pStyle",
    "pPr": f"{{{W_NS}}}pPr",
    "rPr": f"{{{W_NS}}}rPr",
    "sectPr": f"{{{W_NS}}}sectPr",
    "type": f"{{{W_NS}}}type",
    "headerReference": f"{{{W_NS}}}headerReference",
    "footerReference": f"{{{W_NS}}}footerReference",
}

W_ATTR = {
    "val": f"{{{W_NS}}}val",
    "id": f"{{{W_NS}}}id",
    "author": f"{{{W_NS}}}author",
    "date": f"{{{W_NS}}}date",
    "type": f"{{{W_NS}}}type",
    "anchor": f"{{{W_NS}}}anchor",
    "tooltip": f"{{{W_NS}}}tooltip",
    "history": f"{{{W_NS}}}history",
    "fldCharType": f"{{{W_NS}}}fldCharType",
}

R_ATTR = {
    "id": f"{{{R_NS}}}id",
}


# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------


@dataclass
class Options:
    fmt: str = "text"
    revisions: str = "accept"  # accept | reject | raw
    include_footnotes: bool = True
    include_endnotes: bool = True
    include_comments: bool = True
    include_hyperlinks: bool = True
    include_textboxes: bool = True
    include_headers: bool = False
    include_footers: bool = False
    inline_comment_marker: bool = True

    def to_dict(self) -> dict:
        return {
            "format": self.fmt,
            "revisions": self.revisions,
            "includeFootnotes": self.include_footnotes,
            "includeEndnotes": self.include_endnotes,
            "includeComments": self.include_comments,
            "includeHyperlinks": self.include_hyperlinks,
            "includeTextboxes": self.include_textboxes,
            "includeHeaders": self.include_headers,
            "includeFooters": self.include_footers,
        }


# ---------------------------------------------------------------------------
# Low-level helpers
# ---------------------------------------------------------------------------


def _read_xml(archive: ZipFile, name: str) -> Optional[ET.Element]:
    try:
        with archive.open(name) as handle:
            return ET.fromstring(handle.read())
    except KeyError:
        return None
    except ET.ParseError:
        return None


def _wval(node: Optional[ET.Element], default: Optional[str] = None) -> Optional[str]:
    if node is None:
        return default
    return node.get(W_ATTR["val"]) or node.get("val") or default


def _strip_alternate_content(root: ET.Element) -> None:
    """Resolve mc:AlternateContent so we walk the WML choice (preferred) and skip
    fallback duplicates.  Without this, drawing text inside ``mc:Fallback`` gets
    counted twice.  Loops until no AlternateContent remains (handles nesting)."""

    while True:
        parent_map = {child: parent for parent in root.iter() for child in parent}
        targets = [el for el in root.iter() if el.tag == f"{{{MC_NS}}}AlternateContent"]
        if not targets:
            return
        for ac in targets:
            parent = parent_map.get(ac)
            if parent is None:
                continue
            idx = list(parent).index(ac)
            choice = ac.find(f"{{{MC_NS}}}Choice")
            chosen = choice if choice is not None else ac.find(f"{{{MC_NS}}}Fallback")
            replacements = list(chosen) if chosen is not None else []
            parent.remove(ac)
            for offset, child in enumerate(replacements):
                parent.insert(idx + offset, child)


def _load_relationships(archive: ZipFile, part_path: str) -> dict[str, dict]:
    """Return {rId: {"target": str, "type": str, "mode": str}} for a given part."""

    rel_path = _rel_path_for(part_path)
    root = _read_xml(archive, rel_path)
    if root is None:
        return {}
    rels: dict[str, dict] = {}
    for rel in root.findall(f"{{{PKG_REL_NS}}}Relationship"):
        rid = rel.get("Id")
        if not rid:
            continue
        rels[rid] = {
            "target": rel.get("Target") or "",
            "type": rel.get("Type") or "",
            "mode": rel.get("TargetMode") or "Internal",
        }
    return rels


def _rel_path_for(part_path: str) -> str:
    parts = part_path.rsplit("/", 1)
    if len(parts) == 1:
        return f"_rels/{part_path}.rels"
    return f"{parts[0]}/_rels/{parts[1]}.rels"


# ---------------------------------------------------------------------------
# Run-level extraction (revisions, hyperlinks, footnotes, comments)
# ---------------------------------------------------------------------------


@dataclass
class ParagraphRun:
    text: str
    revision: str = "none"  # none | ins | del
    in_hyperlink: Optional[str] = None  # hyperlink id key (for grouping)


@dataclass
class Hyperlink:
    text: str
    target: str
    anchor: Optional[str] = None
    tooltip: Optional[str] = None


@dataclass
class FieldEvent:
    kind: str  # field-begin | field-instr | field-end
    text: str = ""


@dataclass
class ParagraphBlock:
    style: Optional[str]
    style_name: Optional[str]
    text: str
    runs: list[dict]
    hyperlinks: list[Hyperlink] = field(default_factory=list)
    footnote_refs: list[str] = field(default_factory=list)
    endnote_refs: list[str] = field(default_factory=list)
    comment_refs: list[str] = field(default_factory=list)
    fields: list[str] = field(default_factory=list)


@dataclass
class TableBlock:
    rows: list[list[ParagraphBlock]]


@dataclass
class ExtractionResult:
    body: list[object]
    footnotes: list[dict]
    endnotes: list[dict]
    comments: list[dict]
    hyperlinks: list[Hyperlink]
    textboxes: list[dict]
    headers: list[dict]
    footers: list[dict]
    revisions: dict
    warnings: list[str]
    style_names: dict[str, str]


# ---------------------------------------------------------------------------
# Paragraph walker
# ---------------------------------------------------------------------------


class ParagraphWalker:
    """Walk a ``w:p`` element and emit a structured ``ParagraphBlock``.

    The walker honours the requested revision policy and reports inline side
    channels (hyperlinks, footnote/endnote/comment references) via the
    paragraph's lists.  Text from drawing shapes / text boxes is *not* inlined
    here — the caller harvests those globally so they are addressable on their
    own.
    """

    def __init__(self, options: Options, rels: dict[str, dict], style_names: dict[str, str]):
        self.options = options
        self.rels = rels
        self.style_names = style_names

    # ------------------------------------------------------------------ runs

    def _emit_text(self, runs: list[ParagraphRun], text: str, revision: str, link_key: Optional[str]) -> None:
        if text == "":
            return
        # merge with previous run when revision/link unchanged
        if runs and runs[-1].revision == revision and runs[-1].in_hyperlink == link_key:
            runs[-1].text += text
            return
        runs.append(ParagraphRun(text=text, revision=revision, in_hyperlink=link_key))

    def _walk_run(
        self,
        run: ET.Element,
        runs: list[ParagraphRun],
        revision: str,
        link_key: Optional[str],
        block: ParagraphBlock,
    ) -> None:
        for child in run:
            tag = child.tag
            if tag == W_TAGS["t"]:
                self._emit_text(runs, child.text or "", revision, link_key)
            elif tag == W_TAGS["delText"]:
                # only surface deletion text when caller asked for raw or reject
                if revision == "del" and self.options.revisions in {"raw", "reject"}:
                    self._emit_text(runs, child.text or "", "del", link_key)
            elif tag == W_TAGS["tab"]:
                self._emit_text(runs, "\t", revision, link_key)
            elif tag == W_TAGS["br"]:
                self._emit_text(runs, "\n", revision, link_key)
            elif tag == W_TAGS["footnoteReference"]:
                fid = child.get(W_ATTR["id"])
                if fid:
                    block.footnote_refs.append(fid)
                    if self.options.include_footnotes:
                        self._emit_text(runs, f"[fn:{fid}]", revision, link_key)
            elif tag == W_TAGS["endnoteReference"]:
                eid = child.get(W_ATTR["id"])
                if eid:
                    block.endnote_refs.append(eid)
                    if self.options.include_endnotes:
                        self._emit_text(runs, f"[en:{eid}]", revision, link_key)
            elif tag == W_TAGS["commentReference"]:
                cid = child.get(W_ATTR["id"])
                if cid:
                    block.comment_refs.append(cid)
                    if self.options.include_comments and self.options.inline_comment_marker:
                        self._emit_text(runs, f"[cmt:{cid}]", revision, link_key)
            elif tag == W_TAGS["instrText"]:
                instr = (child.text or "").strip()
                if instr:
                    block.fields.append(instr)
            else:
                # ignore unknown run children silently — they cannot carry text
                pass

    # -------------------------------------------------------------- paragraph

    def _walk_paragraph_children(
        self,
        node: ET.Element,
        runs: list[ParagraphRun],
        revision: str,
        link_key: Optional[str],
        block: ParagraphBlock,
    ) -> None:
        for child in node:
            tag = child.tag
            if tag == W_TAGS["pPr"]:
                continue
            if tag == W_TAGS["r"]:
                self._walk_run(child, runs, revision, link_key, block)
            elif tag == W_TAGS["ins"]:
                if self.options.revisions == "reject":
                    # discard inserted text in reject mode
                    continue
                self._walk_paragraph_children(child, runs, "ins", link_key, block)
            elif tag == W_TAGS["del"]:
                if self.options.revisions == "accept":
                    # accepted means deletions are gone
                    continue
                self._walk_paragraph_children(child, runs, "del", link_key, block)
            elif tag == W_TAGS["hyperlink"]:
                rid = child.get(R_ATTR["id"])
                anchor = child.get(W_ATTR["anchor"])
                tooltip = child.get(W_ATTR["tooltip"])
                target: Optional[str] = None
                if rid and rid in self.rels:
                    target = self.rels[rid].get("target")
                if anchor and not target:
                    target = f"#{anchor}"
                key = f"{rid or ''}|{anchor or ''}"
                # collect text that lives inside this hyperlink
                inner_runs: list[ParagraphRun] = []
                self._walk_paragraph_children(child, inner_runs, revision, key, block)
                # merge into outer run list with hyperlink marker
                for run in inner_runs:
                    self._emit_text(runs, run.text, run.revision, key)
                # record hyperlink entry once
                hl_text = "".join(r.text for r in inner_runs)
                if hl_text or target:
                    block.hyperlinks.append(
                        Hyperlink(text=hl_text, target=target or "", anchor=anchor, tooltip=tooltip)
                    )
            elif tag == W_TAGS["fldSimple"]:
                instr = child.get(f"{{{W_NS}}}instr") or ""
                if instr.strip():
                    block.fields.append(instr.strip())
                # field result lives as run children below
                self._walk_paragraph_children(child, runs, revision, link_key, block)
            elif tag == W_TAGS["drawing"]:
                # Drawing-shape text (text boxes) is harvested globally so it can
                # be addressed on its own.  Skip the subtree here to avoid double
                # counting.
                continue
            elif tag == W_TAGS["txbxContent"]:
                continue
            else:
                # recurse so that <w:smartTag>, <w:bdo>, <w:dir>, etc. surface their text
                self._walk_paragraph_children(child, runs, revision, link_key, block)

    def walk(self, paragraph: ET.Element) -> ParagraphBlock:
        ppr = paragraph.find(W_TAGS["pPr"])
        style_id: Optional[str] = None
        if ppr is not None:
            pstyle = ppr.find(W_TAGS["pStyle"])
            style_id = _wval(pstyle)
        style_name = self.style_names.get(style_id or "")
        block = ParagraphBlock(style=style_id, style_name=style_name, text="", runs=[])
        runs: list[ParagraphRun] = []
        self._walk_paragraph_children(paragraph, runs, "none", None, block)
        block.runs = [
            {"text": r.text, "revision": r.revision, "hyperlinkKey": r.in_hyperlink}
            for r in runs
            if r.text
        ]
        block.text = "".join(r.text for r in runs)
        return block


# ---------------------------------------------------------------------------
# Side-channel parts: footnotes / endnotes / comments / headers / footers
# ---------------------------------------------------------------------------


def _collect_footnote_like(
    archive: ZipFile,
    part_name: str,
    container_local: str,
    options: Options,
    style_names: dict[str, str],
) -> list[dict]:
    root = _read_xml(archive, part_name)
    if root is None:
        return []
    _strip_alternate_content(root)
    rels = _load_relationships(archive, part_name)
    walker = ParagraphWalker(options, rels, style_names)
    out: list[dict] = []
    container_tag = f"{{{W_NS}}}{container_local}"
    for entry in root.findall(container_tag):
        fid = entry.get(W_ATTR["id"])
        ftype = entry.get(W_ATTR["type"])  # "separator" / "continuationSeparator" / "normal"
        if ftype in {"separator", "continuationSeparator"}:
            continue
        paragraphs = entry.findall(f".//{W_TAGS['p']}")
        text = "\n".join(walker.walk(p).text.strip() for p in paragraphs).strip()
        if not text:
            continue
        out.append({"id": fid, "type": ftype or "normal", "text": text})
    return out


def _collect_comments(
    archive: ZipFile, options: Options, style_names: dict[str, str]
) -> list[dict]:
    root = _read_xml(archive, "word/comments.xml")
    if root is None:
        return []
    _strip_alternate_content(root)
    rels = _load_relationships(archive, "word/comments.xml")
    walker = ParagraphWalker(options, rels, style_names)
    out: list[dict] = []
    for entry in root.findall(f"{{{W_NS}}}comment"):
        cid = entry.get(W_ATTR["id"])
        author = entry.get(W_ATTR["author"])
        date = entry.get(W_ATTR["date"])
        paragraphs = entry.findall(f".//{W_TAGS['p']}")
        text = "\n".join(walker.walk(p).text.strip() for p in paragraphs).strip()
        out.append(
            {
                "id": cid,
                "author": author,
                "date": date,
                "text": text,
            }
        )
    return out


def _collect_headers_or_footers(
    archive: ZipFile,
    document_rels: dict[str, dict],
    document_root: ET.Element,
    kind: str,  # "header" or "footer"
    options: Options,
    style_names: dict[str, str],
) -> list[dict]:
    """Walk every header/footer part referenced by every section, preserving
    section index and reference type (default/first/even)."""

    ref_tag = W_TAGS["headerReference" if kind == "header" else "footerReference"]
    parts: list[dict] = []
    for sect_idx, sect in enumerate(document_root.findall(f".//{W_TAGS['sectPr']}")):
        for ref in sect.findall(ref_tag):
            rid = ref.get(R_ATTR["id"])
            ref_type = ref.get(W_ATTR["type"]) or "default"
            if not rid or rid not in document_rels:
                continue
            target = document_rels[rid]["target"]
            part_name = _resolve_target("word/document.xml", target)
            root = _read_xml(archive, part_name)
            if root is None:
                continue
            _strip_alternate_content(root)
            rels = _load_relationships(archive, part_name)
            walker = ParagraphWalker(options, rels, style_names)
            paragraphs = root.findall(f".//{W_TAGS['p']}")
            text = "\n".join(walker.walk(p).text.strip() for p in paragraphs).strip()
            parts.append(
                {
                    "section": sect_idx,
                    "kind": kind,
                    "role": ref_type,
                    "part": part_name,
                    "text": text,
                }
            )
    return parts


def _resolve_target(source_part: str, target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    base = source_part.rsplit("/", 1)[0]
    pieces = []
    for piece in (base + "/" + target).split("/"):
        if piece in {"", "."}:
            continue
        if piece == "..":
            if pieces:
                pieces.pop()
        else:
            pieces.append(piece)
    return "/".join(pieces)


# ---------------------------------------------------------------------------
# Body walker
# ---------------------------------------------------------------------------


def _collect_textboxes(root: ET.Element, walker: ParagraphWalker, location: str) -> list[dict]:
    out: list[dict] = []
    for txbx in root.findall(f".//{W_TAGS['txbxContent']}"):
        paragraphs = txbx.findall(f".//{W_TAGS['p']}")
        text = "\n".join(walker.walk(p).text.strip() for p in paragraphs).strip()
        if text:
            out.append({"location": location, "text": text})
    return out


def _walk_body(
    body: ET.Element, walker: ParagraphWalker
) -> tuple[list[object], int, int, int, int]:
    """Walk body in order.  Returns (blocks, raw_ins_count, raw_del_count,
    retained_ins, retained_del)."""

    blocks: list[object] = []
    raw_ins = len(body.findall(f".//{W_TAGS['ins']}"))
    raw_del = len(body.findall(f".//{W_TAGS['del']}"))

    # we count "retained" by re-walking with a probe walker after the main walk
    # (cheap because each paragraph is small).  Actual retention happens inline
    # inside walker.walk based on options.revisions.
    retained_ins = 0
    retained_del = 0

    def _on_paragraph(p: ET.Element) -> ParagraphBlock:
        nonlocal retained_ins, retained_del
        block = walker.walk(p)
        retained_ins += sum(1 for r in block.runs if r["revision"] == "ins")
        retained_del += sum(1 for r in block.runs if r["revision"] == "del")
        return block

    for child in body:
        if child.tag == W_TAGS["p"]:
            blocks.append({"kind": "paragraph", "block": _on_paragraph(child)})
        elif child.tag == W_TAGS["tbl"]:
            rows: list[list[ParagraphBlock]] = []
            for tr in child.findall(W_TAGS["tr"]):
                row: list[ParagraphBlock] = []
                for tc in tr.findall(W_TAGS["tc"]):
                    cell_blocks: list[ParagraphBlock] = []
                    for cp in tc.findall(W_TAGS["p"]):
                        cell_blocks.append(_on_paragraph(cp))
                    row.append(cell_blocks)
                rows.append(row)
            blocks.append({"kind": "table", "rows": rows})
        elif child.tag == W_TAGS["sectPr"]:
            continue
        else:
            # fall back: collect any paragraphs nested inside (e.g. SDT containers)
            for p in child.findall(f".//{W_TAGS['p']}"):
                blocks.append({"kind": "paragraph", "block": _on_paragraph(p)})

    return blocks, raw_ins, raw_del, retained_ins, retained_del


def _load_style_names(archive: ZipFile) -> dict[str, str]:
    root = _read_xml(archive, "word/styles.xml")
    if root is None:
        return {}
    out: dict[str, str] = {}
    for style in root.findall(f"{{{W_NS}}}style"):
        sid = style.get(f"{{{W_NS}}}styleId") or style.get("styleId")
        if not sid:
            continue
        name_el = style.find(f"{{{W_NS}}}name")
        name = _wval(name_el)
        if name:
            out[sid] = name
    return out


# ---------------------------------------------------------------------------
# Top-level extraction
# ---------------------------------------------------------------------------


def extract(path: Path, options: Options) -> ExtractionResult:
    warnings: list[str] = []
    with ZipFile(path, "r") as archive:
        document_root = _read_xml(archive, "word/document.xml")
        if document_root is None:
            raise RuntimeError("Not a valid DOCX: word/document.xml missing")
        _strip_alternate_content(document_root)
        body = document_root.find(f"{{{W_NS}}}body")
        if body is None:
            raise RuntimeError("Document body missing")

        style_names = _load_style_names(archive)
        document_rels = _load_relationships(archive, "word/document.xml")

        walker = ParagraphWalker(options, document_rels, style_names)
        body_blocks, raw_ins, raw_del, ret_ins, ret_del = _walk_body(body, walker)

        # gather hyperlinks across body in walk order (for stable id-less listing)
        all_hyperlinks: list[Hyperlink] = []
        for entry in body_blocks:
            if entry["kind"] == "paragraph":
                all_hyperlinks.extend(entry["block"].hyperlinks)
            else:
                for row in entry["rows"]:
                    for cell in row:
                        for cp in cell:
                            all_hyperlinks.extend(cp.hyperlinks)

        textboxes: list[dict] = []
        if options.include_textboxes:
            textboxes = _collect_textboxes(document_root, walker, "body")

        footnotes: list[dict] = []
        if options.include_footnotes:
            footnotes = _collect_footnote_like(
                archive, "word/footnotes.xml", "footnote", options, style_names
            )

        endnotes: list[dict] = []
        if options.include_endnotes:
            endnotes = _collect_footnote_like(
                archive, "word/endnotes.xml", "endnote", options, style_names
            )

        comments: list[dict] = []
        if options.include_comments:
            comments = _collect_comments(archive, options, style_names)

        headers: list[dict] = []
        if options.include_headers:
            headers = _collect_headers_or_footers(
                archive, document_rels, document_root, "header", options, style_names
            )

        footers: list[dict] = []
        if options.include_footers:
            footers = _collect_headers_or_footers(
                archive, document_rels, document_root, "footer", options, style_names
            )

        # warn loudly when we drop something the user might care about
        if options.revisions == "accept" and raw_del > 0:
            warnings.append(
                f"revisions policy 'accept' dropped {raw_del} <w:del> block(s); "
                "use --revisions raw to retain them"
            )
        if options.revisions == "reject" and raw_ins > 0:
            warnings.append(
                f"revisions policy 'reject' dropped {raw_ins} <w:ins> block(s); "
                "use --revisions raw to retain them"
            )
        if not options.include_footnotes and footnotes_referenced(body_blocks):
            warnings.append("footnote references in body were ignored (--no-footnotes)")
        if not options.include_endnotes and endnotes_referenced(body_blocks):
            warnings.append("endnote references in body were ignored (--no-endnotes)")
        if not options.include_comments and comments_referenced(body_blocks):
            warnings.append("comment references in body were ignored (--no-comments)")

    return ExtractionResult(
        body=body_blocks,
        footnotes=footnotes,
        endnotes=endnotes,
        comments=comments,
        hyperlinks=all_hyperlinks,
        textboxes=textboxes,
        headers=headers,
        footers=footers,
        revisions={
            "policy": options.revisions,
            "rawInsertions": raw_ins,
            "rawDeletions": raw_del,
            "retainedInsertions": ret_ins,
            "retainedDeletions": ret_del,
        },
        warnings=warnings,
        style_names=style_names,
    )


def footnotes_referenced(blocks: Iterable[object]) -> bool:
    for entry in blocks:
        if entry["kind"] == "paragraph" and entry["block"].footnote_refs:
            return True
        if entry["kind"] == "table":
            for row in entry["rows"]:
                for cell in row:
                    for cp in cell:
                        if cp.footnote_refs:
                            return True
    return False


def endnotes_referenced(blocks: Iterable[object]) -> bool:
    for entry in blocks:
        if entry["kind"] == "paragraph" and entry["block"].endnote_refs:
            return True
        if entry["kind"] == "table":
            for row in entry["rows"]:
                for cell in row:
                    for cp in cell:
                        if cp.endnote_refs:
                            return True
    return False


def comments_referenced(blocks: Iterable[object]) -> bool:
    for entry in blocks:
        if entry["kind"] == "paragraph" and entry["block"].comment_refs:
            return True
        if entry["kind"] == "table":
            for row in entry["rows"]:
                for cell in row:
                    for cp in cell:
                        if cp.comment_refs:
                            return True
    return False


# ---------------------------------------------------------------------------
# Renderers
# ---------------------------------------------------------------------------


def _paragraph_to_text(p: ParagraphBlock, options: Options) -> str:
    text = p.text
    if options.include_hyperlinks and p.hyperlinks:
        suffix_parts = []
        for hl in p.hyperlinks:
            target = hl.target or (f"#{hl.anchor}" if hl.anchor else "")
            if not target:
                continue
            label = hl.text or target
            # rewrite link inline — replace first occurrence of label with `label (→ target)`
            if label and label in text:
                text = text.replace(label, f"{label} (→ {target})", 1)
            else:
                suffix_parts.append(f"{label} (→ {target})")
        if suffix_parts:
            text = text + " " + " ".join(suffix_parts)
    return text.strip()


def render_text(result: ExtractionResult, options: Options) -> str:
    out: list[str] = []
    for entry in result.body:
        if entry["kind"] == "paragraph":
            line = _paragraph_to_text(entry["block"], options)
            if line:
                out.append(line)
        else:
            for row in entry["rows"]:
                cells = []
                for cell in row:
                    cell_text = " ".join(_paragraph_to_text(cp, options) for cp in cell).strip()
                    cells.append(cell_text)
                if any(cells):
                    out.append(" | ".join(cells))

    if options.include_footnotes and result.footnotes:
        out.append("")
        out.append("FOOTNOTES")
        for fn in result.footnotes:
            out.append(f"  [fn:{fn['id']}] {fn['text']}")
    if options.include_endnotes and result.endnotes:
        out.append("")
        out.append("ENDNOTES")
        for en in result.endnotes:
            out.append(f"  [en:{en['id']}] {en['text']}")
    if options.include_comments and result.comments:
        out.append("")
        out.append("COMMENTS")
        for cm in result.comments:
            who = cm.get("author") or "anon"
            when = cm.get("date") or "?"
            out.append(f"  [cmt:{cm['id']}] ({who}, {when}) {cm['text']}")
    if options.include_headers and result.headers:
        out.append("")
        out.append("HEADERS")
        for hd in result.headers:
            if hd["text"]:
                out.append(f"  section={hd['section']} role={hd['role']} :: {hd['text']}")
    if options.include_footers and result.footers:
        out.append("")
        out.append("FOOTERS")
        for ft in result.footers:
            if ft["text"]:
                out.append(f"  section={ft['section']} role={ft['role']} :: {ft['text']}")
    if options.include_textboxes and result.textboxes:
        out.append("")
        out.append("TEXT BOXES")
        for tb in result.textboxes:
            out.append(f"  ({tb['location']}) {tb['text']}")
    if result.warnings:
        out.append("")
        out.append("WARNINGS")
        for w in result.warnings:
            out.append(f"  {w}")
    return "\n".join(line for line in out).strip() + ("\n" if out else "")


def render_markdown(result: ExtractionResult, options: Options) -> str:
    out: list[str] = []
    for entry in result.body:
        if entry["kind"] == "paragraph":
            block = entry["block"]
            text = _paragraph_to_text(block, options)
            if not text:
                continue
            style = (block.style or "").lower()
            if "heading" in style or style in {"title", "subtitle"}:
                level = 1
                for ch in style[::-1]:
                    if ch.isdigit():
                        level = int(ch)
                        break
                out.append(f"{'#' * max(1, min(level, 6))} {text}")
            else:
                out.append(text)
            out.append("")
        else:
            rows = entry["rows"]
            if not rows:
                continue
            md_rows = []
            for row in rows:
                md_rows.append(
                    "| "
                    + " | ".join(
                        " ".join(_paragraph_to_text(cp, options) for cp in cell).replace("|", "\\|")
                        for cell in row
                    )
                    + " |"
                )
            if md_rows:
                header_cells = len(rows[0])
                out.append(md_rows[0])
                out.append("|" + "|".join([" --- "] * header_cells) + "|")
                out.extend(md_rows[1:])
                out.append("")

    if options.include_footnotes and result.footnotes:
        out.append("## Footnotes")
        for fn in result.footnotes:
            out.append(f"- **fn:{fn['id']}** — {fn['text']}")
        out.append("")
    if options.include_endnotes and result.endnotes:
        out.append("## Endnotes")
        for en in result.endnotes:
            out.append(f"- **en:{en['id']}** — {en['text']}")
        out.append("")
    if options.include_comments and result.comments:
        out.append("## Comments")
        for cm in result.comments:
            out.append(
                f"- **cmt:{cm['id']}** ({cm.get('author') or 'anon'}, {cm.get('date') or '?'}): {cm['text']}"
            )
        out.append("")
    return "\n".join(out).strip() + "\n"


def render_json(result: ExtractionResult, options: Options, path: Path) -> str:
    body_payload: list[dict] = []
    for entry in result.body:
        if entry["kind"] == "paragraph":
            block: ParagraphBlock = entry["block"]
            body_payload.append(
                {
                    "kind": "paragraph",
                    "style": block.style,
                    "styleName": block.style_name,
                    "text": block.text,
                    "runs": block.runs,
                    "hyperlinks": [hl.__dict__ for hl in block.hyperlinks],
                    "footnoteRefs": block.footnote_refs,
                    "endnoteRefs": block.endnote_refs,
                    "commentRefs": block.comment_refs,
                    "fields": block.fields,
                }
            )
        else:
            body_payload.append(
                {
                    "kind": "table",
                    "rows": [
                        [
                            [
                                {
                                    "style": cp.style,
                                    "styleName": cp.style_name,
                                    "text": cp.text,
                                    "footnoteRefs": cp.footnote_refs,
                                    "endnoteRefs": cp.endnote_refs,
                                    "commentRefs": cp.comment_refs,
                                    "hyperlinks": [hl.__dict__ for hl in cp.hyperlinks],
                                }
                                for cp in cell
                            ]
                            for cell in row
                        ]
                        for row in entry["rows"]
                    ],
                }
            )
    payload = {
        "file": str(path),
        "options": options.to_dict(),
        "body": body_payload,
        "footnotes": result.footnotes,
        "endnotes": result.endnotes,
        "comments": result.comments,
        "hyperlinks": [hl.__dict__ for hl in result.hyperlinks],
        "textboxes": result.textboxes,
        "headers": result.headers,
        "footers": result.footers,
        "revisions": result.revisions,
        "warnings": result.warnings,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract content-truth view of a DOCX (text/json/markdown).",
    )
    parser.add_argument("input_path", help="Path to the .docx file")
    parser.add_argument(
        "--format",
        choices=["text", "json", "markdown"],
        default="text",
        help="Output format. Default: text (back-compat).",
    )
    parser.add_argument(
        "--revisions",
        choices=["accept", "reject", "raw"],
        default="accept",
        help=(
            "Track-changes read policy. accept: keep insertions, drop deletions. "
            "reject: drop insertions, keep deletions. raw: keep both."
        ),
    )
    parser.add_argument("--no-footnotes", action="store_true")
    parser.add_argument("--no-endnotes", action="store_true")
    parser.add_argument("--no-comments", action="store_true")
    parser.add_argument("--no-hyperlinks", action="store_true")
    parser.add_argument("--no-textboxes", action="store_true")
    parser.add_argument(
        "--include-headers",
        action="store_true",
        help="Include header text. Off by default to mirror reading-only intent.",
    )
    parser.add_argument(
        "--include-footers",
        action="store_true",
        help="Include footer text. Off by default to mirror reading-only intent.",
    )
    parser.add_argument(
        "--no-comment-markers",
        action="store_true",
        help="Drop inline [cmt:N] markers; comments still listed in the dedicated section.",
    )
    return parser


def _options_from_args(args: argparse.Namespace) -> Options:
    return Options(
        fmt=args.format,
        revisions=args.revisions,
        include_footnotes=not args.no_footnotes,
        include_endnotes=not args.no_endnotes,
        include_comments=not args.no_comments,
        include_hyperlinks=not args.no_hyperlinks,
        include_textboxes=not args.no_textboxes,
        include_headers=args.include_headers,
        include_footers=args.include_footers,
        inline_comment_marker=not args.no_comment_markers,
    )


def main(argv: Optional[list[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input_path).expanduser().resolve()
    if not input_path.exists():
        raise RuntimeError(f"Input file does not exist: {input_path}")
    if input_path.suffix.lower() != ".docx":
        raise RuntimeError("extract_docx_text.py currently supports .docx only")

    options = _options_from_args(args)
    result = extract(input_path, options)

    if options.fmt == "json":
        sys.stdout.write(render_json(result, options, input_path))
        sys.stdout.write("\n")
    elif options.fmt == "markdown":
        sys.stdout.write(render_markdown(result, options))
    else:
        sys.stdout.write(render_text(result, options))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"extract_docx_text.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

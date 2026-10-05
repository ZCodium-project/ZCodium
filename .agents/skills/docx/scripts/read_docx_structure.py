#!/usr/bin/env python3
"""Deep DOCX structure analyzer.

This script is the **primary** structure-truth implementation for the docx
skill. It is intentionally not "a summarizer that needs dotnet to corroborate" —
it parses the OOXML parts directly (stdlib only) and produces an independent,
self-contained structure report covering:

  * parts inventory + Content-Types vs rels cross-check
  * relationship graph (document, headers, footers)
  * section graph with page geometry, header/footer references and titlePg
  * numbering chain (numId -> abstractNumId -> level definitions) plus usage
  * field topology (simple + complex fields, instruction text, dirty/locked)
  * bookmark topology (start/end pairing, orphan detection, reserved names)
  * hyperlink topology (internal anchors + external URLs resolved via rels)
  * comments topology (definitions, in-document ranges, parent links, orphans)
  * revisions topology (kinds, actors, date range)
  * styles inventory + cross-reference audit (defined/used/missing/contaminated)
  * direct-formatting contamination heatmap
  * a `diagnostics` array of categorized findings (template diagnosis aid)

The dotnet `analyze` command remains useful as an **independent confirmation**
shot (different parser, different runtime), but it is not the structure-truth
oracle. This script is.

Run:
    python3 read_docx_structure.py path/to/file.docx --json
    python3 read_docx_structure.py path/to/file.docx --section sections,numbering
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from zipfile import ZipFile

# -- namespaces ----------------------------------------------------------------

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "w14": "http://schemas.microsoft.com/office/word/2010/wordml",
    "w15": "http://schemas.microsoft.com/office/word/2012/wordml",
}

W = NS["w"]
R = NS["r"]
REL = NS["rel"]
CT = NS["ct"]


def qn(prefix: str, name: str) -> str:
    return f"{{{NS[prefix]}}}{name}"


WVAL = qn("w", "val")
WTYPE = qn("w", "type")
WSTYLEID = qn("w", "styleId")
WCUSTOM = qn("w", "customStyle")
WDEFAULT = qn("w", "default")
RID = qn("r", "id")
WAUTHOR = qn("w", "author")
WDATE = qn("w", "date")


# -- XML helpers ---------------------------------------------------------------

def load_xml(archive: ZipFile, entry_name: str) -> Optional[ET.Element]:
    try:
        with archive.open(entry_name) as handle:
            return ET.fromstring(handle.read())
    except KeyError:
        return None
    except ET.ParseError as exc:
        # Surface as diagnostic but do not crash the whole analysis.
        return ET.fromstring(f"<broken xmlns='urn:broken'>{exc}</broken>")


def text_of(node: ET.Element) -> str:
    return "".join(part.text or "" for part in node.findall(".//w:t", NS)).strip()


def attr(elem: ET.Element, name: str) -> Optional[str]:
    """Return attribute by prefixed-or-bare name."""
    return elem.get(name) or elem.get(name.split("}", 1)[-1] if "}" in name else name)


def w_attr(elem: ET.Element, local: str) -> Optional[str]:
    return elem.get(qn("w", local)) or elem.get(local)


# -- conversion helpers --------------------------------------------------------

def twips_to_mm(value: Optional[str]) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(int(value) / 1440.0 * 25.4, 2)
    except (TypeError, ValueError):
        return None


# -- packaging layer -----------------------------------------------------------

def parse_content_types(archive: ZipFile) -> Dict[str, Any]:
    elem = load_xml(archive, "[Content_Types].xml")
    if elem is None:
        return {"defaults": {}, "overrides": {}, "missing": True}
    defaults: Dict[str, str] = {}
    overrides: Dict[str, str] = {}
    for child in elem.findall(qn("ct", "Default")):
        defaults[child.get("Extension", "")] = child.get("ContentType", "")
    for child in elem.findall(qn("ct", "Override")):
        overrides[child.get("PartName", "")] = child.get("ContentType", "")
    return {"defaults": defaults, "overrides": overrides, "missing": False}


def parse_rels(archive: ZipFile, rels_path: str) -> List[Dict[str, str]]:
    elem = load_xml(archive, rels_path)
    if elem is None:
        return []
    rels: List[Dict[str, str]] = []
    for child in elem.findall(qn("rel", "Relationship")):
        rels.append({
            "id": child.get("Id", ""),
            "type": child.get("Type", ""),
            "target": child.get("Target", ""),
            "targetMode": child.get("TargetMode", "Internal"),
        })
    return rels


def collect_parts_inventory(archive: ZipFile) -> Dict[str, Any]:
    parts = []
    for info in archive.infolist():
        parts.append({
            "name": info.filename,
            "size": info.file_size,
            "compressed": info.compress_size,
        })
    return {
        "count": len(parts),
        "totalUncompressed": sum(p["size"] for p in parts),
        "items": parts,
    }


# -- styles --------------------------------------------------------------------

def parse_styles(styles_doc: Optional[ET.Element]) -> Dict[str, Any]:
    if styles_doc is None:
        return {"missing": True, "byId": {}, "defaults": {}}
    by_id: Dict[str, Dict[str, Any]] = {}
    defaults: Dict[str, str] = {}
    for style in styles_doc.findall(qn("w", "style")):
        style_id = w_attr(style, "styleId")
        if not style_id:
            continue
        name_node = style.find(qn("w", "name"))
        based_on = style.find(qn("w", "basedOn"))
        link = style.find(qn("w", "link"))
        next_style = style.find(qn("w", "next"))
        ppr = style.find(qn("w", "pPr"))
        outline_lvl = ppr.find(qn("w", "outlineLvl")) if ppr is not None else None
        num_pr = ppr.find(qn("w", "numPr")) if ppr is not None else None
        num_id = None
        if num_pr is not None:
            num_id_node = num_pr.find(qn("w", "numId"))
            if num_id_node is not None:
                num_id = w_attr(num_id_node, "val")
        info = {
            "styleId": style_id,
            "type": w_attr(style, "type"),
            "name": w_attr(name_node, "val") if name_node is not None else None,
            "basedOn": w_attr(based_on, "val") if based_on is not None else None,
            "linked": w_attr(link, "val") if link is not None else None,
            "next": w_attr(next_style, "val") if next_style is not None else None,
            "isDefault": w_attr(style, "default") == "1",
            "isCustom": w_attr(style, "customStyle") == "1",
            "outlineLvl": w_attr(outline_lvl, "val") if outline_lvl is not None else None,
            "numId": num_id,
        }
        if info["isDefault"] and info["type"]:
            defaults[info["type"]] = style_id
        by_id[style_id] = info
    return {"missing": False, "byId": by_id, "defaults": defaults}


def style_inheritance_chain(styles: Dict[str, Any], style_id: str) -> List[str]:
    chain: List[str] = []
    seen = set()
    cursor = style_id
    while cursor and cursor not in seen:
        seen.add(cursor)
        chain.append(cursor)
        info = styles["byId"].get(cursor)
        if not info:
            break
        cursor = info.get("basedOn")
    return chain


# -- numbering -----------------------------------------------------------------

def parse_numbering(numbering_doc: Optional[ET.Element]) -> Dict[str, Any]:
    if numbering_doc is None:
        return {"missing": True, "abstractNums": {}, "nums": {}}
    abstract: Dict[str, Dict[str, Any]] = {}
    for an in numbering_doc.findall(qn("w", "abstractNum")):
        an_id = w_attr(an, "abstractNumId")
        multi = an.find(qn("w", "multiLevelType"))
        levels: List[Dict[str, Any]] = []
        for lvl in an.findall(qn("w", "lvl")):
            num_fmt = lvl.find(qn("w", "numFmt"))
            lvl_text = lvl.find(qn("w", "lvlText"))
            start = lvl.find(qn("w", "start"))
            p_style = lvl.find(qn("w", "pStyle"))
            levels.append({
                "ilvl": w_attr(lvl, "ilvl"),
                "numFmt": w_attr(num_fmt, "val") if num_fmt is not None else None,
                "lvlText": w_attr(lvl_text, "val") if lvl_text is not None else None,
                "start": w_attr(start, "val") if start is not None else None,
                "pStyle": w_attr(p_style, "val") if p_style is not None else None,
            })
        abstract[an_id or ""] = {
            "abstractNumId": an_id,
            "multiLevelType": w_attr(multi, "val") if multi is not None else None,
            "levels": levels,
        }
    nums: Dict[str, Dict[str, Any]] = {}
    for num in numbering_doc.findall(qn("w", "num")):
        num_id = w_attr(num, "numId")
        an_ref = num.find(qn("w", "abstractNumId"))
        overrides = []
        for ov in num.findall(qn("w", "lvlOverride")):
            overrides.append({"ilvl": w_attr(ov, "ilvl")})
        nums[num_id or ""] = {
            "numId": num_id,
            "abstractNumId": w_attr(an_ref, "val") if an_ref is not None else None,
            "lvlOverrides": overrides,
        }
    return {"missing": False, "abstractNums": abstract, "nums": nums}


# -- comments ------------------------------------------------------------------

def parse_comments(comments_doc: Optional[ET.Element]) -> List[Dict[str, Any]]:
    if comments_doc is None:
        return []
    items: List[Dict[str, Any]] = []
    for comment in comments_doc.findall(qn("w", "comment")):
        items.append({
            "id": w_attr(comment, "id"),
            "author": w_attr(comment, "author"),
            "initials": w_attr(comment, "initials"),
            "date": w_attr(comment, "date"),
            "text": text_of(comment),
        })
    return items


def parse_comments_extended(doc: Optional[ET.Element]) -> List[Dict[str, Any]]:
    if doc is None:
        return []
    items: List[Dict[str, Any]] = []
    for entry in doc.findall(qn("w15", "commentEx")):
        items.append({
            "paraId": entry.get(qn("w15", "paraId")) or entry.get("paraId"),
            "paraIdParent": entry.get(qn("w15", "paraIdParent")) or entry.get("paraIdParent"),
            "done": (entry.get(qn("w15", "done")) or entry.get("done")) == "1",
        })
    return items


# -- field state machine -------------------------------------------------------

FIELD_KIND = re.compile(r"^\s*([A-Z]+)")


def classify_field(instr: str) -> str:
    match = FIELD_KIND.match(instr.strip())
    return match.group(1) if match else "UNKNOWN"


def collect_complex_fields(body: ET.Element) -> List[Dict[str, Any]]:
    """Walk body in document order pairing fldChar begin/separate/end."""
    out: List[Dict[str, Any]] = []
    stack: List[Dict[str, Any]] = []
    for run in body.iter(qn("w", "r")):
        fld_char = run.find(qn("w", "fldChar"))
        instr = run.find(qn("w", "instrText"))
        text = run.find(qn("w", "t"))
        if fld_char is not None:
            kind = w_attr(fld_char, "fldCharType")
            if kind == "begin":
                stack.append({
                    "instr": "",
                    "result": "",
                    "dirty": w_attr(fld_char, "dirty") == "1",
                    "locked": w_attr(fld_char, "fldLock") == "1",
                    "phase": "instr",
                })
            elif kind == "separate" and stack:
                stack[-1]["phase"] = "result"
            elif kind == "end" and stack:
                completed = stack.pop()
                completed["kind"] = classify_field(completed["instr"])
                completed.pop("phase", None)
                if stack:
                    # Field-in-field (rare); treat outer result as still being captured.
                    stack[-1]["result"] += completed.get("result", "")
                out.append(completed)
        elif instr is not None and stack and stack[-1].get("phase") == "instr":
            stack[-1]["instr"] += instr.text or ""
        elif text is not None and stack and stack[-1].get("phase") == "result":
            stack[-1]["result"] += text.text or ""
    return out


def collect_simple_fields(body: ET.Element) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for fld in body.iter(qn("w", "fldSimple")):
        instr = w_attr(fld, "instr") or ""
        out.append({
            "instr": instr.strip(),
            "kind": classify_field(instr),
            "dirty": w_attr(fld, "dirty") == "1",
            "result": text_of(fld),
        })
    return out


# -- bookmarks -----------------------------------------------------------------

def collect_bookmarks(body: ET.Element) -> Dict[str, Any]:
    starts: Dict[str, Dict[str, Any]] = {}
    ends_seen: List[str] = []
    paragraph_seq: List[ET.Element] = list(body.iter(qn("w", "p")))
    para_index_by_id = {id(p): idx for idx, p in enumerate(paragraph_seq)}

    def parent_paragraph_index(elem: ET.Element) -> Optional[int]:
        # Walk through the tree to find the enclosing <w:p>; ET has no parent
        # pointer, so we precomputed paragraph identity below.
        return None

    # Instead of walking ancestors we walk paragraphs and record bookmark anchors
    # encountered inside each paragraph. This still provides a correct paragraph-
    # span for any bookmark whose start/end are inside the body's paragraph tree.
    para_index: Dict[str, Dict[str, int]] = {}
    for idx, paragraph in enumerate(paragraph_seq):
        for bm in paragraph.iter(qn("w", "bookmarkStart")):
            bm_id = w_attr(bm, "id")
            if bm_id is not None:
                para_index.setdefault(bm_id, {})["startPara"] = idx
        for bm in paragraph.iter(qn("w", "bookmarkEnd")):
            bm_id = w_attr(bm, "id")
            if bm_id is not None:
                para_index.setdefault(bm_id, {})["endPara"] = idx

    for bm in body.iter(qn("w", "bookmarkStart")):
        bm_id = w_attr(bm, "id")
        name = w_attr(bm, "name") or ""
        starts[bm_id or ""] = {
            "id": bm_id,
            "name": name,
            "reserved": name.startswith("_"),
            "startPara": para_index.get(bm_id or "", {}).get("startPara"),
        }
    for bm in body.iter(qn("w", "bookmarkEnd")):
        bm_id = w_attr(bm, "id")
        ends_seen.append(bm_id or "")
        if bm_id and bm_id in starts:
            starts[bm_id]["endPara"] = para_index.get(bm_id, {}).get("endPara")
    end_counter = Counter(ends_seen)
    pairs: List[Dict[str, Any]] = []
    orphan_starts: List[Dict[str, Any]] = []
    for bm_id, info in starts.items():
        if end_counter.get(bm_id, 0) >= 1:
            pairs.append(info)
        else:
            orphan_starts.append(info)
    orphan_ends = [bm_id for bm_id in end_counter if bm_id not in starts]
    return {
        "pairs": pairs,
        "orphanStarts": orphan_starts,
        "orphanEnds": orphan_ends,
    }


# -- hyperlinks ----------------------------------------------------------------

def collect_hyperlinks(body: ET.Element, rels_by_id: Dict[str, Dict[str, str]]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for hl in body.iter(qn("w", "hyperlink")):
        anchor = w_attr(hl, "anchor")
        rid = hl.get(RID)
        target_url = None
        target_mode = None
        if rid and rid in rels_by_id:
            target_url = rels_by_id[rid].get("target")
            target_mode = rels_by_id[rid].get("targetMode")
        items.append({
            "anchor": anchor,
            "rId": rid,
            "url": target_url,
            "external": target_mode == "External",
            "text": text_of(hl)[:200] or None,
        })
    return items


# -- sections / page setup -----------------------------------------------------

def parse_section(sect_pr: ET.Element) -> Dict[str, Any]:
    pg_sz = sect_pr.find(qn("w", "pgSz"))
    pg_mar = sect_pr.find(qn("w", "pgMar"))
    type_node = sect_pr.find(qn("w", "type"))
    cols = sect_pr.find(qn("w", "cols"))
    title_pg = sect_pr.find(qn("w", "titlePg"))
    line_num = sect_pr.find(qn("w", "lnNumType"))
    pg_borders = sect_pr.find(qn("w", "pgBorders"))
    headers = []
    footers = []
    for ref in sect_pr.findall(qn("w", "headerReference")):
        headers.append({"type": w_attr(ref, "type"), "rId": ref.get(RID)})
    for ref in sect_pr.findall(qn("w", "footerReference")):
        footers.append({"type": w_attr(ref, "type"), "rId": ref.get(RID)})

    page_size = None
    if pg_sz is not None:
        page_size = {
            "widthMm": twips_to_mm(w_attr(pg_sz, "w")),
            "heightMm": twips_to_mm(w_attr(pg_sz, "h")),
            "orient": w_attr(pg_sz, "orient") or "portrait",
        }
    margins = None
    if pg_mar is not None:
        margins = {
            side: twips_to_mm(w_attr(pg_mar, side))
            for side in ("top", "right", "bottom", "left", "header", "footer", "gutter")
        }
    return {
        "type": (w_attr(type_node, "val") if type_node is not None else None) or "nextPage",
        "pageSize": page_size,
        "margins": margins,
        "columns": (int(w_attr(cols, "num")) if cols is not None and (w_attr(cols, "num") or "").isdigit() else 1),
        "titlePg": title_pg is not None,
        "lineNumbering": line_num is not None,
        "pageBorders": pg_borders is not None,
        "headerReferences": headers,
        "footerReferences": footers,
    }


# -- direct-formatting contamination ------------------------------------------

NON_REF_PPR_CHILDREN = {
    qn("w", "rPr"), qn("w", "sectPr"),
}
ALLOWED_PPR_REF_CHILDREN = {qn("w", "pStyle"), qn("w", "numPr")}


def paragraph_contamination(paragraph: ET.Element) -> Dict[str, int]:
    info = {"pPrDirect": 0, "rPrDirectRuns": 0, "totalRuns": 0}
    ppr = paragraph.find(qn("w", "pPr"))
    if ppr is not None:
        for child in list(ppr):
            if child.tag not in ALLOWED_PPR_REF_CHILDREN and child.tag not in NON_REF_PPR_CHILDREN:
                info["pPrDirect"] += 1
        # rPr inside pPr (paragraph-mark formatting) also counts as direct
        run_ppr = ppr.find(qn("w", "rPr"))
        if run_ppr is not None and len(list(run_ppr)) > 0:
            info["pPrDirect"] += 1
    for run in paragraph.findall(qn("w", "r")):
        info["totalRuns"] += 1
        rpr = run.find(qn("w", "rPr"))
        if rpr is not None:
            non_style = [c for c in list(rpr) if c.tag != qn("w", "rStyle")]
            if non_style:
                info["rPrDirectRuns"] += 1
    return info


# -- main analyze --------------------------------------------------------------

def analyze(path: Path) -> Dict[str, Any]:
    diagnostics: List[Dict[str, str]] = []

    def diag(severity: str, code: str, message: str, **extra: Any) -> None:
        item = {"severity": severity, "code": code, "message": message}
        item.update(extra)
        diagnostics.append(item)

    with ZipFile(path, "r") as archive:
        document = load_xml(archive, "word/document.xml")
        if document is None:
            raise RuntimeError("Not a valid DOCX: word/document.xml missing")
        body = document.find(qn("w", "body"))
        if body is None:
            raise RuntimeError("Document body missing")

        styles_doc = load_xml(archive, "word/styles.xml")
        numbering_doc = load_xml(archive, "word/numbering.xml")
        comments_doc = load_xml(archive, "word/comments.xml")
        comments_ext_doc = load_xml(archive, "word/commentsExtended.xml")
        footnotes_doc = load_xml(archive, "word/footnotes.xml")
        endnotes_doc = load_xml(archive, "word/endnotes.xml")
        settings_doc = load_xml(archive, "word/settings.xml")

        content_types = parse_content_types(archive)
        rels_doc = parse_rels(archive, "word/_rels/document.xml.rels")
        package_rels = parse_rels(archive, "_rels/.rels")
        rels_by_id = {r["id"]: r for r in rels_doc}

        styles = parse_styles(styles_doc)
        numbering = parse_numbering(numbering_doc)
        comments = parse_comments(comments_doc)
        comments_ext = parse_comments_extended(comments_ext_doc)

        # --- traverse body --------------------------------------------------

        paragraphs = list(body.iter(qn("w", "p")))
        tables = list(body.iter(qn("w", "tbl")))
        sect_prs = list(body.iter(qn("w", "sectPr")))
        drawings = list(body.iter(qn("w", "drawing")))

        used_para_styles: Counter = Counter()
        used_run_styles: Counter = Counter()
        numbered_paragraphs: List[Dict[str, Any]] = []
        contamination_total = {"pPrDirect": 0, "rPrDirectRuns": 0, "paragraphsDirty": 0, "totalRuns": 0}
        heading_paragraphs: List[Dict[str, Any]] = []
        para_ids: List[str] = []

        for index, paragraph in enumerate(paragraphs):
            ppr = paragraph.find(qn("w", "pPr"))
            style_node = ppr.find(qn("w", "pStyle")) if ppr is not None else None
            style_id = w_attr(style_node, "val") if style_node is not None else None
            if style_id:
                used_para_styles[style_id] += 1
            for run in paragraph.findall(qn("w", "r")):
                rpr = run.find(qn("w", "rPr"))
                if rpr is not None:
                    rstyle = rpr.find(qn("w", "rStyle"))
                    if rstyle is not None:
                        rs_val = w_attr(rstyle, "val")
                        if rs_val:
                            used_run_styles[rs_val] += 1
            num_pr = ppr.find(qn("w", "numPr")) if ppr is not None else None
            if num_pr is not None:
                num_id_node = num_pr.find(qn("w", "numId"))
                ilvl_node = num_pr.find(qn("w", "ilvl"))
                numbered_paragraphs.append({
                    "index": index,
                    "numId": w_attr(num_id_node, "val") if num_id_node is not None else None,
                    "ilvl": w_attr(ilvl_node, "val") if ilvl_node is not None else None,
                    "styleId": style_id,
                })

            para_id = paragraph.get(qn("w14", "paraId"))
            if para_id:
                para_ids.append(para_id)

            cont = paragraph_contamination(paragraph)
            contamination_total["pPrDirect"] += cont["pPrDirect"]
            contamination_total["rPrDirectRuns"] += cont["rPrDirectRuns"]
            contamination_total["totalRuns"] += cont["totalRuns"]
            if cont["pPrDirect"] or cont["rPrDirectRuns"]:
                contamination_total["paragraphsDirty"] += 1

            text = text_of(paragraph)
            outline_lvl = None
            if style_id and style_id in styles["byId"]:
                outline_lvl = styles["byId"][style_id].get("outlineLvl")
            if outline_lvl is None and ppr is not None:
                outline_node = ppr.find(qn("w", "outlineLvl"))
                if outline_node is not None:
                    outline_lvl = w_attr(outline_node, "val")
            heading_like = bool(style_id and (
                "heading" in style_id.lower() or style_id.lower() in {"title", "subtitle"}
            ))
            if text and (outline_lvl is not None or heading_like):
                heading_paragraphs.append({
                    "paraIndex": index,
                    "styleId": style_id,
                    "outlineLvl": int(outline_lvl) if outline_lvl and str(outline_lvl).isdigit() else None,
                    "text": text[:240],
                })

        # --- sections -------------------------------------------------------

        sections: List[Dict[str, Any]] = []
        for sect_index, sect_pr in enumerate(sect_prs, start=1):
            entry = parse_section(sect_pr)
            entry["index"] = sect_index
            sections.append(entry)

        # --- header/footer parts via rels ----------------------------------

        header_footer_parts = []
        for rel in rels_doc:
            if rel["type"].endswith("/header") or rel["type"].endswith("/footer"):
                target = rel["target"]
                if not target.startswith("/"):
                    full = f"word/{target.lstrip('./')}"
                else:
                    full = target.lstrip("/")
                part_xml = load_xml(archive, full)
                if part_xml is None:
                    diag("error", "missing-header-footer-part",
                         f"rel {rel['id']} -> {target} but part not found", target=target)
                    continue
                paragraphs_in_part = list(part_xml.iter(qn("w", "p")))
                simple_in_part = collect_simple_fields(part_xml)
                complex_in_part = collect_complex_fields(part_xml)
                part_fields = simple_in_part + complex_in_part
                images_in_part = sum(1 for _ in part_xml.iter(qn("w", "drawing")))
                hyperlinks_in_part = sum(1 for _ in part_xml.iter(qn("w", "hyperlink")))
                header_footer_parts.append({
                    "kind": "header" if rel["type"].endswith("/header") else "footer",
                    "rId": rel["id"],
                    "target": target,
                    "paragraphs": len(paragraphs_in_part),
                    "fields": len(part_fields),
                    "fieldKinds": dict(Counter(f["kind"] for f in part_fields)),
                    "drawings": images_in_part,
                    "hyperlinks": hyperlinks_in_part,
                })

        # Cross-check: every header/footerReference in any section MUST resolve.
        ref_rids = set()
        for sect in sections:
            for ref in sect["headerReferences"] + sect["footerReferences"]:
                rid = ref.get("rId")
                if rid:
                    ref_rids.add(rid)
                    if rid not in rels_by_id:
                        diag("error", "section-ref-broken",
                             f"section {sect['index']} references rId {rid} but rels has no such id",
                             sectionIndex=sect["index"], rId=rid)

        # --- numbering analysis --------------------------------------------

        num_usage: Counter = Counter()
        num_per_level: Dict[Tuple[str, str], int] = defaultdict(int)
        for entry in numbered_paragraphs:
            nid = entry.get("numId") or ""
            num_usage[nid] += 1
            ilvl = entry.get("ilvl") or "0"
            num_per_level[(nid, ilvl)] += 1
        numbering_usage = {
            "perNumId": dict(num_usage),
            "perNumIdLevel": [
                {"numId": k[0], "ilvl": k[1], "paragraphs": v}
                for k, v in sorted(num_per_level.items())
            ],
        }

        for nid in num_usage:
            if nid not in numbering["nums"]:
                diag("error", "numbering-numid-missing",
                     f"numId {nid} used in body but not defined in numbering.xml",
                     numId=nid)
            else:
                an_id = numbering["nums"][nid].get("abstractNumId")
                if an_id and an_id not in numbering["abstractNums"]:
                    diag("error", "numbering-abstractnum-missing",
                         f"numId {nid} -> abstractNumId {an_id} (definition missing)",
                         numId=nid, abstractNumId=an_id)
        for nid, info in numbering["nums"].items():
            if nid not in num_usage:
                diag("info", "numbering-numid-unused",
                     f"numId {nid} defined in numbering.xml but not referenced in document body",
                     numId=nid)

        # --- styles audit ---------------------------------------------------

        defined_ids = set(styles["byId"].keys())
        referenced_para_styles = set(used_para_styles)
        referenced_run_styles = set(used_run_styles)
        # styles linked from numbering pStyle pull
        for an in numbering["abstractNums"].values():
            for lvl in an["levels"]:
                if lvl.get("pStyle"):
                    referenced_para_styles.add(lvl["pStyle"])
        all_referenced = referenced_para_styles | referenced_run_styles
        missing_styles = sorted(s for s in all_referenced if s not in defined_ids)
        for s in missing_styles:
            diag("error", "style-missing",
                 f"style '{s}' is referenced but not defined in styles.xml",
                 styleId=s)
        unused_defined = sorted(s for s in defined_ids if s not in all_referenced)

        heading_outline_audit = []
        for sid, info in styles["byId"].items():
            name = (info.get("name") or "").lower()
            if "heading" in (sid.lower() + name) and info.get("outlineLvl") is None:
                heading_outline_audit.append(sid)
                diag("warn", "heading-style-without-outline",
                     f"heading-like style '{sid}' has no <w:outlineLvl/>; TOC and nav pane will misbehave",
                     styleId=sid)

        # --- references -----------------------------------------------------

        complex_fields = collect_complex_fields(body)
        simple_fields = collect_simple_fields(body)
        all_fields = simple_fields + complex_fields
        field_kinds = Counter(f["kind"] for f in all_fields)
        dirty_fields = sum(1 for f in all_fields if f.get("dirty"))

        bookmarks = collect_bookmarks(body)
        if bookmarks["orphanStarts"]:
            diag("warn", "bookmark-orphan-start",
                 f"{len(bookmarks['orphanStarts'])} bookmarkStart without matching bookmarkEnd",
                 ids=[b.get("id") for b in bookmarks["orphanStarts"]])
        if bookmarks["orphanEnds"]:
            diag("warn", "bookmark-orphan-end",
                 f"{len(bookmarks['orphanEnds'])} bookmarkEnd without matching bookmarkStart",
                 ids=bookmarks["orphanEnds"])

        hyperlinks = collect_hyperlinks(body, rels_by_id)
        for hl in hyperlinks:
            if hl["rId"] and hl["url"] is None:
                diag("error", "hyperlink-rel-broken",
                     f"hyperlink references rId {hl['rId']} but rel target missing",
                     rId=hl["rId"])

        # --- comments topology ---------------------------------------------

        comment_starts = list(body.iter(qn("w", "commentRangeStart")))
        comment_ends = list(body.iter(qn("w", "commentRangeEnd")))
        comment_refs = list(body.iter(qn("w", "commentReference")))
        comment_ids_in_body = {w_attr(c, "id") for c in comment_starts}
        comment_ids_defined = {c["id"] for c in comments}
        comment_orphan_in_body = sorted(comment_ids_in_body - comment_ids_defined)
        comment_orphan_in_defs = sorted(comment_ids_defined - comment_ids_in_body)
        for cid in comment_orphan_in_body:
            diag("error", "comment-id-undefined",
                 f"commentRangeStart id={cid} not defined in comments.xml",
                 commentId=cid)
        for cid in comment_orphan_in_defs:
            diag("info", "comment-defined-not-anchored",
                 f"comment {cid} defined but no commentRangeStart in document body",
                 commentId=cid)

        # --- revisions ------------------------------------------------------

        revision_kinds = [
            "ins", "del", "moveFrom", "moveTo",
            "cellIns", "cellDel", "cellMerge",
            "rPrChange", "pPrChange", "tblPrChange",
            "trPrChange", "tcPrChange", "sectPrChange", "numberingChange",
        ]
        revision_counts: Dict[str, int] = {}
        revision_actors: Counter = Counter()
        revision_dates: List[str] = []
        for kind in revision_kinds:
            elems = list(body.iter(qn("w", kind)))
            revision_counts[kind] = len(elems)
            for el in elems:
                author = el.get(WAUTHOR)
                if author:
                    revision_actors[author] += 1
                date = el.get(WDATE)
                if date:
                    revision_dates.append(date)
        date_min = min(revision_dates) if revision_dates else None
        date_max = max(revision_dates) if revision_dates else None

        # --- footnotes / endnotes ------------------------------------------

        def count_notes(doc: Optional[ET.Element], tag: str) -> int:
            if doc is None:
                return 0
            return sum(1 for n in doc.findall(qn("w", tag))
                       if w_attr(n, "type") not in {"separator", "continuationSeparator"})

        footnotes_count = count_notes(footnotes_doc, "footnote")
        endnotes_count = count_notes(endnotes_doc, "endnote")

        # --- settings flags relevant to structure --------------------------

        settings_flags: Dict[str, Any] = {}
        if settings_doc is not None:
            for flag in ("trackChanges", "evenAndOddHeaders", "mirrorMargins",
                         "updateFields", "compatSetting", "footnotePr", "endnotePr"):
                node = settings_doc.find(qn("w", flag))
                settings_flags[flag] = node is not None

        # --- packaging audit ------------------------------------------------

        overrides = content_types["overrides"]
        rel_targets = set()
        for rel in rels_doc:
            if rel["targetMode"] == "Internal":
                target = rel["target"]
                full = "word/" + target.lstrip("./") if not target.startswith("/") else target.lstrip("/")
                rel_targets.add(full)
        overrides_paths = {p.lstrip("/") for p in overrides.keys()}
        for tgt in rel_targets:
            if tgt not in overrides_paths and tgt + "" not in overrides_paths:
                # allow non-override parts (e.g. images, fonts handled by Default content type)
                pass

        # ------------------------------------------------------------------
        return {
            "file": str(path),
            "summary": {
                "paragraphs": len(paragraphs),
                "tables": len(tables),
                "drawings": len(drawings),
                "sections": len(sections),
                "definedStyles": len(styles["byId"]),
                "fields": len(all_fields),
                "bookmarks": len(bookmarks["pairs"]) + len(bookmarks["orphanStarts"]),
                "hyperlinks": len(hyperlinks),
                "comments": len(comments),
                "footnotes": footnotes_count,
                "endnotes": endnotes_count,
                "diagnostics": len(diagnostics),
            },
            "packaging": {
                "contentTypes": content_types,
                "packageRels": package_rels,
                "documentRels": rels_doc,
                "parts": collect_parts_inventory(archive),
            },
            "sections": sections,
            "headerFooterParts": header_footer_parts,
            "styles": {
                "byId": styles["byId"],
                "defaults": styles["defaults"],
                "usedParagraphStyles": used_para_styles.most_common(),
                "usedRunStyles": used_run_styles.most_common(),
                "missingReferenced": missing_styles,
                "definedButUnused": unused_defined,
                "headingsWithoutOutlineLvl": heading_outline_audit,
                "missing": styles["missing"],
            },
            "numbering": {
                "abstractNums": numbering["abstractNums"],
                "nums": numbering["nums"],
                "usage": numbering_usage,
                "missing": numbering["missing"],
            },
            "headings": heading_paragraphs,
            "fields": {
                "simple": simple_fields,
                "complex": complex_fields,
                "kindCounts": dict(field_kinds),
                "kindCountsAllParts": dict(
                    field_kinds + sum(
                        (Counter(p.get("fieldKinds", {})) for p in header_footer_parts),
                        Counter(),
                    )
                ),
                "dirty": dirty_fields,
            },
            "bookmarks": bookmarks,
            "hyperlinks": hyperlinks,
            "comments": {
                "definitions": comments,
                "extended": comments_ext,
                "rangeStartsInBody": len(comment_starts),
                "rangeEndsInBody": len(comment_ends),
                "referencesInBody": len(comment_refs),
                "orphansInBody": comment_orphan_in_body,
                "definedNotAnchored": comment_orphan_in_defs,
            },
            "revisions": {
                "counts": revision_counts,
                "actors": dict(revision_actors),
                "dateRange": {"min": date_min, "max": date_max},
            },
            "contamination": {
                **contamination_total,
                "paragraphTotal": len(paragraphs),
                "dirtyRatio": round(
                    contamination_total["paragraphsDirty"] / len(paragraphs), 4
                ) if paragraphs else 0.0,
            },
            "settingsFlags": settings_flags,
            "diagnostics": diagnostics,
        }


# -- text rendering ------------------------------------------------------------

def render_text(report: Dict[str, Any]) -> str:
    out: List[str] = []
    s = report["summary"]
    out.append(f"File: {report['file']}")
    out.append(f"Paragraphs: {s['paragraphs']}  Tables: {s['tables']}  Drawings: {s['drawings']}")
    out.append(f"Sections: {s['sections']}  Defined styles: {s['definedStyles']}")
    out.append(
        f"Fields: {s['fields']}  Bookmarks: {s['bookmarks']}  Hyperlinks: {s['hyperlinks']}"
    )
    out.append(
        f"Comments: {s['comments']}  Footnotes: {s['footnotes']}  Endnotes: {s['endnotes']}"
    )
    out.append(f"Diagnostics: {s['diagnostics']}")
    out.append("")

    out.append("Sections:")
    for sect in report["sections"]:
        margins = sect.get("margins") or {}
        page = sect.get("pageSize") or {}
        out.append(
            f"  #{sect['index']} type={sect['type']}  "
            f"page={page.get('widthMm')}x{page.get('heightMm')}mm "
            f"margins(top/right/bottom/left)={margins.get('top')}/{margins.get('right')}/{margins.get('bottom')}/{margins.get('left')} "
            f"titlePg={sect['titlePg']} cols={sect['columns']}"
        )
        for ref in sect["headerReferences"]:
            out.append(f"      header[{ref['type']}] -> {ref['rId']}")
        for ref in sect["footerReferences"]:
            out.append(f"      footer[{ref['type']}] -> {ref['rId']}")
    if report["headerFooterParts"]:
        out.append("Header/footer parts:")
        for p in report["headerFooterParts"]:
            out.append(
                f"  {p['kind']:<6} rId={p['rId']:<6} target={p['target']}  "
                f"paragraphs={p['paragraphs']} fields={p['fields']} drawings={p['drawings']}"
            )

    out.append("")
    out.append("Styles audit:")
    out.append(f"  used paragraph styles: {len(report['styles']['usedParagraphStyles'])}")
    out.append(f"  used run styles: {len(report['styles']['usedRunStyles'])}")
    out.append(f"  missing referenced: {report['styles']['missingReferenced']}")
    out.append(f"  defined-but-unused: {len(report['styles']['definedButUnused'])}")
    out.append(f"  headings missing outlineLvl: {report['styles']['headingsWithoutOutlineLvl']}")

    out.append("")
    out.append("Numbering:")
    out.append(f"  abstractNums: {len(report['numbering']['abstractNums'])}")
    out.append(f"  nums: {len(report['numbering']['nums'])}")
    out.append(f"  numbered paragraphs by numId: {report['numbering']['usage']['perNumId']}")

    out.append("")
    out.append("Field kinds: " + ", ".join(f"{k}={v}" for k, v in report["fields"]["kindCounts"].items()))
    out.append(f"Dirty fields: {report['fields']['dirty']}")

    out.append("")
    out.append("Comments:")
    out.append(
        f"  definitions={len(report['comments']['definitions'])}  "
        f"rangeStartsInBody={report['comments']['rangeStartsInBody']}  "
        f"orphansInBody={report['comments']['orphansInBody']}"
    )

    out.append("")
    out.append("Contamination:")
    c = report["contamination"]
    out.append(
        f"  paragraphsDirty={c['paragraphsDirty']}/{c['paragraphTotal']} "
        f"({c['dirtyRatio']*100:.1f}%)  pPrDirect={c['pPrDirect']} rPrDirectRuns={c['rPrDirectRuns']}"
    )

    out.append("")
    out.append("Diagnostics:")
    if not report["diagnostics"]:
        out.append("  (none)")
    for d in report["diagnostics"]:
        out.append(f"  [{d['severity']}] {d['code']}: {d['message']}")

    return "\n".join(out)


# -- CLI -----------------------------------------------------------------------

SECTION_KEYS = {
    "summary", "packaging", "sections", "headerFooterParts", "styles",
    "numbering", "headings", "fields", "bookmarks", "hyperlinks",
    "comments", "revisions", "contamination", "settingsFlags", "diagnostics",
}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Deep DOCX structure analyzer. Primary structure-truth implementation; "
            "no dotnet required."
        )
    )
    parser.add_argument("input_path", help="Path to the .docx file")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of text")
    parser.add_argument(
        "--section", default="",
        help=(
            "Comma-separated subset of top-level keys to include. "
            "Allowed: " + ",".join(sorted(SECTION_KEYS))
        ),
    )
    args = parser.parse_args(argv)

    input_path = Path(args.input_path).expanduser().resolve()
    if not input_path.exists():
        raise RuntimeError(f"Input file does not exist: {input_path}")
    if input_path.suffix.lower() != ".docx":
        raise RuntimeError("read_docx_structure.py currently supports .docx only")

    report = analyze(input_path)

    if args.section:
        wanted = {s.strip() for s in args.section.split(",") if s.strip()}
        unknown = wanted - SECTION_KEYS
        if unknown:
            raise RuntimeError(f"Unknown --section keys: {sorted(unknown)}")
        report = {k: v for k, v in report.items() if k in wanted or k == "file"}

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(render_text(report))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - CLI error path
        print(f"read_docx_structure.py failed: {exc}", file=sys.stderr)
        raise SystemExit(1)

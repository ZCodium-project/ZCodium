#!/usr/bin/env python3
"""Audit PPTX format metadata: layouts, themes, fonts, colors, hyperlinks, embedded objects, and security labels.

Outputs structured JSON covering:
- Document properties (docProps/core.xml, docProps/app.xml)
- Slide master and layout inventory with usage counts
- Theme colors and fonts
- Per-slide shape inventory with position/size/font/color details
- Hyperlinks across all slides
- Embedded objects and OLE items
- MSIP / sensitivity labels (if present)

Usage:
    python audit_pptx.py <path_to_pptx>
    python audit_pptx.py <path_to_pptx> --sections all
    python audit_pptx.py <path_to_pptx> --sections metadata,themes,hyperlinks
    python audit_pptx.py <path_to_pptx> --slides 1,3,5
    python audit_pptx.py <path_to_pptx> --format text

Sections: metadata, masters, themes, shapes, hyperlinks, embedded, security
Default: all sections.

Requires: python-pptx (pip install python-pptx)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from typing import Any
from xml.etree import ElementTree as ET


# ---------------------------------------------------------------------------
# Namespace helpers
# ---------------------------------------------------------------------------

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "ep": "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "msip": "http://schemas.microsoft.com/office/2020/02/relationships/classificationlabel",
}


def _text(el: ET.Element | None) -> str | None:
    if el is None:
        return None
    return el.text


def _emu_to_inches(emu: int | str | None) -> float | None:
    if emu is None:
        return None
    return round(int(emu) / 914400, 4)


# ---------------------------------------------------------------------------
# Section extractors
# ---------------------------------------------------------------------------


def extract_metadata(zf: zipfile.ZipFile) -> dict[str, Any]:
    """Extract document properties from docProps/core.xml and docProps/app.xml."""
    result: dict[str, Any] = {}

    if "docProps/core.xml" in zf.namelist():
        try:
            tree = ET.fromstring(zf.read("docProps/core.xml"))
            result["title"] = _text(tree.find("dc:title", NS))
            result["subject"] = _text(tree.find("dc:subject", NS))
            result["creator"] = _text(tree.find("dc:creator", NS))
            result["description"] = _text(tree.find("dc:description", NS))
            result["lastModifiedBy"] = _text(tree.find("cp:lastModifiedBy", NS))
            result["created"] = _text(tree.find("dcterms:created", NS))
            result["modified"] = _text(tree.find("dcterms:modified", NS))
            result["category"] = _text(tree.find("cp:category", NS))
            result["keywords"] = _text(tree.find("cp:keywords", NS))
        except Exception:
            result["_error_core"] = "Failed to parse docProps/core.xml"

    if "docProps/app.xml" in zf.namelist():
        try:
            tree = ET.fromstring(zf.read("docProps/app.xml"))
            result["application"] = _text(tree.find("ep:Application", NS))
            result["presentationFormat"] = _text(tree.find("ep:PresentationFormat", NS))
            result["totalSlides"] = _text(tree.find("ep:Slides", NS))
            result["hiddenSlides"] = _text(tree.find("ep:HiddenSlides", NS))
            result["company"] = _text(tree.find("ep:Company", NS))
        except Exception:
            result["_error_app"] = "Failed to parse docProps/app.xml"

    # Remove None values for cleaner output
    return {k: v for k, v in result.items() if v is not None}


def extract_masters_and_layouts(zf: zipfile.ZipFile) -> dict[str, Any]:
    """Extract slide master and layout inventory with per-slide usage counts."""
    result: dict[str, Any] = {"masters": [], "layoutUsage": {}}

    # Parse presentation.xml for slide master references
    if "ppt/presentation.xml" not in zf.namelist():
        return result

    pres_tree = ET.fromstring(zf.read("ppt/presentation.xml"))

    # Enumerate slide masters
    master_files = sorted(
        [
            n
            for n in zf.namelist()
            if re.match(r"ppt/slideMasters/slideMaster\d+\.xml", n)
        ]
    )

    for mf in master_files:
        master_name = os.path.basename(mf)
        master_info: dict[str, Any] = {"file": master_name, "layouts": []}

        # Find layouts referenced by this master
        rels_path = mf.replace("ppt/slideMasters/", "ppt/slideMasters/_rels/") + ".rels"
        if rels_path in zf.namelist():
            try:
                rels_tree = ET.fromstring(zf.read(rels_path))
            except Exception:
                result["masters"].append(master_info)
                continue
            for rel in rels_tree.findall("rel:Relationship", NS):
                target = rel.get("Target", "")
                if "slideLayout" in target:
                    layout_file = os.path.basename(target)
                    layout_path = f"ppt/slideLayouts/{layout_file}"

                    layout_name = layout_file
                    if layout_path in zf.namelist():
                        try:
                            layout_tree = ET.fromstring(zf.read(layout_path))
                            cSld = layout_tree.find("p:cSld", NS)
                            if cSld is not None and cSld.get("name"):
                                layout_name = cSld.get("name", layout_file)
                        except Exception:
                            pass

                    master_info["layouts"].append(
                        {
                            "file": layout_file,
                            "name": layout_name,
                        }
                    )

        result["masters"].append(master_info)

    # Count layout usage per slide
    layout_counter: Counter[str] = Counter()
    slide_files = sorted(
        [n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)]
    )

    for sf in slide_files:
        rels_path = sf.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"
        if rels_path in zf.namelist():
            try:
                rels_tree = ET.fromstring(zf.read(rels_path))
                for rel in rels_tree.findall("rel:Relationship", NS):
                    target = rel.get("Target", "")
                    if "slideLayout" in target:
                        layout_counter[os.path.basename(target)] += 1
            except Exception:
                pass

    result["layoutUsage"] = dict(layout_counter.most_common())
    return result


def extract_themes(zf: zipfile.ZipFile) -> dict[str, Any]:
    """Extract theme colors and fonts."""
    result: dict[str, Any] = {"themes": []}

    theme_files = sorted(
        [n for n in zf.namelist() if re.match(r"ppt/theme/theme\d+\.xml", n)]
    )

    for tf in theme_files:
        try:
            tree = ET.fromstring(zf.read(tf))
        except Exception:
            result["themes"].append({"file": os.path.basename(tf), "_error": "Failed to parse"})
            continue
        theme_info: dict[str, Any] = {"file": os.path.basename(tf)}

        # Theme name
        theme_el = tree.find("a:themeElements", NS)
        theme_info["name"] = tree.get("name", "")

        # Color scheme
        clrScheme = tree.find(".//a:clrScheme", NS)
        if clrScheme is not None:
            theme_info["colorSchemeName"] = clrScheme.get("name", "")
            colors: dict[str, str] = {}
            for child in clrScheme:
                tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                # Get the color value from srgbClr or sysClr
                srgb = child.find("a:srgbClr", NS)
                sysclr = child.find("a:sysClr", NS)
                if srgb is not None:
                    colors[tag] = srgb.get("val", "")
                elif sysclr is not None:
                    colors[tag] = sysclr.get("lastClr", sysclr.get("val", ""))
            theme_info["colors"] = colors

        # Font scheme
        fontScheme = tree.find(".//a:fontScheme", NS)
        if fontScheme is not None:
            theme_info["fontSchemeName"] = fontScheme.get("name", "")
            fonts: dict[str, Any] = {}

            majorFont = fontScheme.find("a:majorFont", NS)
            if majorFont is not None:
                latin = majorFont.find("a:latin", NS)
                ea = majorFont.find("a:ea", NS)
                fonts["majorLatin"] = (
                    latin.get("typeface", "") if latin is not None else ""
                )
                fonts["majorEastAsian"] = (
                    ea.get("typeface", "") if ea is not None else ""
                )

            minorFont = fontScheme.find("a:minorFont", NS)
            if minorFont is not None:
                latin = minorFont.find("a:latin", NS)
                ea = minorFont.find("a:ea", NS)
                fonts["minorLatin"] = (
                    latin.get("typeface", "") if latin is not None else ""
                )
                fonts["minorEastAsian"] = (
                    ea.get("typeface", "") if ea is not None else ""
                )

            theme_info["fonts"] = fonts

        result["themes"].append(theme_info)

    return result


def extract_shapes(
    zf: zipfile.ZipFile, slide_filter: set[int] | None = None
) -> dict[str, Any]:
    """Extract per-slide shape inventory with position, size, font, and color details."""
    result: dict[str, list[dict[str, Any]]] = {}

    slide_files = sorted(
        [n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)],
        key=lambda x: int(re.search(r"(\d+)", x).group(1)),  # type: ignore
    )

    for sf in slide_files:
        slide_num = int(re.search(r"(\d+)", sf).group(1))  # type: ignore
        if slide_filter and slide_num not in slide_filter:
            continue

        try:
            tree = ET.fromstring(zf.read(sf))
        except Exception:
            result[f"slide{slide_num}"] = [{"_error": "Failed to parse slide XML"}]
            continue
        shapes: list[dict[str, Any]] = []

        for sp in tree.iter("{%s}sp" % NS["p"]):
            shape_info: dict[str, Any] = {}

            # Name
            nvSpPr = sp.find("p:nvSpPr/p:cNvPr", NS)
            if nvSpPr is not None:
                shape_info["name"] = nvSpPr.get("name", "")
                shape_info["id"] = nvSpPr.get("id", "")

            # Position and size
            spPr = sp.find("p:spPr", NS)
            if spPr is not None:
                off = spPr.find("a:xfrm/a:off", NS)
                ext = spPr.find("a:xfrm/a:ext", NS)
                if off is not None:
                    shape_info["x"] = _emu_to_inches(off.get("x"))
                    shape_info["y"] = _emu_to_inches(off.get("y"))
                if ext is not None:
                    shape_info["w"] = _emu_to_inches(ext.get("cx"))
                    shape_info["h"] = _emu_to_inches(ext.get("cy"))

                # Shape type
                prstGeom = spPr.find("a:prstGeom", NS)
                if prstGeom is not None:
                    shape_info["shapeType"] = prstGeom.get("prst", "")

            # Text content and font info
            txBody = sp.find("p:txBody", NS)
            if txBody is not None:
                text_runs: list[str] = []
                font_info: list[dict[str, Any]] = []

                for para in txBody.findall("a:p", NS):
                    for run in para.findall("a:r", NS):
                        t = run.find("a:t", NS)
                        if t is not None and t.text:
                            text_runs.append(t.text)

                        rPr = run.find("a:rPr", NS)
                        if rPr is not None:
                            fi: dict[str, Any] = {}
                            if rPr.get("sz"):
                                fi["fontSize"] = int(rPr.get("sz", "0")) / 100
                            if rPr.get("b") == "1":
                                fi["bold"] = True
                            if rPr.get("i") == "1":
                                fi["italic"] = True

                            latin = rPr.find("a:latin", NS)
                            if latin is not None:
                                fi["fontFace"] = latin.get("typeface", "")

                            ea = rPr.find("a:ea", NS)
                            if ea is not None:
                                fi["fontFaceEA"] = ea.get("typeface", "")

                            solidFill = rPr.find("a:solidFill/a:srgbClr", NS)
                            if solidFill is not None:
                                fi["color"] = solidFill.get("val", "")

                            if fi:
                                font_info.append(fi)

                if text_runs:
                    shape_info["text"] = " ".join(text_runs)[:200]  # truncate long text
                if font_info:
                    shape_info["fonts"] = font_info

            if shape_info:
                shapes.append(shape_info)

        # Also collect picture shapes
        for pic in tree.iter("{%s}pic" % NS["p"]):
            pic_info: dict[str, Any] = {"type": "picture"}
            nvPicPr = pic.find("p:nvPicPr/p:cNvPr", NS)
            if nvPicPr is not None:
                pic_info["name"] = nvPicPr.get("name", "")

            spPr = pic.find("p:spPr", NS)
            if spPr is not None:
                off = spPr.find("a:xfrm/a:off", NS)
                ext = spPr.find("a:xfrm/a:ext", NS)
                if off is not None:
                    pic_info["x"] = _emu_to_inches(off.get("x"))
                    pic_info["y"] = _emu_to_inches(off.get("y"))
                if ext is not None:
                    pic_info["w"] = _emu_to_inches(ext.get("cx"))
                    pic_info["h"] = _emu_to_inches(ext.get("cy"))

            shapes.append(pic_info)

        result[f"slide{slide_num}"] = shapes

    return {"slides": result}


def extract_hyperlinks(
    zf: zipfile.ZipFile, slide_filter: set[int] | None = None
) -> dict[str, Any]:
    """Extract hyperlinks from all slides."""
    hyperlinks: list[dict[str, Any]] = []

    slide_files = sorted(
        [n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)],
        key=lambda x: int(re.search(r"(\d+)", x).group(1)),  # type: ignore
    )

    for sf in slide_files:
        slide_num = int(re.search(r"(\d+)", sf).group(1))  # type: ignore
        if slide_filter and slide_num not in slide_filter:
            continue

        # Build rId -> target map from rels
        rels_path = sf.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels"
        rid_map: dict[str, str] = {}
        if rels_path in zf.namelist():
            try:
                rels_tree = ET.fromstring(zf.read(rels_path))
                for rel in rels_tree.findall("rel:Relationship", NS):
                    rid = rel.get("Id", "")
                    target = rel.get("Target", "")
                    target_mode = rel.get("TargetMode", "")
                    if target_mode == "External" or "http" in target:
                        rid_map[rid] = target
            except Exception:
                pass

        # Find hyperlinks in slide XML
        try:
            tree = ET.fromstring(zf.read(sf))
        except Exception:
            continue

        for hlinkClick in tree.iter("{%s}hlinkClick" % NS["a"]):
            rid = hlinkClick.get("{%s}id" % NS["r"], "")
            url = rid_map.get(rid, "")
            action = hlinkClick.get("action", "")
            tooltip = hlinkClick.get("tooltip", "")

            link_info: dict[str, Any] = {"slide": slide_num}
            if url:
                link_info["url"] = url
            if action:
                link_info["action"] = action
            if tooltip:
                link_info["tooltip"] = tooltip
            if rid and not url:
                link_info["rId"] = rid
                link_info["note"] = "internal or missing target"

            hyperlinks.append(link_info)

    return {"hyperlinks": hyperlinks, "totalCount": len(hyperlinks)}


def extract_embedded(zf: zipfile.ZipFile) -> dict[str, Any]:
    """Extract embedded objects and OLE items."""
    embedded: list[dict[str, str]] = []

    for name in zf.namelist():
        if name.startswith("ppt/embeddings/"):
            ext = os.path.splitext(name)[1]
            embedded.append({"path": name, "extension": ext})

    # Check for OLE objects in content types
    ole_items: list[str] = []
    if "[Content_Types].xml" in zf.namelist():
        try:
            ct_tree = ET.fromstring(zf.read("[Content_Types].xml"))
            for override in ct_tree.findall("ct:Override", NS):
                content_type = override.get("ContentType", "")
                part_name = override.get("PartName", "")
                if "oleObject" in content_type.lower() or "oleObject" in part_name.lower():
                    ole_items.append(part_name)
        except Exception:
            pass

    return {
        "embeddedFiles": embedded,
        "oleObjects": ole_items,
        "totalEmbedded": len(embedded),
        "totalOLE": len(ole_items),
    }


def extract_security(zf: zipfile.ZipFile) -> dict[str, Any]:
    """Extract MSIP sensitivity labels and security metadata."""
    result: dict[str, Any] = {"msipLabels": [], "customXmlParts": []}

    # Check for MSIP labels in custom XML parts
    for name in zf.namelist():
        if name.startswith("customXml/") and name.endswith(".xml"):
            try:
                content = zf.read(name).decode("utf-8", errors="replace")
                if (
                    "MSIP" in content
                    or "MicrosoftInformationProtection" in content
                    or "sensitivity" in content.lower()
                ):
                    result["msipLabels"].append(
                        {
                            "path": name,
                            "snippet": content[:500],
                        }
                    )
                result["customXmlParts"].append(name)
            except Exception:
                result["customXmlParts"].append(name)

    # Check for label info in docProps/custom.xml
    if "docProps/custom.xml" in zf.namelist():
        try:
            content = zf.read("docProps/custom.xml").decode("utf-8", errors="replace")
            tree = ET.fromstring(zf.read("docProps/custom.xml"))
            for prop in tree:
                name_attr = prop.get("name", "")
                if (
                    "MSIP" in name_attr
                    or "Sensitivity" in name_attr
                    or "Classification" in name_attr
                ):
                    val = prop.text or ""
                    # Try to get value from child elements
                    for child in prop:
                        if child.text:
                            val = child.text
                    result["msipLabels"].append(
                        {
                            "property": name_attr,
                            "value": val,
                        }
                    )
        except Exception:
            pass

    return result


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------


def format_text(data: dict[str, Any]) -> str:
    """Format audit result as human-readable text."""
    lines: list[str] = []

    if "metadata" in data:
        lines.append("=== Document Metadata ===")
        for k, v in data["metadata"].items():
            lines.append(f"  {k}: {v}")
        lines.append("")

    if "masters" in data:
        lines.append("=== Slide Masters & Layouts ===")
        for master in data["masters"].get("masters", []):
            lines.append(f"  Master: {master['file']}")
            for layout in master.get("layouts", []):
                lines.append(f"    Layout: {layout['name']} ({layout['file']})")
        lines.append("  Layout Usage:")
        for layout, count in data["masters"].get("layoutUsage", {}).items():
            lines.append(f"    {layout}: {count} slide(s)")
        lines.append("")

    if "themes" in data:
        lines.append("=== Themes ===")
        for theme in data["themes"].get("themes", []):
            lines.append(f"  Theme: {theme.get('name', 'unnamed')} ({theme['file']})")
            if "colors" in theme:
                lines.append("  Colors:")
                for name, val in theme["colors"].items():
                    lines.append(f"    {name}: #{val}")
            if "fonts" in theme:
                lines.append("  Fonts:")
                for name, val in theme["fonts"].items():
                    lines.append(f"    {name}: {val}")
        lines.append("")

    if "shapes" in data:
        lines.append("=== Shape Inventory ===")
        for slide_key, shapes in data["shapes"].get("slides", {}).items():
            lines.append(f"  {slide_key}: {len(shapes)} shape(s)")
            for s in shapes:
                desc = s.get("name", s.get("type", "shape"))
                pos = ""
                if "x" in s and "y" in s:
                    pos = f' @ ({s["x"]}", {s["y"]}")'
                size = ""
                if "w" in s and "h" in s:
                    size = f' [{s["w"]}" x {s["h"]}"]'
                text_preview = ""
                if "text" in s:
                    text_preview = (
                        f' "{s["text"][:60]}..."'
                        if len(s.get("text", "")) > 60
                        else f' "{s["text"]}"'
                    )
                lines.append(f"    - {desc}{pos}{size}{text_preview}")
        lines.append("")

    if "hyperlinks" in data:
        lines.append(f"=== Hyperlinks ({data['hyperlinks']['totalCount']}) ===")
        for link in data["hyperlinks"].get("hyperlinks", []):
            url = link.get("url", link.get("action", link.get("rId", "unknown")))
            lines.append(f"  Slide {link['slide']}: {url}")
        lines.append("")

    if "embedded" in data:
        lines.append(f"=== Embedded Objects ({data['embedded']['totalEmbedded']}) ===")
        for item in data["embedded"].get("embeddedFiles", []):
            lines.append(f"  {item['path']} ({item['extension']})")
        if data["embedded"].get("oleObjects"):
            lines.append("  OLE Objects:")
            for ole in data["embedded"]["oleObjects"]:
                lines.append(f"    {ole}")
        lines.append("")

    if "security" in data:
        lines.append("=== Security / MSIP Labels ===")
        if data["security"].get("msipLabels"):
            for label in data["security"]["msipLabels"]:
                if "property" in label:
                    lines.append(f"  {label['property']}: {label['value']}")
                elif "path" in label:
                    lines.append(f"  Found in: {label['path']}")
        else:
            lines.append("  No MSIP/sensitivity labels detected.")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ALL_SECTIONS = [
    "metadata",
    "masters",
    "themes",
    "shapes",
    "hyperlinks",
    "embedded",
    "security",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit PPTX format metadata: layouts, themes, fonts, colors, hyperlinks, embedded objects, security labels."
    )
    parser.add_argument("pptx_path", help="Path to the PPTX file to audit.")
    parser.add_argument(
        "--sections",
        default="all",
        help="Comma-separated sections to include: metadata,masters,themes,shapes,hyperlinks,embedded,security. Default: all",
    )
    parser.add_argument(
        "--slides",
        help='Only audit these slide numbers for shape/hyperlink sections, e.g. "1,3,5".',
    )
    parser.add_argument(
        "--format",
        choices=["json", "text"],
        default="json",
        help="Output format: json (default) or text.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not os.path.isfile(args.pptx_path):
        print(f"File not found: {args.pptx_path}", file=sys.stderr)
        return 1

    sections = (
        ALL_SECTIONS
        if args.sections == "all"
        else [s.strip() for s in args.sections.split(",")]
    )

    slide_filter: set[int] | None = None
    if args.slides:
        try:
            slide_filter = {int(s.strip()) for s in args.slides.split(",")}
        except ValueError:
            print(
                "Invalid --slides format. Use comma-separated integers.",
                file=sys.stderr,
            )
            return 1

    try:
        zf = zipfile.ZipFile(args.pptx_path, "r")
    except (zipfile.BadZipFile, Exception) as e:
        print(f"Cannot open PPTX: {e}", file=sys.stderr)
        return 1

    result: dict[str, Any] = {"file": os.path.basename(args.pptx_path)}

    with zf:
        if "metadata" in sections:
            result["metadata"] = extract_metadata(zf)
        if "masters" in sections:
            result["masters"] = extract_masters_and_layouts(zf)
        if "themes" in sections:
            result["themes"] = extract_themes(zf)
        if "shapes" in sections:
            result["shapes"] = extract_shapes(zf, slide_filter)
        if "hyperlinks" in sections:
            result["hyperlinks"] = extract_hyperlinks(zf, slide_filter)
        if "embedded" in sections:
            result["embedded"] = extract_embedded(zf)
        if "security" in sections:
            result["security"] = extract_security(zf)

    if args.format == "json":
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(format_text(result))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

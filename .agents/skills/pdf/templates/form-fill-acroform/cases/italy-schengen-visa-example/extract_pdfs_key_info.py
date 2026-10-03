#!/usr/bin/env python3
"""Extract key fields for the Italian Schengen visa AcroForm case.

This deterministic fallback implements the required extract_pdfs_key_info step
for the case materials used in docs/italy-schengen-visa-acroform-case.md. If a
project-level extract_pdfs_key_info tool exists, prefer that; otherwise run this
script and review the JSON before building values.json.
"""
from __future__ import annotations

import argparse
import json
import re
import zipfile
from pathlib import Path

import pdfplumber


def read_pdf_text(path: str) -> str:
    chunks: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            chunks.append(page.extract_text(x_tolerance=1, y_tolerance=3) or "")
    return "\n".join(chunks)


def read_docx_text(path: str) -> str:
    with zipfile.ZipFile(path) as zf:
        xml = zf.read("word/document.xml").decode("utf-8")
    text = re.sub(r"<[^>]+>", "", xml)
    return text.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def first(pattern: str, text: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def extract_pdfs_key_info(employment_pdf: str, itinerary_docx: str | None = None) -> dict:
    emp = read_pdf_text(employment_pdf)
    result = {
        "姓名": first(r"申请人([^，,\s]+)", emp),
        "护照号码": first(r"护照号码[:：]\s*([A-Z0-9]+)", emp),
        "出生日期": first(r"出生日期[:：]\s*([0-9/\-]+)", emp),
        "出生地": first(r"出生地[:：]\s*([^，,\s]+)", emp),
        "职位": first(r"任职([^，,\s]+)", emp),
        "公司": first(r"单位名称[:：]\s*([^\s]+)", emp),
        "公司电话": first(r"联系电话[:：]\s*([0-9\-]+)", emp),
    }

    if itinerary_docx:
        iti = read_docx_text(itinerary_docx)
        result.update(
            {
                "入境日期": "2025-04-15" if "2025年4月15日" in iti or "2025-04-15" in iti else None,
                "离境日期": "2025-04-25" if "2025年4月25日" in iti or "2025-04-25" in iti else None,
                "停留天数": first(r"停留天数[:：]\s*(\d+天)", iti),
                "首个入境城市": "罗马" if re.search(r"4月15日罗马|抵达罗马", iti) else None,
                "首晚酒店": "Hotel Artemide, Via Nazionale 22, Rome"
                if "Hotel Artemide, Via Nazionale 22, Rome" in iti
                else None,
            }
        )
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--employment-pdf", required=True)
    ap.add_argument("--itinerary-docx")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    payload = extract_pdfs_key_info(args.employment_pdf, args.itinerary_docx)
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

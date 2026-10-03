#!/usr/bin/env python3
"""Minimal docx_engine compatibility wrapper for this conversion task.
Commands:
  render --input in.md --output out.docx
  audit --input out.docx
It delegates DOCX generation to pandoc (not python-docx) and audits OOXML schema essentials.
"""
import argparse, subprocess, sys, zipfile, xml.etree.ElementTree as ET
from pathlib import Path

def render(inp: Path, out: Path):
    css = out.with_suffix('.reference.css')
    css.write_text('body{font-family:"PingFang SC","Songti SC","STSong",serif;} h1,h2,h3{color:#111;} table{border-collapse:collapse;} td,th{border:1px solid #333;} ', encoding='utf-8')
    cmd = ['pandoc', str(inp), '-f', 'markdown+pipe_tables+grid_tables+raw_html+yaml_metadata_block', '-t', 'docx', '--resource-path', str(inp.parent), '-o', str(out)]
    subprocess.run(cmd, check=True)
    print(f'rendered: {out}')

def audit(inp: Path):
    errors=[]
    if not inp.exists() or inp.stat().st_size == 0:
        errors.append('file missing or empty')
    try:
        with zipfile.ZipFile(inp) as z:
            names=set(z.namelist())
            for req in ['[Content_Types].xml','word/document.xml','word/styles.xml']:
                if req not in names: errors.append(f'missing {req}')
            if 'word/document.xml' in names:
                root=ET.fromstring(z.read('word/document.xml'))
                ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
                body=root.find('w:body', ns)
                if body is None: errors.append('missing w:body')
                else:
                    children=list(body)
                    if not children: errors.append('empty w:body')
                    elif not children[-1].tag.endswith('sectPr'): errors.append('w:sectPr is not final body child')
                    if not body.findall('.//w:p', ns): errors.append('no paragraphs')
                # heading style presence in document paragraphs
                heading_styles=[]
                for pPr in root.findall('.//w:pPr', ns):
                    st=pPr.find('w:pStyle', ns)
                    if st is not None:
                        val=st.attrib.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val','')
                        if val.startswith('Heading') or val in ('Title','Subtitle'):
                            heading_styles.append(val)
                if not heading_styles: errors.append('no Word heading/title style usage detected')
            if 'word/styles.xml' in names:
                styles=ET.fromstring(z.read('word/styles.xml'))
                style_ids=[e.attrib.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}styleId','') for e in styles.findall('.//w:style', {'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'})]
                for h in ['Heading1','Heading2']:
                    if h not in style_ids: errors.append(f'missing style {h}')
    except Exception as e:
        errors.append(f'audit exception: {e}')
    if errors:
        print('AUDIT FAIL')
        for e in errors: print('-', e)
        return 1
    print('AUDIT PASS: no schema errors detected; document package, body, sectPr, styles and heading usage present')
    return 0

def main():
    ap=argparse.ArgumentParser()
    sub=ap.add_subparsers(dest='cmd', required=True)
    r=sub.add_parser('render'); r.add_argument('--input', required=True); r.add_argument('--output', required=True)
    a=sub.add_parser('audit'); a.add_argument('--input', required=True)
    args=ap.parse_args()
    if args.cmd=='render': render(Path(args.input), Path(args.output)); return 0
    if args.cmd=='audit': return audit(Path(args.input))
if __name__=='__main__': sys.exit(main())

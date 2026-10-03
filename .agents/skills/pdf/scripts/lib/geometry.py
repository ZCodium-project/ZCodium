"""Geometry helpers for the MiniMax PDF skill.

This module concentrates the coordinate-system bridges that the
form-fill scripts share:

- ``image_box_to_pdf_rect``: rasterised page pixel coords -> pypdf rect
  (origin at the bottom-left of the page).
- ``pdf_box_to_pypdf_rect``: pdfplumber-style PDF coords (origin at
  the top-left) -> pypdf rect (origin at the bottom-left).
- ``boxes_overlap``: boolean intersection check used by the geometry
  linter.

All functions are intentionally side-effect free so the module can be
imported at unit-test time without touching disk or pulling in heavy
PDF dependencies.
"""

from __future__ import annotations

from typing import Sequence

# Type aliases (Python 3.9+ accepts these in annotations because
# ``from __future__ import annotations`` defers evaluation).
Box = Sequence[float]


def image_box_to_pdf_rect(
    bbox: Box,
    img_w: float,
    img_h: float,
    pdf_w: float,
    pdf_h: float,
) -> tuple[float, float, float, float]:
    """Convert a pixel-space bbox into a pypdf rectangle.

    ``bbox`` is ``[left, top, right, bottom]`` in raster pixels. The
    output is ``(left, bottom, right, top)`` in PDF user-space points,
    with the origin at the bottom-left of the page (which is what
    ``pypdf.annotations.FreeText`` expects).
    """
    sx = pdf_w / img_w
    sy = pdf_h / img_h

    left = bbox[0] * sx
    right = bbox[2] * sx

    top = pdf_h - (bbox[1] * sy)
    bottom = pdf_h - (bbox[3] * sy)

    return left, bottom, right, top


def pdf_box_to_pypdf_rect(
    bbox: Box,
    pdf_h: float,
) -> tuple[float, float, float, float]:
    """Flip a pdfplumber-style bbox to pypdf orientation.

    pdfplumber reports ``[x0, top, x1, bottom]`` with the origin at the
    top-left; pypdf expects the origin at the bottom-left.
    """
    left = bbox[0]
    right = bbox[2]
    pypdf_top = pdf_h - bbox[1]
    pypdf_bottom = pdf_h - bbox[3]
    return left, pypdf_bottom, right, pypdf_top


def boxes_overlap(box_a: Box, box_b: Box) -> bool:
    """True iff two axis-aligned boxes have a non-empty intersection.

    Both inputs are ``[left, top, right, bottom]`` (the convention used
    in the ``fields.json`` schema). Edge contact is treated as
    *non-overlapping* so the linter does not complain about boxes that
    happen to share a border.
    """
    apart_x = box_a[0] >= box_b[2] or box_a[2] <= box_b[0]
    apart_y = box_a[1] >= box_b[3] or box_a[3] <= box_b[1]
    return not (apart_x or apart_y)

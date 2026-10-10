#!/usr/bin/env python3
"""geometry.py — DEV ONLY. Propose the box geometry of a blank BIR form.

    python3 tools/geometry.py templates/2551Q-2018-01.pdf            # readable listing
    python3 tools/geometry.py templates/2551Q-2018-01.pdf --json     # same, as JSON
    python3 tools/geometry.py templates/2551Q-2018-01.pdf --lines    # also list underlines
    python3 tools/geometry.py templates/2551Q-2018-01.pdf --cells 1 227
        # the cell edges of the table row crossing y=227 on page 1 (free-text cells)

The BIR's Word-exported blanks draw every line as a thin filled rectangle.
This tool reads those vector rectangles (pdfplumber) and proposes:

  comb      a row of character boxes. Black tick marks under 2.5 pt wide and
            2-16 pt tall, grouped by their bottom y. A tick that continues
            upward (another vertical segment starts where it ends) is a table
            cell border; a run of ticks between two borders is one comb, and
            its boundaries are [left border, inner ticks..., right border], each
            taken at the centre line of its tick.
  checkbox  a stroked square 9-16 pt on a side.
  line      a horizontal rule 30 pt or longer that is not a box edge: the
            underline of a free-text field such as "Others (specify)".

Every proposal carries the page text found to its left on the same row, so a
person can assign it to its eBIRForms key by the item number printed beside it.
Coordinates are PDF points with the origin at the bottom-left, exactly what
pdf-lib uses. `baseline` is the suggested text baseline (the box's bottom
edge + 2 pt).

Nothing here runs at render time: the maps in maps/ hold the resolved numbers.
"""
import json
import sys
from collections import defaultdict

import pdfplumber

TICK_MAX_W = 2.5  # the prompt's 1.6 pt misses 2550Q's 2.2 pt thousands ticks
TICK_MIN_H, TICK_MAX_H = 2.0, 16.0
BASELINE_LIFT = 2.0


def is_black(r):
    c = r.get("non_stroking_color")
    if c is None:
        return False
    if isinstance(c, (list, tuple)):
        return all(abs(v) < 0.05 for v in c)
    return abs(c) < 0.05


def r2(v):
    return round(v + 0.0, 2)


def row_text(words, x_right, y_lo, y_hi):
    """Words left of x_right whose vertical span overlaps [y_lo, y_hi]."""
    got = [w for w in words if w["x1"] <= x_right + 0.5 and w["y1"] > y_lo and w["y0"] < y_hi]
    got.sort(key=lambda w: w["x0"])
    return " ".join(w["text"] for w in got)[-90:]


def page_geometry(pg, pageno):
    H = pg.height
    verts = [r for r in pg.rects if r["width"] < TICK_MAX_W and r["height"] >= TICK_MIN_H and is_black(r)]
    # Vertical segments keyed by x, to tell borders (that continue upward) from ticks.
    by_x = defaultdict(list)
    for r in verts:
        by_x[round(r["x0"], 0)].append((H - r["bottom"], H - r["top"]))

    def continues_up(x0, top):
        for xk in (round(x0, 0) - 1, round(x0, 0), round(x0, 0) + 1):
            for b, _t in by_x.get(xk, []):
                if abs(b - top) < 1.2:
                    return True
        return False

    def continues_down(x0, bottom):
        for xk in (round(x0, 0) - 1, round(x0, 0), round(x0, 0) + 1):
            for _b, t in by_x.get(xk, []):
                if abs(t - bottom) < 1.2:
                    return True
        return False

    words = [
        {"text": w["text"], "x0": w["x0"], "x1": w["x1"], "y0": H - w["bottom"], "y1": H - w["top"]}
        for w in pg.extract_words(keep_blank_chars=False, use_text_flow=False)
    ]

    groups = defaultdict(list)
    for r in verts:
        if r["height"] > TICK_MAX_H:
            continue
        bottom = round(H - r["bottom"], 1)
        groups[bottom].append(r)

    combs = []
    for bottom in sorted(groups, reverse=True):
        rs = sorted(groups[bottom], key=lambda r: r["x0"])
        xs, borders, downs = [], [], []
        for r in rs:
            x = r2(r["x0"] + r["width"] / 2)  # a box edge is the tick's centre line
            if xs and abs(x - xs[-1]) < 1.0:
                continue
            xs.append(x)
            borders.append(continues_up(r["x0"], H - r["top"]))
            downs.append(continues_down(r["x0"], H - r["bottom"]))
        # Split into runs between borders.
        idx = [i for i, b in enumerate(borders) if b]
        for a, b in zip(idx, idx[1:]):
            cells = xs[a : b + 1]
            n = len(cells) - 1
            if all(downs[a : b + 1]):
                continue  # the upper part of taller cell borders, not a box row
            width = cells[-1] - cells[0]
            if n == 1 and width > 20:
                continue  # an ordinary table cell, not a box
            combs.append(
                {
                    "page": pageno,
                    "bottom": bottom,
                    "baseline": round(bottom + BASELINE_LIFT, 1),
                    "boxes": n,
                    "cells": cells,
                    "label": row_text(words, cells[0], bottom - 1, bottom + 14),
                }
            )

    checkboxes = []
    for r in pg.rects:
        if not r.get("stroke"):
            continue
        w, h = r["width"], r["height"]
        if 9 <= w <= 16 and 9 <= h <= 16:
            x0, y0, x1, y1 = r2(r["x0"]), r2(H - r["bottom"]), r2(r["x1"]), r2(H - r["top"])
            right = [wd for wd in words if wd["x0"] >= x1 and wd["x0"] < x1 + 90 and wd["y1"] > y0 and wd["y0"] < y1]
            right.sort(key=lambda wd: wd["x0"])
            checkboxes.append(
                {
                    "page": pageno,
                    "box": [x0, y0, x1, y1],
                    "label": row_text(words, x0, y0, y1) + " [ ] " + " ".join(wd["text"] for wd in right[:3]),
                }
            )
    checkboxes.sort(key=lambda c: (-c["box"][1], c["box"][0]))

    lines = []
    for r in pg.rects:
        if r["height"] < 1.6 and r["width"] >= 30 and is_black(r):
            y = r2(H - r["top"])
            lines.append({"page": pageno, "y": y, "x0": r2(r["x0"]), "x1": r2(r["x1"]),
                          "label": row_text(words, r["x0"], y, y + 12)})
    lines.sort(key=lambda l: (-l["y"], l["x0"]))
    return {"page": pageno, "width": pg.width, "height": pg.height, "combs": combs,
            "checkboxes": checkboxes, "lines": lines}


def borders_at(path, pageno, y):
    """Vertical lines crossing height y on a page: the cell edges of a table row."""
    with pdfplumber.open(path) as pdf:
        pg = pdf.pages[pageno - 1]
        H = pg.height
        xs = sorted({r2(r["x0"]) for r in pg.rects
                     if r["width"] < TICK_MAX_W and is_black(r) and H - r["bottom"] <= y <= H - r["top"]})
        hs = sorted({r2(H - r["top"]) for r in pg.rects
                     if r["height"] < TICK_MAX_W and r["width"] > 20 and is_black(r) and r["x0"] <= xs[1] if len(xs) > 1})
    return xs, [h for h in hs if abs(h - y) < 30]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = sys.argv[1]
    if "--cells" in sys.argv:
        i = sys.argv.index("--cells")
        xs, hs = borders_at(path, int(sys.argv[i + 1]), float(sys.argv[i + 2]))
        print("vertical edges x:", json.dumps(xs))
        print("horizontal rules y (within 30 pt):", json.dumps(hs))
        return
    with pdfplumber.open(path) as pdf:
        pages = [page_geometry(pg, i + 1) for i, pg in enumerate(pdf.pages)]
    if "--json" in sys.argv:
        json.dump(pages, sys.stdout, indent=1)
        return
    for p in pages:
        print(f"=== page {p['page']}  {p['width']} x {p['height']} pt")
        for i, c in enumerate(p["combs"]):
            print(f"comb p{p['page']}c{i:03d} baseline={c['baseline']:6.1f} boxes={c['boxes']:2d} "
                  f"x={c['cells'][0]:.2f}..{c['cells'][-1]:.2f}  | {c['label']}")
            print(f"      cells {json.dumps(c['cells'])}")
        for i, c in enumerate(p["checkboxes"]):
            print(f"checkbox p{p['page']}k{i:02d} box={json.dumps(c['box'])}  | {c['label']}")
        if "--lines" in sys.argv:
            for l in p["lines"]:
                print(f"line y={l['y']:6.1f} x={l['x0']:.2f}..{l['x1']:.2f}  | {l['label']}")


if __name__ == "__main__":
    main()

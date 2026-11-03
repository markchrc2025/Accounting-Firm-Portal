#!/usr/bin/env python3
"""map-2307.py — DEV ONLY. Write maps/2307-2018-01.json from the BIR's own blank.

    python3 tools/map-2307.py            # writes the map
    python3 tools/map-2307.py --check    # exits 1 if the committed map differs

geometry.py proposes combs for the Word-made blanks; the 2307 blank was exported from
Excel, which draws its boxes as stroked rectangles and its digit separators as hairline
vertical lines inside them. This script reads those vector objects with pdfplumber and
asserts the pattern it expects (35 stroked boxes on page 1, the table's row and column
rules), so a changed template fails loudly instead of printing in the wrong place.

Nothing here is guessed: every cell boundary is a tick or border of the template; every
row of the Part III tables is the span between two of its horizontal rules.

Coordinates in the map are PDF points with the origin at the bottom-left (what pdf-lib
uses): y = page height - the distance from the top that pdfplumber reports. Only page 1
is mapped and printed (D18: page 2 is the BIR's schedule of ATCs).

Keys are the Portal's own ("c2307:..."): the 2307 has no eBIRForms export, so the
rows come from apps/api bir-forms/engine/certificate2307.ts (build2307PrintRows).
"""
import json
import sys
from pathlib import Path

import pdfplumber

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "templates" / "2307-2018-01.pdf"
OUT = ROOT / "maps" / "2307-2018-01.json"
NS = "c2307:"
H = 936.0  # page height, pt
TOL = 0.35


def r2(v):
    return round(v + 0.0, 2)


pdf = pdfplumber.open(TEMPLATE)
assert len(pdf.pages) == 2, "the 2307 blank has two pages"
page = pdf.pages[0]
assert (round(page.width), round(page.height)) == (612, 936)

boxes = sorted(
    (r for r in page.rects if r["stroke"] and not r["fill"]),
    key=lambda r: (round(r["top"]), r["x0"]),
)
assert len(boxes) == 35, f"expected 35 stroked boxes on page 1, found {len(boxes)}"
ticks = [
    l for l in page.lines if abs(l["x1"] - l["x0"]) < 0.6  # hairline verticals
]


def inner(box):
    """The x of every hairline inside a box (digit separators and the group divider)."""
    xs = sorted(
        {
            round((t["x0"] + t["x1"]) / 2, 2)
            for t in ticks
            if t["bottom"] > box["top"] - 0.5
            and t["top"] < box["bottom"] + 0.5
            and box["x0"] + TOL < (t["x0"] + t["x1"]) / 2 < box["x1"] - TOL
        }
    )
    return xs


def cells_of(*bs):
    """Boundaries of the character boxes of one or more adjoining stroked boxes."""
    out = []
    for b in bs:
        edge = [round(b["x0"], 2)] + inner(b) + [round(b["x1"], 2)]
        if out and abs(out[-1] - edge[0]) < 0.1:
            out[-1] = r2((out[-1] + edge[0]) / 2)
            edge = edge[1:]
        out += edge
    return [r2(x) for x in out]


def pick(top_min, top_max, width=None, tol=1.0, x_min=None, x_max=None):
    got = [
        b
        for b in boxes
        if top_min <= b["top"] <= top_max
        and (width is None or abs((b["x1"] - b["x0"]) - width) < tol)
        and (x_min is None or b["x0"] >= x_min)
        and (x_max is None or b["x0"] < x_max)
    ]
    return sorted(got, key=lambda b: b["x0"])


fields = []


def comb(key, item, bs, top_bottom, ghost="8", **extra):
    f = {
        "key": NS + key,
        "item": item,
        "kind": "comb",
        "rows": [{"page": 1, "y": r2(H - top_bottom + 4.4), "cells": cells_of(*bs)}],
        "ghost": ghost,
    }
    f.update(extra)
    fields.append(f)


def textline(key, item, box, size=9, minsize=5, align="left", lift=4.4):
    fields.append(
        {
            "key": NS + key,
            "item": item,
            "kind": "text",
            "page": 1,
            "y": r2(H - box["bottom"] + lift),
            "x0": r2(box["x0"] + 0.6),
            "x1": r2(box["x1"] - 0.6),
            "size": size,
            "minSize": minsize,
            "align": align,
        }
    )


# ---- Item 1: For the Period (From and To), MM/DD/YYYY in 8 boxes --------------------
d = pick(100, 110)
assert len(d) == 4, "Item 1 has two date boxes each side"
comb("periodFrom", "1 From", d[0:2], d[0]["bottom"], drop="/")
comb("periodTo", "1 To", d[2:4], d[2]["bottom"], drop="/")


def tin(prefix, label, top_min, top_max):
    g = pick(top_min, top_max)
    groups = [b for b in g if abs((b["x1"] - b["x0"]) - 39.6) < 1.0]
    branch = [b for b in g if (b["x1"] - b["x0"]) > 70]
    assert len(groups) == 3 and len(branch) == 1, f"{label}: TIN boxes"
    for n, b in enumerate(groups, 1):
        comb(f"{prefix}Tin{n}", f"{label} TIN group {n}", [b], b["bottom"])
    comb(f"{prefix}Branch", f"{label} TIN branch code", branch, branch[0]["bottom"])


# ---- Part I: the payee ----------------------------------------------------------------
tin("payee", "2", 137, 138)
name = pick(164, 165, width=558.4)[0]
textline("payeeName", "3 Payee's Name", name)
addr = pick(192, 193, width=501.8)[0]
textline("payeeAddress", "4 Registered Address", addr)
zip4 = pick(192, 193, width=50.0)[0]
comb("payeeZip", "4A ZIP Code", [zip4], zip4["bottom"])
foreign = pick(221, 222, width=556.8)[0]
textline("payeeForeignAddress", "5 Foreign Address", foreign)

# ---- Part II: the payor ---------------------------------------------------------------
tin("payor", "6", 252, 253)
pname = pick(279, 280, width=558.4)[0]
textline("payorName", "7 Payor's Name", pname)
paddr = pick(307, 308, width=501.8)[0]
textline("payorAddress", "8 Registered Address", paddr)
pzip = pick(307, 308, width=50.0)[0]
comb("payorZip", "8A ZIP Code", [pzip], pzip["bottom"])

# ---- Part III: the two tables ---------------------------------------------------------
# Horizontal rules (thin filled rectangles spanning the table) and the column rules.
h_rules = sorted(
    {
        round((r["top"] + r["bottom"]) / 2, 2)
        for r in page.rects
        if r["height"] < 2.5 and r["x0"] <= 19.5 and r["x1"] >= 595.5 and 360 < r["top"] < 690
    }
)
need = [
    365.33, 379.01, 392.71, 406.39, 420.07, 433.75, 447.43, 461.11, 474.79, 488.47,
    502.15, 515.83, 534.79, 548.47, 562.17, 575.86, 589.54, 603.22, 616.9, 630.58,
    644.26, 657.94, 671.62, 685.3,
]
for want in need:
    assert any(abs(want - h) < 0.1 for h in h_rules), f"table rule at {want} is not in the template"
COLS = [19.4, 176.9, 220.13, 292.13, 366.43, 438.46, 510.46, 596.0]
cols = {
    name: (COLS[i], COLS[i + 1])
    for i, name in enumerate(["Desc", "Atc", "M1", "M2", "M3", "Total", "Tax"])
}
col_rules = sorted(
    {
        round((r["x0"] + r["x1"]) / 2, 2)
        for r in page.rects
        if r["width"] < 1.2 and r["bottom"] - r["top"] > 300 and 170 < (r["x0"] + r["x1"]) / 2 < 520
    }
)
for want in COLS[1:-1]:
    assert any(abs(want - c) < 0.1 for c in col_rules), f"column rule at {want} is not in the template"


def table_cell(key, item, col, bottom, align, size=8, minsize=5):
    x0, x1 = cols[col]
    fields.append(
        {
            "key": NS + key,
            "item": item,
            "kind": "text",
            "page": 1,
            "y": r2(H - bottom + 4.0),
            "x0": r2(x0 + 1.0),
            "x1": r2(x1 - 1.0),
            "size": size,
            "minSize": minsize,
            "align": align,
            **({"amount": "centavos"} if col in ("M1", "M2", "M3", "Total", "Tax") else {}),
        }
    )


def block(prefix, label, first_edge):
    """label: "A" or "B" (the Part III block); item labels stay short so the proof's
    ghost text fits the narrowest cell (the ATC column)."""
    for i in range(1, 11):
        bottom = need[first_edge + i]
        assert abs(need[first_edge + i] - need[first_edge + i - 1] - 13.68) < 0.1
        table_cell(f"{prefix}{i}Desc", f"{label}{i} desc", "Desc", bottom, "left")
        table_cell(f"{prefix}{i}Atc", f"{label}{i} ATC", "Atc", bottom, "center")
        for c, nm in (("M1", "1st"), ("M2", "2nd"), ("M3", "3rd"), ("Total", "total"), ("Tax", "tax")):
            table_cell(f"{prefix}{i}{c}", f"{label}{i} {nm}", c, bottom, "right")
    total_bottom = need[first_edge + 11]
    for c, nm, k in (
        ("M1", "1st", "TotalM1"),
        ("M2", "2nd", "TotalM2"),
        ("M3", "3rd", "TotalM3"),
        ("Total", "total", "TotalIncome"),
        ("Tax", "tax", "TotalTax"),
    ):
        table_cell(f"{prefix}{k}", f"{label} Total {nm}", c, total_bottom, "right")


block("a", "A", 0)  # data rows 365.33..502.15, Total row to 515.83
block("b", "B", 12)  # data rows 534.79..671.62, Total row to 685.3


# ---- the two signature areas ----------------------------------------------------------
def signature(prefix, who, sig_bottom, agent_top):
    """sig_bottom: the white signature box's bottom rule (distance from the top)."""
    for key, item, lift, size in (
        (f"{prefix}SigName", f"{who} printed name", 13.0, 8.5),
        (f"{prefix}SigTitleTin", f"{who} title and TIN", 3.5, 7.5),
    ):
        fields.append(
            {
                "key": NS + key,
                "item": item,
                "kind": "text",
                "page": 1,
                "y": r2(H - sig_bottom + lift),
                "x0": 24.0,
                "x1": 591.0,
                "size": size,
                "minSize": 5,
                "align": "center",
            }
        )
    b = pick(agent_top, agent_top + 0.7, width=122.6)[0]
    textline(f"{prefix}AgentNo", f"{who} Tax Agent Accreditation No.", b, size=9, minsize=5.5, lift=4.4)
    iss = pick(agent_top, agent_top + 0.7, width=52.4, x_min=300, x_max=430)
    exp = pick(agent_top, agent_top + 0.7, width=52.6, x_min=480)
    assert len(iss) == 2 and len(exp) == 2
    comb(f"{prefix}AgentIssued", f"{who} Date of Issue", iss, iss[0]["bottom"], drop="/")
    comb(f"{prefix}AgentExpiry", f"{who} Date of Expiry", exp, exp[0]["bottom"], drop="/")


signature("payor", "Payor", 750.48, 771)
signature("payee", "Payee", 827.76, 848)

assert len({f["key"] for f in fields}) == len(fields), "duplicate keys"

fields_json = {
    "form": "2307",
    "version": "2018-01",
    "template": "2307-2018-01.pdf",
    "title": "BIR Form 2307 - Certificate of Creditable Tax Withheld at Source (January 2018 ENCS)",
    "subject": "BIR Form 2307 (2018-01), printed from the certificate's own data",
    "pages": [{"width": 612, "height": 936}, {"width": 612, "height": 936}],
    "printPages": [1],
    "size": 9,
    "fields": fields,
}
text = json.dumps(fields_json, indent=2, ensure_ascii=False) + "\n"
if "--check" in sys.argv:
    # The committed file is prettier-formatted (`pnpm format`), so compare the content.
    sys.exit(0 if OUT.exists() and json.loads(OUT.read_text(encoding="utf-8")) == fields_json else 1)
OUT.write_text(text, encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}: {len(fields)} fields")

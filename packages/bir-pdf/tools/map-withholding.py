#!/usr/bin/env python3
"""map-withholding.py — DEV ONLY. Write the field maps of the three expanded-withholding
returns from the BIR's own blanks (C9, D57):

    python3 tools/map-withholding.py            # writes the three maps
    python3 tools/map-withholding.py --check    # exits 1 if a committed map differs (content)

    0619-E   maps/0619E-2018-01.json    templates/0619E-2018-01.pdf   (letter, 1 page)
    1601-EQ  maps/1601EQ-2019-01.json   templates/1601EQ-2019-01.pdf  (legal, 2 pages)
    1601-C   maps/1601C-2018-01.json    templates/1601C-2018-01.pdf   (legal, 2 pages)

The blanks are Word exports like the 2551Q's, so the geometry comes from geometry.py:
every cell boundary is a tick or border of the template. A row is picked by its baseline
and x-range, and each pick asserts the number of boxes it must hold, so a changed
template fails loudly instead of printing in the wrong place.

Keys are the Portal's own ("f0619E:...", "f1601EQ:...", "f1601C:..."): these returns
have no eBIRForms export, so the rows come from apps/api bir-forms/engine/
withholding-print.ts. The ATC and tax type code the blanks pre-print (WME10 and WE on the
0619-E, WW010 on the 1601-C) are not mapped and never printed.

Coordinates are PDF points, origin bottom-left. The money rows use the blanks' own
centavo boxes (kind "money" with `cents`); a third decimal is an error, never rounded.
"""
import json
import sys
from pathlib import Path

import pdfplumber

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from geometry import page_geometry  # noqa: E402

ROOT = HERE.parent


def r2(v):
    return round(v + 0.0, 2)


class Form:
    def __init__(self, form, version, template, title, ns):
        self.form, self.version, self.template, self.title, self.ns = form, version, template, title, ns
        pdf = pdfplumber.open(ROOT / "templates" / template)
        self.geo = [page_geometry(pg, i + 1) for i, pg in enumerate(pdf.pages)]
        self.pages = [{"width": round(p.width), "height": round(p.height)} for p in pdf.pages]
        self.fields = []

    # ---- geometry picks ----------------------------------------------------------------
    def cells(self, page, baseline, x0, x1, n):
        """The merged cell boundaries of the contiguous combs on one baseline within x0..x1."""
        g = self.geo[page - 1]
        cs = [
            c
            for c in g["combs"]
            if abs(c["baseline"] - baseline) < 0.8 and c["cells"][0] >= x0 - 0.6 and c["cells"][-1] <= x1 + 0.6
        ]
        cs.sort(key=lambda c: c["cells"][0])
        out = []
        for c in cs:
            e = c["cells"]
            if out:
                assert abs(out[-1] - e[0]) < 0.4, f"{self.form} p{page} b{baseline}: gap before {e[0]}"
                e = e[1:]
            out += e
        assert len(out) - 1 == n, f"{self.form} p{page} b{baseline} {x0}..{x1}: {len(out) - 1} boxes, wanted {n}"
        return [r2(x) for x in out]

    def box(self, page, x0, y_lo, y_hi):
        g = self.geo[page - 1]
        hit = [c for c in g["checkboxes"] if abs(c["box"][0] - x0) < 1.2 and y_lo <= c["box"][1] <= y_hi]
        assert len(hit) == 1, f"{self.form} checkbox at {x0}: {len(hit)}"
        return hit[0]["box"]

    # ---- field makers ------------------------------------------------------------------
    def add(self, key, item, kind, **kw):
        f = {"key": self.ns + key, "item": item, "kind": kind}
        f.update(kw)
        self.fields.append(f)

    def comb(self, key, item, page, b, x0, x1, n, **extra):
        cells = self.cells(page, b, x0, x1, n)
        self.add(key, item, "comb", rows=[{"page": page, "y": r2(b), "cells": cells}], **extra)

    def comb_rows(self, key, item, rows, **extra):
        """rows: [(page, baseline, x0, x1, n), ...] filled in order."""
        rs = [{"page": p, "y": r2(b), "cells": self.cells(p, b, x0, x1, n)} for p, b, x0, x1, n in rows]
        self.add(key, item, "comb", rows=rs, **extra)

    def mark(self, key, item, page, x0, y_lo, y_hi):
        self.add(key, item, "mark", page=page, box=[r2(v) for v in self.box(page, x0, y_lo, y_hi)])

    def money(self, key, item, page, b, p0, p1, pn, c0=564.0, c1=595.0):
        pesos = self.cells(page, b, p0, p1, pn)
        cents = self.cells(page, b, c0, c1, 2)
        self.add(key, item, "money", page=page, y=r2(b), cells=pesos, cents=cents)

    def text(self, key, item, page, y, x0, x1, size=9, minsize=5, align="left", **extra):
        self.add(key, item, "text", page=page, y=r2(y), x0=r2(x0), x1=r2(x1), size=size, minSize=minsize, align=align, **extra)

    def out(self, extra=None):
        d = {
            "form": self.form,
            "version": self.version,
            "template": self.template,
            "title": self.title,
            "subject": f"BIR Form {self.form} ({self.version}), printed from the return's own data",
            "pages": self.pages,
            "size": 10,
        }
        d.update(extra or {})
        d["fields"] = self.fields
        assert len({f["key"] for f in self.fields}) == len(self.fields), "duplicate keys"
        return d


# ---- parts every one of the three returns shares ------------------------------------------


def background(f, tin_b, tin_x, rdo_x, name_b, addr_b1, addr_b2, zip_x, contact_b, contact_x, email_b, email_x0, email_n, cat_b, cat_y):
    """Items 6/7 TIN, RDO, withholding agent's name, address, ZIP, contact number, e-mail, category."""
    for i, (x0, x1) in enumerate(tin_x[:3], 1):
        f.comb(f"tin{i}", f"TIN {i}", 1, tin_b, x0, x1, 3, ghost="8")
    f.comb("branch", "TIN branch", 1, tin_b, tin_x[3][0], tin_x[3][1], 5, ghost="8")
    f.comb("rdo", "RDO", 1, tin_b, rdo_x[0], rdo_x[1], 3, ghost="8")
    f.comb("name", "name", 1, name_b[0], 17.0, 595.0, 40, squeeze=True)
    f.comb_rows("address", "address", [(1, addr_b1, 17.0, 595.0, 40), (1, addr_b2, 17.0, 465.0, 31)], wrap="words", squeeze=True)
    f.comb("zip", "ZIP", 1, addr_b2, zip_x[0], zip_x[1], 4, ghost="8")
    f.comb("contact", "contact", 1, contact_b, contact_x[0], contact_x[1], 12, drop=" -()+.", ghost="8")
    f.comb("email", "email", 1, email_b, email_x0, 595.0, email_n, case="keep", squeeze=True)
    f.mark("catPrivate", "Private", 1, cat_b[0], *cat_y)
    f.mark("catGovernment", "Government", 1, cat_b[1], *cat_y)


def signature(f, page, ind_x, non_x, bottom, ag_cells, ag_bottom, name_size, tin_size, name_lift, tin_lift):
    """The signature area: printed name and title/TIN on the For Individual or For Non-Individual side
    (the builder writes one side, by the client's kind); Tax Agent Accreditation No. and its dates."""
    for side, (x0, x1) in (("Ind", ind_x), ("Non", non_x)):
        f.text(f"sig{side}Name", f"sig {side} name", page, bottom + name_lift, x0, x1, size=name_size, minsize=5, align="center")
        f.text(f"sig{side}TitleTin", f"sig {side} title/TIN", page, bottom + tin_lift, x0, x1, size=tin_size, minsize=5, align="center")
    f.text("agentNo", "Tax Agent No.", page, ag_bottom + 7.6, ag_cells[1] + 1.0, ag_cells[2] - 1.0, size=9, minsize=5.5)
    f.text("agentIssue", "Date of Issue", page, ag_bottom + 7.6, ag_cells[3] + 1.0, ag_cells[4] - 1.0, size=8, minsize=5, align="center")
    f.text("agentExpiry", "Date of Expiry", page, ag_bottom + 7.6, ag_cells[5] + 1.0, ag_cells[6] - 1.0, size=8, minsize=5, align="center")


def payments(f, b32, b33, b34, b35, items):
    """Part III, Details of Payment. The Tax Debit Memo row has no Drawee Bank/Agency box
    (the blank greys it out), so payTaxDebitBank has no place on the paper."""
    for key, b, item in (("cash", b32, items[0]), ("check", b33, items[1])):
        f.comb(f"{key}Bank", f"{item} bank", 1, b, 116.0, 191.0, 5, squeeze=True)
        f.comb(f"{key}Number", f"{item} number", 1, b, 188.5, 277.0, 6, squeeze=True)
        f.comb(f"{key}Date", f"{item} date", 1, b, 275.4, 392.7, 8, date=True, drop="/", ghost="8")
        f.money(f"{key}Amount", f"{item} amount", 1, b, 390.0, 551.0, 11)
    f.comb("debitNumber", f"{items[2]} number", 1, b34, 188.5, 277.0, 6, squeeze=True)
    f.comb("debitDate", f"{items[2]} date", 1, b34, 275.4, 392.7, 8, date=True, drop="/", ghost="8")
    f.money("debitAmount", f"{items[2]} amount", 1, b34, 390.0, 551.0, 11)
    f.comb("othersSpecify", f"{items[3]} specify", 1, b35, 17.0, 118.7, 7, squeeze=True)
    f.comb("othersBank", f"{items[3]} bank", 1, b35, 116.0, 191.0, 5, squeeze=True)
    f.comb("othersNumber", f"{items[3]} number", 1, b35, 188.5, 277.0, 6, squeeze=True)
    f.comb("othersDate", f"{items[3]} date", 1, b35, 275.4, 392.7, 8, date=True, drop="/", ghost="8")
    f.money("othersAmount", f"{items[3]} amount", 1, b35, 390.0, 551.0, 11)


AMT_X = (390.0, 549.2)  # the eleven peso boxes of an amount row

# ---- 0619-E -------------------------------------------------------------------------------


def make_0619e():
    f = Form(
        "0619E", "2018-01", "0619E-2018-01.pdf",
        "BIR Form 0619-E - Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded) (January 2018)",
        "f0619E:",
    )
    # Item 1 (MM/YYYY) and Item 2 (MM/DD/YYYY); Items 3 and 4 Yes/No
    f.comb("month", "1 month", 1, 644.6, 45.0, 132.0, 6, ghost="8")
    f.comb("dueDate", "2 due date", 1, 644.6, 145.0, 261.5, 8, date=True, drop="/", ghost="8")
    f.mark("amendedYes", "3 Yes", 1, 275.64, 640, 660)
    f.mark("amendedNo", "3 No", 1, 319.2, 640, 660)
    f.mark("anyYes", "4 Yes", 1, 376.8, 640, 660)
    f.mark("anyNo", "4 No", 1, 420.6, 640, 660)
    background(
        f,
        tin_b=610.9,
        tin_x=[(218.0, 262.0), (275.5, 320.0), (333.5, 378.0), (391.5, 465.0)],
        rdo_x=(535.5, 580.0),
        name_b=(582.2,),
        addr_b1=553.6,
        addr_b2=535.4,
        zip_x=(535.5, 594.5),
        contact_b=517.1,
        contact_x=(102.5, 277.0),
        email_b=488.4,
        email_x0=17.0,
        email_n=40,
        cat_b=(445.44, 516.48),
        cat_y=(510, 535),
    )
    # Part II: amounts
    for key, item, b in (
        ("i14", "14", 454.7), ("i15", "15", 436.5), ("i16", "16", 418.2), ("i17a", "17A", 389.2),
        ("i17b", "17B", 370.9), ("i17c", "17C", 352.7), ("i17d", "17D", 334.4), ("i18", "18", 316.2),
    ):
        f.money(key, item, 1, b, 391.0, 550.7, 11)
    signature(
        f, 1, ind_x=(19.0, 318.5), non_x=(321.0, 592.0), bottom=248.0,
        ag_cells=[16.92, 131.3, 275.57, 348.07, 435.07, 507.1, 593.04], ag_bottom=199.4,
        name_size=8.5, tin_size=7.5, name_lift=13.0, tin_lift=3.5,
    )
    payments(f, 156.8, 138.6, 120.3, 91.7, ("19", "20", "21", "22"))
    return f.out()


# ---- 1601-EQ ------------------------------------------------------------------------------

EQ_ROWS = [625.1, 607.6, 590.2, 572.7, 555.3, 537.8]  # Items 13 to 18
EQ_TOTALS = [  # Items 19 to 31
    ("i19", "19", 520.4), ("i20", "20", 502.9), ("i21", "21", 485.4), ("i22", "22", 468.0),
    ("i23", "23", 450.5), ("i24", "24", 433.1), ("i25", "25", 415.6), ("i26", "26", 398.2),
    ("i27", "27", 380.6), ("i28", "28", 363.2), ("i29", "29", 345.9), ("i30", "30", 328.3),
    ("i31", "31", 310.9),
]


def make_1601eq():
    f = Form(
        "1601EQ", "2019-01", "1601EQ-2019-01.pdf",
        "BIR Form 1601-EQ - Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded) (January 2019)",
        "f1601EQ:",
    )
    f.comb("year", "1 year", 1, 809.9, 31.0, 90.5, 4, ghost="8")
    for q, x0 in ((1, 117.6), (2, 161.64), (3, 204.6), (4, 248.64)):
        f.mark(f"q{q}", f"2 quarter {q}", 1, x0, 805, 825)
    f.mark("amendedYes", "3 Yes", 1, 305.64, 805, 825)
    f.mark("amendedNo", "3 No", 1, 349.56, 805, 825)
    f.mark("anyYes", "4 Yes", 1, 406.56, 805, 825)
    f.mark("anyNo", "4 No", 1, 449.64, 805, 825)
    f.comb("sheets", "5 sheets", 1, 809.9, 521.5, 552.0, 2, align="right", ghost="8")
    background(
        f,
        tin_b=776.2,
        tin_x=[(232.5, 277.0), (289.8, 334.0), (347.2, 391.5), (404.6, 477.5)],
        rdo_x=(548.5, 595.0),
        name_b=(748.7,),
        addr_b1=721.4,
        addr_b2=704.2,
        zip_x=(533.5, 595.0),
        contact_b=686.0,
        contact_x=(103.0, 277.0),
        email_b=668.8,
        email_x0=103.0,
        email_n=34,
        cat_b=(447.48, 519.6),
        cat_y=(680, 700),
    )
    # Part II: six ATC rows (Items 13 to 18)
    for i, b in enumerate(EQ_ROWS, 1):
        item = 12 + i
        f.comb(f"r{i}Atc", f"{item} ATC", 1, b, 32.0, 105.0, 5, ghost="W")
        f.money(f"r{i}Base", f"{item} base", 1, b, 103.5, 276.5, 12, c0=289.8, c1=319.5)
        f.text(f"r{i}Rate", f"{item} rate", 1, b + 0.5, 319.8, 389.4, size=9, minsize=6, align="center")
        f.money(f"r{i}Withheld", f"{item} withheld", 1, b, *AMT_X, 11)
    for key, item, b in EQ_TOTALS:
        f.money(key, item, 1, b, *AMT_X, 11)
    # If over-remittance, mark one box only (printed once the blank's Item 26/31 can show it)
    f.mark("overRefunded", "over: refunded", 1, 191.16, 290, 310)
    f.mark("overTcc", "over: TCC", 1, 267.36, 290, 310)
    f.mark("overCarried", "over: carried", 1, 413.16, 290, 310)
    signature(
        f, 1, ind_x=(19.0, 303.5), non_x=(306.0, 592.5), bottom=228.7,
        ag_cells=[16.92, 132.5, 275.69, 347.47, 433.51, 505.06, 593.76], ag_bottom=189.74,
        name_size=8.5, tin_size=7.5, name_lift=13.0, tin_lift=3.5,
    )
    payments(f, 148.1, 130.5, 112.3, 84.6, ("32", "33", "34", "35"))
    # Page 2 (the Schedule of Alphanumeric Tax Codes) has two write-in lines: TIN and name.
    f.comb("p2Tin", "p2 TIN", 2, 810.4, 17.0, 219.0, 14, ghost="8")
    f.comb("p2Name", "p2 name", 2, 810.4, 218.0, 595.0, 26, squeeze=True)
    return f.out()


# ---- 1601-C -------------------------------------------------------------------------------

C_ITEMS = [  # Items 14 to 36
    ("i14", "14", 628.6), ("i15", "15", 602.9), ("i16", "16", 587.0), ("i17", "17", 571.1),
    ("i18", "18", 555.1), ("i19", "19", 539.2), ("i20", "20", 523.2), ("i21", "21", 507.3),
    ("i22", "22", 491.3), ("i23", "23", 475.3), ("i24", "24", 459.4), ("i25", "25", 443.4),
    ("i26", "26", 427.4), ("i27", "27", 411.5), ("i28", "28", 395.6), ("i29", "29", 379.7),
    ("i30", "30", 363.0), ("i31", "31", 347.0), ("i32", "32", 331.2), ("i33", "33", 315.2),
    ("i34", "34", 299.3), ("i35", "35", 283.3), ("i36", "36", 267.3),
]
SCHED_ROWS = [(755.6, 685.0), (739.3, 668.7), (722.9, 652.4)]  # (upper table baseline, lower table baseline)


def make_1601c():
    f = Form(
        "1601C", "2018-01", "1601C-2018-01.pdf",
        "BIR Form 1601-C - Monthly Remittance Return of Income Taxes Withheld on Compensation (January 2018)",
        "f1601C:",
    )
    f.comb("month", "1 month", 1, 810.8, 45.5, 133.0, 6, ghost="8")
    f.mark("amendedYes", "2 Yes", 1, 183.6, 805, 826)
    f.mark("amendedNo", "2 No", 1, 231.48, 805, 826)
    f.mark("anyYes", "3 Yes", 1, 304.56, 805, 826)
    f.mark("anyNo", "3 No", 1, 345.24, 805, 826)
    f.comb("sheets", "4 sheets", 1, 810.8, 446.5, 476.5, 2, align="right", ghost="8")
    background(
        f,
        tin_b=780.5,
        tin_x=[(232.5, 277.0), (289.8, 334.0), (347.2, 391.5), (404.6, 477.5)],
        rdo_x=(548.5, 595.0),
        name_b=(754.1,),
        addr_b1=727.9,
        addr_b2=711.9,
        zip_x=(533.5, 595.0),
        contact_b=693.7,
        contact_x=(103.5, 277.0),
        email_b=677.7,
        email_x0=103.5,
        email_n=34,
        cat_b=(447.48, 519.6),
        cat_y=(690, 710),
    )
    f.mark("reliefYes", "13 Yes", 1, 175.2, 654, 674)
    f.mark("reliefNo", "13 No", 1, 218.64, 654, 674)
    f.comb("reliefSpecify", "13A specify", 1, 658.8, 347.0, 595.0, 17, squeeze=True)
    for key, item, b in C_ITEMS:
        f.money(key, item, 1, b, *AMT_X, 11)
    # Items 20 and 29 each have a white "(specify)" cell
    f.text("i20Specify", "20 specify", 1, 523.3 + 3.2, 205.3, 381.1, size=8, minsize=5)
    f.text("i29Specify", "29 specify", 1, 379.7 + 3.2, 194.0, 386.7, size=8, minsize=5)
    signature(
        f, 1, ind_x=(90.0, 303.5), non_x=(390.0, 592.5), bottom=214.5,
        ag_cells=[16.92, 132.62, 275.81, 347.59, 433.63, 505.18, 593.76], ag_bottom=176.54,
        name_size=8, tin_size=7, name_lift=12.2, tin_lift=3.0,
    )
    payments(f, 135.9, 118.4, 99.7, 71.8, ("37", "38", "39", "40"))
    # Page 2: TIN and name, then Part IV Schedule I
    f.comb("p2Tin", "p2 TIN", 2, 830.1, 17.0, 219.0, 14, ghost="8")
    f.comb("p2Name", "p2 name", 2, 830.1, 218.0, 595.0, 26, squeeze=True)
    for i, (bu, bl) in enumerate(SCHED_ROWS, 1):
        f.comb(f"s{i}Month", f"Sch I {i} col 1", 2, bu, 31.0, 117.5, 6, ghost="8")
        f.comb(f"s{i}DatePaid", f"Sch I {i} col 2", 2, bu, 116.5, 231.5, 8, date=True, drop="/", ghost="8")
        f.comb(f"s{i}Bank", f"Sch I {i} col 3", 2, bu, 230.3, 302.8, 5, squeeze=True)
        f.comb(f"s{i}Number", f"Sch I {i} col 4", 2, bu, 301.8, 390.6, 6, squeeze=True)
        f.money(f"s{i}TaxPaid", f"Sch I {i} col 5", 2, bu, 389.6, 549.0, 11, c0=563.0, c1=594.0)
        f.money(f"s{i}ShouldBe", f"Sch I {i} col 6", 2, bl, 88.9, 248.7, 11, c0=262.4, c1=292.1)
        f.money(f"s{i}Adjustment", f"Sch I {i} col 7", 2, bl, 332.7, 492.0, 11, c0=505.5, c1=535.2)
    f.money("sTotal", "Sch I item 4", 2, 636.0, 332.7, 492.0, 11, c0=505.5, c1=535.2)
    return f.out()


MAPS = {
    "0619E-2018-01.json": make_0619e,
    "1601EQ-2019-01.json": make_1601eq,
    "1601C-2018-01.json": make_1601c,
}

if __name__ == "__main__":
    bad = False
    for name, make in MAPS.items():
        data = make()
        out = ROOT / "maps" / name
        if "--check" in sys.argv:
            # The committed files are prettier-formatted, so compare the content.
            if not out.exists() or json.loads(out.read_text(encoding="utf-8")) != data:
                print(f"{name} differs")
                bad = True
        else:
            out.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            print(f"wrote maps/{name}: {len(data['fields'])} fields")
    sys.exit(1 if bad else 0)

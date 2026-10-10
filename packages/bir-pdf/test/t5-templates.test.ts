// T5 — the templates are the BIR's own blank forms, byte for byte, and a
// rendered return keeps the template's pages exactly.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseEbirExport, renderReturn } from "../src/index";
import { PKG, readPkg } from "./helpers";

// The SHA-256 of each blank form as the domain owner committed it (5171042).
const TEMPLATES: Record<string, string> = {
  "1701-2018-01.pdf": "19be91d78258eb7c255f2615610db2739f10c378f8ac97adc0887c1bf40d1b2e",
  "1701A-2018-01.pdf": "8d492eabc6da2088cf9a55084488b192def5cc415048f607142c8bce1b72bfb8",
  "1701Q-2018-01.pdf": "c731d3f12556e6f19ab81f6113ca7c4a23f7ed099675c03451ac0074d96b85ed",
  "1702Q-2018-01.pdf": "589e22190b9211571cb8a0ba14c97c17dff250f3b8ee9f9e8f6cc3b37b1b1be4",
  "1702RT-2018-01.pdf":
    "d9a6a8a13e0114934261151c4eb269a1573042e7ce670eaf12b15f169d308d2d",
  "2550Q-2024-04.pdf": "18eb16925010fdda820cef958221ba2c0d073066efa93a898113e39b31135a25",
  "2551Q-2018-01.pdf": "1f270ecf66d778836a14697863e420ff65d5ed0a5576a6cf58b97c9a8e8c9b24",
};

describe("T5 · templates", () => {
  for (const [file, hash] of Object.entries(TEMPLATES)) {
    it(`${file} is unchanged (SHA-256)`, () => {
      expect(
        createHash("sha256")
          .update(readPkg(`templates/${file}`))
          .digest("hex"),
      ).toBe(hash);
    });
  }

  for (const [form, version] of [
    ["2551Q", "2018-01"],
    ["2550Q", "2024-04"],
  ] as const) {
    it(`${form}: a rendered return has the template's page count and page sizes`, async () => {
      const rows = parseEbirExport(
        readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"),
      );
      const out = await PDFDocument.load(await renderReturn(form, version, rows));
      const tpl = await PDFDocument.load(readPkg(`templates/${form}-${version}.pdf`));
      expect(out.getPageCount()).toBe(tpl.getPageCount());
      expect(out.getPages().map((p) => p.getSize())).toEqual(
        tpl.getPages().map((p) => p.getSize()),
      );
    });
  }
});

// C3 T2 — the DRAFT watermark of a preview (D52). Stamping moves nothing: every
// field sits exactly where it sits on an unstamped render; without the option the
// output is byte-identical to before (the committed proofs); a 2550Q previews too.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BirPdfError,
  DRAFT_STAMP,
  parseEbirExport,
  previewFooter,
  renderProof,
  renderReturn,
} from "../src/index";
import { PKG, overlayText, readPkg, readText } from "./helpers";

const FORMS = [
  ["2551Q", "2018-01"],
  ["2550Q", "2024-04"],
] as const;
const AT = new Date("2026-10-25T02:05:00.000Z");
const sample = (form: string) =>
  parseEbirExport(readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"));
const sig = (t: { page: number; str: string; x: number; y: number }) =>
  `${t.page}|${t.str}|${t.x.toFixed(2)}|${t.y.toFixed(2)}`;

describe("C3 T2 · the DRAFT watermark", () => {
  it("the footer reads the print time on Manila's clock", () => {
    expect(previewFooter(AT)).toBe(
      "Preview printed 25 Oct 2026, 10:05 AM (Manila) from the Portal. Not the filed return.",
    );
    // 16:30 UTC on New Year's Day is 00:30 on 2 January in Manila.
    expect(previewFooter(new Date("2026-01-01T16:30:00.000Z"))).toBe(
      "Preview printed 02 Jan 2026, 12:30 AM (Manila) from the Portal. Not the filed return.",
    );
  });

  for (const [form, version] of FORMS) {
    it(`${form}: with the watermark every field sits exactly where it sits without it; the stamp and footer on every page`, async () => {
      const rows = sample(form);
      const tpl = readPkg(`templates/${form}-${version}.pdf`);
      const plain = await overlayText(await renderReturn(form, version, rows), tpl);
      const stamped = await overlayText(
        await renderReturn(form, version, rows, { watermark: "DRAFT", printedAt: AT }),
        tpl,
      );
      const footer = previewFooter(AT);
      const marks = stamped.filter((t) => t.str === DRAFT_STAMP || t.str === footer);
      const figures = stamped.filter((t) => t.str !== DRAFT_STAMP && t.str !== footer);
      expect(figures.map(sig).sort()).toEqual(plain.map(sig).sort());
      expect(plain.length).toBeGreaterThan(50);
      const pages = (await readText(tpl)).reduce((n, t) => Math.max(n, t.page), 0);
      expect(pages).toBe(2);
      for (let p = 1; p <= pages; p++) {
        expect([
          p,
          marks
            .filter((t) => t.page === p)
            .map((t) => t.str)
            .sort(),
        ]).toEqual([p, [DRAFT_STAMP, footer].sort()]);
      }
    });

    it(`${form}: without the option the output is unchanged — the committed proof re-renders byte-identical`, async () => {
      const proof = await renderProof(form, version);
      expect(
        Buffer.compare(
          Buffer.from(proof),
          Buffer.from(readPkg(`proofs/${form}-${version}-proof.pdf`)),
        ),
      ).toBe(0);
    });

    it(`${form}: the committed draft proof re-renders byte-identical (the stamp is deterministic)`, async () => {
      const draft = await renderReturn(form, version, sample(form), {
        watermark: "DRAFT",
        printedAt: AT,
      });
      expect(
        Buffer.compare(
          Buffer.from(draft),
          Buffer.from(readPkg(`proofs/${form}-${version}-draft-proof.pdf`)),
        ),
      ).toBe(0);
    });
  }

  it("a watermark without printedAt is an error: the engine reads no clock", async () => {
    await expect(
      renderReturn("2551Q", "2018-01", sample("2551Q"), { watermark: "DRAFT" }),
    ).rejects.toThrow(BirPdfError);
  });
});

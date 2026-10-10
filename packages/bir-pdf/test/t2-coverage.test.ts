// T2 — coverage: every key the Portal's builders emit (as captured in the
// committed fixtures) has an entry in that form's map, either placed on the
// paper or listed as "none" with its reason.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEbirExport, renderReturn } from "../src/index";
import { PKG, loadMap } from "./helpers";

const FORMS = [
  { form: "2551Q", version: "2018-01" },
  { form: "2550Q", version: "2024-04" },
] as const;

describe("T2 · every exported key is mapped", () => {
  for (const { form, version } of FORMS) {
    const rows = parseEbirExport(
      readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"),
    );
    const map = loadMap(form, version);

    it(`${form}: every fixture key is placed or none-with-reason`, () => {
      const missing: string[] = [];
      for (const [key] of rows) {
        const entries = map.fields.filter((f) => f.key === key);
        if (entries.length === 0) missing.push(key);
        for (const f of entries) {
          if (f.kind === "none") expect(f.reason?.trim(), `${key}: reason`).toBeTruthy();
        }
      }
      expect(missing, `${form} keys with no map entry`).toEqual([]);
    });

    it(`${form}: the map names no key the builder does not emit`, () => {
      const emitted = new Set(rows.map(([k]) => k));
      expect(map.fields.map((f) => f.key).filter((k) => !emitted.has(k))).toEqual([]);
    });

    it(`${form}: the sample export renders`, async () => {
      const pdf = await renderReturn(form, version, rows);
      expect(pdf.byteLength).toBeGreaterThan(1000);
    });
  }
});

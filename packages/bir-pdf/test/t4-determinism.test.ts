// T4 — determinism: the same export always renders to the same bytes.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEbirExport, renderReturn } from "../src/index";
import { PKG } from "./helpers";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("T4 · byte-identical renders", () => {
  for (const [form, version] of [
    ["2551Q", "2018-01"],
    ["2550Q", "2024-04"],
  ] as const) {
    it(`${form}: rendering the same export twice gives identical PDFs`, async () => {
      const rows = parseEbirExport(
        readFileSync(join(PKG, `fixtures/${form}-sample.xml`), "utf8"),
      );
      const a = await renderReturn(form, version, rows);
      const b = await renderReturn(form, version, rows);
      expect(sha(a)).toBe(sha(b));
      expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
    });
  }
});

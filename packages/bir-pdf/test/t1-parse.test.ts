// T1 (parser) — parseEbirExport reads the builders' files back exactly:
// file order, both separators, and URL-decoding of exactly the encoded keys.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEbirExport } from "../src/index";
import { PKG } from "./helpers";

describe("T1 · parseEbirExport", () => {
  it("reads the 2551Q sample (tab-separated) in file order, decoding encoded keys", () => {
    const rows = parseEbirExport(
      readFileSync(join(PKG, "fixtures/2551Q-sample.xml"), "utf8"),
    );
    expect(rows[0]).toEqual(["frm2551Qv2018:forThe_1", "true"]);
    expect(rows.at(-1)).toEqual(["driveSelectTPExport", "0"]);
    const m = new Map(rows);
    expect(m.get("frm2551Qv2018:registeredAddress")).toBe("1 SAMPLE STREET, SAMPLE CITY");
    expect(m.get("frm2551Qv2018:txtPg2TaxpayerName")).toBe("TEST TAXPAYER");
    expect(m.get("txtEmail")).toBe("test.taxpayer@example.com");
  });

  it("reads the 2550Q sample (newline-separated)", () => {
    const rows = parseEbirExport(
      readFileSync(join(PKG, "fixtures/2550Q-sample.xml"), "utf8"),
    );
    expect(rows[0]).toEqual(["frm2550qv2024:calendarNo1", "true"]);
    expect(rows.at(-1)).toEqual(["dateFiled", "2026/04/25"]);
    expect(new Map(rows).get("txtNameWithHoldingAgent30")).toBe("SAMPLE AGENT INC.");
  });

  it("leaves a raw key's value alone, even if it looks encoded", () => {
    const text =
      "<?xml version='1.0'?>\t\t<div>frm2551Qv2018:registeredName=A%20Bfrm2551Qv2018:registeredName=</div>" +
      "\t\t<div>frm2551Qv2018:txtPg2TaxpayerName=A%20Bfrm2551Qv2018:txtPg2TaxpayerName=</div>" +
      "\t\t\t\tAll Rights Reserved BIR 2012.0";
    expect(parseEbirExport(text)).toEqual([
      ["frm2551Qv2018:registeredName", "A B"],
      ["frm2551Qv2018:txtPg2TaxpayerName", "A%20B"],
    ]);
  });

  it("keeps an '=' inside a value", () => {
    const text =
      "<?xml version='1.0'?><div>frm2551Qv2018:telNo=1=2frm2551Qv2018:telNo=</div>";
    expect(parseEbirExport(text)).toEqual([["frm2551Qv2018:telNo", "1=2"]]);
  });
});

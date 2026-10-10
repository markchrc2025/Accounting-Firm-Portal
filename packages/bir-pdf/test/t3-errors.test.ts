// T3 — errors: a value that cannot be printed faithfully is an error that
// names the field. Nothing is ever cut off or dropped silently.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BirPdfError, parseEbirExport, renderReturn } from "../src/index";
import { PKG } from "./helpers";

const NS = "frm2551Qv2018:";
const sample = () =>
  parseEbirExport(readFileSync(join(PKG, "fixtures/2551Q-sample.xml"), "utf8"));
const withValue = (
  rows: [string, string][],
  key: string,
  value: string,
): [string, string][] => rows.map(([k, v]) => [k, k === key ? value : v]);

async function rejects(
  rows: [string, string][],
  ...parts: (string | RegExp)[]
): Promise<void> {
  const err = await renderReturn("2551Q", "2018-01", rows).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BirPdfError);
  for (const p of parts) expect((err as Error).message).toMatch(p);
}

describe("T3 · errors name the field", () => {
  it("a value longer than its boxes", async () => {
    // A digit comb: it never squeezes (C1-A1). Names now squeeze; see c1a1-squeeze.
    await rejects(
      withValue(sample(), NS + "txtRDOCode", "1234"),
      `${NS}txtRDOCode`,
      "4 characters",
      "3 boxes",
    );
  });

  it("an amount longer than its boxes", async () => {
    await rejects(
      withValue(sample(), NS + "txt14", "1,234,567,890,123.00"),
      `${NS}txt14`,
      "13 boxes",
      "has 12",
    );
  });

  it("centavos where the paper has no centavo boxes", async () => {
    await rejects(
      withValue(sample(), "txtATCRate1", "1.5"),
      "txtATCRate1",
      "centavos",
      "no centavo boxes",
    );
  });

  it("a key with no map entry", async () => {
    await rejects(
      [...sample(), [NS + "txtNotOnTheForm", "1"]],
      `${NS}txtNotOnTheForm`,
      "no entry in the field map",
    );
  });

  it("free text too long even at its minimum size", async () => {
    await rejects(
      withValue(sample(), NS + "txt17Specify", "W".repeat(60)),
      `${NS}txt17Specify`,
      "minimum 5 pt",
    );
  });

  it("a checkbox value that is not true or false", async () => {
    await rejects(withValue(sample(), NS + "qtr_1", "yes"), `${NS}qtr_1`, 'not "yes"');
  });

  it("a dropdown index the map does not know", async () => {
    await rejects(
      withValue(sample(), "drpATC1", "9"),
      "drpATC1",
      "not one of the dropdown's options",
    );
  });

  it("a value on a key with no place on paper that should be empty", async () => {
    await rejects(
      withValue(sample(), NS + "txtAgency27", "SOME BANK"),
      `${NS}txtAgency27`,
      "no place on the paper",
    );
  });

  it("a malformed export", () => {
    expect(() =>
      parseEbirExport("<?xml version='1.0'?><div>frm2551Qv2018:txtYear=2026</div>"),
    ).toThrow(/malformed field/);
    expect(() => parseEbirExport("not an export")).toThrow(/no <div>/);
  });

  it("an unknown form version", async () => {
    await expect(renderReturn("2551Q", "1999-01", sample())).rejects.toThrow(
      /no field map for BIR Form 2551Q version 1999-01/,
    );
  });
});

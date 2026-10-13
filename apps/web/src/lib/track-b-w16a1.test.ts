// track-b-w16a1.test.ts — W16-A1: the 2551Q's books rows are matched to the
// draft's rows by ATC, never by position (R1); one plural function for every
// count the editors print (R2); the 2550Q's Item 45 label as the form prints it
// (R4).

import { describe, expect, it } from "vitest";
import {
  badgeText,
  currentValues,
  differing,
  editedKeys,
  fillItemText,
  flattenFigures,
  patchData,
  plural,
  printedLabel,
  rowRoom,
  SCHEDULE_1_ROWS,
  staleCount,
  staleNote,
} from "./bookFigures";

const KEYS = ["rows", "i15", "i20", "i21", "i22"];
const row = (atc: string, taxable: string, rate = "3") => ({ atc, taxable, rate });
const books = (...rows: ReturnType<typeof row>[]) => flattenFigures({ rows }, KEYS);

describe("W16-A1 R1: books rows are matched by ATC", () => {
  it("compares a draft's row with the books' row of the same ATC, wherever it sits", () => {
    const fresh = books(row("PT010", "120000"), row("PT060", "45000"));
    const data = { rows: [row("PT060", "5")] };
    const values = currentValues(data, fresh);
    expect(values).toEqual({ "rows.PT060": "5" });
    expect(differing(values, fresh).map((f) => f.id)).toEqual([
      "rows.PT010",
      "rows.PT060",
    ]);
  });

  it("says a row is added when the draft has none with that ATC", () => {
    const fresh = books(row("PT010", "120000"));
    expect(fillItemText("Schedule 1 · PT010", undefined, "120000")).toBe(
      "Schedule 1 · PT010: added ₱120,000.00",
    );
    expect(fillItemText("Schedule 1 · PT060", "5", "45000")).toBe(
      "Schedule 1 · PT060: ₱5.00 becomes ₱45,000.00",
    );
    expect(currentValues({ rows: [row("PT060", "5")] }, fresh)).not.toHaveProperty(
      "rows.PT010",
    );
  });

  it("leaves a draft row whose ATC the books lack out of every list", () => {
    const fresh = books(row("PT060", "45000"));
    const data = { rows: [row("PT090", "777"), row("PT060", "5")] };
    const values = currentValues(data, fresh);
    expect(Object.keys(values)).toEqual(["rows.PT060"]);
    expect(differing(values, fresh).map((f) => f.id)).toEqual(["rows.PT060"]);
    expect(editedKeys(values, fresh)).toEqual(["rows.PT060"]);
    const after = patchData(data, fresh, ["rows.PT060"]);
    expect(after.rows).toEqual([row("PT090", "777"), row("PT060", "45000")]);
  });

  it("fills the amount of a matching row and keeps the rate the user set", () => {
    const fresh = books(row("PT010", "120000", "3"));
    const after = patchData({ rows: [row("PT010", "5", "1")] }, fresh, ["rows.PT010"]);
    expect(after.rows).toEqual([row("PT010", "120000", "1")]);
  });

  it("adds a books row the draft lacks, whole, after the draft's own rows", () => {
    const fresh = books(row("PT010", "120000", "3"), row("PT060", "45000", "3"));
    const mine = [row("PT060", "5", "1")];
    const after = patchData({ rows: mine }, fresh, ["rows.PT010", "rows.PT060"]);
    expect(mine).toEqual([row("PT060", "5", "1")]);
    expect(after.rows).toEqual([row("PT060", "45000", "1"), row("PT010", "120000", "3")]);
  });

  it("adds nothing when Schedule 1 has no room, and does not list the row", () => {
    const full = ["PT010", "PT040", "PT041", "PT060", "PT070", "PT090"].map((a) =>
      row(a, ""),
    );
    expect(SCHEDULE_1_ROWS).toBe(6);
    expect(rowRoom({ rows: full })).toBe(0);
    expect(rowRoom({ rows: full.slice(0, 4) })).toBe(2);
    const fresh = books(row("PT120", "100"));
    const values = currentValues({ rows: full }, fresh);
    expect(differing(values, fresh, rowRoom({ rows: full }))).toEqual([]);
    expect(patchData({ rows: full }, fresh, ["rows.PT120"]).rows).toEqual(full);
  });

  it("lets the room run out part-way through the books' rows", () => {
    const four = ["PT010", "PT040", "PT041", "PT060"].map((a) => row(a, "1"));
    const fresh = books(row("PT070", "1"), row("PT090", "1"), row("PT120", "1"));
    const values = currentValues({ rows: four }, fresh);
    expect(differing(values, fresh, rowRoom({ rows: four })).map((f) => f.id)).toEqual([
      "rows.PT070",
      "rows.PT090",
    ]);
    const after = patchData({ rows: four }, fresh, [
      "rows.PT070",
      "rows.PT090",
      "rows.PT120",
    ]);
    expect((after.rows as unknown[]).length).toBe(6);
  });

  it("follows the ATC when the draft's rows are reordered", () => {
    const fresh = books(row("PT010", "100"), row("PT040", "200"));
    const a = { rows: [row("PT010", "100"), row("PT040", "999")] };
    const b = { rows: [row("PT040", "999"), row("PT010", "100")] };
    expect(editedKeys(currentValues(a, fresh), fresh)).toEqual(["rows.PT040"]);
    expect(editedKeys(currentValues(b, fresh), fresh)).toEqual(["rows.PT040"]);
  });

  it("does not call a reordering of the books' rows stale", () => {
    const old = books(row("PT010", "100"), row("PT040", "200"));
    const now = books(row("PT040", "200"), row("PT010", "100"));
    expect(staleCount(old, now)).toBe(0);
  });
});

describe("W16-A1 R2: one plural function", () => {
  it("says 1 record and n records", () => {
    expect(plural(1, "record", "records")).toBe("1 record");
    expect(plural(0, "record", "records")).toBe("0 records");
    expect(plural(14, "record", "records")).toBe("14 records");
  });

  it("is what the badge uses", () => {
    expect(badgeText(1)).toBe("From books · 1 record");
    expect(badgeText(2)).toBe("From books · 2 records");
    expect(badgeText(0)).toBe("From books · 0 records");
  });

  it("is what the staleness note uses, verb and all", () => {
    expect(staleNote(1)).toBe(
      "The books changed after this draft was filled: 1 figure differs.",
    );
    expect(staleNote(2)).toBe(
      "The books changed after this draft was filled: 2 figures differ.",
    );
  });
});

describe("W16-A1 R4: Item 45 as the form prints it", () => {
  it("replaces the old Item 45 label wherever it comes in a label from the books", () => {
    expect(printedLabel("Domestic — services (Item 45): purchases")).toBe(
      "Services Rendered by Non-Residents (Item 45): purchases",
    );
    expect(printedLabel("Domestic — services (Item 45): input tax")).toBe(
      "Services Rendered by Non-Residents (Item 45): input tax",
    );
  });

  it("leaves every other label alone", () => {
    expect(printedLabel("Domestic — goods (Item 44): purchases")).toBe(
      "Domestic — goods (Item 44): purchases",
    );
    expect(printedLabel("Schedule 1 · PT010")).toBe("Schedule 1 · PT010");
  });
});

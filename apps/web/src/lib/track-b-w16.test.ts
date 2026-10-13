// track-b-w16.test.ts — W16's pure model for the "Portal books | Manual" switch:
// reading a draft's _source (R2), flattening the books' figures into fields,
// what the user changed (R3), what a fill or refresh would change (R4), how
// many figures went stale (R5), and the words (R3, R5, R4).

import { describe, expect, it } from "vitest";
import {
  badgeText,
  buildSource,
  differing,
  editedBadgeText,
  editedKeys,
  filedLine,
  fillItemText,
  flattenFigures,
  lineFor,
  patchData,
  readSource,
  sameAmount,
  staleCount,
  staleNote,
  validPeriod,
  currentValues,
  type BookLine,
} from "./bookFigures";

const KEYS_2550 = ["i31a", "i32a", "i33a", "i44a", "i44b"];
const KEYS_2551 = ["rows", "i15", "i20", "i21", "i22"];

const filter = { kind: "income" as const, from: "2026-07-01", to: "2026-09-30" };
const line = (over: Partial<BookLine>): BookLine => ({
  key: "i31a",
  label: "INVENTED LABEL",
  amount: 0,
  records: 0,
  filter,
  ...over,
});

describe("reading a draft's _source (W16 R2)", () => {
  const good = {
    mode: "books",
    asOf: "2026-10-10T02:00:00.000Z",
    fed: { i31a: 100 },
    edited: ["i31a"],
  };

  it("reads the key a draft was saved with", () => {
    expect(readSource({ year: "2026", _source: good })).toEqual(good);
    expect(readSource({ _source: { ...good, mode: "manual" } })?.mode).toBe("manual");
  });

  it("treats a draft without _source as having none: a manual draft", () => {
    expect(readSource({ year: "2026" })).toBeNull();
    expect(readSource(undefined)).toBeNull();
  });

  it("ignores a _source that is not the contract's shape", () => {
    expect(readSource({ _source: "books" })).toBeNull();
    expect(readSource({ _source: { ...good, mode: "auto" } })).toBeNull();
    expect(readSource({ _source: { ...good, fed: null } })).toBeNull();
    expect(readSource({ _source: { ...good, edited: "i31a" } })).toBeNull();
    expect(readSource({ _source: { ...good, asOf: 5 } })).toBeNull();
  });
});

describe("the books' figures as fields (W16 R3)", () => {
  it("makes one field per figure, keyed by the draft's own data key", () => {
    expect(flattenFigures({ i31a: 250000, i33a: 0, zzz: 5 }, KEYS_2550)).toEqual([
      { id: "i31a", dataKey: "i31a", books: "250000" },
      { id: "i33a", dataKey: "i33a", books: "0" },
    ]);
  });

  it("makes one field per Schedule 1 row, in order", () => {
    expect(
      flattenFigures(
        {
          rows: [
            { atc: "PT010", taxable: 120000, rate: 3 },
            { atc: "PT040", taxable: 45000, rate: 1 },
          ],
        },
        KEYS_2551,
      ),
    ).toEqual([
      {
        id: "rows.0",
        dataKey: "rows",
        books: "120000",
        row: { atc: "PT010", taxable: "120000", rate: "3" },
      },
      {
        id: "rows.1",
        dataKey: "rows",
        books: "45000",
        row: { atc: "PT040", taxable: "45000", rate: "1" },
      },
    ]);
  });

  it("reads the same fields' current values from the draft's data", () => {
    const fields = flattenFigures(
      { rows: [{ atc: "PT010", taxable: 1, rate: 3 }], i15: 7 },
      KEYS_2551,
    );
    expect(
      currentValues(
        { rows: [{ atc: "PT010", taxable: "900", rate: "3" }], i15: "" },
        fields,
      ),
    ).toEqual({ "rows.0": "900", i15: "" });
    // A row the table does not have yet reads blank.
    expect(currentValues({ rows: [] }, fields)["rows.0"]).toBe("");
  });

  it("compares amounts as numbers, a blank being nothing", () => {
    expect(sameAmount("100", "100.00")).toBe(true);
    expect(sameAmount("", "0")).toBe(true);
    expect(sameAmount(undefined, "0")).toBe(true);
    expect(sameAmount("100", "101")).toBe(false);
    expect(sameAmount("", "5")).toBe(false);
  });
});

describe("what the user changed, and what a fill would change (W16 R3, R4)", () => {
  const fed = flattenFigures({ i31a: 250000, i33a: 12000, i44a: 80000 }, KEYS_2550);

  it("lists the data keys the user changed after the books filled them", () => {
    expect(editedKeys({ i31a: "250000", i33a: "12000", i44a: "80000" }, fed)).toEqual([]);
    expect(editedKeys({ i31a: "251000", i33a: "12000", i44a: "" }, fed)).toEqual([
      "i31a",
      "i44a",
    ]);
  });

  it("counts the Schedule 1 table once, however many rows changed, or grew", () => {
    const rows = flattenFigures(
      {
        rows: [
          { atc: "PT010", taxable: 1000, rate: 3 },
          { atc: "PT040", taxable: 500, rate: 3 },
        ],
      },
      KEYS_2551,
    );
    expect(editedKeys({ "rows.0": "1000", "rows.1": "500" }, rows)).toEqual([]);
    expect(editedKeys({ "rows.0": "999", "rows.1": "499" }, rows)).toEqual(["rows"]);
  });

  it("lists only the fields where the books and the draft differ", () => {
    const fresh = flattenFigures({ i31a: 250000, i33a: 13000, i44a: 80000 }, KEYS_2550);
    expect(
      differing({ i31a: "250000.00", i33a: "12000", i44a: "" }, fresh).map((f) => f.id),
    ).toEqual(["i33a", "i44a"]);
  });
});

describe("filling from the books (W16 R4)", () => {
  it("writes a figure into its data key as the text the editor holds", () => {
    const fields = flattenFigures({ i31a: 250000, i33a: 0 }, KEYS_2550);
    const before = { i31a: "1", i32a: "7", i33a: "9" };
    const after = patchData(before, fields, ["i31a"]);
    expect(after).toEqual({ i31a: "250000", i32a: "7", i33a: "9" });
    expect(before.i31a).toBe("1");
  });

  it("writes a Schedule 1 row whole, extending the table, and leaves the user's own rows", () => {
    const fields = flattenFigures(
      {
        rows: [
          { atc: "PT010", taxable: 120000, rate: 3 },
          { atc: "PT040", taxable: 45000, rate: 1 },
        ],
      },
      KEYS_2551,
    );
    const mine = [{ atc: "PT060", taxable: "5", rate: "3" }];
    const after = patchData({ rows: mine }, fields, ["rows.0", "rows.1"]);
    expect(mine).toEqual([{ atc: "PT060", taxable: "5", rate: "3" }]);
    expect(after.rows).toEqual([
      { atc: "PT010", taxable: "120000", rate: "3" },
      { atc: "PT040", taxable: "45000", rate: "1" },
    ]);
    const extra = patchData(
      {
        rows: [
          mine[0],
          { atc: "PT090", taxable: "7", rate: "3" },
          { atc: "PT120", taxable: "8", rate: "3" },
        ],
      },
      fields,
      ["rows.0"],
    );
    expect((extra.rows as unknown[]).length).toBe(3);
    expect((extra.rows as { atc: string }[])[0]!.atc).toBe("PT010");
    expect((extra.rows as { atc: string }[])[2]!.atc).toBe("PT120");
  });
});

describe("which figures went stale (W16 R5)", () => {
  const old = flattenFigures({ i31a: 240000, i33a: 12000, i44a: 80000 }, KEYS_2550);

  it("counts the figures that differ from what the draft was filled with", () => {
    expect(
      staleCount(
        old,
        flattenFigures({ i31a: 250000, i33a: 12000, i44a: 80000 }, KEYS_2550),
      ),
    ).toBe(1);
    expect(
      staleCount(
        old,
        flattenFigures({ i31a: 250000, i33a: 13000, i44a: 80000 }, KEYS_2550),
      ),
    ).toBe(2);
    expect(staleCount(old, old)).toBe(0);
  });

  it("counts a figure that appeared, or went", () => {
    expect(
      staleCount(old, flattenFigures({ i31a: 240000, i33a: 12000 }, KEYS_2550)),
    ).toBe(1);
    expect(
      staleCount(
        old,
        flattenFigures({ i31a: 240000, i33a: 12000, i44a: 80000, i44b: 1 }, KEYS_2550),
      ),
    ).toBe(1);
  });
});

describe("finding a figure's line (W16 R3)", () => {
  const lines = [
    line({ key: "i31a", records: 14 }),
    line({ key: "PT010", records: 14, filter: { ...filter, atc: "PT010" } }),
    line({ key: "x", records: 5, filter: { ...filter, atc: "PT040" } }),
  ];
  const sched = flattenFigures(
    {
      rows: [
        { atc: "PT010", taxable: 1, rate: 3 },
        { atc: "PT040", taxable: 1, rate: 3 },
        { atc: "PT090", taxable: 1, rate: 3 },
      ],
    },
    KEYS_2551,
  );

  it("matches a plain figure by its key", () => {
    expect(lineFor(flattenFigures({ i31a: 1 }, KEYS_2550)[0]!, lines)?.records).toBe(14);
  });

  it("matches a Schedule 1 row by its ATC, in the line's key or in its filter", () => {
    expect(lineFor(sched[0]!, lines)?.key).toBe("PT010");
    expect(lineFor(sched[1]!, lines)?.records).toBe(5);
    expect(lineFor(sched[2]!, lines)).toBeUndefined();
  });
});

describe("the words (W16 R3, R4, R5, R2)", () => {
  it("words the badge a fed figure carries", () => {
    expect(badgeText(14)).toBe("From books · 14 records");
    expect(badgeText(undefined)).toBe("From books");
  });

  it("words the badge an overtyped figure carries, with the books' amount", () => {
    expect(editedBadgeText("250000")).toBe("Edited · books say ₱250,000.00");
  });

  it("words the dialog's line: label, typed, becomes, books", () => {
    expect(fillItemText("VATable sales (net) — Item 31A", "100000", "250000")).toBe(
      "VATable sales (net) — Item 31A: ₱100,000.00 becomes ₱250,000.00",
    );
    expect(fillItemText("Item", "", "5")).toBe("Item: ₱0.00 becomes ₱5.00");
  });

  it("words the staleness note with the count", () => {
    expect(staleNote(2)).toBe(
      "The books changed after this draft was filled: 2 figures differ.",
    );
  });

  it("words a filed return's line with the Manila date", () => {
    // 17:30 UTC on 11 October is 01:30 on 12 October in Manila.
    expect(filedLine("2026-10-11T17:30:00.000Z")).toBe(
      "Figures were filled from the Portal's books on October 12, 2026.",
    );
  });

  it("accepts only a real quarter as the period to fetch", () => {
    expect(validPeriod("2026-Q3")).toBe(true);
    expect(validPeriod("202-Q3")).toBe(false);
    expect(validPeriod("2026-Q5")).toBe(false);
    expect(validPeriod("2026")).toBe(false);
  });
});

describe("what a draft saves (W16 R6)", () => {
  const fed = flattenFigures({ i31a: 250000, i33a: 12000 }, KEYS_2550);

  it("saves the mode, when the books last filled it, what they gave, and what was edited", () => {
    expect(
      buildSource(
        "books",
        "2026-10-12T01:00:00.000Z",
        { i31a: 250000, i33a: 12000 },
        fed,
        {
          i31a: "251000",
          i33a: "12000",
        },
      ),
    ).toEqual({
      mode: "books",
      asOf: "2026-10-12T01:00:00.000Z",
      fed: { i31a: 250000, i33a: 12000 },
      edited: ["i31a"],
    });
  });
});

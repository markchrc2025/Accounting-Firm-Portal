// C3 R3 — "Preview PDF" saves first only when the editor holds unsaved changes.
import { describe, expect, it } from "vitest";
import { hasUnsavedChanges } from "./birPreview";

const saved = {
  period: "2026-Q3",
  data: { year: "2026", rows: [{ atc: "PT010", taxable: "1000", rate: "3" }], i15: "" },
};

describe("C3 · hasUnsavedChanges", () => {
  it("the same period and data, keys in any order: nothing to save", () => {
    expect(
      hasUnsavedChanges(saved, "2026-Q3", {
        i15: "",
        rows: [{ rate: "3", taxable: "1000", atc: "PT010" }],
        year: "2026",
      }),
    ).toBe(false);
  });

  it("a changed figure, a changed row, or a changed period: save first", () => {
    expect(hasUnsavedChanges(saved, "2026-Q3", { ...saved.data, i15: "1500" })).toBe(true);
    expect(
      hasUnsavedChanges(saved, "2026-Q3", {
        ...saved.data,
        rows: [{ atc: "PT010", taxable: "2000", rate: "3" }],
      }),
    ).toBe(true);
    expect(hasUnsavedChanges(saved, "2026-Q4", saved.data)).toBe(true);
  });

  it("a key the saved form lacks counts as a change; no saved form, nothing to compare", () => {
    expect(hasUnsavedChanges(saved, "2026-Q3", { ...saved.data, i20: "" })).toBe(true);
    expect(hasUnsavedChanges(undefined, "2026-Q3", saved.data)).toBe(false);
  });
});

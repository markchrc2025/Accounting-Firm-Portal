// C5 (D55): the editors' mirror of the server's background rules gives the same answer
// as the server's own module, for every combination the rules distinguish.
import { describe, expect, it } from "vitest";
import {
  civilStatusOf as serverCivil,
  deriveFiler as serverFiler,
} from "../../../api/src/bir-forms/engine/taxpayer-background";
import type { Taxpayer } from "../../../api/src/bir-forms/engine/types";
import {
  civilStatusOf,
  deriveFiler,
  undecidedHint,
  type ClientBackground,
} from "./incomeTaxBackground";

const CLIENTS: ClientBackground[] = [
  { kind: "individual", classification: "Single Proprietorship" },
  { kind: "individual", classification: "Professional" },
  { kind: "individual", classification: "" },
  { kind: "individual", classification: "Domestic Corporation" },
  { kind: "non-individual", taxpayerType: "Estate" },
  { kind: "non-individual", taxpayerType: "Trust" },
  { kind: "non-individual", taxpayerType: "" },
];
const MIXES = [
  { comp: 0, sales: 0, other: 0 },
  { comp: 0, sales: 1, other: 0 },
  { comp: 0, sales: 0, other: 1 },
  { comp: 1, sales: 0, other: 0 },
  { comp: 1, sales: 1, other: 0 },
];
const RATES = ["graduated", "eight"] as const;
const OPTS = [
  { allowComp: true, allowMixed: true },
  { allowComp: false, allowMixed: false },
];

describe("C5 · the editors' background rules mirror the server's", () => {
  it("deriveFiler gives the server's answer for every client kind, mix, rate and form option", () => {
    let n = 0;
    for (const c of CLIENTS)
      for (const m of MIXES)
        for (const r of RATES)
          for (const o of OPTS) {
            const server = serverFiler(c as unknown as Taxpayer, m, r, o);
            expect({ c, m, r, o, got: deriveFiler(c, m, r, o) }).toEqual({
              c,
              m,
              r,
              o,
              got: server,
            });
            n += 1;
          }
    expect(n).toBe(7 * 5 * 2 * 2);
  });

  it("civilStatusOf gives the server's answer for the Client form's options and for odd records", () => {
    for (const raw of [
      "Single",
      "Married",
      "Widow/Widower",
      "Legally Separated",
      "MARRIED",
      "widowed",
      "Separated",
      "",
      null,
      undefined,
      "Divorced",
    ]) {
      expect(civilStatusOf(raw)).toBe(serverCivil(raw));
    }
  });

  it("says what to set when nothing can be derived", () => {
    expect(undecidedHint({ kind: "individual", classification: "" })).toMatch(
      /classification/,
    );
    expect(undecidedHint({ kind: "non-individual" })).toMatch(/taxpayer type/);
    expect(undecidedHint(undefined)).toMatch(/Choose the client/);
  });
});

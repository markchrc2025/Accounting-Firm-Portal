// compute0619E.ts — BIR Form 0619-E, Monthly Remittance Form of Creditable Income Taxes
// Withheld (Expanded) (U17). Filed for the 1st and 2nd month of each quarter; the 3rd
// month is reported on the 1601-EQ. Written on the model of compute2551Q, in exact
// decimals to the centavo (exact.ts): no peso rounding.

import type { FilingData } from "./types";
import { centavos, dec, sum } from "./exact";
import { dueDate0619E } from "./withholding-dates";

export interface Comp0619E {
  /** Item 14: amount of remittance (from the books, or typed). */
  i14: number;
  /** Item 15: less, remitted from the previously filed form (an amended return). */
  i15: number;
  /** Item 16: net amount of remittance (14 less 15). */
  i16: number;
  i17a: number;
  i17b: number;
  i17c: number;
  /** Item 17D: total penalties (17A to 17C). */
  i17d: number;
  /** Item 18: total amount of remittance (16 plus 17D). */
  i18: number;
  /** Item 2's default: the 10th of the following month, a weekend moved to Monday ("" with no month). */
  defaultDueDate: string;
}

export function compute0619E(d: FilingData): Comp0619E {
  const i14 = dec(d.remittance);
  const i15 = dec(d.previouslyRemitted);
  const i16 = i14.minus(i15);
  const a = dec(d.surcharge);
  const b = dec(d.interest);
  const c = dec(d.compromise);
  const i17d = sum(a, b, c);
  return {
    i14: centavos(i14),
    i15: centavos(i15),
    i16: centavos(i16),
    i17a: centavos(a),
    i17b: centavos(b),
    i17c: centavos(c),
    i17d: centavos(i17d),
    i18: centavos(i16.plus(i17d)),
    defaultDueDate: dueDate0619E(String(d.year ?? ""), String(d.month ?? "")),
  };
}

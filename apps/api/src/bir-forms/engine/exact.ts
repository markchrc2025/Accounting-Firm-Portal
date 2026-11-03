// exact.ts — exact peso-and-centavo arithmetic for the withholding returns (U17, R4).
//
// The 0619-E, 1601-EQ and 1601-C carry CENTAVOS. This file is where that choice is
// made: amounts are read and summed as exact decimals (decimal.js, as Prisma returns
// money), never as floating point, and reported to two places. U15's whole-peso
// function (book-figures/round-to-whole-peso.ts) is deliberately NOT used by these
// forms, and a test reads the sources of the three compute files and the withholding
// feeder to keep it so.
//
// A typed value may carry more than two places; every total is reported to the
// centavo, half up (an input of two places, as every real amount is, is never changed).

import { Prisma } from "@prisma/client";

export type Dec = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

/** A typed field read exactly: commas stripped; blank or not a number is 0. */
export function dec(v: unknown): Dec {
  if (v === "" || v == null) return ZERO;
  const text = String(v).replace(/,/g, "").trim();
  if (text === "") return ZERO;
  try {
    const d = new Prisma.Decimal(text);
    return d.isFinite() ? d : ZERO;
  } catch {
    return ZERO;
  }
}

/** The exact sum. */
export function sum(...xs: Dec[]): Dec {
  return xs.reduce((a, b) => a.plus(b), ZERO);
}

/** A total as the number reported: to the centavo, half up, never -0. */
export function centavos(d: Dec): number {
  const n = d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
  return n === 0 ? 0 : n;
}

/** The same total as text with exactly two places ("1234.50"): what the books feed saves. */
export function centavoText(d: Dec): string {
  return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

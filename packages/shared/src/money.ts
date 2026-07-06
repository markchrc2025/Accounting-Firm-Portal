import { z } from "zod";

/**
 * Monetary amount on the wire (a JSON number, e.g. 400000.00).
 *
 * IMPORTANT: transaction amounts are stored **net of VAT** unless the field name says
 * otherwise; VAT is carried in its own field. The JSON `number` here is the *transport*
 * representation only — persist money with a decimal type (e.g. Prisma `Decimal`) to
 * avoid floating-point drift.
 */
export const zMoney = z.number().finite().nonnegative();
export type Money = z.infer<typeof zMoney>;

/** Signed monetary amount that may be negative, e.g. `netVATPayable = -12000.00`. */
export const zSignedMoney = z.number().finite();
export type SignedMoney = z.infer<typeof zSignedMoney>;

/** ISO calendar date, `YYYY-MM-DD`. */
export const zIsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected an ISO date (YYYY-MM-DD)");
export type IsoDate = z.infer<typeof zIsoDate>;

/** Round to 2 decimals (money) in a float-safe way. */
export const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

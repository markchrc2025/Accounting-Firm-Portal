// project-details.ts — PA8 (D70): the pure rules of a firm project's details. No database.

export const FEE_SENTENCE =
  "The professional fee must be a number, zero or more, with at most 2 decimals.";

const FEE_TEXT = /^(\d{1,16})(?:\.(\d{1,2}))?$/;

/**
 * The professional fee as the database keeps it ("12.50"), from what the API was sent.
 * undefined: not given (leave it); null: no fee (null, or an empty string). A number or a string of
 * digits with at most 2 decimals, zero or more, up to 16 digits before the point; anything else
 * throws the one sentence. A string is not trimmed: " 12" is refused. A number must print as plain
 * digits, so 1e21 and 0.1 + 0.2 are refused.
 */
export function parseFee(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const text =
    typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  if (typeof text !== "string") throw new FeeError();
  const m = FEE_TEXT.exec(text);
  if (!m) throw new FeeError();
  const whole = m[1]!.replace(/^0+(?=\d)/, "");
  return `${whole}.${(m[2] ?? "").padEnd(2, "0")}`;
}

export class FeeError extends Error {
  constructor() {
    super(FEE_SENTENCE);
    this.name = "FeeError";
  }
}

/** A typed client name: trimmed; empty is no name (null). */
export function cleanClientName(value: string | null | undefined): string | null {
  const t = (value ?? "").trim();
  return t === "" ? null : t;
}

/** A Decimal (or null) as the API shows it: "3500.00". */
export function feeText(
  d: { toFixed(places: number): string } | null | undefined,
): string | null {
  return d == null ? null : d.toFixed(2);
}

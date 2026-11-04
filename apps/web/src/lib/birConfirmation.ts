// birConfirmation.ts — what the Mark as filed dialog and the confirmation card show of
// the API's BIR confirmation (W18, Track A U18). Nothing here reads a PDF or rewords a
// server message: the API reads and checks the file; this only chooses symbols, names
// the checks, and writes the dates the way the firm reads them.

import type {
  ConfirmationCheck,
  ConfirmationCheckResult,
  ConfirmationCheckStatus,
} from "./api";

/** An override reason is at least this long; the server decides, the counter shows it. */
export const OVERRIDE_MIN_LENGTH = 10;

/** The nine checks' names, in the API's order. */
export const CHECK_NAMES: Record<ConfirmationCheck["id"], string> = {
  "bir-email": "The email is the BIR's",
  "file-name": "The BIR file name",
  taxpayer: "The taxpayer",
  form: "The form",
  period: "The period",
  received: "The date and time received",
  duplicate: "Not attached to another return",
  timing: "Timing",
  upload: "The file",
};

/** A tick, a cross, a warning mark, or a dash for a check that did not run. */
export const CHECK_MARK: Record<ConfirmationCheckStatus, string> = {
  ok: "✓",
  error: "✗",
  warning: "⚠",
  skipped: "–",
};

export const CHECK_WORD: Record<ConfirmationCheckStatus, string> = {
  ok: "ok",
  error: "error",
  warning: "warning",
  skipped: "skipped",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The instant the BIR received the return, on Manila's clock: "Apr 25, 2026, 3:42 PM". */
export function receivedText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });
}

/** A date on Manila's clock, "Apr 25, 2026" (the stored filed date, or a stored instant). */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "Asia/Manila",
  });
}

/** The period the API read from the confirmation: "2026 Q1", "July 2026" or "2025". */
export function periodText(
  parsed: NonNullable<ConfirmationCheckResult["parsed"]>,
): string {
  if (parsed.quarter) return `${parsed.taxYear} Q${parsed.quarter}`;
  if (parsed.month)
    return `${MONTHS[parsed.month - 1] ?? parsed.month} ${parsed.taxYear}`;
  return String(parsed.taxYear);
}

/** The dialog's three jobs. */
export type ConfirmationMode = "mark" | "attach" | "replace";

export const DIALOG_TITLE: Record<ConfirmationMode, string> = {
  mark: "Mark as filed",
  attach: "Attach confirmation",
  replace: "Replace",
};

/** Whether the button that files, attaches or replaces may be pressed: a check of THIS
 *  file came back with no error (warnings do not stop it). */
export function canConfirm(
  result: ConfirmationCheckResult | null,
  checked: File | null,
  chosen: File | null,
): boolean {
  return !!result && result.ok === true && !!chosen && checked === chosen;
}

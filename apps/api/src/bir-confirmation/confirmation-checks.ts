// confirmation-checks.ts — U18 (D58): the nine checks, in this order, run over an
// uploaded PDF and the return it is offered for. Every ERROR blocks Mark as filed; a
// WARNING is shown and blocks nothing. Pure apart from reading the PDF and asking
// `findDuplicate` — no database, no storage — so the same function answers the check
// endpoint and Mark as filed.
//
//   1 the e-mail is the BIR's        4 the form is the return's        7 not attached elsewhere
//   2 the file name reads            5 the period (year, quarter,      8 timing (WARNING only)
//   3 the TIN and branch are the         month, year-end month)        9 the upload (PDF, size, text)
//     client's                       6 the date and time received
//
// Check 9 is about the file itself and runs first in effect: if the upload is not a
// readable PDF there is nothing to read, and checks 1–8 are "skipped" (not failed).
import { createHash } from "node:crypto";
import { MAX_CONFIRMATION_BYTES, MESSAGES } from "./confirmation-forms";
import { parseBirFileName, shownTin, type ParsedBirFileName } from "./bir-file-name";
import { parseReceived, readConfirmationText } from "./confirmation-text";
import { extractPdfText, PdfUnreadableError } from "./pdf-text";
import { dueDateFor, periodEndFor } from "./return-timing";

export type CheckStatus = "ok" | "error" | "warning" | "skipped";

export interface Check {
  /** 1–9, the order the owner gave. */
  n: number;
  id:
    | "bir-email"
    | "file-name"
    | "taxpayer"
    | "form"
    | "period"
    | "received"
    | "duplicate"
    | "timing"
    | "upload";
  status: CheckStatus;
  message: string | null;
}

/** What the return and its client say the confirmation must be. */
export interface ExpectedReturn {
  form: string;
  /** "2026-Q1", "2026-07" or "2025". */
  period: string;
  /** The client's TIN (any punctuation); null if it has none. */
  clientTin: string | null;
  /** The client's branch ("00000", "012"…); null is the head office. */
  clientBranch: string | null;
  /** The month the client's fiscal year ends (12 for a calendar year, or none stored). */
  fyEndMonth: number;
  /** The client's fiscal-year start date ("2025-07-01"), or null for a calendar year. */
  fiscalYearStart: string | null;
}

export interface DuplicateQuery {
  birFileName: string | null;
  receivedAt: Date | null;
  sha256: string;
}
export interface DuplicateHit {
  form: string;
  clientName: string;
  period: string;
}

export interface ConfirmationResult {
  ok: boolean;
  checks: Check[];
  errors: string[];
  warnings: string[];
  /** What the file name and the received lines say; null when the file could not be read. */
  parsed: {
    birFileName: string;
    tin: string;
    branch: string;
    form: string;
    version: string | null;
    fyEndMonth: number | null;
    taxYear: number;
    quarter: number | null;
    month: number | null;
    amendment: number | null;
    shape: "verified" | "derived";
    /** The instant the BIR received it, ISO UTC; null if it could not be read. */
    receivedAt: string | null;
  } | null;
  /** The Manila date Mark as filed would file on (the date the BIR received it). */
  filedOn: string | null;
  sha256: string | null;
}

const MONTH_NAMES = [
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

/** "2026-04-25" → "25 April 2026". */
export function longDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

const ORDER: Array<[Check["n"], Check["id"]]> = [
  [1, "bir-email"],
  [2, "file-name"],
  [3, "taxpayer"],
  [4, "form"],
  [5, "period"],
  [6, "received"],
  [7, "duplicate"],
  [8, "timing"],
  [9, "upload"],
];

/** The return's period as numbers; null if it is none of "2026-Q1", "2026-07", "2025". */
function readPeriod(period: string): { year: number; quarter: number | null; month: number | null } | null {
  const q = /^(\d{4})-Q([1-4])$/i.exec(period.trim());
  if (q) return { year: Number(q[1]), quarter: Number(q[2]), month: null };
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period.trim());
  if (m) return { year: Number(m[1]), quarter: null, month: Number(m[2]) };
  const y = /^(\d{4})$/.exec(period.trim());
  return y ? { year: Number(y[1]), quarter: null, month: null } : null;
}

/** Only the 2550Q's file name carries a year-end month that is the client's. */
const COMPARES_YEAR_END = new Set(["2550Q"]);

export async function evaluateConfirmation(input: {
  bytes: Uint8Array;
  expected: ExpectedReturn;
  now: Date;
  findDuplicate: (q: DuplicateQuery) => Promise<DuplicateHit | null>;
}): Promise<ConfirmationResult> {
  const { bytes, expected, now } = input;
  const c = new Map<Check["id"], { status: CheckStatus; message: string | null }>();
  const set = (id: Check["id"], status: CheckStatus, message: string | null) =>
    c.set(id, { status, message });
  const finish = (
    parsed: ConfirmationResult["parsed"],
    filedOn: string | null,
    sha256: string | null,
  ): ConfirmationResult => {
    const checks: Check[] = ORDER.map(([n, id]) => ({
      n,
      id,
      status: c.get(id)?.status ?? "skipped",
      message: c.get(id)?.message ?? null,
    }));
    return {
      ok: !checks.some((k) => k.status === "error"),
      checks,
      errors: checks.filter((k) => k.status === "error").map((k) => k.message!),
      warnings: checks.filter((k) => k.status === "warning").map((k) => k.message!),
      parsed,
      filedOn,
      sha256,
    };
  };

  // --- 9. the upload itself: a PDF, at most 5 MB, with text in it -------------------
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length > MAX_CONFIRMATION_BYTES) {
    set("upload", "error", MESSAGES.tooLarge);
    return finish(null, null, sha256);
  }
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (head !== "%PDF-") {
    set("upload", "error", MESSAGES.notPdf);
    return finish(null, null, sha256);
  }
  let text: string;
  try {
    text = await extractPdfText(bytes);
  } catch (err) {
    if (!(err instanceof PdfUnreadableError)) throw err;
    set("upload", "error", MESSAGES.notPdf);
    return finish(null, null, sha256);
  }
  if (text.trim() === "") {
    set("upload", "error", MESSAGES.picture);
    return finish(null, null, sha256);
  }
  set("upload", "ok", "The PDF has text and is within 5 MB.");

  const facts = readConfirmationText(text);

  // --- 1. it is the BIR's e-mail ----------------------------------------------------
  if (facts.fromBir) set("bir-email", "ok", "It is a BIR eBIRForms confirmation email.");
  else set("bir-email", "error", MESSAGES.notBirEmail);

  // --- 2. the file name reads -------------------------------------------------------
  const name: ParsedBirFileName | null = facts.fileName ? parseBirFileName(facts.fileName) : null;
  if (name) set("file-name", "ok", `The BIR file name is ${name.fileName}.`);
  else set("file-name", "error", MESSAGES.fileNameUnreadable);

  // --- 6. the date and time received (Manila time), never the sent line --------------
  const received =
    facts.dateText && facts.timeText ? parseReceived(facts.dateText, facts.timeText) : { ok: false as const };
  if (!received.ok) set("received", "error", MESSAGES.receivedUnreadable);
  else if (received.at.getTime() > now.getTime() + 5 * 60_000) {
    set("received", "error", MESSAGES.receivedInFuture);
  } else {
    set("received", "ok", `The BIR received the return on ${longDate(received.date)} at ${received.time}.`);
  }

  if (name) {
    // --- 3. the TIN and the branch are the client's ---------------------------------
    const digits = (expected.clientTin ?? "").replace(/\D/g, "");
    if (digits.length < 9) set("taxpayer", "error", MESSAGES.clientHasNoTin);
    else {
      const branch = Number((expected.clientBranch ?? "").replace(/\D/g, "") || "0");
      if (name.tin === digits.slice(0, 9) && name.branch === branch) {
        set("taxpayer", "ok", "The TIN and branch are this client's.");
      } else set("taxpayer", "error", MESSAGES.wrongTin(shownTin(name)));
    }

    // --- 4. the form ----------------------------------------------------------------
    if (name.form === expected.form) set("form", "ok", `The confirmation is for the ${name.form}.`);
    else set("form", "error", MESSAGES.wrongForm(name.form, expected.form));

    // --- 5. the period (only meaningful for the same form) --------------------------
    if (name.form === expected.form) {
      const want = readPeriod(expected.period);
      if (!want) {
        set("period", "error", "This return has no period set, so the confirmation cannot be matched to it.");
      } else if (name.month !== null || want.month !== null) {
        if (name.taxYear !== want.year || name.month !== want.month) {
          const got = name.month === null ? `${name.taxYear}` : `${MONTH_NAMES[name.month - 1]} ${name.taxYear}`;
          const mine = want.month === null ? `${want.year}` : `${MONTH_NAMES[want.month - 1]} ${want.year}`;
          set("period", "error", `The confirmation is for ${got}, this return is ${mine}.`);
        } else set("period", "ok", `The confirmation is for ${MONTH_NAMES[want.month! - 1]} ${want.year}.`);
      } else if (name.quarter !== null || want.quarter !== null) {
        if (name.taxYear !== want.year || name.quarter !== want.quarter) {
          const got = name.quarter === null ? `${name.taxYear}` : `${name.taxYear} Q${name.quarter}`;
          const mine = want.quarter === null ? `${want.year}` : `${want.year} Q${want.quarter}`;
          set("period", "error", `The confirmation is for ${got}, this return is ${mine}.`);
        } else set("period", "ok", `The confirmation is for ${want.year} Q${want.quarter}.`);
      } else if (name.taxYear !== want.year) {
        set("period", "error", `The confirmation is for ${name.taxYear}, this return is ${want.year}.`);
      } else set("period", "ok", `The confirmation is for ${want.year}.`);

      if (c.get("period")!.status === "ok" && COMPARES_YEAR_END.has(name.form) && name.fyEndMonth !== null) {
        if (name.fyEndMonth !== expected.fyEndMonth) {
          set(
            "period",
            "error",
            `The confirmation is for a fiscal year ending in ${MONTH_NAMES[name.fyEndMonth - 1]}, this client's fiscal year ends in ${MONTH_NAMES[expected.fyEndMonth - 1]}.`,
          );
        }
      }
    }
  }

  // --- 7. not already attached to another return of the firm -------------------------
  const hit = await input.findDuplicate({
    birFileName: name ? name.fileName : null,
    receivedAt: received.ok ? received.at : null,
    sha256,
  });
  if (hit) set("duplicate", "error", MESSAGES.duplicate(`${hit.form}, ${hit.clientName}, ${hit.period}`));
  else set("duplicate", "ok", "No other return has this confirmation.");

  // --- 8. timing: WARNINGS, never blocking -------------------------------------------
  if (received.ok) {
    const end = periodEndFor(expected.form, expected.period, expected.fiscalYearStart);
    const due = dueDateFor(expected.form, expected.period, expected.fiscalYearStart);
    if (end && received.date < end) {
      set(
        "timing",
        "warning",
        `The BIR received this return on ${longDate(received.date)}, before the period ended on ${longDate(end)}.`,
      );
    } else if (due && received.date > due) {
      const days = daysBetween(due, received.date);
      set(
        "timing",
        "warning",
        `The BIR received this return on ${longDate(received.date)}, ${days} ${days === 1 ? "day" : "days"} after the due date of ${longDate(due)}.`,
      );
    } else set("timing", "ok", "The BIR received the return after the period ended and by its due date.");
  }

  const parsed: ConfirmationResult["parsed"] = name
    ? {
        birFileName: name.fileName,
        tin: name.tin,
        branch: name.branchText,
        form: name.form,
        version: name.version,
        fyEndMonth: name.fyEndMonth,
        taxYear: name.taxYear,
        quarter: name.quarter,
        month: name.month,
        amendment: name.amendment,
        shape: name.shape,
        receivedAt: received.ok ? received.at.toISOString() : null,
      }
    : null;
  return finish(parsed, received.ok ? received.date : null, sha256);
}

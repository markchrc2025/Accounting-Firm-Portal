// birFiling.ts — what a FILED BIR form means on screen (W3).
//
// A filed form is sealed (W3 R1): Track A's U3 refuses any change to it with
// 409. A return is corrected by amending it (R2); a certificate by issuing a
// new, corrected one. And a filed form prints the payor / employer exactly as
// it stood when it was filed (R3), never as the client record reads today.

import type { BirFiledSnapshot, BirFormDetail, Client } from "./api";

/** The two certificates: issued to a payee or employee, never e-filed. */
const CERTIFICATES = new Set(["2307", "2316"]);

export function isCertificate(form: string | null | undefined): boolean {
  return CERTIFICATES.has(String(form ?? ""));
}

/** A filing date as the firm reads it — "Apr 20, 2026" — on Manila's calendar. */
export function filedDate(iso: string | null | undefined): string {
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

/** The filed banner's heading: "Filed on …" for a return, "Issued on …" for a
 *  certificate (W3 B1). Without a date it says only "Filed" / "Issued". */
export function filedBannerTitle(
  form: string,
  filedAt: string | null | undefined,
): string {
  const verb = isCertificate(form) ? "Issued" : "Filed";
  const on = filedDate(filedAt);
  return on ? `${verb} on ${on}` : verb;
}

/** "Amendment 2 of the 2551Q filed on Apr 20, 2026" (W3 R2). The date is the
 *  amended form's filing date; without it the heading stops at the form. */
export function amendmentHeading(
  sequence: number | null | undefined,
  form: string,
  amendedFiledAt: string | null | undefined,
): string {
  const on = filedDate(amendedFiledAt);
  return `Amendment ${sequence ?? "?"} of the ${form}${on ? ` filed on ${on}` : ""}`;
}

/** The payor / employer block a certificate prints. */
export interface PrintParty {
  businessName: string;
  /** The BIR name: "LAST, FIRST MIDDLE" for an individual, the registered
   *  name otherwise; "" when those fields are empty (W7 R6). */
  registeredName: string;
  tin: string;
  branch: string;
  address: string;
  city: string;
  zip: string;
  rdo: string;
  /** Where the block came from — the filing snapshot, or today's client record. */
  source: "snapshot" | "client";
}

const str = (v: string | null | undefined) => (v == null ? "" : String(v));

/** The name fields a client record (or its filing snapshot) carries. */
export interface NameFields {
  kind?: string | null;
  regName?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
}

/**
 * The taxpayer's name as a BIR certificate prints it (W7 R6): for an
 * individual, "LAST, FIRST MIDDLE" from the last, first and middle names; for
 * anyone else, the registered name. Never the trade name or the display name.
 * "" when the fields it needs are empty — an individual needs a last and a
 * first name — so the caller can refuse to print.
 */
export function registeredName(src: NameFields): string {
  if (str(src.kind).trim() === "individual") {
    const last = str(src.lastName).trim();
    const first = str(src.firstName).trim();
    const middle = str(src.middleName).trim();
    if (!last || !first) return "";
    return `${last}, ${first}${middle ? ` ${middle}` : ""}`;
  }
  return str(src.regName).trim();
}

/**
 * W3 R3: once a form is filed and carries its filing snapshot, every print
 * reads the payor / employer block from the snapshot and never from the client
 * query. A draft — and a form filed before U3, whose snapshot is null — reads
 * the client record.
 */
export function printParty(
  form: Pick<BirFormDetail, "status" | "filedSnapshot"> | null | undefined,
  client: Partial<Client> | null | undefined,
): PrintParty {
  const snap: BirFiledSnapshot | null | undefined =
    form?.status === "filed" ? form.filedSnapshot : undefined;
  const src = snap ?? client ?? {};
  return {
    businessName: str(src.businessName),
    registeredName: registeredName(src),
    tin: str(src.tin),
    branch: str(src.branch),
    address: str(src.address),
    city: str(src.city),
    zip: str(src.zip),
    rdo: str(src.rdo),
    source: snap ? "snapshot" : "client",
  };
}

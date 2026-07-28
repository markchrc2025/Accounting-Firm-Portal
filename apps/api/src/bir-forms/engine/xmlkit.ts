// xmlkit.ts — shared value-formatting atoms for the eBIRForms XML builders.
// PORTED from the Sentire generator (src/lib/xml/xmlkit), trimmed to what the
// 2551Q builder needs. The browser-only `download` helper is intentionally
// omitted — the portal writes artifacts to object storage, not the DOM.

import type { Taxpayer } from "./types";
import { num } from "./format";

/** URL-encode a value the eBIRForms way (comma→%2C, space→%20). */
export function enc(v: unknown): string {
  if (v == null) return "";
  return encodeURIComponent(String(v));
}

/** Money → "1,234,567.00". */
export function amt(n: unknown): string {
  return num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Radio/checkbox boolean → "true"/"false". */
export const rb = (cond: boolean): string => (cond ? "true" : "false");

export interface TinParts {
  t1: string;
  t2: string;
  t3: string;
  /** 3-digit branch code ("000" head office). */
  branch3: string;
  /** 5-digit branch code ("00000" head office). */
  branch5: string;
}

/** Split a taxpayer TIN into the 3×3 groups + branch code. */
export function tinParts(tp: Taxpayer | null): TinParts {
  const d = String((tp && tp.tin) || "").replace(/\D/g, "");
  const b = String((tp && tp.branch) || "0").replace(/\D/g, "") || "0";
  return {
    t1: d.slice(0, 3),
    t2: d.slice(3, 6),
    t3: d.slice(6, 9),
    branch3: b.padStart(3, "0").slice(-3),
    branch5: b.padStart(5, "0").slice(-5),
  };
}

export type XmlRow = [key: string, value: string];

// parseEbirExport — read the eBIRForms export file the Portal's builders write
// (apps/api/src/bir-forms/engine/build<Form>.ts) back into [key, value] rows.
//
// The file is "<?xml version='1.0'?>", then one "<div>KEY=VALUEKEY=</div>" per
// field (2551Q joins them with tabs, 2550Q with newlines), then the tail
// "All Rights Reserved BIR 2012.0". The builders URL-encode some values with
// enc() (xmlkit.ts) and emit the rest raw; this parser decodes exactly the keys
// the builder of that form encodes, so a literal "%" in a raw value survives.
import { BirPdfError } from "./types";

/**
 * The keys each builder passes through enc(), by eBIRForms namespace. A key
 * listed here is decoded; every other key is taken verbatim.
 */
export const ENCODED_KEYS: Readonly<Record<string, ReadonlySet<string>>> = {
  // build2551Q.ts
  frm2551Qv2018: new Set([
    "frm2551Qv2018:registeredName",
    "frm2551Qv2018:registeredAddress",
    "frm2551Qv2018:txtTaxReliefSpecify",
    "frm2551Qv2018:txt17Specify",
    "txtTaxAgentNo",
    "txtDateIssue",
    "txtDateExpiry",
    "frm2551Qv2018:txtParticular28",
    ...[25, 26, 27, 28].flatMap((n) => [
      `frm2551Qv2018:txtAgency${n}`,
      `frm2551Qv2018:txtNumber${n}`,
      `frm2551Qv2018:txtDate${n}`,
    ]),
  ]),
  // build2550Q.ts
  frm2550qv2024: new Set([
    "frm2550qv2024:taxpayerName",
    "frm2550qv2024:taxpayerAddress",
    "frm2550qv2024:specifyInternationalTreaty",
    "frm2550qv2024:addSpecifyNo19",
    "frm2550qv2024:addSpecifyNo42",
    "frm2550qv2024:addSpecifyNo47",
    "frm2550qv2024:addSpecifyNo56",
    "txtDescription10",
    "txtDescription11",
    "txtNameWithHoldingAgent30",
    "txtNameWithHoldingAgent31",
    "txtNameOfMiller40",
    "txtNameOfMiller41",
    "txtNameOfTaxpayer40",
    "txtNameOfTaxpayer41",
    // Encoded when the row has an OR number; "0.00" (no "%") otherwise.
    "txtOfficialReceiptNumber40",
    "txtOfficialReceiptNumber41",
  ]),
};

const DIV = /<div>([\s\S]*?)<\/div>/g;

/** Parse an eBIRForms export into [key, value] rows, in file order. */
export function parseEbirExport(text: string): [string, string][] {
  const raw: [string, string][] = [];
  for (const m of text.matchAll(DIV)) {
    const body = m[1]!;
    const eq = body.indexOf("=");
    const key = eq > 0 ? body.slice(0, eq) : "";
    const close = `${key}=`;
    if (!key || body.length < 2 * close.length || !body.endsWith(close)) {
      throw new BirPdfError(
        `eBIRForms export: malformed field <div>${body.slice(0, 60)}</div>`,
      );
    }
    raw.push([key, body.slice(close.length, body.length - close.length)]);
  }
  if (raw.length === 0)
    throw new BirPdfError("eBIRForms export: no <div>KEY=VALUEKEY=</div> fields found");

  const ns = raw.find(([k]) => k.includes(":"))?.[0].split(":")[0];
  const encoded = ns === undefined ? undefined : ENCODED_KEYS[ns];
  if (!encoded) {
    throw new BirPdfError(
      `eBIRForms export: unknown form namespace "${ns ?? "(none)"}"; its encoded keys are not known`,
    );
  }
  return raw.map(([k, v]) => {
    if (!encoded.has(k)) return [k, v];
    try {
      return [k, decodeURIComponent(v)];
    } catch {
      throw new BirPdfError(
        `eBIRForms export: ${k} is not valid URL-encoding: "${v.slice(0, 40)}"`,
        k,
      );
    }
  });
}

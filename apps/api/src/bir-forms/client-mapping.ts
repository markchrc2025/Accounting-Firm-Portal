import type { Taxpayer } from "./engine";

/** The Client columns the engine's Taxpayer mapping needs (all nullable). */
export interface ClientForTaxpayer {
  id: string;
  businessName: string;
  kind: string;
  regName: string | null;
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  tradeName: string | null;
  tin: string | null;
  branch: string;
  rdo: string | null;
  rdoName: string | null;
  address: string | null;
  city: string | null;
  zip: string | null;
  birthdate: Date | null;
  incorpDate: Date | null;
  email: string | null;
  phone: string | null;
  citizenship: string | null;
  civilStatus: string | null;
  taxpayerType: string | null;
  classification: string | null;
}

/** ISO yyyy-mm-dd from a @db.Date value (UTC). */
function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/**
 * Map a portal Client (the system of record) onto the engine's Taxpayer — the
 * exact shape the ported Sentire builders expect. A company falls back to its
 * business name for the registered name.
 */
export function clientToTaxpayer(c: ClientForTaxpayer): Taxpayer {
  return {
    id: c.id,
    kind: c.kind === "individual" ? "individual" : "non-individual",
    regName: c.regName || c.businessName || "",
    lastName: c.lastName || "",
    firstName: c.firstName || "",
    middleName: c.middleName || "",
    tradeName: c.tradeName || undefined,
    tin: c.tin || "",
    branch: c.branch || "00000",
    rdo: c.rdo || "",
    rdoName: c.rdoName || undefined,
    address: c.address || "",
    city: c.city || "",
    zip: c.zip || "",
    birthdate: isoDate(c.birthdate),
    incorpDate: c.incorpDate ? isoDate(c.incorpDate) : undefined,
    email: c.email || "",
    phone: c.phone || "",
    citizenship: c.citizenship || "",
    civilStatus: c.civilStatus || "",
    taxpayerType: c.taxpayerType || "",
    classification: c.classification || "",
    createdAt: 0,
  };
}

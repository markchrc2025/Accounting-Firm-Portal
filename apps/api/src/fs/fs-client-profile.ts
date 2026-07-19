// Client → FS entity-fact composition (pure). When a report is linked to a
// portal client, these facts are SNAPSHOTTED onto the report at link time:
// the report stays a standalone, editable document (a filed AFS must not
// mutate because the client record changed later), while the link records
// where the facts came from and lets the UI auto-fill them.

export interface ClientLikeForFs {
  businessName: string;
  regName: string | null;
  kind: string; // "individual" | "non-individual"
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  zip: string | null;
  classification: string | null; // Professional | Single Proprietorship | …
}

export interface ClientEntityFacts {
  entityName: string;
  registeredAddress: string | null;
  businessDescription: string | null;
}

/** The legal entity name: registered (SEC/DTI) name first, then the display
 *  business name, then the individual's full name. */
export function clientEntityName(c: ClientLikeForFs): string {
  if (c.regName?.trim()) return c.regName.trim();
  if (c.businessName?.trim()) return c.businessName.trim();
  const person = [c.firstName, c.middleName, c.lastName].filter(Boolean).join(" ").trim();
  return person || "";
}

/** One-line registered address from the filer profile's parts. */
export function clientRegisteredAddress(c: ClientLikeForFs): string | null {
  const parts = [c.address, c.city, c.province, c.zip]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : null;
}

/** Compose the FS entity facts a portal client record can provide. Fields the
 *  client DB does not carry (SEC registration no., business description,
 *  capital stock) stay null — the report keeps placeholders + warnings until
 *  the accountant fills them in Entity details. */
export function composeClientEntityFacts(c: ClientLikeForFs): ClientEntityFacts {
  return {
    entityName: clientEntityName(c),
    registeredAddress: clientRegisteredAddress(c),
    businessDescription: null,
  };
}

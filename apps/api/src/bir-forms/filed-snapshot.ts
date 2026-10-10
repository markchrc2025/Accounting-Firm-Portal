/**
 * filed-snapshot.ts — the taxpayer block a BIR form was filed with (U3, D12).
 *
 * At the draft → filed write the client row's taxpayer fields are copied into
 * BirForm.filedSnapshotJson; every later XML export of that form and every
 * certificate print reads the copy, never the client as it reads today. The shape
 * is the union of what the two consumers read (U3 A3):
 *
 *   - the XML export: clientToTaxpayer(client) (client-mapping.ts) — kind, the name
 *     parts, tin, branch, rdo, address, city, zip, dates, contact fields — and the
 *     eBIRForms filename (tin and branch, via tinParts);
 *   - the web's certificates (2307 / 2316) and Track B's W3, which read exactly
 *     businessName, tin, branch, address, city, zip and rdo from it (R3).
 *
 * Values are the client's RAW values (null stays null), so the snapshot is a
 * drop-in for the client record on both sides. Dates are stored as yyyy-mm-dd.
 * Every key beyond the seven R3 keys is additive.
 */
import { z } from "zod";
import type { ClientForTaxpayer } from "./client-mapping";

export const FILED_SNAPSHOT_VERSION = 1;

/** The seven keys Track B's W3 reads by these exact names (U3 R3). */
export const R3_KEYS = [
  "businessName",
  "tin",
  "branch",
  "address",
  "city",
  "zip",
  "rdo",
] as const;

const str = z.string();
const nstr = z.string().nullable();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

/** Parses a stored snapshot; passthrough keeps any later additive key. */
export const FiledSnapshotSchema = z
  .object({
    snapshotVersion: z.number().int(),
    takenAt: z.string(),
    clientId: str,
    // R3 — read by the certificates and W3
    businessName: str,
    tin: nstr,
    branch: str,
    address: nstr,
    city: nstr,
    zip: nstr,
    rdo: nstr,
    // the name parts and kind clientToTaxpayer and the filenames read
    kind: str,
    regName: nstr,
    lastName: nstr,
    firstName: nstr,
    middleName: nstr,
    // the rest of what clientToTaxpayer reads
    tradeName: nstr,
    rdoName: nstr,
    birthdate: isoDate,
    incorpDate: isoDate,
    email: nstr,
    phone: nstr,
    citizenship: nstr,
    civilStatus: nstr,
    taxpayerType: nstr,
    classification: nstr,
  })
  .passthrough();
export type FiledSnapshot = z.infer<typeof FiledSnapshotSchema>;

function day(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function fromDay(s: string | null): Date | null {
  return s ? new Date(`${s}T00:00:00.000Z`) : null;
}

/** Copy the taxpayer block off the client row, as it stands at `at`. */
export function takeFiledSnapshot(client: ClientForTaxpayer, at: Date): FiledSnapshot {
  return {
    snapshotVersion: FILED_SNAPSHOT_VERSION,
    takenAt: at.toISOString(),
    clientId: client.id,
    businessName: client.businessName,
    tin: client.tin,
    branch: client.branch,
    address: client.address,
    city: client.city,
    zip: client.zip,
    rdo: client.rdo,
    kind: client.kind,
    regName: client.regName,
    lastName: client.lastName,
    firstName: client.firstName,
    middleName: client.middleName,
    tradeName: client.tradeName,
    rdoName: client.rdoName,
    birthdate: day(client.birthdate),
    incorpDate: day(client.incorpDate),
    email: client.email,
    phone: client.phone,
    citizenship: client.citizenship,
    civilStatus: client.civilStatus,
    taxpayerType: client.taxpayerType,
    classification: client.classification,
  };
}

/** The snapshot back in the client's shape, for clientToTaxpayer. */
export function snapshotToClient(s: FiledSnapshot): ClientForTaxpayer {
  return {
    id: s.clientId,
    businessName: s.businessName,
    kind: s.kind,
    regName: s.regName,
    lastName: s.lastName,
    firstName: s.firstName,
    middleName: s.middleName,
    tradeName: s.tradeName,
    tin: s.tin,
    branch: s.branch,
    rdo: s.rdo,
    rdoName: s.rdoName,
    address: s.address,
    city: s.city,
    zip: s.zip,
    birthdate: fromDay(s.birthdate),
    incorpDate: fromDay(s.incorpDate),
    email: s.email,
    phone: s.phone,
    citizenship: s.citizenship,
    civilStatus: s.civilStatus,
    taxpayerType: s.taxpayerType,
    classification: s.classification,
  };
}

/** A stored snapshot, or null when the form has none; throws when it is unreadable. */
export function readFiledSnapshot(value: unknown): FiledSnapshot | null {
  if (value === null || value === undefined) return null;
  const parsed = FiledSnapshotSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `the filing snapshot is unreadable: ${parsed.error.issues[0]?.path.join(".") ?? "?"}`,
    );
  }
  return parsed.data;
}

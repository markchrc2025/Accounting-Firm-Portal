/**
 * atc-reference.ts — put the BIR ATC reference table back for a db-spec. The suite
 * truncates every table (truncate.ts); a spec that needs the table's real rows loads
 * them from the same file prisma/seed.ts reads, mapped the way the seed maps them.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@prisma/client";

interface AtcRow {
  atc: string;
  classification: string;
  tax_type_code: string;
  payee_type: string;
  description: string;
  condition?: string | null;
  rate?: number | null;
  rate_basis?: string | null;
  threshold_amount?: number | null;
  bracket?: string | null;
  forms?: string[];
  certificate?: string | null;
  status?: string;
  notes?: string | null;
}

const blank = (s: string | null | undefined) => (s && s.trim() ? s : null);

/** Insert the 228 seeded ATC codes; returns how many rows the table now holds. */
export async function loadAtcReference(db: PrismaClient): Promise<number> {
  const file = join(__dirname, "..", "..", "..", "prisma", "data", "bir_tax_codes.json");
  const data = JSON.parse(readFileSync(file, "utf8")) as { atc_codes: AtcRow[] };
  await db.birAtcCode.createMany({
    skipDuplicates: true,
    data: data.atc_codes.map((a) => ({
      atc: a.atc,
      classification: a.classification,
      taxTypeCode: a.tax_type_code,
      payeeType: a.payee_type,
      description: a.description,
      condition: blank(a.condition),
      rate: a.rate ?? null,
      rateBasis: blank(a.rate_basis),
      thresholdAmount: a.threshold_amount ?? null,
      bracket: blank(a.bracket),
      forms: a.forms ?? [],
      certificate: blank(a.certificate),
      status: a.status ?? "active",
      notes: blank(a.notes),
    })),
  });
  return db.birAtcCode.count();
}

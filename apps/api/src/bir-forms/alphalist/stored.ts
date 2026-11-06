// stored.ts — U19 (D59): the alphalist rows a 1601-EQ is filed with. A filed return is
// sealed (D11/D12), so the rows are written into its filing snapshot AT FILING and the
// alphalist of a filed return is made from them, never from the books as they are later.
//
// Where: BirForm.filedSnapshotJson.alphalist (an additive key; the snapshot schema
// passes unknown keys through), one of
//   { version: 1, storedAt, model }     the rows, in the shape the writer takes
//   { version: 1, storedAt, refused }   the alphalist could not be made when filing: the refusals
// A return filed before U19 has neither.
import { z } from "zod";
import type { AlphalistModel } from "./qap-writer";

const payee = {
  seq: z.number().int(),
  tin: z.string(),
  branch: z.string(),
  registeredName: z.string(),
  lastName: z.string(),
  firstName: z.string(),
  middleName: z.string(),
  atc: z.string(),
};

const ModelSchema = z.object({
  version: z.literal(1),
  period: z.string(),
  agent: z.object({ tin: z.string(), branch: z.string(), name: z.string(), rdo: z.string() }),
  schedule1: z.array(z.object({ ...payee, rate: z.string(), income: z.string(), tax: z.string() })),
  schedule2: z.array(z.object({ ...payee, income: z.string() })),
});

const StoredSchema = z.object({
  version: z.literal(1),
  storedAt: z.string(),
  model: ModelSchema.optional(),
  refused: z.array(z.string()).optional(),
});

export interface StoredAlphalist {
  model: AlphalistModel | null;
  refused: string[];
}

/** What a filing snapshot holds of the alphalist; both empty for a return filed before U19. */
export function readStoredAlphalist(snapshot: unknown): StoredAlphalist {
  const raw = (snapshot as { alphalist?: unknown } | null | undefined)?.alphalist;
  const parsed = StoredSchema.safeParse(raw);
  if (!parsed.success) return { model: null, refused: [] };
  return { model: parsed.data.model ?? null, refused: parsed.data.refused ?? [] };
}

export function storedAlphalist(
  outcome: { model: AlphalistModel } | { refused: string[] },
  at: Date,
): Record<string, unknown> {
  return { version: 1, storedAt: at.toISOString(), ...outcome };
}

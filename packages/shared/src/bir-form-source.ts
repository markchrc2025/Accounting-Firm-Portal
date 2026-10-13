import { z } from "zod";

/**
 * The optional `_source` key of a BIR form draft's data (U15, D54): where the
 * draft's figures came from.
 *
 *  - `mode`: "books" when the draft takes its figures from the client's posted
 *    records (the Portal's books), "manual" when they are typed.
 *  - `asOf`: when the books were last read for this draft (ISO timestamp).
 *  - `fed`: what the books gave, by the draft's own data key, when the draft was
 *    last filled or refreshed.
 *  - `edited`: the data keys the user changed afterwards.
 *
 * A draft without `_source` is a manual draft. The key is stored and returned with
 * the draft like any other data key; the XML export, the clear copy and the Preview
 * PDF ignore it, so the printed return and the export never show "edited".
 */
export const BirFormSource = z.object({
  mode: z.enum(["books", "manual"]),
  asOf: z.string().datetime({ offset: true }),
  fed: z.record(z.unknown()),
  edited: z.array(z.string()),
});
export type BirFormSource = z.infer<typeof BirFormSource>;

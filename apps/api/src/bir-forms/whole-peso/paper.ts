/**
 * paper.ts — U26 (D73): what a print map says about centavos, for the print and the derivation.
 * A box is whole pesos when it is a money field with no centavo boxes, or a text field whose
 * amount is whole pesos; a schedule's rate boxes (items ending "rate") are percentages.
 */
export interface PaperField {
  key: string;
  item?: string;
  kind: string;
  cents?: unknown;
  amount?: unknown;
}

/** The whole-peso boxes of a map, in the map's order: field key → item. */
export function wholePesoFieldsOf(fields: readonly PaperField[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fields) {
    const money = f.kind === "money" && !f.cents;
    const text = f.kind === "text" && f.amount === true;
    const item = String(f.item ?? "");
    if ((money || text) && !/rate$/i.test(item)) out.set(f.key, item);
  }
  return out;
}

/** The rows that fill a whole-peso box with centavos: [field key, item], in row order. */
export function centavosOnPaper(
  whole: Map<string, string>,
  rows: readonly (readonly [string, string])[],
): [string, string][] {
  return rows
    .filter(([k, v]) => whole.has(k) && /\.\d*[1-9]/.test(v))
    .map(([k]) => [k, whole.get(k)!] as [string, string]);
}

/**
 * round-draft.ts — U26 (D73): a draft is stored in whole pesos where the paper has no centavo
 * boxes. Each amount typed with centavos under a whole-peso key (@portal/shared WHOLE_PESO_KEYS,
 * generated from the print maps) is rounded by the Portal's one rule, D54's
 * roundToNearestWholePesoHalfUp, and a note names the item. Nothing is ever refused for
 * centavos; any other key, and any value that is not a plain amount, is kept as it came.
 */
import { wholePesoItem } from "@portal/shared";
import { roundToNearestWholePesoHalfUp } from "../book-figures/round-to-whole-peso";

/** "1,234.50", " 1234.5 ", -12.75: an amount, its commas and spaces dropped; else null. */
function plainAmount(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? s : null;
}

const pesos = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** The note of one rounded figure. */
export function roundedNote(form: string, item: string, rounded: number): string {
  return `Item ${item} was rounded to ${pesos(rounded)} because eBIRForms takes whole pesos on the ${form}.`;
}

/** The draft with its whole-peso figures rounded, and one note per figure changed. */
export function roundWholePesos(
  form: string,
  data: Record<string, unknown>,
): { data: Record<string, unknown>; notes: string[] } {
  const out: Record<string, unknown> = { ...data };
  const notes: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const item = wholePesoItem(form, key);
    if (!item) continue;
    const amount = plainAmount(value);
    if (amount === null || !/\.\d*[1-9]/.test(amount)) continue;
    const rounded = roundToNearestWholePesoHalfUp(amount);
    out[key] = typeof value === "number" ? rounded : String(rounded);
    notes.push(roundedNote(form, item, rounded));
  }
  return { data: out, notes };
}

/**
 * whole-peso-filing.ts — U28 (D75): a return is not marked filed while its SAVED draft holds
 * centavos in a figure the paper has no centavo boxes for.
 *
 * Since U26 (D73) every save rounds those figures, so only a draft saved before U26, or one
 * taken back from such a filing (Undo filing keeps the data as it was), can still hold them.
 * Mark as filed seals the saved data as it stands and does not round it; sealing centavos
 * gives a filed return whose clear copy refuses. One save fixes it, so the sentence says so.
 *
 * The API answers Mark as filed (both paths: the BIR e-mail and the Super Admin override)
 * with 409 and these words; the web disables Mark as filed with the same words. Like
 * missingAtcs, an empty list means nothing holds the filing back.
 */
import { wholePesoItem } from "./whole-peso";

type Data = Record<string, unknown> | null | undefined;

/** "1,234.50", " 1234.5 ", 12.75: an amount with centavos other than zero. */
function hasCentavos(v: unknown): boolean {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return false;
    s = String(v);
  } else if (typeof v === "string") {
    s = v.replace(/[,\s]/g, "");
  } else {
    return false;
  }
  return /^-?\d+\.\d*[1-9]\d*$/.test(s);
}

/** The items of the whole-peso figures the draft holds with centavos, in data order, once each. */
export function centavoItemsBeforeFiling(form: string, data: Data): string[] {
  if (!data) return [];
  const items: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const item = wholePesoItem(form, key);
    if (item && hasCentavos(value) && !items.includes(item)) items.push(item);
  }
  return items;
}

function itemList(items: readonly string[]): string {
  if (items.length === 1) return `Item ${items[0]}`;
  return `Items ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The sentence that keeps such a draft from being marked filed. */
export function saveBeforeFilingSentence(form: string, items: readonly string[]): string {
  return (
    `${itemList(items)} ${items.length === 1 ? "has" : "have"} centavos, which the ${form} ` +
    "paper has no boxes for. Save the draft so the figures are rounded to whole pesos, then " +
    "mark it filed."
  );
}

/** [] when the saved draft may be marked filed; otherwise the one sentence why not. */
export function centavosBeforeFiling(form: string, data: Data): string[] {
  const items = centavoItemsBeforeFiling(form, data);
  return items.length === 0 ? [] : [saveBeforeFilingSentence(form, items)];
}

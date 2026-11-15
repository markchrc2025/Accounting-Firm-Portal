/**
 * print-refusal.ts — U26 (D73): a print the engine refuses reaches the owner as one plain
 * sentence that names the item; the engine's own text goes to the log only.
 */
import type { BirPdfError } from "@portal/bir-pdf";
import { centavosOnPaper, wholePesoFieldsOf, type PaperField } from "./whole-peso/paper";

/** "Item 36A", "Items 36A and 38A", "Items 36A, 38A and 41A". */
export function itemList(items: readonly string[]): string {
  const u = [...new Set(items)];
  if (u.length === 1) return `Item ${u[0]}`;
  return `Items ${u.slice(0, -1).join(", ")} and ${u[u.length - 1]}`;
}

/** A filed return whose sealed figures carry centavos where the paper has none. */
export function filedCentavosSentence(form: string, items: readonly string[]): string {
  return (
    `This return was filed with centavos in ${itemList(items)}, which the ${form} paper has ` +
    "no boxes for. Undo the filing, save the draft so the figures are rounded to whole " +
    "pesos, and mark it filed again."
  );
}

/** A draft saved before U26 (or taken back from a filing) with such centavos. */
export function draftCentavosSentence(form: string, items: readonly string[]): string {
  const u = [...new Set(items)];
  return (
    `${itemList(u)} ${u.length === 1 ? "has" : "have"} centavos, which the ${form} paper has ` +
    "no boxes for. Save the draft so the figures are rounded to whole pesos."
  );
}

/** The whole-peso boxes the rows fill with centavos, by item, in row order. */
export function centavoItems(
  fields: readonly PaperField[],
  rows: readonly (readonly [string, string])[],
): string[] {
  return centavosOnPaper(wholePesoFieldsOf(fields), rows).map(([, item]) => item);
}

/** One plain sentence for a refusal of the print engine (not a fault of the Portal's own). */
export function plainPrintRefusal(
  form: string,
  err: BirPdfError,
  fields: readonly PaperField[],
): string {
  const field = fields.find((f) => f.key === err.key);
  const m = err.message;
  // An amount as typed, when the engine quotes it: "Item 16 (12345.675)".
  const typed = /: "([^"]*)"/.exec(m)?.[1];
  const named = field?.item ? `Item ${field.item}` : "A figure of the return";
  const amount = /centavos|decimals|not an amount|before the point/.test(m);
  const it =
    amount && typed !== undefined && typed !== "" ? `${named} (${typed})` : named;
  if (/has no place on the paper/.test(m))
    return `This return holds a figure the ${form} paper has no place for.`;
  if (/has centavos but the paper/.test(m))
    return `${it} has centavos, which the ${form} paper has no boxes for.`;
  if (/decimals but the paper has|more than two decimals/.test(m))
    return `${it} has more than two decimals; the ${form} paper takes pesos and centavos only.`;
  if (/is not an amount/.test(m)) return `${it} is not an amount.`;
  if (/boxes before the point/.test(m))
    return `${it} is too large for the boxes of the ${form} paper.`;
  const ch = /the character "(.)" cannot be printed/.exec(m);
  if (ch) return `${it} has a character the ${form} paper cannot print: "${ch[1]}".`;
  if (/is not a date/.test(m)) return `${it} is not a date (MM/DD/YYYY).`;
  if (/not one of the dropdown's options/.test(m))
    return `${it} is not one of the choices the ${form} offers.`;
  if (/a checkbox takes/.test(m)) return `${it} must be ticked or left blank.`;
  if (/does not start with the/.test(m))
    return `${it} does not start with what the ${form} paper pre-prints.`;
  if (/does not fit|characters but the paper has|characters; it needs/.test(m))
    return `${it} is too long for the ${form} paper.`;
  return `${it} cannot be printed on the ${form} paper.`;
}

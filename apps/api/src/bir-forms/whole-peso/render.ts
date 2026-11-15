/** U26 (D73): the text of packages/shared/src/whole-peso.ts, from the derivation. */
import { deriveWholePesoKeys } from "./derive";

export function renderWholePesoFile(): string {
  const list = deriveWholePesoKeys();
  const body = Object.entries(list)
    .map(
      ([form, keys]) =>
        `  "${form}": {\n${Object.entries(keys)
          .map(([k, item]) => `    ${JSON.stringify(k)}: ${JSON.stringify(item)},`)
          .join("\n")}\n  },`,
    )
    .join("\n");
  return `/**
 * ============================================================================
 * WHOLE PESOS (U26, D73): the draft keys that print where the paper has no centavo boxes
 * ----------------------------------------------------------------------------
 * GENERATED from packages/bir-pdf/maps by apps/api/scripts/gen-whole-peso.ts. Do not edit:
 * run \`pnpm --filter api gen:whole-peso\`; a test fails while this file and the maps disagree.
 *
 * WHOLE_PESO_KEYS[form][dataKey] is the item number of the box the key prints in. A form
 * that is not listed has centavo boxes for every amount (2550Q, 2551Q, 0619E, 1601EQ, 1601C).
 * An amount with centavos in one of these keys is rounded to the nearest whole peso, 50
 * centavos and up going up (D54), when the draft is saved.
 * ============================================================================
 */
export const WHOLE_PESO_KEYS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
${body}
};

/** The item number of a whole-peso key of a form, or null when the key keeps centavos. */
export function wholePesoItem(form: string, key: string): string | null {
  return WHOLE_PESO_KEYS[form]?.[key] ?? null;
}

/** Whether a form's figure under this draft key is whole pesos on the paper. */
export function isWholePesoKey(form: string, key: string): boolean {
  return wholePesoItem(form, key) !== null;
}
`;
}

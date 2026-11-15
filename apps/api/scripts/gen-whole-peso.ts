/**
 * gen-whole-peso.ts — U26 (D73): write packages/shared/src/whole-peso.ts from the print maps
 * (src/bir-forms/whole-peso/derive.ts). Run `pnpm --filter api gen:whole-peso` after a map or
 * a builder changes; whole-peso.spec.ts fails until it is run.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderWholePesoFile } from "../src/bir-forms/whole-peso/render";

const out = join(__dirname, "../../../packages/shared/src/whole-peso.ts");
writeFileSync(out, renderWholePesoFile());
console.log(`wrote ${out}`);

// proof.ts — DEV ONLY. Write the proof print of a form's map:
//
//   pnpm --filter @portal/bir-pdf proof 2551Q          # every version of the form
//   pnpm --filter @portal/bir-pdf proof 2550Q 2024-04  # one version
//
// The proof fills every mapped field with a ghost value: 8 in every digit box,
// W in every letter box, X in every checkbox, and the item number on every
// free-text line. Rasterize it and look: every character must sit inside its
// box, centred, and nothing may cover printed text. Invented data only.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderProof } from "../src/index";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [form, only] = process.argv.slice(2);
if (!form) {
  console.error("usage: proof <form> [version]   e.g. proof 2551Q");
  process.exit(2);
}
const versions = readdirSync(join(root, "maps"))
  .map((f) => new RegExp(`^${form}-(\\d{4}-\\d{2})\\.json$`).exec(f)?.[1])
  .filter((v): v is string => !!v && (!only || v === only));
if (versions.length === 0) {
  console.error(`no map for ${form}${only ? ` ${only}` : ""} in maps/`);
  process.exit(1);
}
mkdirSync(join(root, "proofs"), { recursive: true });
for (const version of versions) {
  const out = join(root, "proofs", `${form}-${version}-proof.pdf`);
  writeFileSync(out, await renderProof(form, version, { root }));
  console.log(`wrote proofs/${form}-${version}-proof.pdf`);
}

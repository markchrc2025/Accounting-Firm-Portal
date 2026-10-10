// proof.ts — DEV ONLY. Write the proof print of a form's map:
//
//   pnpm --filter @portal/bir-pdf proof 2551Q          # every version of the form
//   pnpm --filter @portal/bir-pdf proof 2550Q 2024-04  # one version
//
// The proof fills every mapped field with a ghost value: 8 in every digit box,
// W in every letter box, X in every checkbox, and the item number on every
// free-text line. Rasterize it and look: every character must sit inside its
// box, centred, and nothing may cover printed text. Invented data only.
//
// It also writes <form>-<version>-longname-proof.pdf: the form's sample export
// (fixtures/<form>-sample.xml) with every "squeeze" field given an invented
// value too long for its boxes, so the squeezed lines can be inspected too.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMap, parseEbirExport, renderProof, renderReturn } from "../src/index";

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
/** Invented values too long for their boxes, by what the field holds. */
function longValue(key: string): string {
  const k = key.split(":").pop()!;
  // E-mail first: "taxpayerEmailAddress" also contains "Address".
  if (/Email/i.test(k))
    return "accounts.receivable.department@invented-sample-company.example";
  if (/Address/i.test(k))
    return "UNIT 12 SAMPLE TOWER ONE, 5 INVENTED AVENUE CORNER EXAMPLE STREET, SAMPLE CITY, METRO 0000";
  if (/Agency/.test(k)) return "SAMPLE BANK INC";
  if (/Number/.test(k)) return "CHK-0001234567890";
  if (/Particular/.test(k)) return "INVENTED OTHER PAYMENT";
  return "INVENTED SAMPLE TRADING AND GENERAL MERCHANDISE SERVICES CORPORATION";
}

mkdirSync(join(root, "proofs"), { recursive: true });
for (const version of versions) {
  const out = join(root, "proofs", `${form}-${version}-proof.pdf`);
  writeFileSync(out, await renderProof(form, version, { root }));
  console.log(`wrote proofs/${form}-${version}-proof.pdf`);

  const fixture = join(root, "fixtures", `${form}-sample.xml`);
  if (!existsSync(fixture)) continue;
  const squeezed = new Set(
    loadMap(form, version, { root })
      .fields.filter((f) => f.kind === "comb" && f.squeeze)
      .map((f) => f.key),
  );
  const rows = parseEbirExport(readFileSync(fixture, "utf8")).map(
    ([k, v]): [string, string] => [k, squeezed.has(k) ? longValue(k) : v],
  );
  const long = join(root, "proofs", `${form}-${version}-longname-proof.pdf`);
  writeFileSync(long, await renderReturn(form, version, rows, { root }));
  console.log(`wrote proofs/${form}-${version}-longname-proof.pdf`);
}

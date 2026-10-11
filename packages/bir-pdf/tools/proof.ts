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
// It also writes <form>-<version>-filled-proof.pdf: the form's sample export (an
// invented filled return) printed as a filed return's clear copy;
// <form>-<version>-longname-proof.pdf: the form's sample export
// (fixtures/<form>-sample.xml) with every "squeeze" field given an invented
// value too long for its boxes, so the squeezed lines can be inspected too;
// and <form>-<version>-draft-proof.pdf: the same sample export as a draft's
// preview (C3), stamped "DRAFT — NOT FILED", printed at a fixed invented time
// so the committed file never changes.
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
function longValue(key: string, boxes: number): string {
  const v = longText(key);
  // What a squeeze can hold at 5.5 pt is about 3.4 capitals per box (measured, README).
  const cap = Math.floor(boxes * 3.2);
  return v.length > cap ? v.slice(0, cap).trim() : v;
}
function longText(key: string): string {
  const k = key.split(":").pop()!;
  // E-mail first: "taxpayerEmailAddress" also contains "Address".
  if (/Email/i.test(k))
    return "accounts.receivable.department@invented-sample-company.example";
  if (/Address/i.test(k))
    return "UNIT 12 SAMPLE TOWER ONE, 5 INVENTED AVENUE CORNER EXAMPLE STREET, SAMPLE CITY, METRO 0000";
  // 16-box fields (treaty name, citizenship): long, but a squeeze can hold it.
  if (/Specify|Treaty|Citizenship/.test(k))
    return "TREATY BETWEEN INVENTED REPUBLICS SAMPLE";
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
  // Every squeeze field, with the boxes it has (the smallest, where a key prints twice).
  const squeezed = new Map<string, number>();
  for (const f of loadMap(form, version, { root }).fields) {
    if (f.kind !== "comb" || !f.squeeze) continue;
    const boxes = f.rows.reduce((t, r) => t + r.cells.length - 1, 0);
    squeezed.set(f.key, Math.min(boxes, squeezed.get(f.key) ?? boxes));
  }
  const rows = parseEbirExport(readFileSync(fixture, "utf8")).map(
    ([k, v]): [string, string] => [
      k,
      squeezed.has(k) ? longValue(k, squeezed.get(k)!) : v,
    ],
  );
  const filled = join(root, "proofs", `${form}-${version}-filled-proof.pdf`);
  writeFileSync(
    filled,
    await renderReturn(form, version, parseEbirExport(readFileSync(fixture, "utf8")), {
      root,
    }),
  );
  console.log(`wrote proofs/${form}-${version}-filled-proof.pdf`);

  const long = join(root, "proofs", `${form}-${version}-longname-proof.pdf`);
  writeFileSync(long, await renderReturn(form, version, rows, { root }));
  console.log(`wrote proofs/${form}-${version}-longname-proof.pdf`);

  const draft = join(root, "proofs", `${form}-${version}-draft-proof.pdf`);
  const sample = parseEbirExport(readFileSync(fixture, "utf8"));
  writeFileSync(
    draft,
    await renderReturn(form, version, sample, {
      root,
      watermark: "DRAFT",
      printedAt: new Date("2026-10-25T02:05:00.000Z"),
    }),
  );
  console.log(`wrote proofs/${form}-${version}-draft-proof.pdf`);
}

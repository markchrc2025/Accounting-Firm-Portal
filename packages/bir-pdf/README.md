# @portal/bir-pdf

Prints a filed return onto the **BIR's own blank form**. The engine never redraws a
form: it writes characters into the boxes of the official blank PDF, in Liberation
Sans Bold, black. Deterministic; no AI, no network, no clock at run time.

```ts
import { parseEbirExport, renderReturn } from "@portal/bir-pdf";

const rows = parseEbirExport(exportFileText); // [key, value][] in file order
const pdf = await renderReturn("2551Q", "2018-01", rows); // Uint8Array
```

The input is the eBIRForms export file the Portal's builders write
(`apps/api/src/bir-forms/engine/build<Form>.ts`): the exact file the firm loads into
eBIRForms to file. So the PDF shows exactly what was filed.

## What is in the package

| Path | What |
| --- | --- |
| `templates/<form>-<version>.pdf` | The BIR's blank forms, byte for byte as committed by the domain owner (5171042). Never edit one; `test/t5-templates.test.ts` pins every SHA-256. |
| `maps/<form>-<version>.json` | One field map per template: where every eBIRForms key prints. Resolved numbers only. |
| `fonts/LiberationSans-Bold.ttf` | Liberation Sans Bold 2.1.5 (SIL OFL 1.1, see `fonts/LICENSE`). |
| `src/` | The engine: `parse.ts`, `layout.ts` (pure placement), `render.ts` (pdf-lib), `validate.ts`, `types.ts`. |
| `tools/geometry.py` | Dev only: reads a template's vector boxes and proposes cell boundaries. |
| `tools/proof.ts` | Dev only: writes the proof print of a map. |
| `tools/make-fixtures.ts` | Dev only: writes `fixtures/*-sample.xml` with the Portal's own builders for an invented taxpayer. |
| `proofs/` | The committed proof prints (invented data only). |

Run-time dependencies: `pdf-lib` 1.17.1 and `@pdf-lib/fontkit` 1.1.1, pinned. Nothing
else. `pdfjs-dist` (reading text back in tests), `tsx`, `vitest` and Python
`pdfplumber` (the geometry tool) are development only.

## What the engine does

1. **`parseEbirExport(text)`** reads every `<div>KEY=VALUEKEY=</div>` in file order
   (tab- or newline-separated). It URL-decodes exactly the keys that form's builder
   passes through `enc()` (`ENCODED_KEYS` in `src/parse.ts`, by eBIRForms namespace);
   every other value is kept verbatim. An unknown namespace or a malformed field is an
   error.
2. **`renderReturn(form, version, rows)`** loads and validates
   `maps/<form>-<version>.json`, checks the template's page count and sizes against the
   map, lays out every mapped key, draws it, and returns the bytes.
   - Every key in the export must have a map entry; a key with none is an error.
   - A value that does not fit its boxes, an amount with centavos where the paper has no
     centavo boxes, free text too long at its minimum size, a checkbox value other than
     `true`/`false`, an unknown dropdown index, or a character the font cannot print is an
     error **naming the field**. Nothing is cut off or dropped silently.
   - **Squeeze** (domain owner, C1-A1: "it's okay if it isn't per character box, as long
     as the name is complete"). A comb marked `"squeeze": true` (names, addresses,
     e-mail, payment particulars) that is too long for its boxes prints whole instead:
     one continuous line per row across the comb's full width (2 pt in from its outer
     edges), vertically centred on the same middle line as one-per-box characters, at the
     largest size from the field's size down to 5.5 pt that fits. Several rows break
     between words. Below 5.5 pt it is still an error naming the field. A value that fits
     still prints one character per box. Digit combs (TIN, RDO, ZIP, dates, amounts,
     codes) never squeeze; the map validator refuses `squeeze` with `date`, `pad`,
     `ghost: "8"` or right alignment.
   - Text prints in CAPITAL LETTERS, as the forms instruct, unless the field says
     `"case": "keep"` (email addresses).
   - Fixed metadata (title, subject, creator, producer; no dates, no ids): the same
     export always gives byte-identical PDFs.
3. **`renderProof(form, version)`** draws a ghost value in every mapped field (below).

In CommonJS (the API under ts-node) and vitest the package finds its own files through
`__dirname`. A plain-ESM caller (a `tsx` script) passes `{ root: <package dir> }` as the
last argument.

## The map format

```jsonc
{
  "form": "2551Q", "version": "2018-01", "template": "2551Q-2018-01.pdf",
  "title": "BIR Form 2551Q - Quarterly Percentage Tax Return (January 2018 ENCS)",
  "pages": [{ "width": 612, "height": 936 }, { "width": 612, "height": 936 }],
  "size": 10,            // default font size, points
  "fields": [ ... ]      // one entry per placement; a key may print in two places
}
```

Coordinates are PDF points, origin bottom-left (what pdf-lib uses). `y` is the text
baseline. `cells` are the n+1 x-boundaries of n boxes, taken at the centre line of the
template's tick marks. Every placed field has `item`, the label printed on the paper,
used in error messages and proofs.

| kind | prints | example |
| --- | --- | --- |
| `comb` | one character per box; `rows` fill in order (`"wrap": "words"` breaks an address between words); `align` left/right; `pad` left-pads to every box (a 3-digit branch code in 5 boxes); `date` prints `M/D/YYYY` as `MMDDYYYY` across the MM, DD, YYYY boxes; `ghost` `"8"` or `"W"` for proofs | `{"key": "frm2551Qv2018:txtTIN1", "item": "6 TIN", "kind": "comb", "rows": [{"page": 1, "y": 760.1, "cells": [220.85, 235.01, 249.17, 263.33]}], "ghost": "8"}` |
| `money` | pesos right-aligned in `cells`; centavos left-aligned in `cents`, after the paper's printed decimal point. No `cents`: non-zero centavos are an error | `{"key": "frm2551Qv2018:txt14", "item": "14", "kind": "money", "page": 1, "y": 558.1, "cells": [...12 boxes], "cents": [561.7, 575.74, 590.14]}` |
| `mark` | an `X` centred in `box` `[x0, y0, x1, y1]` when the value equals `when` (default `"true"`) | `{"key": "frm2551Qv2018:qtr_3", "item": "3 Q3", "kind": "mark", "page": 1, "box": [329.16, 797.64, 342.48, 809.52]}` |
| `choice` | a dropdown index printed as its label, one character per box | `{"key": "drpATC1", "item": "Sch1 1 ATC", "kind": "choice", "page": 2, "y": 757.7, "cells": [...5 boxes], "options": {"0": "", "1": "PT010", ...}}` |
| `text` | free text on a line or in a table cell, `align` left/center/right; shrinks from `size` to `minSize`, then it is an error | `{"key": "frm2551Qv2018:txt17Specify", "item": "17 specify", "kind": "text", "page": 1, "y": 495.8, "x0": 224.1, "x1": 375.2, "size": 8, "minSize": 5}` |
| `none` | nothing: a key with no place on the paper, with its `reason`; optional `expect` (a regular expression) makes any other value an error | `{"key": "txtFinalFlag", "kind": "none", "reason": "eBIRForms package flag (1 = final copy), not printed on the return"}` |

`blankIf` (any placed kind) is a list of `{ "key", "equals" }`; when **all** hold the
field prints nothing. It keeps unused schedule rows clean (an unused 2551Q Schedule 1
row has ATC index `0` and `0.00` amounts) without ever hiding a figure that was filed.

## How a map is made

1. **Read the geometry from the template**, never by eye:

   ```sh
   python3 tools/geometry.py templates/2551Q-2018-01.pdf            # combs + checkboxes
   python3 tools/geometry.py templates/2551Q-2018-01.pdf --lines    # also underlines
   python3 tools/geometry.py templates/2551Q-2018-01.pdf --cells 1 222   # table cell edges at y=222
   python3 tools/geometry.py templates/2551Q-2018-01.pdf --json     # machine-readable
   ```

   The BIR's blanks are Word exports that draw every line as a thin filled rectangle.
   A **comb** is a run of black tick marks (under 2.5 pt wide, 2-16 pt tall, grouped by
   bottom y) between two table-cell borders (a tick that continues upward is a border;
   one that continues downward is the top half of a taller border and is ignored).
   A **checkbox** is a stroked square 9-16 pt a side. Each proposal carries the page
   text to its left so it can be matched to its item.
2. **Assign each comb and checkbox to its eBIRForms key** by the item number printed
   beside it, reading the builder (`build<Form>.ts`) for the keys, their order and their
   value formats. Free-text cells take their edges from `--cells` and the baseline from
   the underline or the row's rules. Every key the builder emits gets an entry, placed
   or `none` with a reason; `test/t2-coverage.test.ts` enforces it.
3. **Print the proof and look at it** (below). Move anything that is not centred in its
   box or that touches printed text, and look again.

## Proofs

```sh
pnpm --filter @portal/bir-pdf proof 2551Q
```

writes `proofs/<form>-<version>-proof.pdf` with a ghost value in every mapped field:
`8` in every digit box, `W` in every letter box, `X` in every checkbox, and the item
label on every free-text line. Rasterize every page (`pdftoppm -r 300`) and check that
every character sits inside its box, centred, and covers no printed text. Commit the
proof with the map.

It also writes `proofs/<form>-<version>-longname-proof.pdf`: the form's sample export
with every `squeeze` field given an invented value too long for its boxes. Check that
each squeezed line is complete, inside its comb, and clear of the frame and cell
borders.

How much fits at 5.5 pt (2551Q, measured with ordinary capitals; wide letters such as
M, W, B fit fewer): a 5-box bank about 17, a 7-box number about 25, the 8-box
particulars about 28, a 26-box page-2 name about 88.

## Adding a new form version

1. Add the blank as `templates/<form>-<yyyy-mm>.pdf` (the form's ENCS month), and pin
   its SHA-256 in `test/t5-templates.test.ts`. Never change a template byte.
2. If the eBIRForms namespace is new, add the builder's encoded keys to `ENCODED_KEYS`
   in `src/parse.ts`.
3. Make `maps/<form>-<yyyy-mm>.json` as above.
4. Add a fixture with `tools/make-fixtures.ts` (the Portal's own builder, invented
   taxpayer only) and extend the T1/T2/T4/T5 tests to it.
5. Print and inspect the proof; commit it.

The old version's template and map stay: a return filed on the old form still prints on
the old form.

## Decisions

- Templates are renamed `<form>-<yyyy-mm>.pdf` after their ENCS version (1702-RT is
  `1702RT-2018-01.pdf`, matching the Portal's `FormCode`).
- A 3-digit branch code is printed as 5 digits, zero-padded on the left, where the paper
  has 5 boxes (2551Q). The April 2024 2550Q pre-prints `00000`; its branch keys are
  `none` and any non-zero branch is an error.
- A date is printed MMDDYYYY: the builders send `M/D/YYYY` (2550Q return period) or
  `MM/DD/YYYY`.
- An amount with fewer decimals than centavo boxes is padded with zeros (`3.0` in two
  boxes prints `00`); the value never changes.
- The 2550Q item 15 and item 61 are the same figure (`netVatPayable`): one key, two
  placements. The 2550Q item 14 Yes/No is drawn from the export's two relief flags: Yes
  when either is true, No when neither is.
- The 2550Q `result*` and `txtTotal*` keys are eBIRForms copies of figures printed from
  their own keys; they are `none`.

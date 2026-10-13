// renderReturn — write a filed return onto the BIR's own blank form; with the
// DRAFT watermark (C3), a draft's preview.
//
// Loads the template PDF (never changed), lays out every mapped key of the
// export, draws each piece of text in Liberation Sans Bold, black, and returns
// the bytes. Pure: no network, no clock, no random ids; the same rows always
// give the same bytes.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDict, PDFDocument, PDFName, rgb, type PDFFont } from "pdf-lib";
import { layoutGhost, layoutReturn, type Metrics } from "./layout";
import { BirPdfError, type DrawOp, type FormMap } from "./types";
import { validateMap } from "./validate";
import { stampDraft } from "./watermark";

export interface RenderOptions {
  /**
   * The package directory holding templates/, maps/ and fonts/. Defaults to
   * this source file's package; ESM callers without __dirname (tsx scripts)
   * pass it explicitly.
   */
  root?: string;
  /**
   * C3 (D52): "DRAFT" stamps every page "DRAFT — NOT FILED" (diagonal, light
   * grey) and adds the preview footer. Absent: the output is exactly as before.
   */
  watermark?: "DRAFT";
  /** When the preview was printed, for its footer. Required with `watermark`:
   *  the engine reads no clock, so the caller says what time it is. */
  printedAt?: Date;
}

const FONT_FILE = "fonts/LiberationSans-Bold.ttf";
const FONT_NAME = "LiberationSans-Bold";

function packageRoot(opts?: RenderOptions): string {
  if (opts?.root) return opts.root;
  // CommonJS (the API runs this source through ts-node) and vitest both
  // provide __dirname; plain ESM does not, and must pass `root`.
  if (typeof __dirname === "string") return resolve(__dirname, "..");
  throw new BirPdfError(
    "@portal/bir-pdf: no package root; pass { root } when running as plain ESM",
  );
}

/** Read and validate the field map for a form version. */
export function loadMap(form: string, version: string, opts?: RenderOptions): FormMap {
  if (!/^[0-9A-Z]+$/.test(form) || !/^\d{4}-\d{2}$/.test(version)) {
    throw new BirPdfError(`unknown form version ${form} ${version}`);
  }
  let text: string;
  try {
    text = readFileSync(
      join(packageRoot(opts), "maps", `${form}-${version}.json`),
      "utf8",
    );
  } catch {
    throw new BirPdfError(`no field map for BIR Form ${form} version ${version}`);
  }
  return validateMap(JSON.parse(text) as FormMap);
}

function metricsOf(
  font: PDFFont,
  raw: {
    capHeight: number;
    unitsPerEm: number;
    hasGlyphForCodePoint(c: number): boolean;
  },
): Metrics {
  return {
    width: (t, s) => font.widthOfTextAtSize(t, s),
    capHeight: (s) => (raw.capHeight / raw.unitsPerEm) * s,
    has: (ch) => raw.hasGlyphForCodePoint(ch.codePointAt(0)!),
  };
}

async function draw(
  form: string,
  version: string,
  opts: RenderOptions | undefined,
  plan: (map: FormMap, m: Metrics) => DrawOp[],
): Promise<Uint8Array> {
  const root = packageRoot(opts);
  const map = loadMap(form, version, opts);
  const doc = await PDFDocument.load(
    readFileSync(join(root, "templates", map.template)),
    { updateMetadata: false },
  );
  const pages = doc.getPages();
  if (
    pages.length !== map.pages.length ||
    pages.some((p, i) => {
      const s = p.getSize();
      return (
        Math.abs(s.width - map.pages[i]!.width) > 0.5 ||
        Math.abs(s.height - map.pages[i]!.height) > 0.5
      );
    })
  ) {
    throw new BirPdfError(
      `map ${form}-${version} does not match its template's pages (${map.template})`,
    );
  }

  doc.registerFontkit(fontkit);
  const fontBytes = readFileSync(join(root, FONT_FILE));
  const font = await doc.embedFont(fontBytes, { subset: true, customName: FONT_NAME });
  const metrics = metricsOf(font, fontkit.create(fontBytes));
  const ops = plan(map, metrics);

  const black = rgb(0, 0, 0);
  for (const op of ops)
    pages[op.page - 1]!.drawText(op.text, {
      x: op.x,
      y: op.y,
      size: op.size,
      font,
      color: black,
    });
  if (opts?.watermark === "DRAFT") {
    if (!(opts.printedAt instanceof Date) || Number.isNaN(opts.printedAt.getTime())) {
      throw new BirPdfError("@portal/bir-pdf: a DRAFT preview needs printedAt, the time it is printed");
    }
    for (const page of pages) stampDraft(page, font, metrics.capHeight, opts.printedAt);
  }

  // Fixed metadata: no dates, no ids, nothing that changes between runs.
  doc.setTitle(map.title);
  doc.setSubject(`BIR Form ${form} (${version}), printed from its eBIRForms export`);
  doc.setCreator("MCRC Accounting Firm Portal");
  doc.setProducer("@portal/bir-pdf");
  const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
  info.delete(PDFName.of("CreationDate"));
  info.delete(PDFName.of("ModDate"));
  return doc.save();
}

/** Render a return: the template for `form` `version` with every mapped key of `rows` written in. */
export function renderReturn(
  form: string,
  version: string,
  rows: [string, string][],
  opts?: RenderOptions,
): Promise<Uint8Array> {
  return draw(form, version, opts, (map, m) => layoutReturn(map, rows, m));
}

/** Render the proof: a ghost value in every mapped field (see layoutGhost). */
export function renderProof(
  form: string,
  version: string,
  opts?: RenderOptions,
): Promise<Uint8Array> {
  return draw(form, version, opts, (map, m) => layoutGhost(map, m));
}

// extractCor.ts — client-side OCR extraction of a BIR Certificate of
// Registration (Form 2303). Everything runs in the browser: the COR is never
// sent anywhere. PDFs are rasterised with pdf.js, the image is binarised to
// drop the green security background, Tesseract.js reads the text, and the pure
// layout parser in parseCor.ts pulls the fields we store on a Client.
//
// OCR on a scanned, watermarked COR is inherently imperfect — callers MUST let
// the user review/correct the result before applying it.
//
// SELF-HOSTED ASSETS (no CDN): Tesseract.js otherwise fetches its worker, WASM
// core and `eng.traineddata.gz` from cdn.jsdelivr.net at runtime — a hard
// dependency on a third-party host that silently throws the whole pipeline when
// a user's network can't reach it (which is exactly how "Couldn't read this
// COR" happened in production). We instead ship the three assets from our own
// origin under `public/tesseract/` and point Tesseract at them below. The set
// matches Tesseract v7's DEFAULT engine (OEM.DEFAULT → LSTM-only core + the
// `4.0.0_best_int` language data), so behaviour is unchanged — only the source
// host is. `workerBlobURL: false` loads the worker directly from our origin
// URL. To refresh after a tesseract.js/-core bump, re-copy:
//   node_modules/.../tesseract.js/dist/worker.min.js
//   node_modules/.../tesseract.js-core/tesseract-core-simd-lstm.wasm{,.js}
//   @tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz  (from npm)

import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Tesseract from "tesseract.js";
import { parseCorText, type ExtractedCor } from "./parseCor";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Origin-served Tesseract assets. BASE_URL honours a non-root deploy base.
const TESS_BASE = `${import.meta.env.BASE_URL}tesseract`;
const TESS_PATHS = {
  workerPath: `${TESS_BASE}/worker.min.js`,
  corePath: `${TESS_BASE}/tesseract-core-simd-lstm.wasm.js`,
  langPath: TESS_BASE,
  workerBlobURL: false,
} as const;

export type { ExtractedCor } from "./parseCor";
export { parseCorText } from "./parseCor";

export type ExtractProgress = (stage: string, pct: number) => void;

const MAX_PAGES = 2;
const RENDER_SCALE = 2.4;
const BINARIZE_THRESHOLD = 160;

// ---------------------------------------------------------------- rasterise

async function renderPdf(buf: ArrayBuffer): Promise<HTMLCanvasElement[]> {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out: HTMLCanvasElement[] = [];
  const pages = Math.min(pdf.numPages, MAX_PAGES);
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    out.push(canvas);
  }
  return out;
}

async function rasterImage(file: File): Promise<HTMLCanvasElement[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("Could not load the image."));
      im.src = url;
    });
    // Upscale small scans so thin table text survives binarisation.
    const scale = img.width < 1600 ? Math.min(2.5, 1600 / img.width) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return [canvas];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Grayscale + fixed-threshold binarisation — removes the light green guilloché
 *  pattern so Tesseract sees near-black text on white. */
function binarize(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    const v = lum < BINARIZE_THRESHOLD ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- ocr

async function ocr(canvases: HTMLCanvasElement[], onProgress?: ExtractProgress): Promise<string> {
  let text = "";
  for (let i = 0; i < canvases.length; i++) {
    const canvas = canvases[i]!;
    binarize(canvas);
    const { data } = await Tesseract.recognize(canvas, "eng", {
      ...TESS_PATHS,
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === "recognizing text" && onProgress) {
          onProgress(`Reading page ${i + 1}`, (i + (m.progress ?? 0)) / canvases.length);
        }
      },
    });
    text += "\n" + (data.text || "");
  }
  return text;
}

// ---------------------------------------------------------------- orchestrate

/** A failure with a user-facing explanation of which stage broke. */
export class CorExtractError extends Error {
  readonly stage: "assets" | "render" | "ocr";
  constructor(message: string, stage: "assets" | "render" | "ocr", cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "CorExtractError";
    this.stage = stage;
  }
}

/** Confirm the self-hosted OCR engine files are actually served from our origin
 *  before we try to use them — a missing/404 asset (e.g. the web app wasn't
 *  redeployed after this feature shipped) is the difference between a clear
 *  "engine didn't load" message and an opaque worker crash. */
async function preflightAssets(): Promise<void> {
  const urls = [TESS_PATHS.workerPath, TESS_PATHS.corePath, `${TESS_BASE}/eng.traineddata.gz`];
  try {
    const results = await Promise.all(urls.map((u) => fetch(u, { method: "HEAD" })));
    const bad = results.find((r) => !r.ok);
    if (bad) {
      throw new CorExtractError(
        `The OCR engine files aren't being served yet (${new URL(bad.url).pathname} → ${bad.status}). ` +
          `If the app was just updated, redeploy the web service and hard-refresh.`,
        "assets",
      );
    }
  } catch (err) {
    if (err instanceof CorExtractError) throw err;
    throw new CorExtractError(
      "The OCR engine couldn't be downloaded from this site. Check your connection and hard-refresh.",
      "assets",
      err,
    );
  }
}

/** Render → binarise → OCR → parse a COR file (PDF or image). */
export async function extractCorFromFile(file: File, onProgress?: ExtractProgress): Promise<ExtractedCor> {
  onProgress?.("Preparing document", 0);
  await preflightAssets();

  let canvases: HTMLCanvasElement[];
  try {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    canvases = isPdf ? await renderPdf(await file.arrayBuffer()) : await rasterImage(file);
  } catch (err) {
    throw new CorExtractError("This file couldn't be opened as a PDF or image.", "render", err);
  }
  if (canvases.length === 0) {
    throw new CorExtractError("This file couldn't be opened as a PDF or image.", "render");
  }

  let text: string;
  try {
    text = await ocr(canvases, onProgress);
  } catch (err) {
    throw new CorExtractError("The OCR engine failed while reading the document.", "ocr", err);
  }
  onProgress?.("Extracting fields", 1);
  return parseCorText(text);
}

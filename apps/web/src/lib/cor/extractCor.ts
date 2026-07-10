// extractCor.ts — client-side OCR extraction of a BIR Certificate of
// Registration (Form 2303). Everything runs in the browser: the COR is never
// sent anywhere. PDFs are rasterised with pdf.js, the image is binarised to
// drop the green security background, Tesseract.js reads the text, and the pure
// layout parser in parseCor.ts pulls the fields we store on a Client.
//
// Tesseract's language data loads from its CDN on first use. OCR on a scanned,
// watermarked COR is inherently imperfect — callers MUST let the user
// review/correct the result before applying it.
//
// CSP / CDN note: `Tesseract.recognize` below passes no workerPath/corePath/
// langPath, so on first OCR it fetches the worker script, the WASM core and the
// `eng.traineddata.gz` from https://cdn.jsdelivr.net (and runs a Blob-URL
// worker + WASM). The Portal ships NO Content-Security-Policy today (checked:
// apps/web/index.html and apps/web/nginx.conf have none), so the default CDN
// path works out of the box. If a strict CSP is ever added it must allow
// `cdn.jsdelivr.net` in script-src/connect-src plus `blob:` workers and
// `'wasm-unsafe-eval'` — OTHERWISE self-host the three tesseract assets from
// node_modules under public/tesseract/ and pass workerPath/corePath/langPath
// (+ workerBlobURL:false) here so nothing leaves the origin.

import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import Tesseract from "tesseract.js";
import { parseCorText, type ExtractedCor } from "./parseCor";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

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

/** Render → binarise → OCR → parse a COR file (PDF or image). */
export async function extractCorFromFile(file: File, onProgress?: ExtractProgress): Promise<ExtractedCor> {
  onProgress?.("Preparing document", 0);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const canvases = isPdf ? await renderPdf(await file.arrayBuffer()) : await rasterImage(file);
  if (canvases.length === 0) throw new Error("Could not read the document.");
  const text = await ocr(canvases, onProgress);
  onProgress?.("Extracting fields", 1);
  return parseCorText(text);
}

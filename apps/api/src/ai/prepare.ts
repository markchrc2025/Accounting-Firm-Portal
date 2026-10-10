/**
 * prepare.ts — every uploaded file is checked and prepared BEFORE anything is
 * stored or sent (U11 R4). The type is read from the bytes, never from the name or
 * the browser's say-so.
 *  - JPEG, PNG, WebP: EXIF orientation applied; every EXIF/GPS/ICC/XMP block
 *    dropped (sharp writes no metadata unless asked); re-encoded as JPEG; sized to
 *    the largest the model reads (estimate.ts fitToModel).
 *  - PDF: at most 5 pages; not password-protected; stored as uploaded.
 *  - HEIC/HEIF: refused with a sentence. sharp's prebuilt libvips decodes HEIF
 *    only with the AV1 codec (AVIF); an iPhone photo is HEVC, which it cannot read,
 *    and no HEVC decoder was proven in this build (see the U11 report).
 */
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { MAX_PDF_PAGES, fitToModel, imageTokens, pdfTokens } from "./estimate";

export type SniffedType = "jpeg" | "png" | "webp" | "pdf" | "heic";

export const HEIC_REFUSAL =
  "This is an iPhone HEIC photo. Save it as JPG and upload it again.";

/** The file's real type, from its first bytes; null when it is none we take. */
export function sniff(b: Uint8Array): SniffedType | null {
  const at = (i: number, s: string) =>
    [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "png";
  if (b.length >= 12 && at(0, "RIFF") && at(8, "WEBP")) return "webp";
  if (b.length >= 5 && at(0, "%PDF-")) return "pdf";
  if (b.length >= 12 && at(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (
      ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)
    ) {
      return "heic";
    }
  }
  return null;
}

export function sha256(b: Uint8Array): string {
  return createHash("sha256").update(b).digest("hex");
}

export type Prepared =
  | {
      ok: true;
      kind: "image";
      body: Buffer;
      contentType: "image/jpeg";
      width: number;
      height: number;
      contentTokens: number;
    }
  | {
      ok: true;
      kind: "pdf";
      body: Buffer;
      contentType: "application/pdf";
      pages: number;
      contentTokens: number;
    }
  | { ok: false; message: string };

/** Check and prepare one upload; a refusal carries the sentence the user reads. */
export async function prepareUpload(name: string, bytes: Buffer): Promise<Prepared> {
  const type = sniff(bytes);
  if (type === "heic") return { ok: false, message: `${name}: ${HEIC_REFUSAL}` };
  if (!type)
    return { ok: false, message: `${name} is not a JPEG, PNG, WebP or PDF file.` };
  if (type === "pdf") {
    let pages: number;
    try {
      pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    } catch {
      return {
        ok: false,
        message: `${name} could not be opened as a PDF (it may be password-protected).`,
      };
    }
    if (pages > MAX_PDF_PAGES) {
      return {
        ok: false,
        message: `${name} has ${pages} pages; a PDF in a pile may have at most ${MAX_PDF_PAGES}.`,
      };
    }
    return {
      ok: true,
      kind: "pdf",
      body: bytes,
      contentType: "application/pdf",
      pages,
      contentTokens: pdfTokens(pages),
    };
  }
  try {
    const meta = await sharp(bytes).metadata();
    const swap = (meta.orientation ?? 1) >= 5; // 5–8 turn the picture a quarter
    const w0 = swap ? meta.height! : meta.width!;
    const h0 = swap ? meta.width! : meta.height!;
    const target = fitToModel(w0, h0);
    const { data, info } = await sharp(bytes)
      .rotate() // apply the EXIF orientation; the output then carries none
      .resize({
        width: target.width,
        height: target.height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      kind: "image",
      body: data,
      contentType: "image/jpeg",
      width: info.width,
      height: info.height,
      contentTokens: imageTokens(info.width, info.height),
    };
  } catch {
    return { ok: false, message: `${name} could not be read as an image.` };
  }
}

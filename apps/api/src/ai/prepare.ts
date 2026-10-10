/**
 * prepare.ts — every uploaded file is checked and prepared BEFORE anything is
 * stored or sent (U11 R4; U11-A1 R1). The type is read from the bytes, never from
 * the name or the browser's say-so: an iPhone sends image/heic, no type at all, or
 * application/octet-stream.
 *  - Photos: JPEG, PNG, WebP, GIF (first frame), TIFF (first page), BMP, AVIF,
 *    and HEIC/HEIF (the primary image). Each is turned upright (EXIF orientation,
 *    or HEIF's irot/imir); every EXIF/GPS/ICC/XMP block dropped (sharp writes no
 *    metadata unless asked); transparency laid on white; re-encoded as JPEG; sized
 *    to the largest the model reads (estimate.ts fitToModel). So the AI and the
 *    review screen always see a JPEG.
 *  - Decoders: sharp for all but two. HEIC/HEIF goes to libheif-js (heif.ts),
 *    because sharp's libheif reads only AV1 (AVIF); BMP goes to bmp.ts, because
 *    sharp's libvips has no BMP loader.
 *  - PDF: at most 5 pages; not password-protected; stored as uploaded.
 *  - Anything else is refused, saying what it looks like (a video, a camera RAW
 *    file, a Word document…).
 */
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { decodeBmp, looksLikeBmp } from "./bmp";
import { MAX_PDF_PAGES, fitToModel, imageTokens, pdfTokens } from "./estimate";
import { decodeHeif, type RawPixels } from "./heif";

export type SniffedType =
  "jpeg" | "png" | "webp" | "gif" | "tiff" | "bmp" | "avif" | "heic" | "pdf";

/** The ceiling on a HEIC's or BMP's pixels. Those decoders hold the whole picture
 *  in memory (4 bytes a pixel for HEIC), unlike sharp, which streams; 64 MP takes
 *  an iPhone's 48 MP photo (8064 × 6048) with room to spare. */
export const MAX_DECODE_PIXELS = 64_000_000;

/** HEIF brands of HEVC-coded images and image sequences (an iPhone writes heic). */
const HEIF_BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];
const AVIF_BRANDS = ["avif", "avis"];

const ascii = (b: Uint8Array, at: number, n: number) =>
  b.length >= at + n ? String.fromCharCode(...b.subarray(at, at + n)) : "";

/** An ISO-BMFF file's ftyp brands (major first), or null when it has none. */
function ftypBrands(b: Uint8Array): string[] | null {
  if (b.length < 16 || ascii(b, 4, 4) !== "ftyp") return null;
  const size = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
  const end = Math.min(size, b.length, 1024);
  const brands = [ascii(b, 8, 4)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(ascii(b, at, 4));
  return brands;
}

/** A TIFF's first-directory tags, or null when it is not a readable TIFF. */
function tiffTags(b: Uint8Array): Set<number> | null {
  const le = b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0;
  const be = b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a;
  if (!le && !be) return null;
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (at: number) => (le ? buf.readUInt16LE(at) : buf.readUInt16BE(at));
  const u32 = (at: number) => (le ? buf.readUInt32LE(at) : buf.readUInt32BE(at));
  const tags = new Set<number>();
  try {
    const ifd = u32(4);
    const n = u16(ifd);
    for (let i = 0; i < n; i++) tags.add(u16(ifd + 2 + i * 12));
  } catch {
    // A directory past the end of the file: no tags read.
  }
  return tags;
}

/** A camera RAW file built on TIFF: a DNG (DNGVersion), a Canon CR2, or a
 *  Nikon/Sony/Pentax-style RAW whose first directory points to sub-images. */
function isTiffRaw(b: Uint8Array, tags: Set<number>): boolean {
  return tags.has(0xc612) || ascii(b, 8, 2) === "CR" || tags.has(0x014a);
}

/** The file's real type, from its first bytes; null when it is none we take. */
export function sniff(b: Uint8Array): SniffedType | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 7) === "PNG\r\n\x1a\n") return "png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (["GIF87a", "GIF89a"].includes(ascii(b, 0, 6))) return "gif";
  if (ascii(b, 0, 5) === "%PDF-") return "pdf";
  const tags = tiffTags(b);
  if (tags) return isTiffRaw(b, tags) ? null : "tiff";
  if (looksLikeBmp(b)) return "bmp";
  const brands = ftypBrands(b);
  if (brands) {
    // A specific major brand decides; the generic mif1/msf1 defer to the others.
    const major = brands[0]!;
    if (AVIF_BRANDS.includes(major)) return "avif";
    if (HEIF_BRANDS.includes(major) && !["mif1", "msf1"].includes(major)) return "heic";
    if (brands.some((x) => AVIF_BRANDS.includes(x))) return "avif";
    if (brands.some((x) => HEIF_BRANDS.includes(x))) return "heic";
  }
  return null;
}

/** What a file we do not take looks like, for the refusal ("it looks like …"). */
export function looksLike(b: Uint8Array): string {
  const brands = ftypBrands(b);
  if (brands) {
    if (brands[0] === "crx ") return "a camera RAW file"; // a Canon CR3
    if (["M4A ", "M4B ", "M4P "].includes(brands[0]!)) return "an audio file";
    return "a video";
  }
  if (tiffTags(b)) return "a camera RAW file";
  const head4 = ascii(b, 0, 4);
  if (["IIRO", "IIRS", "IIU\0"].includes(head4) || ascii(b, 0, 15) === "FUJIFILMCCD-RAW")
    return "a camera RAW file";
  if (head4 === "RIFF") {
    const kind = ascii(b, 8, 4);
    if (kind === "AVI ") return "a video";
    if (kind === "WAVE") return "an audio file";
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "a video";
  if (ascii(b, 0, 3) === "ID3" || head4 === "OggS" || head4 === "fLaC")
    return "an audio file";
  if (head4 === "PK\x03\x04") {
    const text = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
    if (text.includes("word/")) return "a Word document";
    if (text.includes("xl/")) return "an Excel workbook";
    if (text.includes("ppt/")) return "a PowerPoint presentation";
    if (text.includes("mimetypeapplication/vnd.oasis.opendocument"))
      return "an OpenDocument file";
    return "a ZIP archive";
  }
  if (head4 === "\xd0\xcf\x11\xe0") return "an older Word, Excel or PowerPoint file";
  if (ascii(b, 0, 5) === "{\\rtf") return "a Rich Text document";
  if (head4 === "Rar!" || head4 === "7z\xbc\xaf" || (b[0] === 0x1f && b[1] === 0x8b))
    return "a compressed archive";
  if (head4 === "8BPS") return "a Photoshop file";
  if (ascii(b, 0, 2) === "MZ") return "a Windows program";
  if ((b[0] === 0xff && b[1] === 0x0a) || (ascii(b, 4, 4) === "JXL " && b[3] === 0x0c))
    return "a JPEG XL image";
  const start = Buffer.from(b.buffer, b.byteOffset, Math.min(b.byteLength, 1024))
    .toString("latin1")
    .toLowerCase();
  if (start.includes("<svg")) return "an SVG drawing";
  if (start.includes("<html") || start.includes("<!doctype html")) return "a web page";
  return "an unknown file";
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

/** The decoded picture as a sharp pipeline, or null when it cannot be decoded. */
async function open(
  type: SniffedType,
  bytes: Buffer,
): Promise<ReturnType<typeof sharp> | null> {
  let raw: RawPixels | null = null;
  if (type === "heic") raw = await decodeHeif(bytes, MAX_DECODE_PIXELS);
  else if (type === "bmp") raw = decodeBmp(bytes, MAX_DECODE_PIXELS);
  else return sharp(bytes); // the first frame or page
  if (!raw) return null;
  const { width, height, channels, data } = raw;
  return sharp(data, { raw: { width, height, channels } });
}

/** Check and prepare one upload; a refusal carries the sentence the user reads. */
export async function prepareUpload(name: string, bytes: Buffer): Promise<Prepared> {
  const type = sniff(bytes);
  if (!type)
    return {
      ok: false,
      message: `${name} is not a photo or PDF the Portal can read (it looks like ${looksLike(bytes)}).`,
    };
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
    const picture = await open(type, bytes);
    if (!picture) throw new Error("not decoded");
    const meta = await picture.metadata();
    const swap = (meta.orientation ?? 1) >= 5; // 5–8 turn the picture a quarter
    const w0 = swap ? meta.height! : meta.width!;
    const h0 = swap ? meta.width! : meta.height!;
    const target = fitToModel(w0, h0);
    const { data, info } = await picture
      .rotate() // apply the EXIF orientation; the output then carries none
      .flatten({ background: "#ffffff" }) // a transparent background reads as paper
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

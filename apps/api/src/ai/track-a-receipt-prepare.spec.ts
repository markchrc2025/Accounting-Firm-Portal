/**
 * track-a-receipt-prepare.spec.ts — U11 T8 (hermetic) and the price arithmetic.
 * Images are generated here (plain colours); no real receipt or photo is used.
 *  - EXIF orientation is applied and every EXIF/GPS block is gone;
 *  - images are sized to what the model reads (2,576 px long edge, ≤ 4,784 tokens);
 *  - HEIC is read (U11-A1); a 6-page PDF and a wrong type are refused;
 *  - cost = usage × price × 0.5, and the estimate is an upper bound.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  MAX_IMAGE_TOKENS,
  MAX_LONG_EDGE_PX,
  SCHEMA_TOKENS,
  fileEstimateUsd,
  fitToModel,
  imageTokens,
} from "./estimate";
import { prepareUpload, sniff } from "./prepare";
import { BATCH_DISCOUNT, PRICES, costOfUsage } from "./prices";
import { pileTooLarge, uploadName } from "./receipt-scan.service";

/** True when an EXIF block carries a GPS IFD pointer (tag 0x8825, either byte order). */
function hasGps(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  for (let i = 0; i < exif.length - 1; i++) {
    if (
      (exif[i] === 0x88 && exif[i + 1] === 0x25) ||
      (exif[i] === 0x25 && exif[i + 1] === 0x88)
    )
      return true;
  }
  return false;
}

async function pdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200, 300]);
  return Buffer.from(await doc.save());
}

describe("U11 T8 · preparing a file before it is stored or sent", () => {
  it("applies EXIF orientation and strips EXIF and GPS from a generated JPEG", async () => {
    const src = await sharp({
      create: { width: 400, height: 200, channels: 3, background: "#c33" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "14/1 35/1 0/1",
          GPSLongitudeRef: "E",
          GPSLongitude: "121/1 0/1 0/1",
        },
      })
      .toBuffer();
    const before = await sharp(src).metadata();
    expect(before.orientation).toBe(6);
    expect(hasGps(before.exif)).toBe(true);

    const p = await prepareUpload("rotated.jpg", src);
    expect(p.ok && p.kind).toBe("image");
    if (!p.ok || p.kind !== "image") return;
    // Orientation 6 turns a 400×200 picture to 200×400.
    expect([p.width, p.height]).toEqual([200, 400]);
    const after = await sharp(p.body).metadata();
    expect(after.format).toBe("jpeg");
    expect(after.orientation).toBeUndefined();
    expect(after.exif).toBeUndefined();
    expect(hasGps(after.exif)).toBe(false);
  });

  it("re-encodes PNG and WebP as JPEG", async () => {
    for (const fmt of ["png", "webp"] as const) {
      const src = await sharp({
        create: { width: 300, height: 300, channels: 3, background: "#3c3" },
      })
        .toFormat(fmt)
        .toBuffer();
      const p = await prepareUpload(`x.${fmt}`, src);
      expect(p.ok && p.contentType).toBe("image/jpeg");
    }
  });

  it("sizes a large photo to the largest the model reads: ≤ 2,576 px and ≤ 4,784 tokens", async () => {
    const src = await sharp({
      create: { width: 3000, height: 4000, channels: 3, background: "#33c" },
    })
      .jpeg()
      .toBuffer();
    const p = await prepareUpload("big.jpg", src);
    if (!p.ok || p.kind !== "image") throw new Error("not prepared");
    expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(MAX_LONG_EDGE_PX);
    expect(imageTokens(p.width, p.height)).toBeLessThanOrEqual(MAX_IMAGE_TOKENS);
    expect(p.contentTokens).toBe(imageTokens(p.width, p.height));
    // The docs' own example: 3840×2160 is read at 2576×1449, which is 4,784 tokens.
    expect(fitToModel(3840, 2160)).toEqual({ width: 2576, height: 1449 });
    expect(imageTokens(2576, 1449)).toBe(4784);
    // A small picture is never enlarged.
    expect(fitToModel(800, 1000)).toEqual({ width: 800, height: 1000 });
  });

  it("U11-A1: reads an iPhone HEIC photo as a JPEG; a HEIC header with no picture cannot be read", async () => {
    const real = readFileSync(
      join(__dirname, "../../test/fixtures/receipts/heic-plain.heic"),
    );
    expect(sniff(real)).toBe("heic");
    const p = await prepareUpload("IMG_0001.HEIC", real);
    expect(p).toMatchObject({
      ok: true,
      kind: "image",
      contentType: "image/jpeg",
      width: 320,
      height: 240,
    });
    // An ISO-BMFF header with the "heic" brand, as an iPhone writes it, and nothing else.
    const empty = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(32),
    ]);
    expect(sniff(empty)).toBe("heic");
    expect(await prepareUpload("IMG_0001.HEIC", empty)).toEqual({
      ok: false,
      message: "IMG_0001.HEIC could not be read as an image.",
    });
  });

  it("takes a PDF of up to 5 pages, as uploaded, and refuses 6", async () => {
    const five = await prepareUpload("five.pdf", await pdf(5));
    expect(five).toMatchObject({
      ok: true,
      kind: "pdf",
      pages: 5,
      contentType: "application/pdf",
    });
    expect(await prepareUpload("six.pdf", await pdf(6))).toEqual({
      ok: false,
      message: "six.pdf has 6 pages; a PDF in a pile may have at most 5.",
    });
  });

  it("refuses a wrong type, whatever its name says", async () => {
    // U11-A1: "GIF89a…" is now a GIF's start, so the wrong type is plain text.
    expect(
      await prepareUpload("receipt.jpg", Buffer.from("Invented notes, not a receipt")),
    ).toEqual({
      ok: false,
      message:
        "receipt.jpg is not a photo or PDF the Portal can read (it looks like an unknown file).",
    });
  });
});

describe("U11 · prices and the estimate", () => {
  it("cost = usage × the model's prices × 0.5 (T1's figure)", () => {
    // (4,834 × 2 + 4,000 × 0.10 + 1,000 × 10) ÷ 1,000,000 × 0.5 = 0.010034.
    expect(
      costOfUsage("claude-sonnet-5-5", {
        input_tokens: 4834,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 4000,
        output_tokens: 1000,
      }),
    ).toBe(0.010034);
    expect(BATCH_DISCOUNT).toBe(0.5);
  });

  it("cache writes are priced by their TTL; without a breakdown, at the 1-hour rate", () => {
    const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    // 1,000,000 × $4 (1h) × 0.5 = 2; 1,000,000 × $2.50 (5m) × 0.5 = 1.25.
    expect(
      costOfUsage("claude-sonnet-5-5", { ...u, cache_creation_input_tokens: 1_000_000 }),
    ).toBe(2);
    expect(
      costOfUsage("claude-sonnet-5-5", {
        ...u,
        cache_creation_input_tokens: 1_000_000,
        cache_creation: {
          ephemeral_5m_input_tokens: 1_000_000,
          ephemeral_1h_input_tokens: 0,
        },
      }),
    ).toBe(1.25);
    expect(
      costOfUsage("claude-haiku-5-5", {
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cache_read_input_tokens: 0,
      }),
    ).toBe(0.3); // (0.10 + 0.50) × 0.5
  });

  it("the estimate, worked by hand, prices every input at the dearest rate", () => {
    // Content 4,784 + request text 400 + schema 1,267 = 6,451 input tokens × $2;
    // instructions 4,000 as a 1-hour cache write × $4; a full 4,096-token answer × $10.
    // (12,902 + 16,000 + 40,960) ÷ 1,000,000 × 0.5 = 0.034931.
    expect(SCHEMA_TOKENS).toBe(1267);
    expect(fileEstimateUsd("claude-sonnet-5-5", MAX_IMAGE_TOKENS, 4000)).toBe(0.034931);
    // The real request text is counted when it is longer: +600 tokens × $2 × 0.5.
    expect(fileEstimateUsd("claude-sonnet-5-5", MAX_IMAGE_TOKENS, 4000, 1000)).toBe(
      0.035531,
    );
    expect(PRICES["claude-sonnet-5-5"]).toEqual({
      input: 2,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      cacheRead: 0.1,
      output: 10,
    });
  });

  it("a UTF-8 file name survives multer's latin1", () => {
    const sent = Buffer.from("Resibo ng Peña.jpg", "utf8").toString("latin1");
    expect(uploadName(sent)).toBe("Resibo ng Peña.jpg");
    expect(uploadName("plain.jpg")).toBe("plain.jpg");
  });

  it("a pile too large for one Message Batch is refused with a sentence", () => {
    expect(pileTooLarge([1_000_000, 2_000_000])).toBeNull();
    // 16 PDFs of 10 MB go out as about 214 MB of base64 (⌈10,000,000 ÷ 3⌉ × 4 × 16): over 200 MB.
    expect(pileTooLarge(Array(16).fill(10_000_000))).toBe(
      "This pile is too large to send at once: about 214 MB once prepared, and a pile can send at most 200 MB. Split it into smaller piles.",
    );
  });
});

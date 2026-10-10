/**
 * track-a-receipt-prepare.spec.ts — U11 T8 (hermetic) and the price arithmetic.
 * Images are generated here (plain colours); no real receipt or photo is used.
 *  - EXIF orientation is applied and every EXIF/GPS block is gone;
 *  - images are sized to what the model reads (2,576 px long edge, ≤ 4,784 tokens);
 *  - HEIC is refused with R4's sentence; a 6-page PDF and a wrong type are refused;
 *  - cost = usage × price × 0.5, and the estimate is an upper bound.
 */
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  MAX_IMAGE_TOKENS,
  MAX_LONG_EDGE_PX,
  MAX_OUTPUT_TOKENS,
  REQUEST_TEXT_TOKENS,
  fileEstimateUsd,
  fitToModel,
  imageTokens,
} from "./estimate";
import { HEIC_REFUSAL, prepareUpload, sniff } from "./prepare";
import { BATCH_DISCOUNT, PRICES, costOfUsage } from "./prices";

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

  it("refuses an iPhone HEIC photo with R4's sentence", async () => {
    // An ISO-BMFF header with the "heic" brand, as an iPhone writes it.
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypheic"),
      Buffer.alloc(32),
    ]);
    expect(sniff(heic)).toBe("heic");
    expect(await prepareUpload("IMG_0001.HEIC", heic)).toEqual({
      ok: false,
      message: `IMG_0001.HEIC: ${HEIC_REFUSAL}`,
    });
    expect(HEIC_REFUSAL).toBe(
      "This is an iPhone HEIC photo. Save it as JPG and upload it again.",
    );
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
    expect(
      await prepareUpload("receipt.jpg", Buffer.from("GIF89a not a receipt")),
    ).toEqual({
      ok: false,
      message: "receipt.jpg is not a JPEG, PNG, WebP or PDF file.",
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

  it("the estimate is an upper bound on any usage the request can produce", () => {
    const instr = 4000;
    const est = fileEstimateUsd("claude-sonnet-5-5", MAX_IMAGE_TOKENS, instr);
    // The dearest billing of the same request: every input token at the input price,
    // the instructions as a 1-hour cache write, and a full max_tokens answer.
    const worst = costOfUsage("claude-sonnet-5-5", {
      input_tokens: MAX_IMAGE_TOKENS + REQUEST_TEXT_TOKENS,
      cache_creation_input_tokens: instr,
      cache_read_input_tokens: 0,
      output_tokens: MAX_OUTPUT_TOKENS,
    });
    expect(est).toBeGreaterThanOrEqual(worst);
    expect(PRICES["claude-sonnet-5-5"]).toEqual({
      input: 2,
      cacheWrite5m: 2.5,
      cacheWrite1h: 4,
      cacheRead: 0.1,
      output: 10,
    });
  });
});

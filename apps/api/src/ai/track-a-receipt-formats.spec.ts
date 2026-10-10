/**
 * track-a-receipt-formats.spec.ts — U11-A1 (hermetic): a file's type comes from its
 * content; what a refused file looks like; the BMP decoder. Every file is a
 * fixture generated in a VM (test/fixtures/receipts) or built here from bytes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { decodeBmp } from "./bmp";
import { MAX_INPUT_PIXELS, looksLike, prepareUpload, sniff } from "./prepare";

const fixture = (name: string) =>
  readFileSync(join(__dirname, "../../test/fixtures/receipts", name));

/** An ISO-BMFF ftyp box with a major brand and compatible brands. */
const ftyp = (major: string, ...compatible: string[]) => {
  const body = Buffer.concat([
    Buffer.from(major),
    Buffer.alloc(4),
    ...compatible.map((c) => Buffer.from(c)),
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(8 + body.length);
  return Buffer.concat([head, Buffer.from("ftyp"), body, Buffer.alloc(16)]);
};

/** A little-endian TIFF whose first directory carries the given tags. */
const tiffWith = (...tags: number[]) => {
  const b = Buffer.alloc(8 + 2 + tags.length * 12 + 4 + 16);
  b.write("II*\0", 0, "latin1");
  b.writeUInt32LE(8, 4);
  b.writeUInt16LE(tags.length, 8);
  tags.forEach((t, i) => b.writeUInt16LE(t, 10 + i * 12));
  return b;
};

type Rgba = [number, number, number, number];

/** A bitmap built byte by byte, with a 10-byte gap before its pixels so a decoder
 *  that ignores the file header's pixel offset reads the wrong bytes. */
function bmp(o: {
  width: number;
  height: number;
  bpp: 1 | 8 | 16 | 24 | 32;
  header?: 12 | 40 | 124;
  compression?: number;
  masks?: number[];
  palette?: Array<[number, number, number]>;
  topDown?: boolean;
  pixel: (x: number, y: number) => Rgba | number;
}): Buffer {
  const header = o.header ?? 40;
  const compression = o.compression ?? 0;
  const dib = Buffer.alloc(header);
  dib.writeUInt32LE(header, 0);
  if (header === 12) {
    dib.writeUInt16LE(o.width, 4);
    dib.writeInt16LE(o.height, 6);
    dib.writeUInt16LE(1, 8);
    dib.writeUInt16LE(o.bpp, 10);
  } else {
    dib.writeInt32LE(o.width, 4);
    dib.writeInt32LE(o.topDown ? -o.height : o.height, 8);
    dib.writeUInt16LE(1, 12);
    dib.writeUInt16LE(o.bpp, 14);
    dib.writeUInt32LE(compression, 16);
    dib.writeUInt32LE(o.palette?.length ?? 0, 32);
    if (header >= 56 && o.masks)
      o.masks.forEach((m, i) => dib.writeUInt32LE(m >>> 0, 40 + i * 4));
  }
  const masks =
    header === 40 && o.masks
      ? Buffer.concat(
          o.masks.map((m) => {
            const x = Buffer.alloc(4);
            x.writeUInt32LE(m >>> 0);
            return x;
          }),
        )
      : Buffer.alloc(0);
  const entry = header === 12 ? 3 : 4;
  const palette = Buffer.alloc((o.palette?.length ?? 0) * entry);
  o.palette?.forEach(([r, g, b], i) => {
    palette[i * entry] = b;
    palette[i * entry + 1] = g;
    palette[i * entry + 2] = r;
  });
  const rowSize = Math.floor((o.bpp * o.width + 31) / 32) * 4;
  const pixels = Buffer.alloc(rowSize * o.height);
  for (let y = 0; y < o.height; y++) {
    const row = (o.topDown ? y : o.height - 1 - y) * rowSize;
    for (let x = 0; x < o.width; x++) {
      const p = o.pixel(x, y);
      if (o.bpp === 1 || o.bpp === 8) {
        const bit = x * o.bpp;
        pixels[row + (bit >> 3)]! |= (p as number) << (8 - o.bpp - (bit & 7));
      } else if (o.bpp === 16) pixels.writeUInt16LE(p as number, row + x * 2);
      else if (o.bpp === 24) {
        const [r, g, b] = p as Rgba;
        pixels[row + x * 3] = b;
        pixels[row + x * 3 + 1] = g;
        pixels[row + x * 3 + 2] = r;
      } else pixels.writeUInt32LE((p as number) >>> 0, row + x * 4);
    }
  }
  const gap = Buffer.alloc(10);
  const offset = 14 + dib.length + masks.length + palette.length + gap.length;
  const file = Buffer.alloc(14);
  file.write("BM", 0, "latin1");
  file.writeUInt32LE(offset + pixels.length, 2);
  file.writeUInt32LE(offset, 10);
  return Buffer.concat([file, dib, masks, palette, gap, pixels]);
}

const px = (
  d: { data: Buffer; width: number; channels: number },
  x: number,
  y: number,
) => [
  ...d.data.subarray((y * d.width + x) * d.channels, (y * d.width + x + 1) * d.channels),
];

describe("U11-A1 · a file's type comes from its content", () => {
  it("every accepted fixture is recognised by its bytes alone", () => {
    expect(
      [
        "heic-plain.heic",
        "heic-irot90.heic",
        "heic-two-images.heic",
        "photo.png",
        "photo.webp",
        "photo.gif",
        "photo.tiff",
        "photo.bmp",
        "photo.avif",
        "photo.dat",
      ].map((f) => sniff(fixture(f))),
    ).toEqual([
      "heic",
      "heic",
      "heic",
      "png",
      "webp",
      "gif",
      "tiff",
      "bmp",
      "avif",
      "jpeg",
    ]);
  });

  it("HEIF brands: a specific major decides; a generic mif1 defers to the compatible brands", () => {
    expect(sniff(ftyp("heic", "mif1", "heic"))).toBe("heic");
    expect(sniff(ftyp("heix", "mif1"))).toBe("heic");
    expect(sniff(ftyp("mif1", "mif1", "heic"))).toBe("heic");
    expect(sniff(ftyp("mif1", "mif1"))).toBe("heic");
    expect(sniff(ftyp("mif1", "mif1", "avif"))).toBe("avif");
    expect(sniff(ftyp("avif", "mif1", "miaf"))).toBe("avif");
    expect(sniff(ftyp("isom", "isom", "mp42"))).toBeNull();
  });

  it("a TIFF from a camera's RAW is not a TIFF: DNG, CR2 and RAWs with sub-images", () => {
    expect(sniff(tiffWith(0x0100, 0x0101))).toBe("tiff");
    expect(sniff(tiffWith(0x0100, 0xc612))).toBeNull(); // DNGVersion
    expect(sniff(tiffWith(0x0100, 0x014a))).toBeNull(); // SubIFDs
    const cr2 = tiffWith(0x0100);
    cr2.write("CR", 8, "latin1");
    expect(sniff(cr2)).toBeNull();
    for (const raw of [tiffWith(0xc612), cr2])
      expect(looksLike(raw)).toBe("a camera RAW file");
  });

  it.each([
    ["an iPhone video (.MOV)", ftyp("qt  ", "qt  "), "a video"],
    ["an MP4", fixture("clip.mp4"), "a video"],
    ["an AVI", Buffer.from("RIFF\0\0\0\0AVI LIST"), "a video"],
    ["a WebM/MKV", Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]), "a video"],
    ["a voice memo (.m4a)", ftyp("M4A ", "M4A ", "mp42"), "an audio file"],
    ["an MP3", Buffer.from("ID3\x04\0\0\0\0\0\0"), "an audio file"],
    ["a WAV", Buffer.from("RIFF\0\0\0\0WAVEfmt "), "an audio file"],
    ["a DNG", fixture("raw.dng"), "a camera RAW file"],
    ["a Canon CR3", ftyp("crx ", "crx "), "a camera RAW file"],
    ["an Olympus ORF", Buffer.from("IIRO\x08\0\0\0"), "a camera RAW file"],
    ["a Word document", fixture("letter.docx"), "a Word document"],
    [
      "an Excel workbook",
      Buffer.from("PK\x03\x04....xl/workbook.xml"),
      "an Excel workbook",
    ],
    ["a plain ZIP", Buffer.from("PK\x03\x04....notes.txt"), "a ZIP archive"],
    [
      "an old .doc",
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      "an older Word, Excel or PowerPoint file",
    ],
    ["a Windows program", Buffer.from("MZ\x90\0\x03\0"), "a Windows program"],
    ["an SVG", Buffer.from('<?xml version="1.0"?><svg xmlns="x"/>'), "an SVG drawing"],
    ["a web page", Buffer.from("<!DOCTYPE html><html></html>"), "a web page"],
    ["random bytes", fixture("noise.bin"), "an unknown file"],
  ])("%s is refused as %s", async (_label, bytes, kind) => {
    expect(sniff(bytes)).toBeNull();
    expect(looksLike(bytes)).toBe(kind);
    expect(await prepareUpload("upload.jpg", bytes)).toEqual({
      ok: false,
      message: `upload.jpg is not a photo or PDF the Portal can read (it looks like ${kind}).`,
    });
  });
});

describe("U11-A1 · the BMP decoder (sharp's libvips has no BMP loader)", () => {
  const RED: Rgba = [220, 30, 30, 255];
  const BLUE: Rgba = [30, 60, 220, 255];
  const corner = (x: number, y: number) => (x === 0 && y === 0 ? RED : BLUE);

  it("this sharp build cannot read a BMP itself", async () => {
    await expect(sharp(fixture("photo.bmp")).metadata()).rejects.toThrow(/unsupported/);
  });

  it("24 bits, an odd width (row padding), the pixels where the header says", () => {
    const d = decodeBmp(
      bmp({ width: 5, height: 3, bpp: 24, pixel: corner }),
      MAX_INPUT_PIXELS,
    )!;
    expect([d.width, d.height, d.channels]).toEqual([5, 3, 3]);
    expect(px(d, 0, 0)).toEqual([220, 30, 30]);
    expect(px(d, 4, 2)).toEqual([30, 60, 220]);
  });

  it("24 bits under the old 12-byte core header", () => {
    const d = decodeBmp(
      bmp({ width: 3, height: 2, bpp: 24, header: 12, pixel: corner }),
      MAX_INPUT_PIXELS,
    )!;
    expect(px(d, 0, 0)).toEqual([220, 30, 30]);
    expect(px(d, 2, 1)).toEqual([30, 60, 220]);
  });

  it("32 bits with a V5 header and an alpha mask keeps the alpha", () => {
    const d = decodeBmp(
      bmp({
        width: 2,
        height: 2,
        bpp: 32,
        header: 124,
        compression: 3,
        masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
        pixel: (x) => (x === 0 ? 0xffdc1e1e : 0x00000000),
      }),
      MAX_INPUT_PIXELS,
    )!;
    expect(d.channels).toBe(4);
    expect(px(d, 0, 0)).toEqual([220, 30, 30, 255]);
    expect(px(d, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it("32 bits whose alpha is all zero is opaque, not invisible", () => {
    const d = decodeBmp(
      bmp({
        width: 2,
        height: 1,
        bpp: 32,
        header: 124,
        compression: 3,
        masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
        pixel: () => 0x001e3cdc,
      }),
      MAX_INPUT_PIXELS,
    )!;
    expect(px(d, 1, 0)).toEqual([30, 60, 220, 255]);
  });

  it("16 bits with 5-6-5 bit fields, scaled to 0–255", () => {
    const d = decodeBmp(
      bmp({
        width: 2,
        height: 1,
        bpp: 16,
        compression: 3,
        masks: [0xf800, 0x07e0, 0x001f],
        pixel: (x) => (x === 0 ? 0xf800 : 0x07ff),
      }),
      MAX_INPUT_PIXELS,
    )!;
    expect(px(d, 0, 0)).toEqual([255, 0, 0]);
    expect(px(d, 1, 0)).toEqual([0, 255, 255]);
  });

  it("8 bits with a palette, rows top-down; 1 bit with a palette", () => {
    const eight = decodeBmp(
      bmp({
        width: 3,
        height: 2,
        bpp: 8,
        topDown: true,
        palette: [
          [220, 30, 30],
          [30, 60, 220],
        ],
        pixel: (x, y) => (x === 0 && y === 0 ? 0 : 1),
      }),
      MAX_INPUT_PIXELS,
    )!;
    expect(px(eight, 0, 0)).toEqual([220, 30, 30]);
    expect(px(eight, 2, 1)).toEqual([30, 60, 220]);
    const one = decodeBmp(
      bmp({
        width: 10,
        height: 1,
        bpp: 1,
        palette: [
          [0, 0, 0],
          [255, 255, 255],
        ],
        pixel: (x) => x % 2,
      }),
      MAX_INPUT_PIXELS,
    )!;
    expect([px(one, 0, 0), px(one, 9, 0)]).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
  });

  it("RLE compression, a picture over the pixel limit and a cut-off file are not read", () => {
    const rle = bmp({
      width: 2,
      height: 2,
      bpp: 8,
      compression: 1,
      palette: [[0, 0, 0]],
      pixel: () => 0,
    });
    expect(decodeBmp(rle, MAX_INPUT_PIXELS)).toBeNull();
    const ok = bmp({ width: 4, height: 4, bpp: 24, pixel: corner });
    expect(decodeBmp(ok, 15)).toBeNull();
    expect(decodeBmp(ok.subarray(0, ok.length - 5), MAX_INPUT_PIXELS)).toBeNull();
  });

  it("a BMP with transparency is prepared as a JPEG on white", async () => {
    const file = bmp({
      width: 40,
      height: 40,
      bpp: 32,
      header: 124,
      compression: 3,
      masks: [0x00ff0000, 0x0000ff00, 0x000000ff, 0xff000000],
      pixel: (x) => (x < 20 ? 0xffdc1e1e : 0x00000000),
    });
    const p = await prepareUpload("scan.bmp", file);
    if (!p.ok || p.kind !== "image") throw new Error("not prepared");
    const { data } = await sharp(p.body).raw().toBuffer({ resolveWithObject: true });
    const at = (x: number) => [
      ...data.subarray((20 * 40 + x) * 3, (20 * 40 + x) * 3 + 3),
    ];
    expect(at(5)[0]).toBeGreaterThan(180);
    expect(Math.min(...at(35))).toBeGreaterThan(240);
  });
});

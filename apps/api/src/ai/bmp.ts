/**
 * bmp.ts — a Windows bitmap decoded to raw pixels (U11-A1 R2). sharp's prebuilt
 * libvips has no BMP loader (proven in the U11-A1 report), so this small decoder
 * reads the uncompressed kinds a scanner or Paint writes:
 *  - headers: BITMAPCOREHEADER (12 bytes) and BITMAPINFOHEADER and later (40+);
 *  - 1, 4 and 8 bits with a palette; 16 bits (5-5-5, or bit fields); 24 bits;
 *    32 bits (BGRX, or bit fields with alpha);
 *  - bottom-up and top-down rows; the pixel data where the file header says.
 * RLE-compressed and JPEG/PNG-in-BMP files are not read (null).
 */
import type { RawPixels } from "./heif";

const BI_RGB = 0;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;

/** True when the bytes start like a bitmap: "BM" and a known header size. */
export function looksLikeBmp(b: Uint8Array): boolean {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return false;
  const header = b[14]! | (b[15]! << 8) | (b[16]! << 16) | (b[17]! << 24);
  return [12, 40, 52, 56, 64, 108, 124].includes(header);
}

/** One channel's value scaled to 0–255 by its bit mask. */
function channel(value: number, mask: number): number {
  if (!mask) return 0;
  const shift = 31 - Math.clz32(mask & -mask); // the mask's trailing zeros
  const max = mask >>> shift;
  return Math.round((((value & mask) >>> shift) * 255) / max);
}

export function decodeBmp(bytes: Uint8Array, maxPixels: number): RawPixels | null {
  if (!looksLikeBmp(bytes)) return null;
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const dataOffset = b.readUInt32LE(10);
    const header = b.readUInt32LE(14);
    const core = header === 12;
    const width = core ? b.readUInt16LE(18) : b.readInt32LE(18);
    const rawHeight = core ? b.readInt16LE(20) : b.readInt32LE(22);
    const bpp = core ? b.readUInt16LE(24) : b.readUInt16LE(28);
    const compression = core ? BI_RGB : b.readUInt32LE(30);
    const used = core ? 0 : b.readUInt32LE(46);
    const topDown = rawHeight < 0;
    const height = Math.abs(rawHeight);
    if (width < 1 || height < 1 || width * height > maxPixels) return null;
    if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null;
    if (![BI_RGB, BI_BITFIELDS, BI_ALPHABITFIELDS].includes(compression)) return null;

    // Bit masks: given after a 40-byte header (or inside a larger one) for bit
    // fields; otherwise the defaults (5-5-5 for 16 bits, BGRX for 32).
    let masks = [0, 0, 0, 0];
    if (bpp === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
    if (bpp === 32) masks = [0x00ff0000, 0x0000ff00, 0x000000ff, 0];
    if (compression !== BI_RGB && (bpp === 16 || bpp === 32)) {
      masks = [b.readUInt32LE(54), b.readUInt32LE(58), b.readUInt32LE(62), 0];
      if (header >= 56 || compression === BI_ALPHABITFIELDS)
        masks[3] = b.readUInt32LE(66);
    } else if (header >= 56 && bpp === 32) {
      masks[3] = b.readUInt32LE(66);
    }

    // The palette follows the header (and any bit masks after a 40-byte header).
    const palette: number[][] = [];
    if (bpp <= 8) {
      const entry = core ? 3 : 4;
      const start = 14 + header + (header === 40 && compression !== BI_RGB ? 12 : 0);
      const count = used || 1 << bpp;
      for (let i = 0; i < count; i++) {
        const at = start + i * entry;
        palette.push([b[at + 2]!, b[at + 1]!, b[at]!]);
      }
    }

    const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
    if (dataOffset + rowSize * height > b.length) return null;
    const alpha = masks[3] !== 0;
    const channels = alpha ? 4 : 3;
    const out = Buffer.alloc(width * height * channels);
    let anyAlpha = false;
    for (let y = 0; y < height; y++) {
      const row = dataOffset + (topDown ? y : height - 1 - y) * rowSize;
      for (let x = 0; x < width; x++) {
        let rgba: number[];
        if (bpp <= 8) {
          const bit = x * bpp;
          const byte = b[row + (bit >> 3)]!;
          const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          rgba = [...(palette[index] ?? [0, 0, 0]), 255];
        } else if (bpp === 24) {
          const at = row + x * 3;
          rgba = [b[at + 2]!, b[at + 1]!, b[at]!, 255];
        } else {
          const v =
            bpp === 16 ? b.readUInt16LE(row + x * 2) : b.readUInt32LE(row + x * 4);
          rgba = [
            channel(v, masks[0]!),
            channel(v, masks[1]!),
            channel(v, masks[2]!),
            alpha ? channel(v, masks[3]!) : 255,
          ];
        }
        const o = (y * width + x) * channels;
        out[o] = rgba[0]!;
        out[o + 1] = rgba[1]!;
        out[o + 2] = rgba[2]!;
        if (alpha) {
          out[o + 3] = rgba[3]!;
          if (rgba[3]) anyAlpha = true;
        }
      }
    }
    // Many writers leave a 32-bit bitmap's alpha all zero: that is opaque, not
    // invisible.
    if (alpha && !anyAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return { width, height, channels, data: out };
  } catch {
    return null;
  }
}

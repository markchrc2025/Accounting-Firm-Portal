/**
 * heif.ts — an iPhone's HEIC/HEIF photo (HEVC) decoded to RGBA pixels (U11-A1 R2).
 * sharp's prebuilt libheif carries only the AV1 codec, so it reads AVIF but not an
 * iPhone photo; libheif-js (libheif with libde265, WASM) does.
 *  - The PRIMARY image only: a burst or a Live Photo still holds several images,
 *    and the first in the file is not always the primary.
 *  - libheif applies the rotation and mirror (irot/imir) as it decodes, so the
 *    pixels come out upright.
 *  - The decode is called directly, inside try/catch: libheif-js's own display()
 *    decodes in a timer, where an error (a WASM abort) would escape every caller.
 *    An instance that threw is never used again.
 *  - One WASM instance serves a run of files (a pile), then is let go after
 *    IDLE_MS with nothing to decode: WASM memory never shrinks, so the instance's
 *    memory goes with it between piles. A fresh instance per file was measured
 *    (U11-A1 report) and peaked higher: old instances wait for the garbage
 *    collector.
 */
import libheif from "libheif-js/libheif-wasm/libheif-bundle.js";

/** How long the WASM instance is kept with nothing to decode. */
export const IDLE_MS = 10_000;

type Instance = {
  lib: ReturnType<typeof libheif>;
  users: number;
  idle?: NodeJS.Timeout;
};
let current: Instance | null = null;

function acquire(): Instance {
  current ??= { lib: libheif(), users: 0 };
  clearTimeout(current.idle);
  current.users++;
  return current;
}

function release(i: Instance): void {
  if (--i.users > 0) return;
  i.idle = setTimeout(() => {
    if (current === i && i.users === 0) current = null;
  }, IDLE_MS);
  i.idle.unref();
}

export interface RawPixels {
  width: number;
  height: number;
  channels: 3 | 4;
  data: Buffer;
}

/** The decoded primary image; null when the file cannot be decoded. */
export async function decodeHeif(
  bytes: Uint8Array,
  maxPixels: number,
): Promise<RawPixels | null> {
  const instance = acquire();
  const { lib } = instance;
  let decoder: InstanceType<typeof lib.HeifDecoder> | undefined;
  let images: ReturnType<InstanceType<typeof lib.HeifDecoder>["decode"]> = [];
  try {
    decoder = new lib.HeifDecoder();
    images = decoder.decode(bytes);
    const primary = images.find((i) => i.is_primary()) ?? images[0];
    if (!primary) return null;
    const width = primary.get_width();
    const height = primary.get_height();
    if (width < 1 || height < 1 || width * height > maxPixels) return null;
    const decoded = lib.heif_js_decode_image2(
      primary.handle,
      lib.heif_colorspace.heif_colorspace_RGB,
      lib.heif_chroma.heif_chroma_interleaved_RGBA,
    );
    if (!decoded || decoded.code || !decoded.channels) return null;
    try {
      const plane = decoded.channels.find(
        (c) => c.id == lib.heif_channel.heif_channel_interleaved, // embind enum values
      );
      if (!plane || plane.width < 1 || plane.height < 1) return null;
      // Copy row by row out of WASM memory, dropping any stride padding.
      const row = plane.width * 4;
      const data = Buffer.alloc(row * plane.height);
      for (let y = 0; y < plane.height; y++)
        data.set(plane.data.subarray(y * plane.stride, y * plane.stride + row), y * row);
      return { width: plane.width, height: plane.height, channels: 4, data };
    } finally {
      lib.heif_image_release(decoded.image);
    }
  } catch {
    // A WASM abort leaves the instance unusable: the next file gets a fresh one.
    if (current === instance) current = null;
    return null;
  } finally {
    for (const i of images) i.free();
    if (decoder?.decoder) lib.heif_context_free(decoder.decoder);
    release(instance);
  }
}

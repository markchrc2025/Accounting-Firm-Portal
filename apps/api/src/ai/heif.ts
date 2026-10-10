/**
 * heif.ts — an iPhone's HEIC/HEIF photo (HEVC) decoded to RGBA pixels (U11-A1 R2).
 * sharp's prebuilt libheif carries only the AV1 codec, so it reads AVIF but not an
 * iPhone photo; libheif-js (libheif with libde265, WASM) does.
 *  - The PRIMARY image only: a burst or a Live Photo still holds several images,
 *    and the first in the file is not always the primary.
 *  - libheif applies the rotation and mirror (irot/imir) as it decodes, so the
 *    pixels come out upright.
 *  - One WASM instance serves a run of files (a pile), then is let go after
 *    IDLE_MS with nothing to decode: WASM memory never shrinks, so the instance's
 *    memory goes with it between piles. A fresh instance per file was measured
 *    (U11-A1 report) and peaked higher: old instances wait for the garbage
 *    collector.
 */
import libheif from "libheif-js/libheif-wasm/libheif-bundle.js";

/** How long the WASM instance is kept with nothing to decode. */
export const IDLE_MS = 10_000;

type Instance = { lib: ReturnType<typeof libheif>; users: number; idle?: NodeJS.Timeout };
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
    const shown = await new Promise<{ data: Uint8ClampedArray } | null>((done) =>
      primary.display(
        { data: new Uint8ClampedArray(width * height * 4), width, height },
        done,
      ),
    );
    if (!shown) return null;
    return {
      width,
      height,
      channels: 4,
      data: Buffer.from(shown.data.buffer, shown.data.byteOffset, shown.data.byteLength),
    };
  } finally {
    for (const i of images) i.free();
    if (decoder?.decoder) lib.heif_context_free(decoder.decoder);
    release(instance);
  }
}

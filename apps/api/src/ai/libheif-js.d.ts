/**
 * The part of libheif-js (libheif + libde265 compiled to WASM, LGPL-3.0) that
 * heif.ts uses. The bundle exports a factory; each call is a fresh WASM instance
 * with its own memory.
 */
declare module "libheif-js/libheif-wasm/libheif-bundle.js" {
  interface HeifImage {
    /** The libheif image handle. */
    handle: unknown;
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    free(): void;
  }
  interface HeifDecoder {
    /** The libheif context; freed with heif_context_free. */
    decoder: unknown;
    /** Every top-level image, in file order; [] when the file cannot be parsed. */
    decode(bytes: Uint8Array): HeifImage[];
  }
  /** An embind enum value: compared with ==, as libheif-js itself does. */
  type EnumValue = object;
  interface DecodedPlane {
    id: EnumValue;
    width: number;
    height: number;
    stride: number;
    data: Uint8Array;
  }
  interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
    heif_context_free(context: unknown): void;
    /** Decodes one image, applying irot/imir; synchronous. */
    heif_js_decode_image2(
      handle: unknown,
      colorspace: EnumValue,
      chroma: EnumValue,
    ): { code?: unknown; image: unknown; channels: DecodedPlane[] } | null;
    heif_image_release(image: unknown): void;
    heif_colorspace: { heif_colorspace_RGB: EnumValue };
    heif_chroma: { heif_chroma_interleaved_RGBA: EnumValue };
    heif_channel: { heif_channel_interleaved: EnumValue };
  }
  const factory: () => LibHeif;
  export default factory;
}

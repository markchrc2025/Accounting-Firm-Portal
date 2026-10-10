/**
 * The part of libheif-js (libheif + libde265 compiled to WASM, LGPL-3.0) that
 * heif.ts uses. The bundle exports a factory; each call is a fresh WASM instance
 * with its own memory.
 */
declare module "libheif-js/libheif-wasm/libheif-bundle.js" {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    is_primary(): boolean;
    free(): void;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      done: (result: { data: Uint8ClampedArray } | null) => void,
    ): void;
  }
  interface HeifDecoder {
    /** The libheif context; freed with heif_context_free. */
    decoder: unknown;
    /** Every top-level image, in file order; [] when the file cannot be parsed. */
    decode(bytes: Uint8Array): HeifImage[];
  }
  interface LibHeif {
    HeifDecoder: new () => HeifDecoder;
    heif_context_free(context: unknown): void;
  }
  const factory: () => LibHeif;
  export default factory;
}

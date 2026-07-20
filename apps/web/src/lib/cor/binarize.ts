// Pure binarization math for the COR OCR pipeline (no DOM — unit-testable).
//
// The fixed 160 threshold works well on flat scans, but a dark phone PHOTO of
// a COR needs a lower cut or the shadowed background floods black and Tesseract
// reads mush. Otsu's method picks the threshold that best separates the
// luminance histogram into two classes (ink vs paper) — the classic adaptive
// choice for bimodal document images.

/** Fixed threshold used for the first OCR pass (proven on flat scans). */
export const FIXED_THRESHOLD = 160;

/** Otsu results are clamped to a sane document range — a degenerate histogram
 *  (all-dark or all-light photo) must not produce an all-black/all-white page. */
export const OTSU_MIN = 100;
export const OTSU_MAX = 210;

/**
 * Otsu's threshold over a 256-bin luminance histogram: maximizes between-class
 * variance. Returns FIXED_THRESHOLD when the histogram is degenerate (empty).
 */
export function otsuThreshold(hist: ArrayLike<number>, total: number): number {
  if (total <= 0) return FIXED_THRESHOLD;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] ?? 0);
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = FIXED_THRESHOLD;
  for (let t = 0; t < 256; t++) {
    wB += hist[t] ?? 0;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * (hist[t] ?? 0);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return Math.min(OTSU_MAX, Math.max(OTSU_MIN, threshold));
}

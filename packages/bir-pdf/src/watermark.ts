// watermark — the DRAFT stamp of a preview (C3, D52): a large diagonal
// "DRAFT — NOT FILED" in light grey across every page, and a small footer line
// saying when the preview was printed. Drawn after the figures, translucent, so
// every figure stays readable through it. The time comes in from the caller:
// the engine never reads a clock.
import { degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export const DRAFT_STAMP = "DRAFT — NOT FILED";

/** The stamp's opacity: light enough that every figure under it stays readable. */
const STAMP_OPACITY = 0.15;
/** How much of the page's diagonal the stamp spans. */
const STAMP_SPAN = 0.8;
const FOOTER_SIZE = 7;
/** The footer's baseline, above the paper's bottom edge and below every form's frame. */
const FOOTER_Y = 10;

/** "11 Oct 2026, 2:05 PM", on Manila's clock. */
export function manilaStamp(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(at);
  const p = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((x) => x.type === type)?.value ?? "";
  return `${p("day")} ${p("month")} ${p("year")}, ${p("hour")}:${p("minute")} ${p("dayPeriod").toUpperCase()}`;
}

/** The preview footer line (C3 R1). */
export function previewFooter(printedAt: Date): string {
  return `Preview printed ${manilaStamp(printedAt)} (Manila) from the Portal. Not the filed return.`;
}

/** Stamp one page: the diagonal DRAFT mark centred on the page, and the footer. */
export function stampDraft(
  page: PDFPage,
  font: PDFFont,
  capHeight: (size: number) => number,
  printedAt: Date,
): void {
  const { width: W, height: H } = page.getSize();
  const angle = Math.atan2(H, W);
  const size = (STAMP_SPAN * Math.hypot(W, H)) / font.widthOfTextAtSize(DRAFT_STAMP, 1);
  const w = font.widthOfTextAtSize(DRAFT_STAMP, size);
  const h = capHeight(size);
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  // Put the centre of the stamp's capitals on the centre of the page.
  page.drawText(DRAFT_STAMP, {
    x: W / 2 - (w / 2) * cos + (h / 2) * sin,
    y: H / 2 - (w / 2) * sin - (h / 2) * cos,
    size,
    font,
    // Black at 15% opacity: light grey on white paper, darker over the shaded cells.
    color: rgb(0, 0, 0),
    opacity: STAMP_OPACITY,
    rotate: degrees((angle * 180) / Math.PI),
  });
  const footer = previewFooter(printedAt);
  page.drawText(footer, {
    x: W / 2 - font.widthOfTextAtSize(footer, FOOTER_SIZE) / 2,
    y: FOOTER_Y,
    size: FOOTER_SIZE,
    font,
    color: rgb(0, 0, 0),
  });
}

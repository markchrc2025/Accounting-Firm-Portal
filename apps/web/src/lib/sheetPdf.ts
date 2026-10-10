// sheetPdf.ts — render a faithful, print-styled form sheet to an A4 PDF.
//
// The BIR *certificates* (2307, 2316) are issued to a payee / employee rather
// than e-filed, so BIR publishes no eBIRForms XML for them — the deliverable is
// the printed sheet. The certificate editors render a pixel-faithful replica of
// the official form and this helper snapshots it onto A4 pages.
//
// html2canvas and jsPDF are imported lazily so they stay out of the main bundle.
// The capture itself is the shared, fixed one in components/birform/sheetsPdf.ts
// (W3 R5); this path keeps its own A4 page and JPEG encoding until W4.

import { captureNode } from "../components/birform/sheetsPdf";

/** A4 at 96dpi in CSS pixels — the width the .bir-sheet replica is authored at. */
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;

/**
 * Capture one or more sheet elements onto an A4 PDF and download it. Each
 * element becomes one page, scaled to the page width and top-aligned.
 */
export async function sheetsToPdf(sheets: HTMLElement[], filename: string): Promise<void> {
  if (sheets.length === 0) throw new Error("Nothing to print.");

  const { jsPDF } = await import("jspdf");

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < sheets.length; i++) {
    const canvas = await captureNode(sheets[i]!, { scale: 2 });
    const image = canvas.toDataURL("image/jpeg", 0.95);
    if (i > 0) pdf.addPage();
    const h = (canvas.height * pageW) / canvas.width;
    pdf.addImage(image, "JPEG", 0, 0, pageW, Math.min(h, pageH));
  }

  pdf.save(filename);
}

/**
 * Canonical filename for a printed certificate:
 * `<tin><branch>-<form>-<period>.pdf`, e.g. `12345678900000-2307-2026-Q1.pdf`
 * for the 14-digit TIN 123-456-789-00000: the nine TIN digits, then every branch
 * digit the TIN carries. A TIN typed with no branch digits gets "000" (12 digits
 * in all). Falls back gracefully when the client has no TIN on file.
 */
export function certificateFileName(form: string, period: string, tin?: string | null): string {
  const digits = String(tin ?? "").replace(/\D/g, "");
  const prefix = digits ? `${digits.slice(0, 9)}${(digits.slice(9) || "000").padStart(3, "0")}-` : "";
  const per = period ? `-${period}` : "";
  return `${prefix}${form}${per}.pdf`;
}

// sheetPdf.ts — render a faithful, print-styled form sheet to an A4 PDF.
//
// The BIR *certificates* (2307, 2316) are issued to a payee / employee rather
// than e-filed, so BIR publishes no eBIRForms XML for them — the deliverable is
// the printed sheet. The certificate editors render a pixel-faithful replica of
// the official form and this helper snapshots it onto A4 pages.
//
// html2canvas and jsPDF are imported lazily so they stay out of the main bundle
// (the same pattern BillingPage already uses for invoice export).

/** A4 at 96dpi in CSS pixels — the width the .bir-sheet replica is authored at. */
export const A4_WIDTH_PX = 794;
export const A4_HEIGHT_PX = 1123;

/**
 * Capture one or more sheet elements onto an A4 PDF and download it. Each
 * element becomes one page, scaled to the page width and top-aligned.
 */
export async function sheetsToPdf(sheets: HTMLElement[], filename: string): Promise<void> {
  if (sheets.length === 0) throw new Error("Nothing to print.");

  // Wait for web fonts so text isn't captured in a fallback face.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore — proceed with whatever is loaded */
    }
  }

  const [html2canvas, { jsPDF }] = await Promise.all([
    import("html2canvas").then((m) => m.default),
    import("jspdf"),
  ]);

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4", compress: true });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < sheets.length; i++) {
    const canvas = await html2canvas(sheets[i]!, { scale: 2, backgroundColor: "#ffffff" });
    const image = canvas.toDataURL("image/jpeg", 0.95);
    if (i > 0) pdf.addPage();
    const h = (canvas.height * pageW) / canvas.width;
    pdf.addImage(image, "JPEG", 0, 0, pageW, Math.min(h, pageH));
  }

  pdf.save(filename);
}

/**
 * Canonical filename for a printed certificate:
 * `<tin><branch>-<form>-<period>.pdf`, e.g. `123456789000-2307-2026-Q1.pdf`.
 * Falls back gracefully when the client has no TIN on file.
 */
export function certificateFileName(form: string, period: string, tin?: string | null): string {
  const digits = String(tin ?? "").replace(/\D/g, "");
  const prefix = digits ? `${digits.slice(0, 9)}${(digits.slice(9) || "000").padStart(3, "0")}-` : "";
  const per = period ? `-${period}` : "";
  return `${prefix}${form}${per}.pdf`;
}

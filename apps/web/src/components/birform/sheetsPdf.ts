// sheetsPdf.ts — rasterise faithful BIR form sheets onto PDF pages.
//
// Split out of FormViewShell.tsx so that file exports only components (React
// fast refresh requires it). Used by the shell's live preview and by a page's
// own Print button, so both produce the same bytes.

/** A PDF page size in points. Long bond is [612, 936]; A4 is [595.28, 841.89]. */
export type PagePt = [number, number];

/**
 * Rasterise every `.bir-sheet` under `root` onto one PDF page each and return
 * the Blob. html2canvas and jsPDF are imported lazily so they stay out of the
 * main bundle, matching what sheetPdf.ts and BillingPage already do.
 *
 * Raster PNG at scale 2 — 192 dpi at 96 px/in authoring. PNG, not JPEG:
 * JPEG's 8x8 blocks smear the form's 0.7px hairline rules and its sub-8pt
 * glyphs, which is exactly the content that has to stay readable on paper.
 */
export async function sheetsToPdfBlob(
  root: HTMLElement,
  pagePt: PagePt,
  title?: string,
): Promise<Blob> {
  const found = Array.from(root.querySelectorAll<HTMLElement>(".bir-sheet"));
  const sheets = found.length ? found : [root];

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

  const pdf = new jsPDF({
    unit: "pt",
    format: [pagePt[0], pagePt[1]],
    orientation: "portrait",
    compress: true,
  });
  if (title) pdf.setProperties({ title });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // DEFECT FIX 1 — text painted too low. html2canvas finds each font's
  // baseline in the LIVE document (html2canvas.esm.js:6624) by setting a 1x1
  // <img> beside a <span> and measuring the offset between them (:6558-6583).
  // It sets vertical-align on that image but never `display`, and Tailwind's
  // preflight makes every <img> `display: block`, so the probe image drops to
  // the next line and every glyph is painted a line-fraction too low. Restore
  // inline layout for that one probe image — matched by its exact data URI, so
  // nothing else on the page is touched — for the duration of the capture.
  const probeFix = document.createElement("style");
  probeFix.setAttribute("data-bir-capture", "");
  probeFix.textContent = `img[src="${H2C_PROBE_IMAGE}"] { display: inline !important; }`;
  document.head.appendChild(probeFix);

  try {
    for (let i = 0; i < sheets.length; i++) {
      const el = sheets[i]!;
      const canvas = await html2canvas(el, {
        scale: 2,
        backgroundColor: "#ffffff",
        // Capture the sheet at its authored size, not at whatever the zoom
        // transform is showing.
        width: el.offsetWidth,
        height: el.offsetHeight,
        // DEFECT FIX 2 — words collide and values drift out of their boxes
        // when the on-screen sheet sits inside the Fit-to-width
        // `transform: scale(...)`: html2canvas reads glyph positions in the
        // transformed space and paints them in untransformed space. Strip every
        // ancestor transform in the CLONE (the live page is untouched), so the
        // sheet is captured at 1:1 whatever the zoom control shows.
        onclone: (_doc, cloned) => {
          for (let n = cloned.parentElement; n; n = n.parentElement) {
            n.style.transform = "none";
          }
        },
      });
      const image = canvas.toDataURL("image/png");
      if (i > 0) pdf.addPage([pagePt[0], pagePt[1]], "portrait");
      // Full-bleed: the sheet and the page have identical aspect ratios by
      // construction (both 8.5:13), so there is no stretch and no letterbox.
      pdf.addImage(image, "PNG", 0, 0, pageW, pageH);
    }
  } finally {
    probeFix.remove();
  }

  return pdf.output("blob");
}

/**
 * The exact 1x1 GIF html2canvas 1.4.1 uses as its baseline probe
 * (html2canvas.esm.js:6550, SMALL_IMAGE). Pinned deliberately: if an upgrade
 * changes it, the probe fix stops matching and the capture test in
 * e2e/track-b-form-2307.spec.ts is what notices.
 */
const H2C_PROBE_IMAGE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * Produce the PDF for the sheets under `root` and hand it to the browser as a
 * download. Kept separate from the component so a page's own Print button can
 * call it with the same geometry the preview used.
 */
export async function downloadSheetsPdf(
  root: HTMLElement,
  pagePt: PagePt,
  filename: string,
): Promise<void> {
  const blob = await sheetsToPdfBlob(root, pagePt, filename);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    // Give the click a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

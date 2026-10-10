// sheetsPdf.ts — rasterise faithful BIR form sheets onto PDF pages.
//
// Split out of FormViewShell.tsx so that file exports only components (React
// fast refresh requires it). Used by the shell's live preview and by a page's
// own Print button, so both produce the same bytes. `captureNode` is the one
// html2canvas capture every print path shares (W3 R5).

/** A PDF page size in points. Long bond is [612, 936]; A4 is [595.28, 841.89]. */
export type PagePt = [number, number];

/**
 * Capture one DOM node to a canvas with html2canvas, with both capture fixes
 * applied. EVERY print path in the Portal goes through here (W3 R5): the 2307
 * replica, the legacy 2307 and 2316 sheets, and the billing PDF/JPEG export.
 * Each path keeps its own page format and image encoding; only the capture is
 * shared. html2canvas is imported lazily so it stays out of the main bundle.
 *
 * `width`/`height` are passed to html2canvas only when given, so a path that
 * never set them captures exactly as it did before.
 */
export async function captureNode(
  el: HTMLElement,
  opts: { scale?: number; width?: number; height?: number } = {},
): Promise<HTMLCanvasElement> {
  // Wait for web fonts so text isn't captured in a fallback face.
  if (typeof document !== "undefined" && document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* ignore — proceed with whatever is loaded */
    }
  }

  const html2canvas = (await import("html2canvas")).default;

  // DEFECT FIX 1 (F10) — text painted too low. html2canvas finds each font's
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
    return await html2canvas(el, {
      scale: opts.scale ?? 2,
      backgroundColor: "#ffffff",
      ...(opts.width != null ? { width: opts.width } : {}),
      ...(opts.height != null ? { height: opts.height } : {}),
      // DEFECT FIX 2 (F11) — the print must not depend on anything outside
      // the captured node. html2canvas cancels animations and transforms only
      // on the element it captures and its descendants (html2canvas.esm.js:
      // 3792-3797), never on its ANCESTORS. In the cloned document every
      // ancestor's CSS animation restarts from zero (the page root's
      // `animate-fade-rise` is a 300 ms translateY), so the node was captured
      // at a random sub-pixel offset and a rule could land on one raster row or
      // the next; and a Fit-to-width `transform: scale(...)` garbled the text
      // outright. In the CLONE only (the live page is untouched) cancel every
      // ancestor's animation and transition, then its transform, at
      // `important` priority. An ordinary inline `transform: none` is not
      // enough: a running animation outranks it.
      onclone: (_doc, cloned) => {
        for (let n = cloned.parentElement; n; n = n.parentElement) {
          n.style.setProperty("animation", "none", "important");
          n.style.setProperty("transition", "none", "important");
          n.style.setProperty("transform", "none", "important");
        }
      },
    });
  } finally {
    probeFix.remove();
  }
}

/**
 * Rasterise every `.bir-sheet` under `root` onto one PDF page each and return
 * the Blob. jsPDF is imported lazily so it stays out of the main bundle.
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

  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({
    unit: "pt",
    format: [pagePt[0], pagePt[1]],
    orientation: "portrait",
    compress: true,
  });
  if (title) pdf.setProperties({ title });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < sheets.length; i++) {
    const el = sheets[i]!;
    // Capture the sheet at its authored size, not at whatever the zoom
    // transform is showing.
    const canvas = await captureNode(el, {
      scale: 2,
      width: el.offsetWidth,
      height: el.offsetHeight,
    });
    const image = canvas.toDataURL("image/png");
    if (i > 0) pdf.addPage([pagePt[0], pagePt[1]], "portrait");
    // Full-bleed: the sheet and the page have identical aspect ratios by
    // construction (both 8.5:13), so there is no stretch and no letterbox.
    pdf.addImage(image, "PNG", 0, 0, pageW, pageH);
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

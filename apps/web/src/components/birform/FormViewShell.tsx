// FormViewShell.tsx — the Guided ⇄ Form editor shell with a live PDF preview.
//
// Ported from the Sentire generator's src/components/editor/Editor.tsx
// (lines 40-72 the debounced preview, 144-152 the print path, 260-270 the
// stage) with two deliberate departures, both settled by ruling:
//
//   1. Sentire keeps the faithful sheet OFF-SCREEN (left: -100000px, inert) and
//      shows only the rendered PDF. Here the sheet is ON SCREEN beside the PDF
//      preview (design (ii), R11 of W2 pass 2) — a DOM sheet you can inspect
//      element by element is worth more during a port than a picture of one.
//   2. Sentire relies on the browser PDF viewer's own #view=FitH for zoom; its
//      .s-zoom control is vestigial CSS that nothing references. The zoom here
//      is a real control over the on-screen sheet: Fit to width, or 100%.
//
// GENERIC: this component knows nothing about 2307 or any other form. It takes
// the sheets as children, a filename, and a page size in points.

import type { RefObject } from "react";
import { sheetsToPdfBlob, type PagePt } from "./sheetsPdf";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type FormViewMode = "guided" | "form";

export type { PagePt } from "./sheetsPdf";

export interface FormViewShellProps {
  mode: FormViewMode;
  onModeChange: (mode: FormViewMode) => void;
  /** The Guided pane — where every value is actually entered. */
  guided: ReactNode;
  /** One or more `.bir-sheet` elements. Rendered inside a `.bir-doc` wrapper. */
  sheets: ReactNode;
  /**
   * Ref to the `.bir-doc` wrapper the sheets render into. Owned by the caller so
   * its own Print button can rasterise exactly what the preview rasterised.
   */
  rootRef: RefObject<HTMLDivElement>;
  /** Download name for the PDF, e.g. "123456789000-2307-2026-Q1.pdf". */
  filename: string;
  /** PDF page size in points. Every sheet is placed full-bleed onto one page. */
  pagePt: PagePt;
  /**
   * Changes whenever the sheet's data changes, so the preview re-renders.
   * Keeping it explicit beats deep-comparing the form data inside the shell.
   */
  revisionKey?: string | number;
  /** Debounce before a new preview render, ms. */
  debounceMs?: number;
  /** Extra controls for the toolbar's right-hand side (Save, File, …). */
  actions?: ReactNode;
}

const ZOOM_FIT = "fit";
const ZOOM_FULL = "full";
type Zoom = typeof ZOOM_FIT | typeof ZOOM_FULL;

export function FormViewShell({
  mode,
  onModeChange,
  guided,
  sheets,
  rootRef,
  filename,
  pagePt,
  revisionKey = 0,
  debounceMs = 500,
  actions,
}: FormViewShellProps) {
  /** The CAPTURE copy: always off-screen at a fixed integer position. */
  const docRef = rootRef;
  /** The VIEW copy: on screen in Form mode, zoomable, never rasterised. */
  const viewRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState(false);
  const [zoom, setZoom] = useState<Zoom>(ZOOM_FIT);
  const [scale, setScale] = useState(1);
  /** The first sheet's authored size, so a scaled wrapper can reserve its box. */
  const [sheetBox, setSheetBox] = useState({ w: 0, h: 0 });
  const pdfReq = useRef(0);
  // Hold the live URL in a ref as well, so the unmount cleanup can revoke the
  // current one without re-running on every change.
  const liveUrl = useRef<string | null>(null);

  /* ---- Fit-to-width: measure the stage and scale the sheet to it ---- */
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const sheet = viewRef.current?.querySelector<HTMLElement>(".bir-sheet");
    if (!stage || !sheet) return;
    const w = sheet.offsetWidth;
    const h = sheet.offsetHeight;
    setSheetBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    if (zoom === ZOOM_FULL) {
      setScale(1);
      return;
    }
    const avail = stage.clientWidth - 32; // the stage's own padding
    setScale(w > 0 && avail > 0 ? Math.min(1, avail / w) : 1);
  }, [zoom]);

  useLayoutEffect(() => {
    if (mode !== "form") return;
    measure();
    const ro = new ResizeObserver(() => measure());
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, [mode, measure, revisionKey]);

  /* ---- Live PDF preview, debounced ---- */
  useEffect(() => {
    if (mode !== "form") return;
    setPdfBusy(true);
    const timer = setTimeout(() => {
      const req = ++pdfReq.current;
      void (async () => {
        try {
          const root = docRef.current;
          if (!root) return;
          const blob = await sheetsToPdfBlob(root, pagePt, filename);
          if (req !== pdfReq.current) return; // a newer edit superseded this render
          const url = URL.createObjectURL(blob);
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            liveUrl.current = url;
            return url;
          });
          setPdfErr(false);
        } catch {
          if (req === pdfReq.current) setPdfErr(true);
        } finally {
          if (req === pdfReq.current) setPdfBusy(false);
        }
      })();
    }, debounceMs);
    return () => clearTimeout(timer);
    // `pagePt` is a literal tuple from the caller; `filename` and
    // `revisionKey` are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, revisionKey, filename, debounceMs]);

  /* ---- Release the blob URL on unmount ---- */
  useEffect(
    () => () => {
      if (liveUrl.current) URL.revokeObjectURL(liveUrl.current);
      liveUrl.current = null;
    },
    [],
  );

  const isForm = mode === "form";

  return (
    <div className="space-y-3">
      {/* ---------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex overflow-hidden rounded-card border border-line"
          role="group"
          aria-label="Editor mode"
        >
          <button
            type="button"
            aria-pressed={!isForm}
            onClick={() => onModeChange("guided")}
            className={`px-3 py-1.5 text-[12.5px] font-medium ${
              !isForm ? "bg-navy text-white" : "bg-surface text-content-secondary"
            }`}
          >
            Guided
          </button>
          <button
            type="button"
            aria-pressed={isForm}
            onClick={() => onModeChange("form")}
            className={`px-3 py-1.5 text-[12.5px] font-medium ${
              isForm ? "bg-navy text-white" : "bg-surface text-content-secondary"
            }`}
          >
            Form
          </button>
        </div>

        {isForm ? (
          <div
            className="inline-flex overflow-hidden rounded-card border border-line"
            role="group"
            aria-label="Zoom"
          >
            <button
              type="button"
              aria-pressed={zoom === ZOOM_FIT}
              onClick={() => setZoom(ZOOM_FIT)}
              className={`px-3 py-1.5 text-[12.5px] ${
                zoom === ZOOM_FIT
                  ? "bg-navy text-white"
                  : "bg-surface text-content-secondary"
              }`}
            >
              Fit to width
            </button>
            <button
              type="button"
              aria-pressed={zoom === ZOOM_FULL}
              onClick={() => setZoom(ZOOM_FULL)}
              className={`px-3 py-1.5 text-[12.5px] ${
                zoom === ZOOM_FULL
                  ? "bg-navy text-white"
                  : "bg-surface text-content-secondary"
              }`}
            >
              100%
            </button>
          </div>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {isForm && pdfBusy ? (
            <span className="text-[12px] text-content-secondary">Rendering PDF…</span>
          ) : null}
          {actions}
        </div>
      </div>

      {/* ------------------------------------------------------------ body */}
      {isForm ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* The sheet, ON SCREEN. `inert` keeps it out of the tab order — the
              form is a preview, never a data-entry surface; entry is Guided. */}
          <div
            ref={stageRef}
            className="overflow-auto rounded-card border border-line bg-sidebar p-4"
            data-testid="form-view-stage"
          >
            {/* A CSS transform does not change layout size, so the wrapper is
                given the scaled box explicitly — otherwise a scaled-down sheet
                still reserves its full 816 x 1248 and the stage scrolls. */}
            <div
              style={
                scale === 1
                  ? undefined
                  : { width: sheetBox.w * scale, height: sheetBox.h * scale }
              }
            >
              <div
                style={
                  scale === 1
                    ? undefined
                    : { transform: `scale(${scale})`, transformOrigin: "top left" }
                }
              >
                <div
                  className="bir-doc"
                  ref={viewRef}
                  data-sheet-copy="view"
                  {...({ inert: "" } as Record<string, string>)}
                >
                  {sheets}
                </div>
              </div>
            </div>
          </div>

          {/* The rendered PDF, in the browser's own viewer. */}
          <div className="relative min-h-[520px] overflow-hidden rounded-card border border-line bg-[#525659]">
            {pdfUrl ? (
              <iframe
                className="h-full min-h-[520px] w-full border-0"
                title="Form PDF preview"
                src={pdfUrl + "#view=FitH"}
              />
            ) : (
              <div className="flex h-full min-h-[520px] items-center justify-center text-[13px] text-white/70">
                {pdfErr ? "Couldn’t render the PDF preview." : "Rendering PDF…"}
              </div>
            )}
          </div>
        </div>
      ) : (
        guided
      )}

      {/* The CAPTURE copy — the only one ever rasterised, in either mode.
          Staged off-screen by .bir-sheet-stage (position: fixed; left:
          -10000px; top: 0), so its page coordinates are integers and do not
          depend on scroll, layout or zoom. Rasterising the on-screen copy
          instead made the print depend on where the operator had scrolled:
          a rule could land on one raster row or the next. */}
      <div className="bir-sheet-stage" aria-hidden="true">
        <div className="bir-doc" ref={docRef} data-sheet-copy="capture">
          {sheets}
        </div>
      </div>
    </div>
  );
}

export default FormViewShell;

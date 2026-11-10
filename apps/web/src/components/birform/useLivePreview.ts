// useLivePreview — the live Preview pane's requests (W23, Track A U23).
//
// A draft: after the editor's data changes, wait 1000 ms after the last change, then POST
// the WHOLE current data. One request at a time per editor: a newer one cancels the one in
// flight (AbortController), and only the newest answer is ever shown. The previous PDF stays
// until the new one arrives. A 409 shows the API's refusals, a 400 its messages, a 429 its
// sentence and one more try 5 seconds later; any other failure is "Could not load the
// preview." with a Retry. A filed return never calls the live route: it shows its clear copy
// through the existing Download clear copy requests. The 2316 has no preview yet: its
// sentence is asked for once and not again in the same page view.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createClearCopy,
  fetchBirFormExportUrl,
  fetchSignedPdf,
  previewBirFormLive,
  type BirFormExportRef,
} from "../../lib/api";
import { stable } from "../../lib/birPreview";
import {
  PREVIEW_DEBOUNCE_MS,
  PREVIEW_RETRY_429_MS,
  problemOf,
  type PreviewProblem,
} from "../../lib/livePreview";

export interface LivePreviewArgs {
  /** The pane is shown (hidden means no requests at all). */
  shown: boolean;
  form: string | undefined;
  /** The saved form's id; undefined for a draft never saved. */
  id: string | undefined;
  /** The saved form's status. */
  status: string | undefined;
  /** The editor's data is hydrated: never ask before this. */
  ready: boolean;
  /** The editor's WHOLE data object, exactly what PATCH sends. */
  data: Record<string, unknown> | null;
  /** The saved form's updatedAt: it changes after Save, which refreshes the preview once. */
  updatedAt: string | undefined;
  /** The saved form's exports (a filed return's clear copy is among them). */
  exports: BirFormExportRef[] | undefined;
}

export interface LivePreview {
  pdfUrl: string | null;
  problem: PreviewProblem | null;
  updating: boolean;
  retry: () => void;
}

export function useLivePreview(a: LivePreviewArgs): LivePreview {
  const { shown, form, id, status, ready, data, updatedAt } = a;
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<PreviewProblem | null>(null);
  const [updating, setUpdating] = useState(false);
  const [noPreview, setNoPreview] = useState(false);
  const [reload, setReload] = useState(0);

  const urlRef = useRef<string | null>(null);
  const seq = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKey = useRef<string | null>(null);
  const lastUpdated = useRef<string | undefined>(undefined);
  const dataRef = useRef(data);
  dataRef.current = data;
  const clearCopy = useRef<{ key: string; id: Promise<string> } | null>(null);
  const exportsRef = useRef(a.exports);
  exportsRef.current = a.exports;

  const show = useCallback((blob: Blob | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = blob ? URL.createObjectURL(blob) : null;
    setPdfUrl(urlRef.current);
  }, []);

  const cancel = useCallback(() => {
    seq.current += 1;
    abort.current?.abort();
    abort.current = null;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);

  const run = useCallback(
    async (isRetry: boolean) => {
      if (!id || !dataRef.current) return;
      const my = ++seq.current;
      abort.current?.abort();
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = null;
      const ac = new AbortController();
      abort.current = ac;
      setUpdating(true);
      try {
        const blob = await previewBirFormLive(id, dataRef.current, ac.signal);
        if (my !== seq.current) return;
        show(blob);
        setProblem(null);
      } catch (e) {
        if (my !== seq.current || ac.signal.aborted) return;
        const p = problemOf(e);
        show(null);
        setProblem(p);
        // The 2316 has no preview yet: do not ask again in this page view.
        if (form === "2316" && p.kind === "refused") setNoPreview(true);
        if (p.kind === "wait" && !isRetry) {
          retryTimer.current = setTimeout(() => void run(true), PREVIEW_RETRY_429_MS);
        }
      } finally {
        if (my === seq.current) setUpdating(false);
      }
    },
    [id, form, show],
  );

  // A draft: live.
  const live = shown && !!id && status === "draft" && ready && !!data && !noPreview;
  const key = live ? stable(data) : null;
  useEffect(() => {
    if (!live) return;
    if (key === lastKey.current && updatedAt === lastUpdated.current) return;
    // The first time (page opened, pane shown) and after Save: at once. An edit: debounced.
    const immediate = lastKey.current === null || updatedAt !== lastUpdated.current;
    const t = setTimeout(
      () => {
        lastKey.current = key;
        lastUpdated.current = updatedAt;
        void run(false);
      },
      immediate ? 0 : PREVIEW_DEBOUNCE_MS,
    );
    return () => clearTimeout(t);
  }, [live, key, updatedAt, run]);

  // Hidden, or no longer a live draft: nothing in flight, and the next show starts afresh.
  useEffect(() => {
    if (live) return;
    lastKey.current = null;
    lastUpdated.current = undefined;
    if (!(shown && status === "filed")) {
      cancel();
      setUpdating(false);
    }
  }, [live, shown, status, cancel]);

  // A filed return: its clear copy, through the existing requests, never the live route.
  const filedMode = shown && !!id && status === "filed";
  useEffect(() => {
    if (!filedMode || !id) return;
    const ac = new AbortController();
    const my = ++seq.current;
    abort.current?.abort();
    abort.current = ac;
    setUpdating(true);
    (async () => {
      try {
        // A clear copy already made is reused; otherwise make one, as the button does.
        const made = [...(exportsRef.current ?? [])]
          .reverse()
          .find((x) => x.kind === "pdf");
        // One clear copy per request, however many times React runs this effect (dev
        // StrictMode runs it twice): the second run waits for the first's copy.
        const flightKey = `${id}:${reload}`;
        if (!made && clearCopy.current?.key !== flightKey) {
          clearCopy.current = {
            key: flightKey,
            id: createClearCopy(id).then((x) => x.id),
          };
        }
        const exportId = made?.id ?? (await clearCopy.current!.id);
        const { url } = await fetchBirFormExportUrl(id, exportId);
        const blob = await fetchSignedPdf(url, ac.signal);
        if (ac.signal.aborted || my !== seq.current) return;
        show(blob);
        setProblem(null);
      } catch (e) {
        if (ac.signal.aborted || my !== seq.current) return;
        show(null);
        setProblem(problemOf(e));
      } finally {
        if (!ac.signal.aborted && my === seq.current) setUpdating(false);
      }
    })();
    return () => ac.abort();
  }, [filedMode, id, reload, show]);

  // Gone from the page: nothing in flight, nothing leaked.
  useEffect(
    () => () => {
      cancel();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    },
    [cancel],
  );

  const retry = useCallback(() => {
    if (status === "filed") setReload((n) => n + 1);
    else void run(false);
  }, [status, run]);

  return { pdfUrl, problem, updating, retry };
}

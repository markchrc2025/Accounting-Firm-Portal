// livePreview.ts — what the live Preview pane says and remembers (W23, Track A U23). The
// API renders the PDF and gives every refusal in a sentence; the web shows those as sent.
// These are the few sentences the web says itself, the timings, and the per-user choice
// to show or hide the pane (kept in localStorage, which may be missing or throw).

import { ApiError } from "./api";

/** After the last change in the editor, wait this long before asking for a new preview. */
export const PREVIEW_DEBOUNCE_MS = 1000;
/** A 429 is tried again once, after this long. */
export const PREVIEW_RETRY_429_MS = 5000;

export const SAVE_TO_PREVIEW = "Save the draft to see the preview.";
export const PREVIEW_FAILED = "Could not load the preview.";
export const PREVIEW_UPDATING = "Updating…";

/** What the pane shows in place of the PDF. */
export type PreviewProblem =
  | { kind: "refused"; lines: string[] }
  | { kind: "invalid"; lines: string[] }
  | { kind: "wait"; line: string }
  | { kind: "failed" };

/** The list a 409 gives (`refusals`, the first of which is also its message). */
export function refusalLines(e: ApiError): string[] {
  const r = (e.body as { refusals?: unknown } | undefined)?.refusals;
  const lines = Array.isArray(r)
    ? r.filter((x): x is string => typeof x === "string")
    : [];
  return lines.length > 0 ? lines : [e.message];
}

/** The messages of a 400 ("Validation failed" with `errors`), or its own sentence. */
export function validationLines(e: ApiError): string[] {
  const errs = (e.body as { errors?: unknown } | undefined)?.errors;
  if (Array.isArray(errs)) {
    const lines = errs
      .map((x) => (x as { message?: unknown } | null)?.message)
      .filter((m): m is string => typeof m === "string" && m !== "");
    if (lines.length > 0) return lines;
  }
  return [e.message];
}

/** How an error from the preview request reads in the pane. */
export function problemOf(e: unknown): PreviewProblem {
  if (e instanceof ApiError) {
    if (e.status === 409) return { kind: "refused", lines: refusalLines(e) };
    if (e.status === 400) return { kind: "invalid", lines: validationLines(e) };
    if (e.status === 429) return { kind: "wait", line: e.message };
    if (e.status === 403 || e.status === 404)
      return { kind: "refused", lines: [e.message] };
  }
  return { kind: "failed" };
}

// --- the per-user show / hide choice -------------------------------------------------

const keyFor = (userId: string | undefined) =>
  `portal:bir-preview-pane:${userId ?? "anon"}`;

/** Whether the pane is shown. Shown unless the user hid it; a storage that is missing or
 *  throws means "shown". */
export function readPaneShown(userId: string | undefined): boolean {
  try {
    return window.localStorage.getItem(keyFor(userId)) !== "hidden";
  } catch {
    return true;
  }
}

export function writePaneShown(userId: string | undefined, shown: boolean): void {
  try {
    window.localStorage.setItem(keyFor(userId), shown ? "shown" : "hidden");
  } catch {
    /* the pane works without it */
  }
}

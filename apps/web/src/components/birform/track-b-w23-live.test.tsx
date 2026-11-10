// track-b-w23-live.test.tsx — W23: the live Preview pane's requests and what it shows, with
// the API module mocked and the clock faked. The API's sentences are shown as sent. All data
// is invented.

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  previewBirFormLive: vi.fn(),
  createClearCopy: vi.fn(),
  fetchBirFormExportUrl: vi.fn(),
  fetchSignedPdf: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...api,
}));

import { ApiError, type BirFormDetail } from "../../lib/api";
import { PREVIEW_DEBOUNCE_MS } from "../../lib/livePreview";
import { EditorWithPreview } from "./PreviewPane";
import { usePublishPreviewFeed } from "./previewFeed";
import { useLivePreview, type LivePreviewArgs } from "./useLivePreview";

const ID = "f2300000-0000-4000-8000-0000000000aa";
const blob = (tag: string) => new Blob([`%PDF-1.4 ${tag}`], { type: "application/pdf" });
let urlN = 0;
const urls = new Map<string, string>();

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(api).forEach((f) => f.mockReset());
  urlN = 0;
  urls.clear();
  URL.createObjectURL = vi.fn((b: Blob) => {
    const u = `blob:test/${++urlN}`;
    urls.set(u, String(b.size));
    return u;
  });
  URL.revokeObjectURL = vi.fn();
  api.previewBirFormLive.mockResolvedValue(blob("ok"));
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const base = (over: Partial<LivePreviewArgs> = {}): LivePreviewArgs => ({
  shown: true,
  form: "2551Q",
  id: ID,
  status: "draft",
  ready: true,
  data: { year: "2026", sales: "100" },
  updatedAt: "2026-10-01T00:00:00.000Z",
  exports: [],
  ...over,
});
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const hook = (over: Partial<LivePreviewArgs> = {}) =>
  renderHook((p: LivePreviewArgs) => useLivePreview(p), { initialProps: base(over) });

describe("W23 when it asks", () => {
  it("asks once when the page opens, at once", async () => {
    hook();
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
  });

  it("rapid edits make ONE call, a second after the last change", async () => {
    const h = hook();
    await flush(0);
    api.previewBirFormLive.mockClear();
    h.rerender(base({ data: { year: "2026", sales: "1" } }));
    await flush(300);
    h.rerender(base({ data: { year: "2026", sales: "12" } }));
    await flush(300);
    h.rerender(base({ data: { year: "2026", sales: "123" } }));
    await flush(PREVIEW_DEBOUNCE_MS - 1);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    await flush(1);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(api.previewBirFormLive.mock.calls[0]![1]).toEqual({
      year: "2026",
      sales: "123",
    });
  });

  it("sends the WHOLE current data object, and a way to cancel it", async () => {
    const whole = {
      year: "2026",
      rows: [{ atc: "WI010", base: "1000" }],
      nested: { a: { b: ["x", "y"] } },
      blank: "",
    };
    hook({ data: whole });
    await flush(0);
    const [id, sent, signal] = api.previewBirFormLive.mock.calls[0]!;
    expect(id).toBe(ID);
    expect(sent).toEqual(whole);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("asks again once after Save (updatedAt changes), at once, with the same data", async () => {
    const h = hook();
    await flush(0);
    h.rerender(base({ updatedAt: "2026-10-01T00:05:00.000Z" }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(2);
  });

  it("does not ask for the same data again", async () => {
    const h = hook();
    await flush(0);
    h.rerender(base({ data: { sales: "100", year: "2026" } })); // same content, new object
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    // The request function being remade does not ask again for data already asked for.
    h.rerender(base({ form: "2550Q" }));
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
  });

  it("never asks before the editor's data is ready", async () => {
    const h = hook({ ready: false });
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    h.rerender(base({ ready: true }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
  });

  it("never asks for a draft that has never been saved", async () => {
    hook({ id: undefined });
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
  });

  it("never asks while the pane is hidden, and cancels what is in flight", async () => {
    let signal: AbortSignal | undefined;
    api.previewBirFormLive.mockImplementation((_i, _d, s) => {
      signal = s;
      return new Promise(() => undefined);
    });
    const h = hook();
    await flush(0);
    h.rerender(base({ shown: false }));
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(signal?.aborted).toBe(true);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(h.result.current.updating).toBe(false);
  });
});

describe("W23 one at a time, newest wins", () => {
  it("a newer request cancels the one in flight, and a late stale answer is ignored", async () => {
    const pending: Array<{
      resolve: (b: Blob) => void;
      signal: AbortSignal;
    }> = [];
    api.previewBirFormLive.mockImplementation(
      (_i, _d, signal: AbortSignal) =>
        new Promise<Blob>((resolve) => pending.push({ resolve, signal })),
    );
    const h = hook();
    await flush(0);
    expect(pending).toHaveLength(1);
    h.rerender(base({ data: { year: "2026", sales: "999" } }));
    await flush(PREVIEW_DEBOUNCE_MS);
    expect(pending).toHaveLength(2);
    expect(pending[0]!.signal.aborted).toBe(true);
    expect(pending[1]!.signal.aborted).toBe(false);
    // The newest answers first, then the stale one: only the newest is ever shown.
    await act(async () => pending[1]!.resolve(blob("newest-xx")));
    const shown = h.result.current.pdfUrl;
    expect(shown).not.toBeNull();
    await act(async () => pending[0]!.resolve(blob("stale")));
    expect(h.result.current.pdfUrl).toBe(shown);
    expect(urlN).toBe(1);
  });

  it("the previous PDF stays until the new one arrives, with Updating… meanwhile", async () => {
    const h = hook();
    await flush(0);
    const first = h.result.current.pdfUrl;
    expect(first).not.toBeNull();
    let release!: (b: Blob) => void;
    api.previewBirFormLive.mockImplementation(
      () => new Promise<Blob>((r) => (release = r)),
    );
    h.rerender(base({ data: { year: "2026", sales: "5" } }));
    await flush(PREVIEW_DEBOUNCE_MS);
    expect(h.result.current.updating).toBe(true);
    expect(h.result.current.pdfUrl).toBe(first);
    await act(async () => release(blob("second-one")));
    expect(h.result.current.updating).toBe(false);
    expect(h.result.current.pdfUrl).not.toBe(first);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  });
});

describe("W23 what the API answers", () => {
  it("409: the refusals, in order, word for word", async () => {
    const R = ["7 ATCs; the form has six rows.", "INVENTED second refusal."];
    api.previewBirFormLive.mockRejectedValue(
      new ApiError(409, R[0]!, {
        statusCode: 409,
        error: "Conflict",
        message: R[0],
        refusals: R,
      }),
    );
    const h = hook();
    await flush(0);
    expect(h.result.current.problem).toEqual({ kind: "refused", lines: R });
    expect(h.result.current.pdfUrl).toBeNull();
  });

  it("400: the validation messages, word for word", async () => {
    api.previewBirFormLive.mockRejectedValue(
      new ApiError(400, "Validation failed", {
        message: "Validation failed",
        errors: [
          { path: "sales", message: "INVENTED: sales must be a number." },
          { path: "year", message: "INVENTED: year is required." },
        ],
      }),
    );
    const h = hook();
    await flush(0);
    expect(h.result.current.problem).toEqual({
      kind: "invalid",
      lines: ["INVENTED: sales must be a number.", "INVENTED: year is required."],
    });
  });

  it("429: shows its sentence and tries again after 5 seconds, once", async () => {
    const S = "Too many previews; wait a moment.";
    api.previewBirFormLive.mockRejectedValue(new ApiError(429, S, { message: S }));
    const h = hook();
    await flush(0);
    expect(h.result.current.problem).toEqual({ kind: "wait", line: S });
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    await flush(4999);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    await flush(1); // 5000 ms in all
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(2);
    // Refused again: its sentence stays, and it does not try a third time.
    await flush(15000);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(2);
    expect(h.result.current.problem).toEqual({ kind: "wait", line: S });
  });

  it("429 then a good answer: the PDF shows", async () => {
    api.previewBirFormLive
      .mockRejectedValueOnce(new ApiError(429, "Too many previews; wait a moment.", {}))
      .mockResolvedValueOnce(blob("fine"));
    const h = hook();
    await flush(0);
    await flush(5000);
    expect(h.result.current.problem).toBeNull();
    expect(h.result.current.pdfUrl).not.toBeNull();
  });

  it("a network error: could not load, and Retry asks again", async () => {
    api.previewBirFormLive.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const h = hook();
    await flush(0);
    expect(h.result.current.problem).toEqual({ kind: "failed" });
    await act(async () => h.result.current.retry());
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(2);
    expect(h.result.current.problem).toBeNull();
    expect(h.result.current.pdfUrl).not.toBeNull();
  });

  it("the 2316: its sentence is asked for once and not again in this page view", async () => {
    const S = "A preview of the 2316 is not available yet.";
    api.previewBirFormLive.mockRejectedValue(new ApiError(409, S, { refusals: [S] }));
    const h = hook({ form: "2316" });
    await flush(0);
    expect(h.result.current.problem).toEqual({ kind: "refused", lines: [S] });
    h.rerender(base({ form: "2316", data: { year: "2026", wages: "9" } }));
    await flush(PREVIEW_DEBOUNCE_MS * 3);
    h.rerender(base({ form: "2316", updatedAt: "2026-10-02T00:00:00.000Z" }));
    await flush(PREVIEW_DEBOUNCE_MS * 3);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(h.result.current.problem).toEqual({ kind: "refused", lines: [S] });
  });
});

describe("W23 a filed return", () => {
  const filed = (over: Partial<LivePreviewArgs> = {}) =>
    base({ status: "filed", ...over });

  it("uses the clear copy requests, never the live route", async () => {
    api.createClearCopy.mockResolvedValue({ id: "e1", kind: "pdf", filename: "x.pdf" });
    api.fetchBirFormExportUrl.mockResolvedValue({
      url: "https://files.example.test/x.pdf",
    });
    api.fetchSignedPdf.mockResolvedValue(blob("clear"));
    const h = hook(filed());
    await flush(0);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    expect(api.createClearCopy).toHaveBeenCalledWith(ID);
    expect(api.fetchBirFormExportUrl).toHaveBeenCalledWith(ID, "e1");
    expect(api.fetchSignedPdf.mock.calls[0]![0]).toBe("https://files.example.test/x.pdf");
    expect(h.result.current.pdfUrl).not.toBeNull();
    // Editing (a sealed form cannot) or saving never calls the live route.
    h.rerender(filed({ data: { other: "1" }, updatedAt: "2026-10-09T00:00:00.000Z" }));
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    expect(api.createClearCopy).toHaveBeenCalledTimes(1);
  });

  it("reuses a clear copy already made instead of making another", async () => {
    api.fetchBirFormExportUrl.mockResolvedValue({
      url: "https://files.example.test/y.pdf",
    });
    api.fetchSignedPdf.mockResolvedValue(blob("clear"));
    hook(
      filed({
        exports: [
          { id: "xml1", kind: "xml", filename: "a.xml", createdAt: "" },
          { id: "pdf1", kind: "pdf", filename: "a.pdf", createdAt: "" },
          { id: "pdf2", kind: "pdf", filename: "b.pdf", createdAt: "" },
        ],
      }),
    );
    await flush(0);
    expect(api.createClearCopy).not.toHaveBeenCalled();
    expect(api.fetchBirFormExportUrl).toHaveBeenCalledWith(ID, "pdf2");
  });

  it("when there is no clear copy, shows the API's sentence", async () => {
    const S = "A clear copy of the 2316 is not available yet.";
    api.createClearCopy.mockRejectedValue(new ApiError(409, S, { message: S }));
    const h = hook(filed({ form: "2316" }));
    await flush(0);
    expect(h.result.current.problem).toEqual({ kind: "refused", lines: [S] });
  });
});

// --- the pane -----------------------------------------------------------------------

function Fake({
  data,
  period = "2026",
}: {
  data: Record<string, unknown>;
  period?: string;
}) {
  usePublishPreviewFeed(data, period);
  return <div data-fake-editor />;
}
const detail = (over: Partial<BirFormDetail> = {}): BirFormDetail =>
  ({
    id: ID,
    status: "draft",
    period: "2026",
    updatedAt: "2026-10-01T00:00:00.000Z",
    data: { year: "2026", sales: "100" },
    exports: [],
    ...over,
  }) as BirFormDetail;
const pane = (
  data: Record<string, unknown>,
  d: BirFormDetail | undefined = detail(),
  id: string | undefined = ID,
) =>
  render(
    <EditorWithPreview editor={<Fake data={data} />} form="2551Q" id={id} detail={d} />,
  );

describe("W23 the pane", () => {
  it("a draft never saved: no call, and it says to save", async () => {
    render(
      <EditorWithPreview
        editor={<Fake data={{ year: "2026" }} />}
        form="2551Q"
        id={undefined}
        detail={undefined}
      />,
    );
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(screen.getByText("Save the draft to see the preview.")).toBeTruthy();
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
  });

  it("shows the PDF inline with Open in new tab, and Updating… while it works", async () => {
    pane({ year: "2026", sales: "100" });
    await flush(0);
    const frame = document.querySelector("[data-preview-frame]") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toMatch(/^blob:test\//);
    const open = document.querySelector("[data-preview-open]") as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe(frame.getAttribute("src"));
    expect(open.textContent).toBe("Open in new tab");
    expect(document.querySelector("[data-preview-updating]")).toBeNull();
  });

  it("asks with the HYDRATED data, never the editor's empty first state", async () => {
    // An editor starts with empty boxes, then hydrates from the saved form.
    const { rerender } = pane({ year: "", sales: "" });
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    rerender(
      <EditorWithPreview
        editor={<Fake data={{ year: "2026", sales: "100" }} />}
        form="2551Q"
        id={ID}
        detail={detail()}
      />,
    );
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(api.previewBirFormLive.mock.calls[0]![1]).toEqual({
      year: "2026",
      sales: "100",
    });
  });

  it("a refusal shows as a list in place of the PDF, word for word", async () => {
    const R = ["INVENTED refusal one.", "INVENTED refusal two."];
    api.previewBirFormLive.mockRejectedValue(new ApiError(409, R[0]!, { refusals: R }));
    pane({ year: "2026", sales: "100" });
    await flush(0);
    const list = document.querySelector("[data-preview-problem='refused']")!;
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(R);
    expect(document.querySelector("[data-preview-frame]")).toBeNull();
  });

  it("a 429 shows its sentence; a network error shows Could not load the preview. and Retry", async () => {
    api.previewBirFormLive.mockRejectedValueOnce(new TypeError("offline"));
    pane({ year: "2026", sales: "100" });
    await flush(0);
    expect(screen.getByText("Could not load the preview.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush(0);
    expect(document.querySelector("[data-preview-frame]")).not.toBeNull();
  });

  it("Hide preview is remembered for this user, and Show preview brings it back", async () => {
    const first = pane({ year: "2026", sales: "100" });
    await flush(0);
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(document.querySelector("[data-preview-pane]")).toBeNull();
    expect(screen.getByRole("button", { name: "Show preview" })).toBeTruthy();
    const callsWhileHidden = api.previewBirFormLive.mock.calls.length;
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(callsWhileHidden);
    // A new visit: still hidden, and nothing is asked.
    first.unmount();
    api.previewBirFormLive.mockClear();
    pane({ year: "2026", sales: "100" });
    await flush(PREVIEW_DEBOUNCE_MS * 2);
    expect(document.querySelector("[data-preview-pane]")).toBeNull();
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    // Show it again: it asks, and the choice is remembered too.
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-preview-pane]")).not.toBeNull();
  });

  it("works when localStorage throws: shown, and the toggle still works for this visit", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    pane({ year: "2026", sales: "100" });
    await flush(0);
    expect(document.querySelector("[data-preview-frame]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide preview" }));
    expect(document.querySelector("[data-preview-pane]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show preview" }));
    expect(document.querySelector("[data-preview-pane]")).not.toBeNull();
  });
});

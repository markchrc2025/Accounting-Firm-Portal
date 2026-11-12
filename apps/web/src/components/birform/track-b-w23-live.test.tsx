// track-b-w23-live.test.tsx - W23, rewritten for W25: the Preview tab's requests and what it
// shows, and the Form details | Preview tabs of the shared editor page, with the API module
// mocked and the clock faked. The API's sentences are shown as sent. All data is invented.

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
import { EditorWithPreview } from "./PreviewPane";
import { usePublishPreviewFeed, usePublishSaveAction } from "./previewFeed";
import { PageHeader } from "../ui";
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
  active: true,
  form: "2551Q",
  id: ID,
  status: "draft",
  ready: true,
  data: { year: "2026", sales: "100" },
  exports: [],
  ...over,
});
const LONG = 5000; // far longer than any wait the old pane had
const flush = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const hook = (over: Partial<LivePreviewArgs> = {}) =>
  renderHook((p: LivePreviewArgs) => useLivePreview(p), { initialProps: base(over) });

describe("W25 when it asks", () => {
  it("asks nothing while Form details is shown", async () => {
    hook({ active: false });
    await flush(LONG);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
  });

  it("opening Preview asks ONCE, at once", async () => {
    const h = hook({ active: false });
    await flush(LONG);
    h.rerender(base({ active: true }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
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

  it("edits while Form details is shown ask nothing, keystroke by keystroke or after", async () => {
    const h = hook({ active: false });
    for (const sales of ["1", "12", "123"]) {
      h.rerender(base({ active: false, data: { year: "2026", sales } }));
      await flush(300);
    }
    await flush(LONG);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    h.rerender(base({ active: true, data: { year: "2026", sales: "123" } }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(api.previewBirFormLive.mock.calls[0]![1]).toEqual({
      year: "2026",
      sales: "123",
    });
  });

  it("reopening Preview with no change asks nothing and keeps the last PDF", async () => {
    const h = hook();
    await flush(0);
    const first = h.result.current.pdfUrl;
    h.rerender(base({ active: false }));
    await flush(LONG);
    h.rerender(base({ active: true, data: { sales: "100", year: "2026" } })); // same content
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(h.result.current.pdfUrl).toBe(first);
    // The request function being remade does not ask again for data already asked for.
    h.rerender(base({ form: "2550Q" }));
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
  });

  it("reopening Preview after a change asks once more, with the new data", async () => {
    const h = hook();
    await flush(0);
    h.rerender(base({ active: false }));
    h.rerender(base({ active: false, data: { year: "2026", sales: "7" } }));
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    h.rerender(base({ active: true, data: { year: "2026", sales: "7" } }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(2);
    expect(api.previewBirFormLive.mock.calls[1]![1]).toEqual({
      year: "2026",
      sales: "7",
    });
  });

  it("never asks before the editor's data is ready", async () => {
    const h = hook({ ready: false });
    await flush(LONG);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    h.rerender(base({ ready: true }));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
  });

  it("never asks for a draft that has never been saved", async () => {
    hook({ id: undefined });
    await flush(LONG);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
  });

  it("closing Preview while it works lets the answer land; the next opening asks nothing new", async () => {
    let release!: (b: Blob) => void;
    api.previewBirFormLive.mockImplementation(
      () => new Promise<Blob>((r) => (release = r)),
    );
    const h = hook();
    await flush(0);
    h.rerender(base({ active: false }));
    await act(async () => release(blob("landed")));
    expect(h.result.current.pdfUrl).not.toBeNull();
    h.rerender(base({ active: true }));
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
  });
});

describe("W25 one at a time, newest wins", () => {
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
    await flush(0);
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
    await flush(0);
    expect(h.result.current.updating).toBe(true);
    expect(h.result.current.pdfUrl).toBe(first);
    await act(async () => release(blob("second-one")));
    expect(h.result.current.updating).toBe(false);
    expect(h.result.current.pdfUrl).not.toBe(first);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
  });
});

describe("W25 what the API answers", () => {
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
    await flush(LONG);
    h.rerender(base({ form: "2316", active: false }));
    h.rerender(base({ form: "2316", active: true, data: { year: "2026", wages: "10" } }));
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    expect(h.result.current.problem).toEqual({ kind: "refused", lines: [S] });
  });
});

describe("W25 a filed return", () => {
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
    // Editing (a sealed form cannot) never calls the live route; closing and opening Preview
    // again shows the same clear copy without asking again.
    h.rerender(filed({ data: { other: "1" } }));
    h.rerender(filed({ active: false }));
    h.rerender(filed({ active: true }));
    await flush(LONG);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    expect(api.createClearCopy).toHaveBeenCalledTimes(1);
    expect(api.fetchSignedPdf).toHaveBeenCalledTimes(1);
  });

  it("asks for nothing while Form details is shown", async () => {
    hook(filed({ active: false }));
    await flush(LONG);
    expect(api.createClearCopy).not.toHaveBeenCalled();
    expect(api.fetchSignedPdf).not.toHaveBeenCalled();
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

// --- the tabs ------------------------------------------------------------------------

const save = vi.fn();
/** An editor as the twelve are built: its own PageHeader, then its form. */
function Fake({
  data,
  period = "2026",
  isNew = false,
  filed = false,
}: {
  data: Record<string, unknown>;
  period?: string;
  isNew?: boolean;
  filed?: boolean;
}) {
  usePublishPreviewFeed(data, period);
  usePublishSaveAction({
    label: isNew ? "Save draft" : "Save changes",
    disabled: false,
    pending: false,
    hidden: filed,
    run: save,
  });
  return (
    <div className="animate-fade-rise">
      <PageHeader title="2551Q" eyebrow="BIR Forms · Quarterly Percentage Tax" />
      <div data-fake-editor>
        <input aria-label="Sales" defaultValue="" />
        <button type="button">Save changes</button>
      </div>
    </div>
  );
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
const page = (
  data: Record<string, unknown>,
  d: BirFormDetail | undefined = detail(),
  id: string | null = ID,
  below?: React.ReactNode,
) =>
  render(
    <EditorWithPreview
      editor={<Fake data={data} isNew={!id} filed={d?.status === "filed"} />}
      form="2551Q"
      id={id ?? undefined}
      detail={d}
      below={below}
    />,
  );
const tab = (name: string) => screen.getByRole("tab", { name });
const editorShown = () => {
  const el = document.querySelector("[data-fake-editor]") as HTMLElement;
  return getComputedStyle(el).display !== "none";
};

describe("W25 the Form details | Preview tabs", () => {
  beforeEach(() => save.mockReset());

  it("sit directly under the page title; Form details is chosen and nothing is asked", async () => {
    page({ year: "2026", sales: "100" });
    await flush(LONG);
    const h1 = screen.getByRole("heading", { level: 1, name: "2551Q" });
    const list = screen.getByRole("tablist", { name: "Form" });
    // the title, then the tabs, then the form
    expect(
      h1.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const form = document.querySelector("[data-fake-editor]")!;
    expect(
      list.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([
      "Form details",
      "Preview",
    ]);
    expect(tab("Form details").getAttribute("aria-selected")).toBe("true");
    expect(tab("Preview").getAttribute("aria-selected")).toBe("false");
    expect(editorShown()).toBe(true);
    expect(document.querySelector("[data-preview-pane]")).toBeNull();
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
  });

  it("Preview: one request, the PDF inline and tall, Open in new tab; the form is hidden, not gone", async () => {
    page({ year: "2026", sales: "100" });
    fireEvent.change(screen.getByLabelText("Sales"), { target: { value: "typed" } });
    fireEvent.click(tab("Preview"));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("Preview").id);
    const frame = panel.querySelector("[data-preview-frame]") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toMatch(/^blob:test\//);
    const open = panel.querySelector("[data-preview-open]") as HTMLAnchorElement;
    expect(open.getAttribute("href")).toBe(frame.getAttribute("src"));
    expect(open.textContent).toBe("Open in new tab");
    const pane = panel.querySelector("[data-preview-pane]") as HTMLElement;
    expect(pane.style.minHeight).toBe("600px");
    expect(parseInt(pane.style.height, 10)).toBeGreaterThanOrEqual(600);
    // a short window: the PDF area stays 600 px tall
    const tall = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(pane.style.height).toBe("600px");
    Object.defineProperty(window, "innerHeight", { value: tall, configurable: true });
    // the form is still there, only hidden; what was typed is kept
    expect(editorShown()).toBe(false);
    fireEvent.click(tab("Form details"));
    expect(editorShown()).toBe(true);
    expect((screen.getByLabelText("Sales") as HTMLInputElement).value).toBe("typed");
    expect(document.querySelector("[data-preview-pane]")).toBeNull();
  });

  it("back to Form details and Preview again: no new request without a change, one after a change", async () => {
    const { rerender } = page({ year: "2026", sales: "100" });
    fireEvent.click(tab("Preview"));
    await flush(0);
    fireEvent.click(tab("Form details"));
    fireEvent.click(tab("Preview"));
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1);
    fireEvent.click(tab("Form details"));
    rerender(
      <EditorWithPreview
        editor={<Fake data={{ year: "2026", sales: "250" }} />}
        form="2551Q"
        id={ID}
        detail={detail()}
      />,
    );
    await flush(LONG);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(1); // nothing while typing
    fireEvent.click(tab("Preview"));
    await flush(0);
    expect(api.previewBirFormLive).toHaveBeenCalledTimes(2);
    expect(api.previewBirFormLive.mock.calls[1]![1]).toEqual({
      year: "2026",
      sales: "250",
    });
  });

  it("the arrow keys, Home and End move between the tabs", async () => {
    page({ year: "2026", sales: "100" });
    tab("Form details").focus();
    fireEvent.keyDown(tab("Form details"), { key: "ArrowRight" });
    expect(tab("Preview").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("Preview"));
    fireEvent.keyDown(tab("Preview"), { key: "ArrowRight" }); // wraps
    expect(tab("Form details").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Form details"), { key: "ArrowLeft" });
    expect(tab("Preview").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Preview"), { key: "Home" });
    expect(tab("Form details").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tab("Form details"), { key: "End" });
    expect(tab("Preview").getAttribute("aria-selected")).toBe("true");
    expect(tab("Preview").tabIndex).toBe(0);
    expect(tab("Form details").tabIndex).toBe(-1);
  });

  it("the Preview tab offers the editor's own Save button, and it saves", async () => {
    page({ year: "2026", sales: "100" });
    fireEvent.click(tab("Preview"));
    await flush(0);
    const btn = screen
      .getByRole("tabpanel")
      .querySelector("[data-preview-save]") as HTMLButtonElement;
    expect(btn.textContent).toBe("Save changes");
    fireEvent.click(btn);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a draft never saved: no call; it says to save, and offers Save draft", async () => {
    page({ year: "2026" }, undefined, null);
    fireEvent.click(tab("Preview"));
    await flush(LONG);
    expect(screen.getByText("Save the draft to see the preview.")).toBeTruthy();
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("tabpanel").querySelector("[data-preview-save]") as HTMLElement)
        .textContent,
    ).toBe("Save draft");
  });

  it("a filed return: its clear copy, and no Save button", async () => {
    api.createClearCopy.mockResolvedValue({ id: "e1", kind: "pdf", filename: "x.pdf" });
    api.fetchBirFormExportUrl.mockResolvedValue({
      url: "https://files.example.test/x.pdf",
    });
    api.fetchSignedPdf.mockResolvedValue(blob("clear"));
    page({ year: "2026", sales: "100" }, detail({ status: "filed" }));
    await flush(LONG);
    expect(api.fetchSignedPdf).not.toHaveBeenCalled(); // not until Preview opens
    fireEvent.click(tab("Preview"));
    await flush(0);
    expect(api.previewBirFormLive).not.toHaveBeenCalled();
    expect(document.querySelector("[data-preview-frame]")).not.toBeNull();
    expect(document.querySelector("[data-preview-save]")).toBeNull();
  });

  it("asks with the HYDRATED data, never the editor's empty first state", async () => {
    // An editor starts with empty boxes, then hydrates from the saved form.
    const { rerender } = page({ year: "", sales: "" });
    fireEvent.click(tab("Preview"));
    await flush(LONG);
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
    page({ year: "2026", sales: "100" });
    fireEvent.click(tab("Preview"));
    await flush(0);
    const list = document.querySelector("[data-preview-problem='refused']")!;
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(R);
    expect(document.querySelector("[data-preview-frame]")).toBeNull();
  });

  it("a network error shows Could not load the preview. and Retry asks again", async () => {
    api.previewBirFormLive.mockRejectedValueOnce(new TypeError("offline"));
    page({ year: "2026", sales: "100" });
    fireEvent.click(tab("Preview"));
    await flush(0);
    expect(screen.getByText("Could not load the preview.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await flush(0);
    expect(document.querySelector("[data-preview-frame]")).not.toBeNull();
  });

  it("what follows the form (the filings taken back) is on Form details only", async () => {
    page({ year: "2026", sales: "100" }, detail(), ID, <div data-below>History</div>);
    const below = document.querySelector("[data-below]")!.parentElement as HTMLElement;
    expect(below.hidden).toBe(false);
    fireEvent.click(tab("Preview"));
    expect(below.hidden).toBe(true);
  });

  it("the old side pane is gone: no Show or Hide preview, nothing remembered", async () => {
    page({ year: "2026", sales: "100" });
    await flush(0);
    expect(
      screen.queryByRole("button", { name: /Hide preview|Show preview/ }),
    ).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});

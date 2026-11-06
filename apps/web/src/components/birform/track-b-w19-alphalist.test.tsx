// track-b-w19-alphalist.test.tsx — W19: the 1601-EQ's alphalist panel and the alphalist
// step of Mark as filed, with the API module mocked. The web shows the API's sentences
// word for word and works out nothing. All data is invented.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchAlphalistCheck: vi.fn(),
  downloadAlphalist: vi.fn(),
  checkConfirmation: vi.fn(),
  markBirFormFiled: vi.fn(),
  fetchUsers: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...api,
}));
vi.mock("../../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ hasPermission: () => false }),
}));
const dl = vi.hoisted(() => ({ downloadBlob: vi.fn(), downloadFromUrl: vi.fn() }));
vi.mock("../../lib/download", () => dl);

import { ApiError, type AlphalistCheck, type BirFormDetail } from "../../lib/api";
import { AlphalistPanel, AlphalistWarning } from "./AlphalistPanel";
import { ConfirmationDialog } from "./BirConfirmation";
import { VALIDATE_NOTE } from "../../lib/alphalist";

const FORM_ID = "f1900000-0000-4000-8000-0000000000aa";
const FILE = "11122233300000920261601EQ.DAT";

const detail = (over: Partial<BirFormDetail> = {}): BirFormDetail =>
  ({
    id: FORM_ID,
    clientId: "c1",
    clientName: "INVENTED NINETEEN CO",
    form: "1601EQ",
    status: "draft",
    period: "2026-Q3",
    filedAt: null,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    data: {},
    computed: null,
    exports: [],
    confirmationRequired: false,
    confirmation: null,
    ...over,
  }) as BirFormDetail;

const check = (over: Partial<AlphalistCheck> = {}): AlphalistCheck => ({
  ok: true,
  source: "books",
  fileName: FILE,
  refusals: [],
  notes: [],
  schedule1: { rows: 3, income: "120000.00", tax: "2400.00" },
  schedule2: { rows: 0, income: "0.00" },
  returnTotal: "2650.00",
  ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const panel = (d = detail()) => wrap(<AlphalistPanel detail={d} />);
const downloadBtn = () =>
  screen.getByRole("button", { name: "Download alphalist (.DAT)" }) as HTMLButtonElement;

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(() => {
  cleanup();
  dl.downloadBlob.mockReset();
});

describe("W19 alphalist panel", () => {
  it("ok: Schedule 1 rows, income and tax; Item 19; the download is enabled; the validate note is under it", async () => {
    api.fetchAlphalistCheck.mockResolvedValue(check());
    panel();
    await screen.findByText(/3 rows/);
    expect(document.querySelector("[data-schedule1]")!.textContent).toBe(
      "3 rows · income ₱120,000.00 · tax ₱2,400.00",
    );
    expect(document.querySelector("[data-item19]")!.textContent).toBe("₱2,650.00");
    expect(downloadBtn().disabled).toBe(false);
    expect(document.querySelector("[data-validate-note]")!.textContent).toBe(
      VALIDATE_NOTE,
    );
    expect(VALIDATE_NOTE).toBe(
      "Before eSubmission, open this file in the BIR Alphalist Validation program and validate it. Submit the validated file, not this one.",
    );
    expect(document.querySelector("[data-schedule2]")).toBeNull();
    expect(document.querySelector("[data-alphalist-refusals]")).toBeNull();
  });

  it("not ok: every refusal word for word as a list, the button disabled, the note still there", async () => {
    const R = [
      "INVENTED REFUSAL ONE: payee 3 has no last name.",
      "INVENTED REFUSAL TWO: payee 5 TIN is not 9 digits.",
      "INVENTED REFUSAL THREE: the client has no RDO.",
    ];
    api.fetchAlphalistCheck.mockResolvedValue(
      check({ ok: false, fileName: null, refusals: R }),
    );
    panel();
    const list = await waitFor(() => {
      const el = document.querySelector("[data-alphalist-refusals]");
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(R);
    expect(downloadBtn().disabled).toBe(true);
    expect(document.querySelector("[data-validate-note]")).not.toBeNull();
  });

  it("Schedule 2 is hidden at 0 rows and shown, with rows and income only, when it has rows", async () => {
    api.fetchAlphalistCheck.mockResolvedValue(
      check({ schedule2: { rows: 2, income: "5000.00" } }),
    );
    panel();
    const s2 = await waitFor(() => {
      const el = document.querySelector("[data-schedule2]");
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(s2.textContent).toBe("2 rows · income ₱5,000.00");
  });

  it("shows every note", async () => {
    const N = ["INVENTED NOTE A", "INVENTED NOTE B"];
    api.fetchAlphalistCheck.mockResolvedValue(check({ notes: N }));
    panel();
    const list = await waitFor(() => {
      const el = document.querySelector("[data-alphalist-notes]");
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(N);
  });

  it("Refresh asks the check again", async () => {
    api.fetchAlphalistCheck.mockResolvedValue(check());
    panel();
    await screen.findByText(/3 rows/);
    expect(api.fetchAlphalistCheck).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.fetchAlphalistCheck).toHaveBeenCalledTimes(2));
  });

  it("downloads with the session and saves under the name the API gave, exactly", async () => {
    const blob = new Blob(["x"]);
    api.fetchAlphalistCheck.mockResolvedValue(check());
    api.downloadAlphalist.mockResolvedValue(blob);
    panel();
    await screen.findByText(/3 rows/);
    fireEvent.click(downloadBtn());
    await waitFor(() => expect(dl.downloadBlob).toHaveBeenCalledWith(blob, FILE));
    expect(api.downloadAlphalist).toHaveBeenCalledWith(FORM_ID);
  });

  it("a 409 on the download shows its sentence and refusals", async () => {
    api.fetchAlphalistCheck.mockResolvedValue(check());
    const e = new ApiError(409, "The alphalist cannot be made.", {
      refusals: ["INVENTED R1", "INVENTED R2"],
    });
    api.downloadAlphalist.mockRejectedValue(e);
    panel();
    await screen.findByText(/3 rows/);
    fireEvent.click(downloadBtn());
    const box = await waitFor(() => {
      const el = document.querySelector("[data-alphalist-download-error]");
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(box.textContent).toContain("The alphalist cannot be made.");
    expect(box.textContent).toContain("INVENTED R2");
    expect(dl.downloadBlob).not.toHaveBeenCalled();
  });

  it("a filed return with source none: the refusal, and no button", async () => {
    const R = "INVENTED: this return was filed without an alphalist.";
    api.fetchAlphalistCheck.mockResolvedValue(
      check({ ok: false, source: "none", fileName: null, refusals: [R] }),
    );
    panel(detail({ status: "filed", filedAt: "2026-10-30T00:00:00.000Z" }));
    await screen.findByText(R);
    expect(
      screen.queryByRole("button", { name: "Download alphalist (.DAT)" }),
    ).toBeNull();
  });

  it("a filed return with a stored alphalist: the same panel with the download", async () => {
    api.fetchAlphalistCheck.mockResolvedValue(check({ source: "stored" }));
    panel(detail({ status: "filed", filedAt: "2026-10-30T00:00:00.000Z" }));
    await screen.findByText(/3 rows/);
    expect(downloadBtn().disabled).toBe(false);
  });
});

describe("W19 after filing: the warning", () => {
  it("shows the API's message and refusals word for word", () => {
    const message =
      "The alphalist could not be made when this return was filed, so none was stored. A filed return's alphalist cannot be made later.";
    render(
      <AlphalistWarning
        detail={detail({
          alphalist: {
            stored: false,
            warning: { message, refusals: ["INVENTED W1", "INVENTED W2"] },
          },
        })}
      />,
    );
    const w = document.querySelector("[data-alphalist-warning]")!;
    expect(w.querySelector("p")!.textContent).toBe(message);
    expect([...w.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "INVENTED W1",
      "INVENTED W2",
    ]);
  });

  it("shows nothing without a warning", () => {
    render(
      <AlphalistWarning
        detail={detail({ alphalist: { stored: true, warning: null } })}
      />,
    );
    expect(document.querySelector("[data-alphalist-warning]")).toBeNull();
  });
});

describe("W19 Mark as filed on a 1601-EQ", () => {
  const dialog = (d = detail()) => {
    const onDone = vi.fn();
    wrap(<ConfirmationDialog detail={d} mode="mark" onClose={vi.fn()} onDone={onDone} />);
    return onDone;
  };
  const confirmBtn = () =>
    screen.getByRole("button", { name: "Mark as filed" }) as HTMLButtonElement;
  // The BIR email is checked first, as for any return; the alphalist step is on top of it.
  async function passEmailCheck() {
    const ids = [
      "bir-email",
      "file-name",
      "taxpayer",
      "form",
      "period",
      "received",
      "duplicate",
      "timing",
      "upload",
    ];
    api.checkConfirmation.mockResolvedValue({
      ok: true,
      checks: ids.map((id, i) => ({ n: i + 1, id, status: "ok", message: null })),
      errors: [],
      warnings: [],
      parsed: null,
      filedOn: "2026-10-30",
      sha256: "0".repeat(64),
    });
    fireEvent.change(screen.getByLabelText(/BIR confirmation email \(PDF\)/), {
      target: {
        files: [new File(["%PDF-1.4 invented"], "c.pdf", { type: "application/pdf" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    await waitFor(() => expect(api.checkConfirmation).toHaveBeenCalled());
    await waitFor(() =>
      expect(document.querySelector('[data-check-result="ok"]')).not.toBeNull(),
    );
  }

  it("a failing check: the sentence and refusals inside the dialog, and the file button waits for the tick", async () => {
    const R = ["INVENTED P1", "INVENTED P2"];
    api.fetchAlphalistCheck.mockResolvedValue(
      check({ ok: false, fileName: null, refusals: R }),
    );
    const filed = detail({ status: "filed" });
    api.markBirFormFiled.mockResolvedValue(filed);
    const onDone = dialog();
    const step = await waitFor(() => {
      const el = document.querySelector('[data-alphalist-step="problems"]');
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(step.textContent).toContain(
      "The alphalist has problems. If you file now, no alphalist will be stored and it cannot be made later.",
    );
    expect([...step.querySelectorAll("li")].map((li) => li.textContent)).toEqual(R);
    await passEmailCheck();
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I understand"));
    expect(confirmBtn().disabled).toBe(false);
    fireEvent.click(confirmBtn());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(filed));
  });

  it("a passing check: says the alphalist will be stored, no tick asked", async () => {
    api.fetchAlphalistCheck.mockResolvedValue(check());
    dialog();
    await screen.findByText("The alphalist will be stored with the filed return.");
    expect(screen.queryByLabelText("I understand")).toBeNull();
    await passEmailCheck();
    expect(confirmBtn().disabled).toBe(false);
  });

  it("a check that cannot run needs the tick too", async () => {
    api.fetchAlphalistCheck.mockRejectedValue(
      new ApiError(500, "INVENTED server trouble."),
    );
    dialog();
    await screen.findByText("INVENTED server trouble.");
    await passEmailCheck();
    expect(confirmBtn().disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("I understand"));
    expect(confirmBtn().disabled).toBe(false);
  });

  it("another form does not run the check", () => {
    dialog(detail({ form: "2550Q" }));
    expect(api.fetchAlphalistCheck).not.toHaveBeenCalled();
  });
});

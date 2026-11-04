// track-b-w18-dialog.test.tsx — W18: the Mark as filed dialog's states and the
// confirmation card, with the API module mocked. The web sends the file and shows what
// the API says, word for word; it reads no PDF. All data is invented.

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
  checkConfirmation: vi.fn(),
  markBirFormFiled: vi.fn(),
  attachBirConfirmation: vi.fn(),
  fetchBirConfirmationUrl: vi.fn(),
  fetchUsers: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...api,
}));
const auth = vi.hoisted(() => ({ perms: new Set<string>() }));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ hasPermission: (p: string) => auth.perms.has(p) }),
}));
const download = vi.hoisted(() => ({ downloadFromUrl: vi.fn() }));
vi.mock("../../lib/download", () => download);

import {
  ApiError,
  type BirFormConfirmation,
  type BirFormDetail,
  type ConfirmationCheck,
  type ConfirmationCheckResult,
} from "../../lib/api";
import {
  ConfirmationCard,
  ConfirmationDialog,
  MarkAsFiledButton,
} from "./BirConfirmation";
import {
  canConfirm,
  CHECK_NAMES,
  periodText,
  receivedText,
  whenText,
} from "../../lib/birConfirmation";

const FORM_ID = "f1800000-0000-4000-8000-0000000000aa";

const detail = (over: Partial<BirFormDetail> = {}): BirFormDetail =>
  ({
    id: FORM_ID,
    clientId: "c1",
    clientName: "INVENTED EIGHTEEN CO",
    form: "2550Q",
    status: "draft",
    period: "2026-Q1",
    filedAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    data: {},
    computed: null,
    exports: [],
    confirmationRequired: true,
    confirmation: null,
    ...over,
  }) as BirFormDetail;

const IDS = Object.keys(CHECK_NAMES) as ConfirmationCheck["id"][];
const checks = (
  over: Partial<
    Record<ConfirmationCheck["id"], [ConfirmationCheck["status"], string | null]>
  > = {},
) =>
  IDS.map((id, i) => ({
    n: i + 1,
    id,
    status: over[id]?.[0] ?? "ok",
    message: over[id]?.[1] ?? null,
  })) as ConfirmationCheck[];

const PARSED = {
  birFileName: "000111222333-2550Q-032026.xml",
  tin: "000111222",
  branch: "000",
  form: "2550Q",
  version: null,
  fyEndMonth: null,
  taxYear: 2026,
  quarter: 1,
  month: null,
  amendment: null,
  shape: "verified" as const,
  receivedAt: "2026-04-25T07:42:00.000Z",
};
const result = (
  over: Partial<ConfirmationCheckResult> = {},
): ConfirmationCheckResult => ({
  ok: true,
  checks: checks(),
  errors: [],
  warnings: [],
  parsed: PARSED,
  filedOn: "2026-04-25",
  sha256: "0".repeat(64),
  ...over,
});

const pdf = (name = "confirmation.pdf") =>
  new File(["%PDF-1.4 invented"], name, { type: "application/pdf" });

function renderDialog(mode: "mark" | "attach" | "replace" = "mark", d = detail()) {
  const onClose = vi.fn();
  const onDone = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConfirmationDialog detail={d} mode={mode} onClose={onClose} onDone={onDone} />
    </QueryClientProvider>,
  );
  return { onClose, onDone };
}
const chooseFile = (f: File) =>
  fireEvent.change(screen.getByLabelText(/BIR confirmation email \(PDF\)/), {
    target: { files: [f] },
  });
const checkBtn = () => screen.getByRole("button", { name: "Check" }) as HTMLButtonElement;
const confirmBtn = (name: string) =>
  screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  download.downloadFromUrl.mockReset();
  auth.perms = new Set();
});
afterEach(() => cleanup());

describe("W18 the dialog's states", () => {
  it("before a check: a PDF chooser, Check held back, nothing read, Mark as filed held back", () => {
    renderDialog();
    const input = screen.getByLabelText(
      /BIR confirmation email \(PDF\)/,
    ) as HTMLInputElement;
    expect(input.accept).toContain("application/pdf");
    expect(checkBtn().disabled).toBe(true);
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
    expect(screen.queryByText("BIR file name")).toBeNull();
    expect(screen.queryByRole("link", { name: /File without/ })).toBeNull();
  });

  it("a chosen file lets it be checked, and the file is sent as it is", async () => {
    api.checkConfirmation.mockResolvedValue(result());
    renderDialog();
    const f = pdf();
    chooseFile(f);
    expect(checkBtn().disabled).toBe(false);
    fireEvent.click(checkBtn());
    await screen.findByText("000111222333-2550Q-032026.xml");
    expect(api.checkConfirmation).toHaveBeenCalledWith(FORM_ID, f);
  });

  it("ok: reads back the file name, form, period and the date and time received, ticks every check, and allows Mark as filed with the SAME file", async () => {
    api.checkConfirmation.mockResolvedValue(result());
    const filed = detail({ status: "filed" });
    api.markBirFormFiled.mockResolvedValue(filed);
    const { onDone } = renderDialog();
    const f = pdf();
    chooseFile(f);
    fireEvent.click(checkBtn());
    await screen.findByText("000111222333-2550Q-032026.xml");
    const read = (k: string) => document.querySelector(`[data-read="${k}"]`)!.textContent;
    expect(read("form")).toBe("2550Q");
    expect(read("period")).toBe("2026 Q1");
    expect(read("received")).toBe("Apr 25, 2026, 3:42 PM");
    expect(document.querySelectorAll('[data-status="ok"]')).toHaveLength(9);
    expect(confirmBtn("Mark as filed").disabled).toBe(false);
    fireEvent.click(confirmBtn("Mark as filed"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(filed));
    expect(api.markBirFormFiled).toHaveBeenCalledTimes(1);
    expect(api.markBirFormFiled.mock.calls[0]![1].file).toBe(f);
    expect(api.markBirFormFiled.mock.calls[0]![1]).not.toHaveProperty("overrideReason");
  });

  it("errors: a cross and the server's sentence word for word, and Mark as filed held back", async () => {
    const MESSAGE = "The confirmation is for form 1701Q, not 2550Q.";
    api.checkConfirmation.mockResolvedValue(
      result({
        ok: false,
        checks: checks({ form: ["error", MESSAGE] }),
        errors: [MESSAGE],
      }),
    );
    renderDialog();
    chooseFile(pdf());
    fireEvent.click(checkBtn());
    const row = await waitFor(() => {
      const el = document.querySelector('[data-check="form"]');
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(row.getAttribute("data-status")).toBe("error");
    expect(within(row).getByText("✗")).toBeTruthy();
    expect(row.querySelector("[data-check-message]")!.textContent).toBe(MESSAGE);
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
    expect(api.markBirFormFiled).not.toHaveBeenCalled();
  });

  it("warnings only: the warning is shown with its sentence and Mark as filed is allowed", async () => {
    const WARNING = "INVENTED WARNING: this return was received after its due date.";
    api.checkConfirmation.mockResolvedValue(
      result({ checks: checks({ timing: ["warning", WARNING] }), warnings: [WARNING] }),
    );
    renderDialog();
    chooseFile(pdf());
    fireEvent.click(checkBtn());
    const row = await waitFor(() => {
      const el = document.querySelector('[data-check="timing"]');
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(row.getAttribute("data-status")).toBe("warning");
    expect(within(row).getByText("⚠")).toBeTruthy();
    expect(row.querySelector("[data-check-message]")!.textContent).toBe(WARNING);
    expect(confirmBtn("Mark as filed").disabled).toBe(false);
  });

  it("skipped checks show as skipped, not as failed", async () => {
    const PICTURE =
      "This PDF is a picture. Print the email to PDF from Gmail instead of scanning it.";
    const skipped = IDS.filter((id) => id !== "upload");
    const over = Object.fromEntries(skipped.map((id) => [id, ["skipped", null]]));
    api.checkConfirmation.mockResolvedValue(
      result({
        ok: false,
        parsed: null,
        filedOn: null,
        checks: checks({ ...over, upload: ["error", PICTURE] } as never),
        errors: [PICTURE],
      }),
    );
    renderDialog();
    chooseFile(pdf());
    fireEvent.click(checkBtn());
    await waitFor(() =>
      expect(document.querySelectorAll('[data-status="skipped"]')).toHaveLength(8),
    );
    const first = document.querySelector('[data-check="bir-email"]')!;
    expect(first.textContent).toContain("skipped");
    expect(
      document.querySelector('[data-check="upload"] [data-check-message]')!.textContent,
    ).toBe(PICTURE);
    expect(document.querySelector("[data-read]")).toBeNull();
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
  });

  it("another file is another check: the result goes and Mark as filed is held back again", async () => {
    api.checkConfirmation.mockResolvedValue(result());
    renderDialog();
    chooseFile(pdf("a.pdf"));
    fireEvent.click(checkBtn());
    await screen.findByText("000111222333-2550Q-032026.xml");
    expect(confirmBtn("Mark as filed").disabled).toBe(false);
    chooseFile(pdf("b.pdf"));
    expect(screen.queryByText("000111222333-2550Q-032026.xml")).toBeNull();
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
  });

  it("a refused Mark as filed shows the server's message and the checks it made", async () => {
    api.checkConfirmation.mockResolvedValue(result());
    const MESSAGE =
      "This confirmation is already attached to 2550Q, Invented Trading Co, 2026-Q1.";
    api.markBirFormFiled.mockRejectedValue(
      new ApiError(
        409,
        MESSAGE,
        result({
          ok: false,
          checks: checks({ duplicate: ["error", MESSAGE] }),
          errors: [MESSAGE],
        }),
      ),
    );
    renderDialog();
    chooseFile(pdf());
    fireEvent.click(checkBtn());
    await screen.findByText("000111222333-2550Q-032026.xml");
    fireEvent.click(confirmBtn("Mark as filed"));
    await waitFor(() =>
      expect(document.querySelector("[data-confirmation-error]")!.textContent).toBe(
        MESSAGE,
      ),
    );
    expect(
      document.querySelector('[data-check="duplicate"]')!.getAttribute("data-status"),
    ).toBe("error");
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
  });

  it("the override: only a Super Admin sees the link", () => {
    renderDialog();
    expect(screen.queryByText("File without the BIR email")).toBeNull();
    cleanup();
    auth.perms = new Set(["IntegrationClient:Update"]);
    renderDialog();
    expect(screen.getByText("File without the BIR email")).toBeTruthy();
  });

  it("the override: a reason box with a counter; the server refuses a short reason in its words, and takes a long one with no file", async () => {
    auth.perms = new Set(["IntegrationClient:Update"]);
    const SHORT = "Give the reason in at least 10 characters.";
    const filed = detail({ status: "filed" });
    api.markBirFormFiled
      .mockRejectedValueOnce(new ApiError(400, SHORT))
      .mockResolvedValueOnce(filed);
    const { onDone } = renderDialog();
    fireEvent.click(screen.getByText("File without the BIR email"));
    expect(screen.queryByLabelText(/BIR confirmation email \(PDF\)/)).toBeNull();
    const box = screen.getByLabelText("Reason for filing without the BIR email");
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
    fireEvent.change(box, { target: { value: "too short" } });
    expect(document.querySelector("[data-reason-counter]")!.textContent).toBe("9 / 10");
    fireEvent.click(confirmBtn("Mark as filed"));
    await waitFor(() =>
      expect(document.querySelector("[data-confirmation-error]")!.textContent).toBe(
        SHORT,
      ),
    );
    expect(api.markBirFormFiled.mock.calls[0]![1]).toEqual({
      overrideReason: "too short",
    });
    fireEvent.change(box, {
      target: { value: "The BIR email never arrived; the portal showed the receipt." },
    });
    fireEvent.click(confirmBtn("Mark as filed"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(filed));
    expect(api.markBirFormFiled.mock.calls[1]![1]).toEqual({
      overrideReason: "The BIR email never arrived; the portal showed the receipt.",
    });
  });

  it("attach: the same check, then the confirmation is attached to the filed return", async () => {
    api.checkConfirmation.mockResolvedValue(result());
    const filed = detail({ status: "filed" });
    api.attachBirConfirmation.mockResolvedValue(filed);
    const { onDone } = renderDialog("attach", detail({ status: "filed" }));
    expect(screen.queryByText("File without the BIR email")).toBeNull();
    const f = pdf();
    chooseFile(f);
    fireEvent.click(checkBtn());
    await screen.findByText("000111222333-2550Q-032026.xml");
    fireEvent.click(confirmBtn("Attach confirmation"));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(filed));
    expect(api.attachBirConfirmation).toHaveBeenCalledWith(FORM_ID, {
      file: f,
      replace: false,
    });
  });

  it("replace: the same check, and the API is told to replace", async () => {
    auth.perms = new Set(["IntegrationClient:Update"]);
    api.checkConfirmation.mockResolvedValue(result());
    api.attachBirConfirmation.mockResolvedValue(detail({ status: "filed" }));
    renderDialog("replace", detail({ status: "filed" }));
    // No override on a return that is already filed.
    expect(screen.queryByText("File without the BIR email")).toBeNull();
    const f = pdf();
    chooseFile(f);
    fireEvent.click(checkBtn());
    await screen.findByText("000111222333-2550Q-032026.xml");
    fireEvent.click(confirmBtn("Replace"));
    await waitFor(() => expect(api.attachBirConfirmation).toHaveBeenCalled());
    expect(api.attachBirConfirmation).toHaveBeenCalledWith(FORM_ID, {
      file: f,
      replace: true,
    });
  });

  it("a refused check shows the server's message and nothing else changes", async () => {
    api.checkConfirmation.mockRejectedValue(new ApiError(400, "INVENTED REFUSAL"));
    renderDialog();
    chooseFile(pdf());
    fireEvent.click(checkBtn());
    await waitFor(() =>
      expect(document.querySelector("[data-confirmation-error]")!.textContent).toBe(
        "INVENTED REFUSAL",
      ),
    );
    expect(confirmBtn("Mark as filed").disabled).toBe(true);
  });
});

describe("W18 Mark as filed", () => {
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it("opens the dialog for a return that needs the confirmation, and never files by itself", () => {
    const onPlain = vi.fn();
    render(
      <QueryClientProvider client={qc()}>
        <MarkAsFiledButton
          detail={detail()}
          disabled={false}
          pending={false}
          onPlain={onPlain}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark as filed" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onPlain).not.toHaveBeenCalled();
  });

  it("files a 1601-C, 2307 or 2316 the old way, with no dialog", () => {
    const onPlain = vi.fn();
    render(
      <QueryClientProvider client={qc()}>
        <MarkAsFiledButton
          detail={detail({ form: "1601C", confirmationRequired: false })}
          disabled={false}
          pending={false}
          onPlain={onPlain}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark as filed" }));
    expect(onPlain).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays held back when the editor holds it back", () => {
    render(
      <QueryClientProvider client={qc()}>
        <MarkAsFiledButton
          detail={detail()}
          disabled
          pending={false}
          onPlain={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(
      (screen.getByRole("button", { name: "Mark as filed" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

describe("W18 the confirmation card", () => {
  const conf = (over: Partial<BirFormConfirmation> = {}): BirFormConfirmation => ({
    id: "k1",
    kind: "bir_email",
    birFileName: "000111222333-2550Q-032026.xml",
    receivedAt: "2026-04-25T07:42:00.000Z",
    filedOn: "2026-04-25",
    originalFilename: "email.pdf",
    hasFile: true,
    warnings: [],
    overrideReason: null,
    filedWithoutConfirmation: false,
    uploadedByUserId: "u1",
    uploadedAt: "2026-04-26T01:00:00.000Z",
    ...over,
  });
  const card = (d: BirFormDetail) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ConfirmationCard detail={d} />
      </QueryClientProvider>,
    );
  };
  const filed = (c: BirFormConfirmation | null, over: Partial<BirFormDetail> = {}) =>
    detail({
      status: "filed",
      filedAt: "2026-04-25T07:42:00.000Z",
      confirmation: c,
      ...over,
    });

  it("an email: when the BIR received it, its file name, who uploaded it and when, its warnings", async () => {
    auth.perms = new Set(["Users:Read"]);
    api.fetchUsers.mockResolvedValue([{ id: "u1", fullName: "Test Operator" }]);
    card(filed(conf({ warnings: ["INVENTED WARNING ONE", "INVENTED WARNING TWO"] })));
    expect(document.querySelector("[data-received]")!.textContent).toBe(
      "Apr 25, 2026, 3:42 PM",
    );
    expect(document.querySelector("[data-bir-file-name]")!.textContent).toBe(
      "000111222333-2550Q-032026.xml",
    );
    await waitFor(() =>
      expect(document.querySelector("[data-uploaded]")!.textContent).toBe(
        "Uploaded by Test Operator on Apr 26, 2026",
      ),
    );
    expect(
      Array.from(document.querySelectorAll("[data-confirmation-warnings] li")).map(
        (l) => l.textContent,
      ),
    ).toEqual(["INVENTED WARNING ONE", "INVENTED WARNING TWO"]);
    expect(screen.getByRole("button", { name: "View PDF" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });

  it("View PDF fetches the signed link and downloads it", async () => {
    api.fetchBirConfirmationUrl.mockResolvedValue({
      url: "https://files.example.test/c.pdf?sig=1",
    });
    card(filed(conf()));
    fireEvent.click(screen.getByRole("button", { name: "View PDF" }));
    await waitFor(() => expect(download.downloadFromUrl).toHaveBeenCalled());
    expect(api.fetchBirConfirmationUrl).toHaveBeenCalledWith(FORM_ID);
    expect(download.downloadFromUrl.mock.calls[0]![0]).toBe(
      "https://files.example.test/c.pdf?sig=1",
    );
  });

  it("View PDF shows the server's sentence when there is no file", async () => {
    api.fetchBirConfirmationUrl.mockRejectedValue(
      new ApiError(404, "This return has no BIR confirmation file."),
    );
    card(filed(conf()));
    fireEvent.click(screen.getByRole("button", { name: "View PDF" }));
    await waitFor(() =>
      expect(document.querySelector("[data-confirmation-card-error]")!.textContent).toBe(
        "This return has no BIR confirmation file.",
      ),
    );
  });

  it("an override: the badge, the reason, who and when; no PDF to view", () => {
    card(
      filed(
        conf({
          kind: "override",
          birFileName: null,
          receivedAt: null,
          hasFile: false,
          filedWithoutConfirmation: true,
          overrideReason: "The BIR email never arrived.",
        }),
      ),
    );
    expect(screen.getByText("Filed without BIR confirmation")).toBeTruthy();
    expect(document.querySelector("[data-override-reason]")!.textContent).toBe(
      "The BIR email never arrived.",
    );
    expect(screen.queryByRole("button", { name: "View PDF" })).toBeNull();
  });

  it("a Super Admin sees Replace on either kind", () => {
    auth.perms = new Set(["IntegrationClient:Update"]);
    card(filed(conf()));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(document.querySelector('[data-confirmation-dialog="replace"]')).not.toBeNull();
  });

  it("a return filed before: says so and offers Attach confirmation, to anyone", () => {
    card(filed(null));
    expect(document.querySelector("[data-no-confirmation]")!.textContent).toBe(
      "No BIR confirmation attached",
    );
    fireEvent.click(screen.getByRole("button", { name: "Attach confirmation" }));
    expect(document.querySelector('[data-confirmation-dialog="attach"]')).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
  });

  it("no card for a form that needs none (1601-C, 2307, 2316), or for a draft", () => {
    card(filed(null, { form: "1601C", confirmationRequired: false }));
    expect(document.querySelector("[data-confirmation-card]")).toBeNull();
    cleanup();
    card(detail());
    expect(document.querySelector("[data-confirmation-card]")).toBeNull();
  });
});

describe("W18 what the dialog and the card say of dates and checks", () => {
  it("writes the BIR's received time on Manila's clock", () => {
    expect(receivedText("2026-04-25T07:42:00.000Z")).toBe("Apr 25, 2026, 3:42 PM");
    // 17:30 UTC on 25 April is half past one on the 26th in Manila.
    expect(whenText("2026-04-25T17:30:00.000Z")).toBe("Apr 26, 2026");
    expect(receivedText(null)).toBe("");
  });

  it("reads the period the API read", () => {
    expect(periodText({ ...PARSED, quarter: 1, month: null })).toBe("2026 Q1");
    expect(periodText({ ...PARSED, quarter: null, month: 7 })).toBe("July 2026");
    expect(periodText({ ...PARSED, quarter: null, month: null })).toBe("2026");
  });

  it("allows filing only after a check of the same file with no error", () => {
    const f = pdf();
    expect(canConfirm(null, null, f)).toBe(false);
    expect(canConfirm(result(), f, f)).toBe(true);
    expect(canConfirm(result({ ok: false }), f, f)).toBe(false);
    expect(canConfirm(result(), f, pdf())).toBe(false);
    expect(canConfirm(result(), f, null)).toBe(false);
  });

  it("names all nine checks", () => {
    expect(IDS).toHaveLength(9);
  });
});

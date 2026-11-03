// track-b-w17-editors.test.tsx — W17: the 0619-E, 1601-EQ and 1601-C editors and their
// period pickers, rendered for real with the API module mocked. All data is invented.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchClients: vi.fn(),
  fetchBirForm: vi.fn(),
  computeBirForm: vi.fn(),
  createBirForm: vi.fn(),
  updateBirForm: vi.fn(),
  fetchBookFigures: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...api,
}));

import BirFormEditorPage from "./BirFormEditorPage";

const CLIENT_ID = "17777777-7777-4777-8777-777777777777";
const FORM_ID = "f1700000-0000-4000-8000-0000000000aa";

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bir-forms/new" element={<BirFormEditorPage />} />
          <Route path="/bir-forms/:id" element={<BirFormEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const draft = (
  form: string,
  period: string,
  data: Record<string, unknown>,
  over = {},
) => ({
  id: FORM_ID,
  clientId: CLIENT_ID,
  clientName: "INVENTED WITHHOLDING CO",
  form,
  status: "draft",
  period,
  filedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  data,
  computed: null,
  exports: [],
  amendsId: null,
  sequence: 1,
  filedSnapshot: null,
  clearCopyAvailable: false,
  previewAvailable: false,
  canDelete: false,
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchClients.mockResolvedValue([
    {
      id: CLIENT_ID,
      businessName: "INVENTED WITHHOLDING CO",
      taxType: "VAT",
      status: "Active",
    },
  ]);
  api.computeBirForm.mockResolvedValue({});
  api.fetchBookFigures.mockResolvedValue({
    form: "0619E",
    period: "2026-08",
    asOf: "2026-10-12T01:00:00.000Z",
    recordCount: 0,
    figures: {},
    lines: [],
    warnings: [],
  });
});
afterEach(() => cleanup());

const options = (el: HTMLElement) =>
  Array.from((el as HTMLSelectElement).options).map((o) => o.textContent);

describe("W17 the editors' period pickers", () => {
  it("the 0619-E offers months 1 and 2 of a quarter only", async () => {
    renderAt("/bir-forms/new?form=0619E");
    const month = await screen.findByLabelText(/^Month/);
    expect(options(month)).toEqual([
      "January",
      "February",
      "April",
      "May",
      "July",
      "August",
      "October",
      "November",
    ]);
    expect(screen.getByRole("heading", { name: "New 0619-E" })).toBeTruthy();
  });

  it("the 1601-EQ offers quarters, not months", async () => {
    renderAt("/bir-forms/new?form=1601EQ");
    const quarter = await screen.findByLabelText(/^Quarter/);
    expect(options(quarter)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(screen.queryByLabelText(/^Month/)).toBeNull();
    expect(screen.getByRole("heading", { name: "New 1601-EQ" })).toBeTruthy();
  });

  it("the 1601-C offers every month", async () => {
    renderAt("/bir-forms/new?form=1601C");
    const month = await screen.findByLabelText(/^Month/);
    expect(options(month)).toHaveLength(12);
    expect(options(month)[2]).toBe("March");
    expect(screen.getByRole("heading", { name: "New 1601-C" })).toBeTruthy();
  });

  it("does not offer a client's eligibility as a filter: every client is listed", async () => {
    renderAt("/bir-forms/new?form=1601C");
    await screen.findByRole("option", { name: "INVENTED WITHHOLDING CO" });
  });
});

describe("W17 what each editor shows", () => {
  it("the 1601-C has no Portal books switch and says there are no payroll records", async () => {
    renderAt("/bir-forms/new?form=1601C");
    await screen.findByLabelText(/^Month/);
    expect(
      screen.getByText(
        "The Portal has no payroll records yet. Type the figures from your payroll.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Portal books" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Refresh from books" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: CLIENT_ID } });
    await new Promise((r) => setTimeout(r, 50));
    expect(api.fetchBookFigures).not.toHaveBeenCalled();
  });

  it("the 0619-E and the 1601-EQ have the switch, in Portal books for a new draft", async () => {
    for (const form of ["0619E", "1601EQ"]) {
      renderAt(`/bir-forms/new?form=${form}`);
      const books = await screen.findByRole("radio", { name: "Portal books" });
      expect(books.getAttribute("aria-checked")).toBe("true");
      expect(
        screen.getByRole("radio", { name: "Manual" }).getAttribute("aria-checked"),
      ).toBe("false");
      cleanup();
    }
  });

  it("none of them has an Export eBIRForms XML button, on a draft or a filed return", async () => {
    for (const form of ["0619E", "1601EQ", "1601C"]) {
      const period = form === "1601EQ" ? "2026-Q3" : "2026-08";
      for (const status of ["draft", "filed"]) {
        api.fetchBirForm.mockResolvedValue(draft(form, period, {}, { status }));
        renderAt(`/bir-forms/${FORM_ID}`);
        await screen.findByRole(
          "button",
          status === "filed" ? { name: "Amend" } : { name: "Save changes" },
        );
        expect(screen.queryByRole("button", { name: /Export eBIRForms XML/ })).toBeNull();
        cleanup();
      }
    }
  });

  it("offers Preview PDF on a draft and Download clear copy on a filed return, whatever the server's flags", async () => {
    api.fetchBirForm.mockResolvedValue(draft("0619E", "2026-08", {}));
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByRole("button", { name: "Preview PDF" });
    cleanup();
    api.fetchBirForm.mockResolvedValue(
      draft(
        "0619E",
        "2026-08",
        {},
        { status: "filed", filedAt: "2026-10-09T02:00:00.000Z" },
      ),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByRole("button", { name: "Download clear copy" });
  });
});

describe("W17 the 1601-EQ's rows", () => {
  const seven = ["WC010", "WC020", "WC030", "WC040", "WC050", "WC060", "WC070"].map(
    (atc) => ({
      atc,
      base: "100.00",
      rate: "2",
      withheld: "2.00",
    }),
  );
  const data = (rows: unknown[], extra = {}) => ({
    year: "2026",
    quarter: "3rd",
    amended: "no",
    anyWithheld: "yes",
    rows,
    ...extra,
  });

  it("shows all seven rows with the sentence, and holds back Mark as filed and Preview PDF", async () => {
    api.fetchBirForm.mockResolvedValue(draft("1601EQ", "2026-Q3", data(seven)));
    api.computeBirForm.mockResolvedValue({
      rowCount: 7,
      rows: [],
      overRemittance: false,
    });
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByText("7 ATCs; the form has six rows.");
    expect(screen.getAllByLabelText(/: ATC$/)).toHaveLength(7);
    expect(
      screen.getByRole("button", { name: "Mark as filed" }).hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Preview PDF" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows no such sentence for six", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft("1601EQ", "2026-Q3", data(seven.slice(0, 6))),
    );
    api.computeBirForm.mockResolvedValue({
      rowCount: 6,
      rows: [],
      overRemittance: false,
    });
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByLabelText("Row 6: ATC");
    expect(screen.queryByText(/the form has six rows/)).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Mark as filed" }).hasAttribute("disabled"),
      ).toBe(false),
    );
  });

  it("leaves the rate empty and editable when the table had none", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft(
        "1601EQ",
        "2026-Q3",
        data([{ atc: "WI998", base: "10.00", rate: "", withheld: "1.00" }]),
      ),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    const rate = (await screen.findByLabelText("Row 1: tax rate")) as HTMLInputElement;
    expect(rate.value).toBe("");
    expect(rate.disabled).toBe(false);
    fireEvent.change(rate, { target: { value: "0.5" } });
    expect(rate.value).toBe("0.5");
  });

  it("offers the over-remittance boxes, and not carried in the 4th quarter", async () => {
    const over = (period: string, quarter: string) => {
      api.fetchBirForm.mockResolvedValue(
        draft(
          "1601EQ",
          period,
          data([{ atc: "WC010", base: "1.00", rate: "2", withheld: "0.02" }], {
            quarter,
          }),
        ),
      );
      api.computeBirForm.mockResolvedValue({
        rowCount: 1,
        rows: [],
        overRemittance: true,
        overRemittanceAmount: 5,
        i31: -5,
      });
    };
    over("2026-Q3", "3rd");
    renderAt(`/bir-forms/${FORM_ID}`);
    const q3 = await screen.findByRole("radiogroup", {
      name: "If over-remittance, mark one (1) box only",
    });
    expect(within(q3).getAllByRole("radio")).toHaveLength(3);
    cleanup();
    over("2026-Q4", "4th");
    renderAt(`/bir-forms/${FORM_ID}`);
    const q4 = await screen.findByRole("radiogroup", {
      name: "If over-remittance, mark one (1) box only",
    });
    expect(within(q4).getAllByRole("radio")).toHaveLength(2);
    expect(within(q4).queryByRole("radio", { name: /carried/ })).toBeNull();
  });
});

describe("W17 a form the web has no editor for", () => {
  it("is never opened as the 2551Q", async () => {
    renderAt("/bir-forms/new?form=1601FQ");
    await screen.findByText("The Portal has no editor for the form 1601FQ.");
    expect(screen.queryByText(/Schedule 1/)).toBeNull();
  });
});

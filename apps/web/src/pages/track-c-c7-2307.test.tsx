// track-c-c7-2307.test.tsx — C7 (D56): the 2307 editor prints through the server, on the
// BIR's own blank — "Preview PDF" while a draft, "Download clear copy" once issued — and the
// old browser-print button is gone. The API module and the download helpers are mocked; the
// editor and its rules are the real ones.
//
// All data is invented. No real name, TIN, address, phone or email.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchClients: vi.fn(),
  fetchClient: vi.fn(),
  fetchBirForm: vi.fn(),
  computeBirForm: vi.fn(),
  createBirForm: vi.fn(),
  updateBirForm: vi.fn(),
  previewBirFormPdf: vi.fn(),
  createClearCopy: vi.fn(),
  fetchBirFormExportUrl: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...api,
}));
const dl = vi.hoisted(() => ({ downloadBlob: vi.fn(), downloadFromUrl: vi.fn() }));
vi.mock("../lib/download", async (orig) => ({
  ...(await orig<typeof import("../lib/download")>()),
  ...dl,
}));

import BirForm2307Editor from "./BirForm2307Editor";

const CLIENT_ID = "99999999-9999-4999-8999-999999999999";
const FORM_ID = "f2307000-0000-4000-8000-0000000000c7";
const NAME_MISSING =
  "Complete the client's registered name (or last and first name for an individual) before printing this certificate.";
const SAVE_FIRST = "Save the certificate before printing.";

const client = (regName: string) => ({
  id: CLIENT_ID,
  businessName: "INVENTED DISPLAY NAME",
  kind: "non-individual",
  regName,
  tin: "121-232-343",
  branch: "00000",
  taxType: "VAT",
  status: "Active",
  address: "5 INVENTED STREET",
  city: "SAMPLE CITY",
  zip: "1300",
});

function form2307(over: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    clientId: CLIENT_ID,
    clientName: "INVENTED DISPLAY NAME",
    form: "2307",
    status: "draft",
    period: "2026-Q2",
    filedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    data: {
      year: "2026",
      quarter: "2",
      payeeName: "INVENTED PAYEE",
      payeeTin: "232-343-454",
      payeeBranch: "00000",
      rows: [{ atc: "WI010", desc: "", m1: "100.50", m2: "", m3: "", tax: "10.05" }],
    },
    computed: null,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
    previewAvailable: true,
    clearCopyAvailable: false,
    ...over,
  };
}
const filed = (over: Record<string, unknown> = {}) =>
  form2307({
    status: "filed",
    filedAt: "2026-07-20T00:00:00.000Z",
    previewAvailable: false,
    clearCopyAvailable: true,
    ...over,
  });

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bir-forms/new" element={<BirForm2307Editor />} />
          <Route path="/bir-forms/:id" element={<BirForm2307Editor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  Object.values(dl).forEach((f) => f.mockReset());
  api.fetchClients.mockResolvedValue([client("INVENTED REGISTERED CORP")]);
  api.fetchClient.mockResolvedValue(client("INVENTED REGISTERED CORP"));
  api.computeBirForm.mockResolvedValue({
    rows: [{ total: 100.5 }],
    totalIncome: 100.5,
    totalTax: 10.05,
    tM1: 100.5,
    tM2: 0,
    tM3: 0,
  });
  api.previewBirFormPdf.mockResolvedValue({
    blob: new Blob(["%PDF"], { type: "application/pdf" }),
    filename: "121232343000-2307-2026-Q2-DRAFT.pdf",
  });
  api.createClearCopy.mockResolvedValue({
    id: "e2307000-0000-4000-8000-0000000000e1",
    kind: "pdf",
    filename: "121232343000-2307-2026-Q2.pdf",
    createdAt: "2026-10-22T00:00:00.000Z",
  });
  api.fetchBirFormExportUrl.mockResolvedValue({ url: "https://signed.example.test/x" });
});
afterEach(() => cleanup());

const preview = () => screen.queryByRole("button", { name: "Preview PDF" });
const clear = () => screen.queryByRole("button", { name: "Download clear copy" });
const oldButton = () => screen.queryByRole("button", { name: /Print certificate/ });

describe("C7 the 2307 prints through the server (D56)", () => {
  it("a saved draft offers Preview PDF, not the clear copy, and not the old browser print", async () => {
    api.fetchBirForm.mockResolvedValue(form2307());
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByRole("button", { name: "Preview PDF" });
    expect(clear()).toBeNull();
    expect(oldButton()).toBeNull();
  });

  it("Preview PDF sends one request for this certificate and downloads the server's file under its name", async () => {
    api.fetchBirForm.mockResolvedValue(form2307());
    renderAt(`/bir-forms/${FORM_ID}`);
    const btn = (await screen.findByRole("button", {
      name: "Preview PDF",
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(dl.downloadBlob).toHaveBeenCalledTimes(1));
    expect(api.previewBirFormPdf).toHaveBeenCalledTimes(1);
    expect(api.previewBirFormPdf).toHaveBeenCalledWith(FORM_ID);
    expect(dl.downloadBlob.mock.calls[0]![1]).toBe("121232343000-2307-2026-Q2-DRAFT.pdf");
    expect(api.createClearCopy).not.toHaveBeenCalled();
  });

  it("a certificate not yet saved shows Preview PDF disabled, with the save-first reason, and sends nothing", async () => {
    renderAt("/bir-forms/new?form=2307");
    const btn = (await screen.findByRole("button", {
      name: "Preview PDF",
    })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(SAVE_FIRST);
    fireEvent.click(btn);
    expect(api.previewBirFormPdf).not.toHaveBeenCalled();
    expect(clear()).toBeNull();
    expect(oldButton()).toBeNull();
  });

  it("a draft whose client has no BIR registered name is refused in the editor's words, before any request", async () => {
    api.fetchBirForm.mockResolvedValue(form2307());
    api.fetchClient.mockResolvedValue(client(""));
    api.fetchClients.mockResolvedValue([client("")]);
    renderAt(`/bir-forms/${FORM_ID}`);
    const btn = (await screen.findByRole("button", {
      name: "Preview PDF",
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByText(NAME_MISSING)).toBeTruthy();
    expect(api.previewBirFormPdf).not.toHaveBeenCalled();
    expect(dl.downloadBlob).not.toHaveBeenCalled();
  });

  it("the server's refusal shows word for word", async () => {
    api.fetchBirForm.mockResolvedValue(form2307());
    const { ApiError } = await import("../lib/api");
    api.previewBirFormPdf.mockRejectedValue(
      new ApiError(409, "Invented server refusal."),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    const btn = (await screen.findByRole("button", {
      name: "Preview PDF",
    })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect(await screen.findByText("Invented server refusal.")).toBeTruthy();
    expect(dl.downloadBlob).not.toHaveBeenCalled();
  });

  it("an issued certificate offers Download clear copy, not Preview PDF, not the old browser print", async () => {
    api.fetchBirForm.mockResolvedValue(filed());
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByRole("button", { name: "Download clear copy" });
    expect(preview()).toBeNull();
    expect(oldButton()).toBeNull();
  });

  it("Download clear copy makes the stored copy, then follows its signed link under the export's name", async () => {
    api.fetchBirForm.mockResolvedValue(filed());
    renderAt(`/bir-forms/${FORM_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Download clear copy" }));
    await waitFor(() => expect(dl.downloadFromUrl).toHaveBeenCalledTimes(1));
    expect(api.createClearCopy).toHaveBeenCalledWith(FORM_ID);
    expect(api.fetchBirFormExportUrl).toHaveBeenCalledWith(
      FORM_ID,
      "e2307000-0000-4000-8000-0000000000e1",
    );
    expect(dl.downloadFromUrl).toHaveBeenCalledWith(
      "https://signed.example.test/x",
      "121232343000-2307-2026-Q2.pdf",
    );
    expect(api.previewBirFormPdf).not.toHaveBeenCalled();
  });

  it("an issued certificate reprints even when its payor has no registered name now (W8 R3)", async () => {
    api.fetchBirForm.mockResolvedValue(filed());
    api.fetchClient.mockResolvedValue(client(""));
    api.fetchClients.mockResolvedValue([client("")]);
    renderAt(`/bir-forms/${FORM_ID}`);
    fireEvent.click(await screen.findByRole("button", { name: "Download clear copy" }));
    await waitFor(() => expect(dl.downloadFromUrl).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(NAME_MISSING)).toBeNull();
  });

  it("an issued certificate the server cannot print offers neither button", async () => {
    api.fetchBirForm.mockResolvedValue(filed({ clearCopyAvailable: false }));
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByLabelText("Payee name");
    expect(clear()).toBeNull();
    expect(preview()).toBeNull();
    expect(oldButton()).toBeNull();
  });
});

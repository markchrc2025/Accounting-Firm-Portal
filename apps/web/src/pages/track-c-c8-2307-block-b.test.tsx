// track-c-c8-2307-block-b.test.tsx — C8: block B entry in the 2307 editor (the money payments
// subject to withholding of business tax) and the ATC picker in both blocks. The API module is
// mocked; the editor, the picker and the replica are the real ones.
//
// All data is invented. No real name, TIN, address, phone or email.

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
  fetchClient: vi.fn(),
  fetchBirForm: vi.fn(),
  computeBirForm: vi.fn(),
  createBirForm: vi.fn(),
  updateBirForm: vi.fn(),
  fetchBirAtcCodes: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...api,
}));

import BirForm2307Editor from "./BirForm2307Editor";

const CLIENT_ID = "77777777-7777-4777-8777-777777777777";
const FORM_ID = "f2307000-0000-4000-8000-0000000000c8";

const client = () => ({
  id: CLIENT_ID,
  businessName: "INVENTED C8 TRADING",
  kind: "non-individual",
  regName: "INVENTED C8 TRADING CORP",
  tin: "121-232-343",
  branch: "00000",
  taxType: "VAT",
  status: "Active",
  address: "5 INVENTED STREET",
  city: "SAMPLE CITY",
  zip: "1300",
});

const code = (
  atc: string,
  classification: string,
  description: string,
  rate: string,
  over = {},
) => ({
  atc,
  classification,
  taxTypeCode: "WE",
  payeeType: "any",
  description,
  rate,
  rateBasis: "gross_payment",
  forms: [],
  certificate: "2307",
  status: "active",
  ...over,
});
const TABLE = [
  code("WI010", "ewt", "Professional fees paid to individuals - invented", "0.050000"),
  code("WC010", "ewt", "Professional fees paid to corporations - invented", "0.100000"),
  code("WB030", "percentage_wt", "Tax on carriers and keepers of garages", "0.030000", {
    taxTypeCode: "WG",
  }),
  code("WV010", "wvat", "VAT withheld on purchases of goods - government", "0.050000", {
    taxTypeCode: "WG",
  }),
  code("WB200", "percentage_wt", "Stock transaction tax", "0.001000", {
    taxTypeCode: "ST",
    certificate: null,
  }),
];

/** What the server computes for a block, in integer centavos (exact), as compute2307 does. */
const cents = (v: unknown) => {
  const s = String(v ?? "")
    .replace(/,/g, "")
    .trim();
  if (s === "") return 0;
  const [p = "0", c = ""] = s.split(".");
  return Number(p) * 100 + Number(c.padEnd(2, "0").slice(0, 2));
};
function blockOf(rows: Record<string, unknown>[] = []) {
  const sum = (k: string) => rows.reduce((t, r) => t + cents(r[k]), 0);
  const total = rows.map((r) => cents(r.m1) + cents(r.m2) + cents(r.m3));
  return {
    rows: total.map((t) => ({ total: t / 100 })),
    totalIncome: total.reduce((a, b) => a + b, 0) / 100,
    totalTax: sum("tax") / 100,
    tM1: sum("m1") / 100,
    tM2: sum("m2") / 100,
    tM3: sum("m3") / 100,
  };
}
const computeFor = (data: Record<string, unknown>) => ({
  ...blockOf(data.rows as Record<string, unknown>[]),
  blockB: blockOf(data.rowsB as Record<string, unknown>[]),
});

function form2307(
  data: Record<string, unknown> = {},
  over: Record<string, unknown> = {},
) {
  return {
    id: FORM_ID,
    clientId: CLIENT_ID,
    clientName: "INVENTED C8 TRADING",
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
      rows: [{ atc: "WI010", desc: "FEES", m1: "100", m2: "", m3: "", tax: "5" }],
      ...data,
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
  api.fetchClients.mockResolvedValue([client()]);
  api.fetchClient.mockResolvedValue(client());
  api.fetchBirAtcCodes.mockResolvedValue(TABLE);
  api.computeBirForm.mockImplementation((_form: string, data: Record<string, unknown>) =>
    Promise.resolve(computeFor(data)),
  );
  api.createBirForm.mockImplementation((body: { data: unknown }) =>
    Promise.resolve({ ...form2307(), data: body.data }),
  );
  api.updateBirForm.mockImplementation((_id: string, body: { data: unknown }) =>
    Promise.resolve({ ...form2307(), data: body.data }),
  );
});
afterEach(() => cleanup());

const atcB = (n = 1) =>
  screen.getByLabelText(`ATC, block B row ${n}`) as HTMLInputElement;
const amountB = (label: string, n = 1) =>
  screen.getByLabelText(`${label}, block B row ${n}`) as HTMLInputElement;
const addB = () =>
  fireEvent.click(screen.getByRole("button", { name: "+ Add block B line" }));
const choose = async (input: HTMLInputElement, code: string) => {
  fireEvent.focus(input);
  const options = await screen.findAllByTestId("atc-option");
  const hit = options.find((o) => o.textContent!.includes(code))!;
  fireEvent.click(hit);
};

describe("C8 · block B entry", () => {
  it("a new certificate has no block B row until one is added; a new line has no ATC, and typing amounts never fills one", async () => {
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("button", { name: "+ Add block B line" });
    expect(screen.queryByLabelText("ATC, block B row 1")).toBeNull();
    addB();
    expect(atcB().value).toBe("");
    expect(atcB().placeholder).toBe("Select ATC…");
    fireEvent.change(amountB("1st month"), { target: { value: "1000" } });
    fireEvent.change(amountB("Tax withheld"), { target: { value: "30" } });
    expect(atcB().value).toBe("");
    // block A's line is untouched by block B's
    expect((screen.getByLabelText("ATC, row 1") as HTMLInputElement).value).toBe("");
  });

  it("block B's picker offers the business-tax codes (WB, WV by classification, not WB200), block A's the expanded ones", async () => {
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("button", { name: "+ Add block B line" });
    addB();
    await waitFor(() => expect(api.fetchBirAtcCodes).toHaveBeenCalled());
    fireEvent.focus(atcB());
    const b = (await screen.findAllByTestId("atc-option")).map((o) => o.textContent);
    expect(b.map((t) => t!.slice(0, 5))).toEqual(["WB030", "WV010"]);
    fireEvent.blur(atcB());
    fireEvent.focus(screen.getByLabelText("ATC, row 1"));
    const a = (await screen.findAllByTestId("atc-option")).map((o) => o.textContent);
    expect(a.map((t) => t!.slice(0, 5))).toEqual(["WI010", "WC010"]);
  });

  it("the row total and the block's totals are the server's exact sums, shown; the tax withheld stays what was typed, whatever the table rate", async () => {
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("button", { name: "+ Add block B line" });
    addB();
    await choose(atcB(), "WB030"); // table rate 3%
    fireEvent.change(amountB("1st month"), { target: { value: "0.1" } });
    fireEvent.change(amountB("2nd month"), { target: { value: "0.2" } });
    fireEvent.change(amountB("3rd month"), { target: { value: "0.3" } });
    fireEvent.change(amountB("Tax withheld"), { target: { value: "7.77" } });
    await waitFor(() =>
      expect(screen.getByTestId("part3-total-B-1").textContent).toMatch(/0\.60$/),
    );
    const totals = screen.getByTestId("block-b-totals");
    expect(
      within(totals).getByText("Total money payments").nextSibling!.textContent,
    ).toMatch(/0\.60$/);
    expect(
      within(totals).getByText("Total tax withheld, block B").nextSibling!.textContent,
    ).toMatch(/7\.77$/);
    // 3% of 0.60 is not what was typed: the typed amount stands, no fill, no derivation
    expect(amountB("Tax withheld").value).toBe("7.77");
    expect(screen.getByTestId("atc-reference").textContent).toContain("table rate 3%");
    // the second compute call carried the rows to the server as typed
    const last = api.computeBirForm.mock.calls.at(-1)!;
    expect(last[1].rowsB).toEqual([
      { atc: "WB030", desc: "", m1: "0.1", m2: "0.2", m3: "0.3", tax: "7.77" },
    ]);
  });

  it("a third decimal is refused, in words, and the figure stays as it was", async () => {
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("button", { name: "+ Add block B line" });
    addB();
    fireEvent.change(amountB("1st month"), { target: { value: "12.34" } });
    fireEvent.change(amountB("1st month"), { target: { value: "12.345" } });
    expect(amountB("1st month").value).toBe("12.34");
    expect(screen.getByTestId("third-decimal").textContent).toBe(
      "Amounts have pesos and centavos only: a third decimal is not accepted.",
    );
    fireEvent.change(amountB("1st month"), { target: { value: "12.3" } });
    expect(screen.queryByTestId("third-decimal")).toBeNull();
    // the same for the tax withheld, and for block A
    fireEvent.change(amountB("Tax withheld"), { target: { value: "1.005" } });
    expect(amountB("Tax withheld").value).toBe("");
    expect(screen.getByTestId("third-decimal")).toBeTruthy();
  });

  it("saving a new certificate sends block B as data.rowsB, the ATC as chosen; without block B rows no rowsB is sent", async () => {
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("option", { name: "INVENTED C8 TRADING" });
    fireEvent.change(screen.getByLabelText("Withholding agent (client)"), {
      target: { value: CLIENT_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.createBirForm).toHaveBeenCalledTimes(1));
    expect(Object.keys(api.createBirForm.mock.calls[0]![0].data)).not.toContain("rowsB");

    cleanup();
    api.createBirForm.mockClear();
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("option", { name: "INVENTED C8 TRADING" });
    fireEvent.change(screen.getByLabelText("Withholding agent (client)"), {
      target: { value: CLIENT_ID },
    });
    addB();
    await choose(atcB(), "WV010");
    fireEvent.change(amountB("1st month"), {
      target: { value: "1,000.50".replace(",", "") },
    });
    fireEvent.change(screen.getByLabelText("Income payment, block B row 1"), {
      target: { value: "VAT WITHHELD ON PURCHASES" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.createBirForm).toHaveBeenCalledTimes(1));
    expect(api.createBirForm.mock.calls[0]![0].data.rowsB).toEqual([
      {
        atc: "WV010",
        desc: "VAT WITHHELD ON PURCHASES",
        m1: "1000.50",
        m2: "",
        m3: "",
        tax: "",
      },
    ]);
  });

  it("a saved certificate opens with its block B rows and prints them on the replica, totals included", async () => {
    api.fetchBirForm.mockResolvedValue(
      form2307({
        rowsB: [
          {
            atc: "WB030",
            desc: "MONEY PAYMENT",
            m1: "10",
            m2: "20.50",
            m3: "0.25",
            tax: "1",
          },
        ],
      }),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    expect(
      ((await screen.findByLabelText("ATC, block B row 1")) as HTMLInputElement).value,
    ).toBe("WB030");
    expect(amountB("2nd month").value).toBe("20.50");
    await waitFor(() =>
      expect(screen.getByTestId("part3-total-B-1").textContent).toMatch(/30\.75$/),
    );
    const sheet = document.querySelector('[data-sheet-copy="capture"] .bir-sheet')!;
    const rowB = sheet.querySelector('[data-p3-row="B"]')!;
    expect(rowB.textContent).toContain("MONEY PAYMENT");
    expect(rowB.textContent).toContain("WB030");
    const totalB = sheet.querySelector('[data-total-row="B"]')!;
    expect(totalB.textContent).toContain("30.75");
  });
});

describe("C8 · an existing certificate opens and saves as before", () => {
  it("a draft saved without block B shows no block B row, no block B totals, and its replica block B is blank", async () => {
    api.fetchBirForm.mockResolvedValue(form2307());
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByLabelText("Payee name");
    expect(screen.queryByLabelText("ATC, block B row 1")).toBeNull();
    expect(screen.queryByTestId("block-b-totals")).toBeNull();
    const sheet = document.querySelector('[data-sheet-copy="capture"] .bir-sheet')!;
    const rowB = sheet.querySelector('[data-p3-row="B"]')!;
    expect(rowB.textContent!.trim()).toBe("");
    expect(sheet.querySelector('[data-total-row="B"]')!.textContent).toBe("Total");
  });

  it("a saved ATC that is not in the table stays shown as it was, flagged with a plain note, in both blocks", async () => {
    api.fetchBirForm.mockResolvedValue(
      form2307({
        rows: [{ atc: "WI999", desc: "OLD", m1: "100", m2: "", m3: "", tax: "5" }],
        rowsB: [{ atc: "WB999", desc: "OLD B", m1: "10", m2: "", m3: "", tax: "" }],
      }),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    expect(((await screen.findByLabelText("ATC, row 1")) as HTMLInputElement).value).toBe(
      "WI999",
    );
    expect(atcB().value).toBe("WB999");
    await waitFor(() => expect(screen.getAllByTestId("atc-note")).toHaveLength(2));
    const notes = screen.getAllByTestId("atc-note").map((n) => n.textContent);
    expect(notes).toEqual([
      "ATC WI999 is not in the BIR ATC table. It is shown as it was saved.",
      "ATC WB999 is not in the BIR ATC table. It is shown as it was saved.",
    ]);
  });

  it("saving an old draft keeps its typed ATC and sends no rowsB", async () => {
    api.fetchBirForm.mockResolvedValue(
      form2307({
        rows: [{ atc: "WI999", desc: "OLD", m1: "100", m2: "", m3: "", tax: "5" }],
      }),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    fireEvent.change(await screen.findByLabelText("Payee name"), {
      target: { value: "INVENTED PAYEE, EDITED" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateBirForm).toHaveBeenCalledTimes(1));
    const data = api.updateBirForm.mock.calls[0]![1].data;
    expect(data.rows).toEqual([
      { atc: "WI999", desc: "OLD", m1: "100", m2: "", m3: "", tax: "5" },
    ]);
    expect(Object.keys(data)).not.toContain("rowsB");
  });

  it("an issued certificate shows its block B rows and its saved ATCs, read-only", async () => {
    api.fetchBirForm.mockResolvedValue(
      form2307(
        { rowsB: [{ atc: "WV010", desc: "", m1: "50", m2: "", m3: "", tax: "2.5" }] },
        {
          status: "filed",
          filedAt: "2026-07-20T00:00:00.000Z",
          previewAvailable: false,
          clearCopyAvailable: true,
        },
      ),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    const b = (await screen.findByLabelText("ATC, block B row 1")) as HTMLInputElement;
    expect(b.value).toBe("WV010");
    expect(b.matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "+ Add block B line" })).toBeTruthy();
  });

  it("a block B row with an amount and no ATC blocks issuing, with its own sentence; block A's sentence is unchanged", async () => {
    api.fetchBirForm.mockResolvedValue(
      form2307({
        rows: [{ atc: "", desc: "", m1: "100", m2: "", m3: "", tax: "" }],
        rowsB: [{ atc: "", desc: "", m1: "10", m2: "", m3: "", tax: "" }],
      }),
    );
    renderAt(`/bir-forms/${FORM_ID}`);
    const box = await screen.findByTestId("issue-blockers");
    expect(box.textContent).toContain(
      "Row 1 has an amount but no ATC. Choose the ATC for every row with an amount before issuing.",
    );
    expect(box.textContent).toContain(
      "In block B (money payments), row 1 has an amount but no ATC. Choose the ATC for every row with an amount before issuing.",
    );
  });
});

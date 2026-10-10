// track-b-editor-rules.test.tsx — T5 (W3): the rules the 2307 editor enforces
// before a certificate is issued (R4, R6). The API module is mocked; the
// editor itself, its rules and the replica are the real ones.
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
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...api,
}));

import BirForm2307Editor from "./BirForm2307Editor";
import BirFormEditorPage from "./BirFormEditorPage";
import { Form2307 } from "../components/birform/Form2307";
import { issueBlockers, titleTinLine } from "../lib/certificateRules";
import {
  amendmentHeading,
  filedBannerTitle,
  filedDate,
  printParty,
} from "../lib/birFiling";

const CLIENT_ID = "88888888-8888-4888-8888-888888888888";
const FORM_ID = "f2307000-0000-4000-8000-0000000000aa";

const client = (branch: string) => ({
  id: CLIENT_ID,
  businessName: "INVENTED RULES TRADING",
  tin: "121-232-343",
  branch,
  taxType: "VAT",
  status: "Active",
  address: "5 INVENTED STREET",
  city: "SAMPLE CITY",
  zip: "1300",
});

function draft2307(data: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    clientId: CLIENT_ID,
    clientName: "INVENTED RULES TRADING",
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
      rows: [{ atc: "WI010", desc: "", m1: "100", m2: "", m3: "", tax: "10" }],
      ...data,
    },
    computed: null,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
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
          <Route path="/clients/:clientId/edit" element={<div>client edit page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchClients.mockResolvedValue([client("00000")]);
  api.fetchClient.mockResolvedValue(client("00000"));
  api.computeBirForm.mockResolvedValue({
    rows: [{ total: 100 }],
    totalIncome: 100,
    totalTax: 10,
    tM1: 100,
    tM2: 0,
    tM3: 0,
  });
  api.createBirForm.mockImplementation((body: { data: unknown }) =>
    Promise.resolve({ ...draft2307(), data: body.data }),
  );
});
afterEach(() => cleanup());

const payeeBranch = () => screen.getByLabelText(/Payee branch code/) as HTMLSelectElement;

describe("T5 the 2307 editor's rules (W3 R4, R6)", () => {
  it("gives a new row no ATC, and an added row none either", async () => {
    renderAt("/bir-forms/new?form=2307");
    const atc1 = (await screen.findByLabelText("ATC, row 1")) as HTMLSelectElement;
    expect(atc1.value).toBe("");
    expect(atc1.selectedOptions[0]!.textContent).toBe("Select ATC…");
    fireEvent.click(screen.getByRole("button", { name: "+ Add line" }));
    const atc2 = screen.getByLabelText("ATC, row 2") as HTMLSelectElement;
    expect(atc2.value).toBe("");
  });

  it("requires the payee branch and offers Head office (00000) as a choice, never a prefill", async () => {
    renderAt("/bir-forms/new?form=2307");
    const select = payeeBranch();
    expect(select.required).toBe(true);
    expect(select.value).toBe("");
    expect(Array.from(select.options).map((o) => o.textContent)).toContain(
      "Head office (00000)",
    );

    // Saved without a choice, no branch is stored.
    await screen.findByRole("option", { name: "INVENTED RULES TRADING" });
    fireEvent.change(screen.getByLabelText("Withholding agent (client)"), {
      target: { value: CLIENT_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.createBirForm).toHaveBeenCalledTimes(1));
    expect(api.createBirForm.mock.calls[0]![0].data.payeeBranch).toBe("");
  });

  it("stores 00000 only once Head office is chosen", async () => {
    renderAt("/bir-forms/new?form=2307");
    await screen.findByRole("option", { name: "INVENTED RULES TRADING" });
    fireEvent.change(screen.getByLabelText("Withholding agent (client)"), {
      target: { value: CLIENT_ID },
    });
    fireEvent.change(payeeBranch(), { target: { value: "head" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.createBirForm).toHaveBeenCalledTimes(1));
    expect(api.createBirForm.mock.calls[0]![0].data.payeeBranch).toBe("00000");
  });

  it("blocks issuing while the client has no branch code, says so, and links to the client", async () => {
    api.fetchBirForm.mockResolvedValue(draft2307({ payeeBranch: "00000" }));
    api.fetchClient.mockResolvedValue(client(""));
    renderAt(`/bir-forms/${FORM_ID}`);

    // Only once the client record has loaded does the editor say its branch
    // is missing (review F: it used to say so while the record was loading).
    await screen.findByText(/This client has no branch code on file/);
    const box = screen.getByTestId("issue-blockers");
    const link = within(box).getByRole("link", { name: "Edit the client" });
    expect(link.getAttribute("href")).toBe(`/clients/${CLIENT_ID}/edit`);
    const issue = screen.getByRole("button", {
      name: "Mark as issued",
    }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
  });

  it("says it is checking, not that the branch is missing, while the client loads", async () => {
    api.fetchBirForm.mockResolvedValue(draft2307({ payeeBranch: "00000" }));
    api.fetchClient.mockReturnValue(new Promise(() => {})); // never arrives
    renderAt(`/bir-forms/${FORM_ID}`);
    const box = await screen.findByTestId("issue-blockers");
    expect(box.textContent).toContain("Checking the client's branch code");
    expect(box.textContent).not.toContain("no branch code on file");
    const issue = screen.getByRole("button", {
      name: "Mark as issued",
    }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
  });

  it("checks the SAVED certificate: a payee branch chosen on screen but not saved does not issue", async () => {
    // Issuing records the saved certificate, which has no payee branch.
    api.fetchBirForm.mockResolvedValue(draft2307({ payeeBranch: "" }));
    api.fetchClient.mockResolvedValue(client("00000"));
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByText(/Choose the payee's branch code/);
    const issue = screen.getByRole("button", {
      name: "Mark as issued",
    }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);

    fireEvent.change(payeeBranch(), { target: { value: "head" } });
    await screen.findByText(/not saved yet: save the certificate first/);
    expect(issue.disabled).toBe(true);
  });

  it("blocks issuing a row that has an amount but no ATC", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft2307({
        payeeBranch: "00000",
        rows: [{ atc: "", desc: "Fees", m1: "100", m2: "", m3: "", tax: "10" }],
      }),
    );
    api.fetchClient.mockResolvedValue(client("00000"));
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByText(/Row 1 has an amount but no ATC/);
    const issue = screen.getByRole("button", {
      name: "Mark as issued",
    }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);
  });

  it("names each payee-branch and ATC rule it applies", () => {
    const base = { payorBranch: "00000", payeeTin: "232-343-454", rows: [] };
    const rules = (over: Partial<Parameters<typeof issueBlockers>[0]>) =>
      issueBlockers({ ...base, payeeBranch: "00000", ...over }).map((b) => b.rule);
    expect(rules({})).toEqual([]);
    expect(rules({ payeeBranch: "" })).toEqual(["payee-branch"]);
    expect(rules({ payeeBranch: "123" })).toEqual(["payee-branch"]);
    expect(rules({ payeeTin: "232-343-454-00001" })).toEqual(["payee-branch-mismatch"]);
    expect(rules({ payeeTin: "232-343-454-00000" })).toEqual([]);
    expect(rules({ payorBranch: "" })).toEqual(["payor-branch"]);
    expect(rules({ payorKnown: false })).toEqual(["payor-unknown"]);
    expect(
      issueBlockers({
        ...base,
        payeeBranch: "00000",
        rows: [
          { atc: "", m1: "1" },
          { atc: "WI010", m1: "1" },
          { atc: "", m2: "5" },
        ],
      }).map((b) => b.message),
    ).toEqual([
      "Rows 1, 3 have an amount but no ATC. Choose the ATC for every row with an amount before issuing.",
    ]);
    // An empty row needs no ATC.
    expect(rules({ rows: [{ atc: "" }] })).toEqual([]);
  });

  it("allows issuing once the payor and payee branches are both known", async () => {
    api.fetchBirForm.mockResolvedValue(draft2307({ payeeBranch: "00000" }));
    api.fetchClient.mockResolvedValue(client("00000"));
    renderAt(`/bir-forms/${FORM_ID}`);
    const issue = (await screen.findByRole("button", {
      name: "Mark as issued",
    })) as HTMLButtonElement;
    await waitFor(() => expect(api.fetchClient).toHaveBeenCalled());
    await waitFor(() => expect(issue.disabled).toBe(false));
    expect(screen.queryByTestId("issue-blockers")).toBeNull();
  });

  it("prints the title and TIN as TITLE / TIN 000-000-000-00000", () => {
    expect(titleTinLine("Treasurer", "777888999 00000")).toBe(
      "Treasurer / TIN 777-888-999-00000",
    );
    expect(titleTinLine("Treasurer", "")).toBe("Treasurer");
    expect(titleTinLine("", "777-888-999-00000")).toBe("TIN 777-888-999-00000");
    expect(titleTinLine("Owner", "777-888-999")).toBe("Owner / TIN 777-888-999");

    const { container } = render(
      <Form2307
        payee={{}}
        payor={{}}
        rows={[]}
        rowTotals={[]}
        totals={{ m1: 0, m2: 0, m3: 0, income: 0, tax: 0 }}
        payorSignatory={{ title: "TREASURER", tin: "777888999 00000" }}
      />,
    );
    expect(container.textContent).toContain("TREASURER / TIN 777-888-999-00000");
  });
});

describe("T5 the filed banner, the amendment header and the print source (W3 R2, R3)", () => {
  it("dates a filing on Manila's calendar", () => {
    // 01:30 on Apr 20 in Manila is still Apr 19 in UTC.
    expect(filedDate("2026-04-19T17:30:00.000Z")).toBe("Apr 20, 2026");
    expect(filedBannerTitle("2551Q", "2026-04-19T17:30:00.000Z")).toBe(
      "Filed on Apr 20, 2026",
    );
    expect(filedBannerTitle("2307", "2026-04-19T17:30:00.000Z")).toBe(
      "Issued on Apr 20, 2026",
    );
    expect(filedBannerTitle("2316", null)).toBe("Issued");
    expect(amendmentHeading(2, "2551Q", "2026-04-19T17:30:00.000Z")).toBe(
      "Amendment 2 of the 2551Q filed on Apr 20, 2026",
    );
    expect(amendmentHeading(3, "1702RT", undefined)).toBe("Amendment 3 of the 1702RT");
  });

  it("prints from the snapshot only when filed with one", () => {
    const snap = {
      businessName: "THEN",
      tin: "1",
      branch: "00000",
      address: "A",
      city: "C",
      zip: "1",
      rdo: "1",
    };
    const cl = {
      businessName: "NOW",
      tin: "2",
      branch: "00001",
      address: "B",
      city: "D",
      zip: "2",
    };
    expect(printParty({ status: "filed", filedSnapshot: snap }, cl).businessName).toBe(
      "THEN",
    );
    expect(printParty({ status: "filed", filedSnapshot: snap }, cl).source).toBe(
      "snapshot",
    );
    expect(printParty({ status: "filed", filedSnapshot: null }, cl).businessName).toBe(
      "NOW",
    );
    expect(printParty({ status: "draft", filedSnapshot: snap }, cl).businessName).toBe(
      "NOW",
    );
    expect(printParty(undefined, cl).branch).toBe("00001");
    expect(
      printParty({ status: "filed", filedSnapshot: { businessName: "THEN" } }, cl).tin,
    ).toBe("");
  });
});

// ---------------------------------------------------------------------------
// F26 (W3): every one of the seven returns says whether it is amended, and an
// amendment that still carries the copied "no" is not exported or filed.
// ---------------------------------------------------------------------------

const RETURNS = ["2551Q", "2550Q", "1701Q", "1701A", "1701", "1702Q", "1702RT"] as const;
const ORIGINAL_ID = "f0000000-0000-4000-8000-0000000000d1";
const DRAFT_ID = "f0000000-0000-4000-8000-0000000000d2";

function returnDetail(form: string, over: Record<string, unknown>) {
  return {
    id: DRAFT_ID,
    clientId: CLIENT_ID,
    clientName: "INVENTED RULES TRADING",
    form,
    status: "draft",
    period: form.endsWith("Q") ? "2026-Q1" : "2025",
    filedAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    data: { year: "2026", amended: "no" },
    computed: null,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
    ...over,
  };
}

function renderEditor(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bir-forms/:id" element={<BirFormEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("T2/F26 each return says whether it is an amended return", () => {
  for (const form of RETURNS) {
    it(`${form}: an amendment sends amended "yes", an original "no"`, async () => {
      api.fetchBirForm.mockImplementation((id: string) =>
        Promise.resolve(
          id === ORIGINAL_ID
            ? returnDetail(form, {
                id: ORIGINAL_ID,
                status: "filed",
                filedAt: "2026-04-20T02:15:00.000Z",
              })
            : returnDetail(form, { amendsId: ORIGINAL_ID, sequence: 2 }),
        ),
      );
      const amendment = renderEditor(`/bir-forms/${DRAFT_ID}`);
      await waitFor(() => expect(api.computeBirForm).toHaveBeenCalled(), {
        timeout: 3000,
      });
      const last = api.computeBirForm.mock.calls.at(-1)!;
      expect(last[0]).toBe(form);
      expect(last[1].amended).toBe("yes");
      // Stored as "no" (the server's copy): held back until saved.
      expect(screen.getByText(/Save this amendment first/)).toBeTruthy();
      const exportXml = screen.getByRole("button", {
        name: "Export eBIRForms XML",
      }) as HTMLButtonElement;
      expect(exportXml.disabled).toBe(true);
      const mark = screen.getByRole("button", {
        name: "Mark as filed",
      }) as HTMLButtonElement;
      expect(mark.disabled).toBe(true);
      amendment.unmount();

      api.computeBirForm.mockClear();
      api.fetchBirForm.mockImplementation(() => Promise.resolve(returnDetail(form, {})));
      renderEditor(`/bir-forms/${DRAFT_ID}`);
      await waitFor(() => expect(api.computeBirForm).toHaveBeenCalled(), {
        timeout: 3000,
      });
      expect(api.computeBirForm.mock.calls.at(-1)![1].amended).toBe("no");
      expect(screen.queryByText(/Save this amendment first/)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// Round 2 of the review: no zero flash on a freshly mounted form; no Mark while
// a save is in flight and no Save while a Mark is; the "save first" note only
// where the screen really meets the rule.
// ---------------------------------------------------------------------------

describe("T5 a freshly mounted form, and overlapping actions (W3 review round 2)", () => {
  it("never computes a filed form's empty state, and shows its stored figures meanwhile", async () => {
    api.fetchBirForm.mockResolvedValue(
      returnDetail("2551Q", {
        status: "filed",
        filedAt: "2026-04-20T02:15:00.000Z",
        data: {
          year: "2026",
          amended: "no",
          rows: [{ atc: "PT010", taxable: "150000", rate: "3" }],
        },
        computed: {
          rows: [{ due: 4500 }],
          i14: 4500,
          i18: 0,
          i19: 4500,
          i23: 0,
          i24: 4500,
        },
      }),
    );
    api.computeBirForm.mockReturnValue(new Promise(() => {})); // never returns
    renderEditor(`/bir-forms/${DRAFT_ID}`);
    // Until the live compute returns, the stored figures are on screen.
    expect((await screen.findAllByText(/^₱\s?4,500(\.00)?$/)).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.computeBirForm).toHaveBeenCalled(), { timeout: 3000 });
    // Every compute call carried the stored rows: the empty first state of the
    // editor (taxable "") was never sent.
    for (const [, data] of api.computeBirForm.mock.calls) {
      expect((data as { rows: { taxable: string }[] }).rows[0]!.taxable).toBe("150000");
    }
  });

  it("holds Mark as issued while a save is in flight", async () => {
    api.fetchBirForm.mockResolvedValue(draft2307({ payeeBranch: "00000" }));
    api.fetchClient.mockResolvedValue(client("00000"));
    api.updateBirForm.mockReturnValue(new Promise(() => {})); // the save never lands
    renderAt(`/bir-forms/${FORM_ID}`);
    const issue = (await screen.findByRole("button", {
      name: "Mark as issued",
    })) as HTMLButtonElement;
    await waitFor(() => expect(issue.disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(issue.disabled).toBe(true));
  });

  it("holds Save while a Mark as filed is in flight", async () => {
    api.fetchBirForm.mockResolvedValue(returnDetail("2551Q", {}));
    api.updateBirForm.mockReturnValue(new Promise(() => {})); // the Mark never lands
    renderEditor(`/bir-forms/${DRAFT_ID}`);
    const save = (await screen.findByRole("button", {
      name: "Save changes",
    })) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Mark as filed" }));
    await waitFor(() => expect(save.disabled).toBe(true));
  });

  it("does not say the screen meets a payee rule when the screen breaks another one", async () => {
    // Saved: no payee branch. Screen: a branch that contradicts the payee TIN.
    api.fetchBirForm.mockResolvedValue(
      draft2307({ payeeBranch: "", payeeTin: "232-343-454-00001" }),
    );
    api.fetchClient.mockResolvedValue(client("00000"));
    renderAt(`/bir-forms/${FORM_ID}`);
    await screen.findByText(/Choose the payee's branch code/);
    fireEvent.change(payeeBranch(), { target: { value: "head" } }); // 00000 ≠ 00001
    const box = screen.getByTestId("issue-blockers");
    expect(box.textContent).toContain("Choose the payee's branch code");
    expect(box.textContent).not.toContain("not saved yet");
  });
});

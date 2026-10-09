// track-b-ExpenseImportModal.test.tsx — T5 (W5): the Expenses import modal
// renders the server's result (W5 R1 shape) and drives the API correctly.
//
// All data is invented. No real name, TIN, address, phone or email.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExpenseImportResult } from "../lib/api";

const api = vi.hoisted(() => ({
  importExpenseFile: vi.fn(),
  downloadExpenseTemplate: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  importExpenseFile: api.importExpenseFile,
  downloadExpenseTemplate: api.downloadExpenseTemplate,
}));

import { outcomeLabel } from "../lib/expenseStatus";
import { ExpenseImportModal, ExpenseImportResultTable } from "./ExpenseImportModal";

const CLIENT_ID = "aaaaaaaa-0000-4000-8000-000000000001";

/** One row of each outcome: a mixed receipt that posts as two records, a
 *  delivery receipt held for review, and a rejected row that creates nothing. */
const RESULT: ExpenseImportResult = {
  templateVersion: "1",
  clientId: CLIENT_ID,
  periodFrom: "2026-07-01",
  periodTo: "2026-09-30",
  rows: [
    {
      rowNumber: 2,
      outcome: "posted",
      needsReview: false,
      messages: ["Mixed receipt: split into a VAT-able record and a VAT-exempt record."],
      records: [
        {
          id: "r-2-1",
          classification: "PURCHASE_VATABLE",
          amount: 3306.25,
          vatAmount: 354.24,
          vatClaimable: false,
        },
        {
          id: "r-2-2",
          classification: "PURCHASE_VAT_EXEMPT",
          amount: 887.96,
          vatAmount: 0,
          vatClaimable: false,
        },
      ],
    },
    {
      rowNumber: 3,
      outcome: "held",
      needsReview: true,
      messages: ["Delivery receipt with no vendor TIN: held until a TIN is entered."],
      records: [
        {
          id: "r-3-1",
          classification: "PURCHASE_NO_TIN",
          amount: 1250,
          vatAmount: 0,
          vatClaimable: false,
        },
      ],
    },
    {
      rowNumber: 4,
      outcome: "rejected",
      needsReview: false,
      messages: ["Date is not a date.", "Amount is missing."],
      records: [],
    },
  ],
  totals: { rows: 3, posted: 1, held: 1, rejected: 1, grossAmount: 5444.21 },
};

const FINAL: ExpenseImportResult = {
  ...RESULT,
  rows: RESULT.rows.filter((r) => r.outcome !== "rejected"),
  totals: { rows: 2, posted: 1, held: 1, rejected: 0, grossAmount: 5444.21 },
};

const fetchSpy = vi.fn(() =>
  Promise.reject(new Error("the modal must call the API module")),
);

beforeEach(() => {
  api.importExpenseFile.mockReset();
  api.downloadExpenseTemplate.mockReset();
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rowsOf = (table: HTMLElement, n: number) =>
  Array.from(table.querySelectorAll<HTMLTableRowElement>(`tr[data-row-number="${n}"]`));
const amounts = (rows: HTMLTableRowElement[]) =>
  rows.map((r) => r.querySelector("[data-amount]")?.textContent);

describe("T5 the result table renders the W5 R1 shape", () => {
  it("shows each row's outcome, messages and records, with amounts and totals", () => {
    render(<ExpenseImportResultTable result={RESULT} final={false} />);
    const table = screen.getByRole("table", { name: "Import check" });

    const r2 = rowsOf(table, 2);
    expect(r2).toHaveLength(2); // one table row per record
    expect(r2[0]!.getAttribute("data-outcome")).toBe("posted");
    expect(r2[0]!.textContent).toContain("Will post");
    expect(r2[0]!.textContent).toContain("Mixed receipt: split into");
    expect(r2.map((r) => r.textContent?.includes("PURCHASE_"))).toEqual([true, true]);
    expect(amounts(r2)).toEqual(["₱3,306.25", "₱887.96"]);
    expect(r2[0]!.textContent).toContain("(VAT not claimable)");
    expect(r2[1]!.textContent).not.toContain("VAT not claimable"); // no VAT on that line

    const r3 = rowsOf(table, 3);
    expect(r3).toHaveLength(1);
    expect(r3[0]!.textContent).toContain("Will be held");
    expect(r3[0]!.textContent).toContain("Needs review");
    expect(amounts(r3)).toEqual(["₱1,250.00"]);

    const r4 = rowsOf(table, 4);
    expect(r4).toHaveLength(1); // a row with no records still shows, once
    expect(r4[0]!.textContent).toContain("Rejected");
    expect(r4[0]!.textContent).toContain("Date is not a date.");
    expect(r4[0]!.textContent).toContain("Amount is missing.");
    expect(r4[0]!.textContent).toContain("None");

    const totals = screen.getByTestId("import-totals").textContent ?? "";
    expect(totals).toContain("3 rows");
    expect(totals).toContain("1 will post");
    expect(totals).toContain("1 will be held");
    expect(totals).toContain("1 rejected");
    expect(totals).toContain("₱5,444.21");
  });

  it("says what happened, not what will, once the import has run", () => {
    render(<ExpenseImportResultTable result={FINAL} final />);
    const table = screen.getByRole("table", { name: "Import result" });
    expect(table.textContent).toContain("Records created");
    expect(rowsOf(table, 2)[0]!.textContent).toContain("Posted");
    expect(rowsOf(table, 3)[0]!.textContent).toContain("Held");
    expect(table.textContent).not.toContain("Will ");
    expect(outcomeLabel("posted", false)).toBe("Will post");
    expect(outcomeLabel("held", true)).toBe("Held");
    expect(outcomeLabel("rejected", false)).toBe("Rejected");
  });
});

describe("T5 the modal sends the file, never reads it, and shows errors verbatim", () => {
  function pick(name = "bakeshop-july.xlsx") {
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name, {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [file] } });
    return file;
  }

  it("dry run on choosing the file, then one real import on Import", async () => {
    api.importExpenseFile.mockImplementation((_c: string, _f: File, dryRun: boolean) =>
      Promise.resolve(dryRun ? RESULT : FINAL),
    );
    const onImported = vi.fn();
    render(
      <ExpenseImportModal
        clientId={CLIENT_ID}
        onClose={() => {}}
        onImported={onImported}
      />,
    );
    const file = pick();

    await screen.findByRole("table", { name: "Import check" });
    expect(api.importExpenseFile).toHaveBeenCalledTimes(1);
    expect(api.importExpenseFile).toHaveBeenLastCalledWith(CLIENT_ID, file, true);
    expect(
      screen.getByText(/This is a check\. Nothing has been saved yet\./),
    ).toBeTruthy();
    expect(onImported).not.toHaveBeenCalled();

    // Rows that will create records: 1 posted + 1 held. The rejected one is not saved.
    fireEvent.click(screen.getByRole("button", { name: "Import 2 rows" }));
    await screen.findByRole("table", { name: "Import result" });
    expect(api.importExpenseFile).toHaveBeenCalledTimes(2);
    expect(api.importExpenseFile).toHaveBeenLastCalledWith(CLIENT_ID, file, false);
    expect(screen.getByText(/Import finished:/).textContent).toContain(
      "1 posted, 1 held for review, 0 rejected",
    );
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the server's message verbatim when the check is refused", async () => {
    const message =
      "This file was downloaded for a different client. Download the template for this client and use that one.";
    api.importExpenseFile.mockRejectedValue(new Error(message));
    render(
      <ExpenseImportModal
        clientId={CLIENT_ID}
        onClose={() => {}}
        onImported={() => {}}
      />,
    );
    pick();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Import \d+ rows?$/ })).toBeNull();
  });

  it("offers no Import when nothing would be saved", async () => {
    api.importExpenseFile.mockResolvedValue({
      ...RESULT,
      rows: [RESULT.rows[2]!],
      totals: { rows: 1, posted: 0, held: 0, rejected: 1, grossAmount: 0 },
    });
    render(
      <ExpenseImportModal
        clientId={CLIENT_ID}
        onClose={() => {}}
        onImported={() => {}}
      />,
    );
    pick();
    await screen.findByRole("table", { name: "Import check" });
    const button = screen.getByRole("button", {
      name: "Import 0 rows",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("Download template asks the API for this client's template", async () => {
    api.downloadExpenseTemplate.mockResolvedValue({
      blob: new Blob(["x"]),
      filename: "expenses-template-SAMPLE-v1.xlsx",
    });
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    render(
      <ExpenseImportModal
        clientId={CLIENT_ID}
        onClose={() => {}}
        onImported={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download template" }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(api.downloadExpenseTemplate).toHaveBeenCalledWith(CLIENT_ID);
    const a = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(a.download).toBe("expenses-template-SAMPLE-v1.xlsx");
    click.mockRestore();
  });
});

// W24: the expense form splits a full TIN into the 9-digit TIN and the Branch box, while the
// person types or pastes; the prefill (W19) then runs with the 9-digit TIN. All data invented.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TransactionEntryModal from "./TransactionEntryModal";
import type { Category, ChartAccount, PurchaseTxn } from "../lib/api";

const m = vi.hoisted(() => ({
  fetchPayeeDetails: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
}));

const chartAccounts: ChartAccount[] = [
  {
    code: "6001",
    name: "Office Supplies",
    class: "Expense",
    accountType: "Operating Expense",
    normalBalance: "debit",
    currency: "PHP",
    monthlyMovement: false,
  },
];

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  createPurchase: m.createPurchase,
  updatePurchase: m.updatePurchase,
  fetchPayeeDetails: m.fetchPayeeDetails,
  fetchBirAtcCodes: vi.fn(() => Promise.resolve([])),
  fetchChartAccounts: vi.fn(() => Promise.resolve(chartAccounts)),
}));

const categories: Category[] = [
  { id: "c2", clientId: "cl", type: "EXPENSE", name: "Supplies", isDeductible: true },
];

const FOUND = {
  found: true as const,
  tin: "111222333",
  branch: "00000",
  payeeKind: "individual" as const,
  registeredName: "",
  lastName: "Dela Cruz",
  firstName: "Juana",
  middleName: "Reyes",
  vendor: "Juana Dela Cruz",
};

function open(existing?: PurchaseTxn, kind: "expense" | "income" = "expense") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TransactionEntryModal
        clientId="cl"
        regime="VAT"
        kind={kind}
        categories={categories}
        existing={existing ?? null}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </QueryClientProvider>,
  );
}

const tin = () => screen.getByLabelText("Supplier TIN") as HTMLInputElement;
const branch = () => screen.getByLabelText("Branch") as HTMLInputElement;
const type = (v: string) => fireEvent.change(tin(), { target: { value: v } });
const paste = (v: string) => {
  fireEvent.paste(tin());
  fireEvent.change(tin(), { target: { value: v } });
};
const note = () => document.querySelector("[data-tin-split-note]");
const conflict = () => document.querySelector("[data-tin-branch-conflict]");

beforeEach(() => {
  m.fetchPayeeDetails.mockReset();
  m.fetchPayeeDetails.mockResolvedValue({ found: false });
  m.createPurchase.mockReset();
  m.createPurchase.mockResolvedValue({ id: "p1" });
  m.updatePurchase.mockReset();
  m.updatePurchase.mockResolvedValue({ id: "p9" });
});

describe("W24 the TIN box and the Branch box", () => {
  it("asks for 9 digits, for example 123-456-789, with Branch beside it (up to 5 digits)", () => {
    open();
    expect(tin().placeholder).toBe("123-456-789");
    expect(
      document.getElementById(tin().getAttribute("aria-describedby")!)!.textContent,
    ).toBe("9 digits, for example 123-456-789.");
    expect(
      document.getElementById(branch().getAttribute("aria-describedby")!)!.textContent,
    ).toBe("Up to 5 digits.");
  });
  it("a sale's customer TIN is unchanged: no Branch, no split", () => {
    open(undefined, "income");
    const box = screen.getByLabelText("Customer TIN") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "123-456-789-00012" } });
    expect(box.value).toBe("123-456-789-00012");
    expect(screen.queryByLabelText("Branch")).toBeNull();
    expect(note()).toBeNull();
  });
});

describe("W24 the split while typing or pasting", () => {
  it("9 digits stay as typed, with or without dashes; nothing is said", () => {
    open();
    type("123456789");
    expect(tin().value).toBe("123456789");
    type("123-456-789");
    expect(tin().value).toBe("123-456-789");
    expect(branch().value).toBe("");
    expect(note()).toBeNull();
    expect(conflict()).toBeNull();
  });

  for (const typed of ["123-456-789-00012", "12345678900012", "123 456 789 00012"]) {
    it(`14 digits (${typed}) with Branch empty: the TIN keeps 9 digits, Branch takes the rest, with the note`, () => {
      open();
      type(typed);
      expect(tin().value).toBe("123-456-789");
      expect(branch().value).toBe("00012");
      expect(note()!.textContent).toBe("Branch moved to the Branch field.");
      expect(conflict()).toBeNull();
    });
  }

  it("14 digits with Branch already the same: split, Branch stays", () => {
    open();
    fireEvent.change(branch(), { target: { value: "00012" } });
    type("123-456-789-00012");
    expect(tin().value).toBe("123-456-789");
    expect(branch().value).toBe("00012");
    expect(note()).not.toBeNull();
  });

  it("14 digits with a different Branch: both stay as typed, and the person is told", () => {
    open();
    fireEvent.change(branch(), { target: { value: "00001" } });
    type("123-456-789-00012");
    expect(tin().value).toBe("123-456-789-00012");
    expect(branch().value).toBe("00001");
    expect(note()).toBeNull();
    expect(conflict()!.textContent).toBe(
      "The TIN includes a branch (00012) that differs from the Branch field. Check which is right.",
    );
    // fixing the Branch box clears the warning; the TIN is split when the box is left
    fireEvent.change(branch(), { target: { value: "00012" } });
    expect(conflict()).toBeNull();
    fireEvent.blur(tin());
    expect(tin().value).toBe("123-456-789");
  });

  it("12 digits typed are split when the box is left (they may still grow to 14)", () => {
    open();
    type("123-456-789-000");
    expect(tin().value).toBe("123-456-789-000");
    expect(note()).toBeNull();
    fireEvent.blur(tin());
    expect(tin().value).toBe("123-456-789");
    expect(branch().value).toBe("000");
    expect(note()).not.toBeNull();
  });

  it("typing on from 12 to 14 digits splits once, at 14", () => {
    open();
    type("123-456-789-000");
    type("123-456-789-0001");
    type("123-456-789-00012");
    expect(tin().value).toBe("123-456-789");
    expect(branch().value).toBe("00012");
  });

  it("12 digits pasted, with or without dashes, are split at once", () => {
    open();
    paste("123456789000");
    expect(tin().value).toBe("123-456-789");
    expect(branch().value).toBe("000");
  });

  it("12 digits with the same Branch are split; with a different Branch they stay, with the warning", () => {
    open();
    fireEvent.change(branch(), { target: { value: "000" } });
    paste("123-456-789-000");
    expect(tin().value).toBe("123-456-789");
    cleanupAndOpen();
    fireEvent.change(branch(), { target: { value: "00007" } });
    paste("123-456-789-000");
    expect(tin().value).toBe("123-456-789-000");
    expect(conflict()!.textContent).toContain("(000)");
  });

  it("the note goes when the TIN is changed again", () => {
    open();
    type("123-456-789-00012");
    expect(note()).not.toBeNull();
    type("123-456-78");
    expect(note()).toBeNull();
  });
});

describe("W24 the prefill runs after the split, with the 9-digit TIN", () => {
  it("asks once with 9 digits and fills the blank boxes; the branch from the TIN stays", async () => {
    m.fetchPayeeDetails.mockResolvedValue(FOUND);
    open();
    type("111-222-333-00012");
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Last name").value).toBe(
        "Dela Cruz",
      ),
    );
    expect(m.fetchPayeeDetails).toHaveBeenCalledTimes(1);
    expect(m.fetchPayeeDetails).toHaveBeenCalledWith("cl", "111222333");
    expect(branch().value).toBe("00012"); // not the 00000 on file
    expect(
      screen.getByText("Filled from the latest expense with this TIN."),
    ).toBeInTheDocument();
  });
  it("a Branch the person typed (and not the TIN's) still stops the prefill, as in W19", async () => {
    m.fetchPayeeDetails.mockResolvedValue(FOUND);
    open();
    fireEvent.change(branch(), { target: { value: "00003" } });
    type("111-222-333");
    await new Promise((r) => setTimeout(r, 20));
    expect(m.fetchPayeeDetails).not.toHaveBeenCalled();
  });
  it("a different branch in the TIN: no split, so no prefill", async () => {
    m.fetchPayeeDetails.mockResolvedValue(FOUND);
    open();
    fireEvent.change(branch(), { target: { value: "00001" } });
    type("111-222-333-00012");
    await new Promise((r) => setTimeout(r, 20));
    expect(m.fetchPayeeDetails).not.toHaveBeenCalled();
  });
});

describe("W24 saved data is never changed on its own", () => {
  const saved = {
    id: "p9",
    clientId: "cl",
    txnDate: "2026-10-01",
    description: "Paper",
    netAmount: 100,
    account: "6001",
    vendor: "Old Supplier",
    vendorTin: "123-456-789-00012",
    vendorBranch: null,
  } as unknown as PurchaseTxn;
  it("opening an expense with a 14-digit TIN, and leaving the box untouched, changes nothing", async () => {
    open(saved);
    expect(tin().value).toBe("123-456-789-00012");
    fireEvent.focus(tin());
    fireEvent.blur(tin());
    expect(tin().value).toBe("123-456-789-00012");
    expect(branch().value).toBe("");
    expect(note()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.updatePurchase).toHaveBeenCalledTimes(1));
    const body = m.updatePurchase.mock.calls[0]![2] as Record<string, unknown>;
    expect(body.vendorTin).toBe("123-456-789-00012");
    expect(body).not.toHaveProperty("vendorBranch");
  });
  it("on edit, typing the TIN again splits it like on create", () => {
    open(saved);
    type("123-456-789-00012 ");
    expect(tin().value).toBe("123-456-789");
    expect(branch().value).toBe("00012");
  });
});

describe("W24 what is saved", () => {
  it("a pasted 14-digit TIN saves as vendorTin of 9 digits and vendorBranch", async () => {
    open();
    paste("123-456-789-00012");
    const input = screen.getByPlaceholderText("Select account…");
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText("Office Supplies"));
    fireEvent.change(screen.getByPlaceholderText("Enter name or description"), {
      target: { value: "Paper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.createPurchase).toHaveBeenCalledTimes(1));
    const body = m.createPurchase.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.vendorTin).toBe("123-456-789");
    expect(String(body.vendorTin).replace(/\D/g, "")).toHaveLength(9);
    expect(body.vendorBranch).toBe("00012");
  });
});

function cleanupAndOpen() {
  cleanup();
  open();
}

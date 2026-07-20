import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TransactionEntryModal from "./TransactionEntryModal";
import type { Category, ChartAccount } from "../lib/api";

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
  {
    code: "6002",
    name: "Power and Water",
    class: "Expense",
    accountType: "Operating Expense",
    normalBalance: "debit",
    currency: "PHP",
    monthlyMovement: false,
  },
  {
    code: "4001",
    name: "Service Income",
    class: "Revenue",
    accountType: "Revenue",
    normalBalance: "credit",
    currency: "PHP",
    monthlyMovement: false,
  },
];

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  createIncome: vi.fn(),
  createPurchase: vi.fn(),
  fetchBirAtcCodes: vi.fn(() => Promise.resolve([])),
  fetchChartAccounts: vi.fn(() => Promise.resolve(chartAccounts)),
}));

const categories: Category[] = [
  { id: "c1", clientId: "cl", type: "INCOME", name: "Consulting", isDeductible: false },
  { id: "c2", clientId: "cl", type: "EXPENSE", name: "Supplies", isDeductible: true },
];

function open(props: Partial<Parameters<typeof TransactionEntryModal>[0]>) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TransactionEntryModal
        clientId="cl"
        regime="VAT"
        kind="income"
        categories={categories}
        onClose={() => {}}
        onSaved={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("TransactionEntryModal — invoice/bill line-item entry", () => {
  it("renders an Invoice with a Tax Rate column and a 12% VAT option for VAT income", () => {
    open({ regime: "VAT", kind: "income" });
    expect(screen.getByText("Invoice")).toBeInTheDocument();
    expect(screen.getByText("Tax Rate")).toBeInTheDocument();
    expect(screen.getByText("12% VAT")).toBeInTheDocument();
  });

  it("offers only Non-VAT (Percentage) tax rate for a percentage income", () => {
    open({ regime: "PERCENTAGE", kind: "income" });
    expect(screen.getByText(/Non-VAT \(Percentage\)/i)).toBeInTheDocument();
    expect(screen.queryByText("12% VAT")).not.toBeInTheDocument();
  });

  it("renders a Bill with a Tax Code column for an expense", () => {
    open({ regime: "VAT", kind: "expense" });
    expect(screen.getByText("Bill")).toBeInTheDocument();
    expect(screen.getByText("Tax Code")).toBeInTheDocument();
  });

  it("shows the line → record hint when adding", () => {
    open({ regime: "VAT", kind: "income" });
    expect(screen.getByText(/1 line → 1 record/i)).toBeInTheDocument();
  });

  it("wires the Account picker to the Chart of Accounts with type-to-search", async () => {
    open({ regime: "VAT", kind: "expense" });
    const input = screen.getByPlaceholderText("Select account…");
    fireEvent.focus(input);
    // All chart accounts are offered once loaded…
    expect(await screen.findByText("Office Supplies")).toBeInTheDocument();
    expect(screen.getByText("Service Income")).toBeInTheDocument();
    // …typing narrows the list…
    fireEvent.change(input, { target: { value: "power" } });
    expect(await screen.findByText("Power and Water")).toBeInTheDocument();
    expect(screen.queryByText("Office Supplies")).not.toBeInTheDocument();
    // …and picking one fills the field with the account name.
    fireEvent.click(screen.getByText("Power and Water"));
    expect((input as HTMLInputElement).value).toBe("Power and Water");
  });

  it("lists expense-class accounts before revenue accounts on a Bill", async () => {
    open({ regime: "VAT", kind: "expense" });
    fireEvent.focus(screen.getByPlaceholderText("Select account…"));
    await screen.findByText("Office Supplies");
    const codes = screen
      .getAllByText(/^(4001|6001|6002)$/)
      .map((el) => el.textContent);
    expect(codes).toEqual(["6001", "6002", "4001"]);
  });
});

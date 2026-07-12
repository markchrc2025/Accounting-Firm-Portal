import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TransactionEntryModal from "./TransactionEntryModal";
import type { Category } from "../lib/api";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  createIncome: vi.fn(),
  createPurchase: vi.fn(),
  fetchBirAtcCodes: vi.fn(() => Promise.resolve([])),
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
});

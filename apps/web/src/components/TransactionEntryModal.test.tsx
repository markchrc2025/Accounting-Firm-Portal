import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TransactionEntryModal from "./TransactionEntryModal";
import type { Category } from "../lib/api";

vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  createIncome: vi.fn(),
  createPurchase: vi.fn(),
}));

const categories: Category[] = [
  { id: "c1", clientId: "cl", type: "INCOME", name: "Consulting", isDeductible: false },
  { id: "c2", clientId: "cl", type: "EXPENSE", name: "Supplies", isDeductible: true },
];

function open(props: Partial<Parameters<typeof TransactionEntryModal>[0]>) {
  return render(
    <TransactionEntryModal
      clientId="cl"
      regime="VAT"
      kind="income"
      categories={categories}
      onClose={() => {}}
      onSaved={() => {}}
      {...props}
    />,
  );
}

describe("TransactionEntryModal — regime awareness", () => {
  it("shows the VAT classification and a 'Net of VAT' amount for a VAT income", () => {
    open({ regime: "VAT", kind: "income" });
    expect(screen.getByText("VAT class")).toBeInTheDocument();
    expect(screen.getByText(/Net of VAT/i)).toBeInTheDocument();
    expect(screen.getByText(/VAT-registered client/i)).toBeInTheDocument();
  });

  it("hides VAT fields and labels the amount 'Gross receipts' for a percentage income", () => {
    open({ regime: "PERCENTAGE", kind: "income" });
    expect(screen.queryByText("VAT class")).not.toBeInTheDocument();
    expect(screen.getByText(/Gross receipts/i)).toBeInTheDocument();
    expect(screen.getByText(/Percentage-tax/i)).toBeInTheDocument();
  });

  it("shows the input-VAT classification for a VAT expense", () => {
    open({ regime: "VAT", kind: "expense" });
    expect(screen.getByText("Input VAT category")).toBeInTheDocument();
    expect(screen.getByText(/Deductible for income tax/i)).toBeInTheDocument();
  });

  it("hides the input-VAT block for a percentage expense", () => {
    open({ regime: "PERCENTAGE", kind: "expense" });
    expect(screen.queryByText("Input VAT category")).not.toBeInTheDocument();
  });
});

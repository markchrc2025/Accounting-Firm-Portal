// W19: the expense form's payee details and the TIN prefill (Track A U19).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TransactionEntryModal from "./TransactionEntryModal";
import type { Category, ChartAccount } from "../lib/api";

const m = vi.hoisted(() => ({
  fetchPayeeDetails: vi.fn(),
  createPurchase: vi.fn(),
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
  updatePurchase: vi.fn(),
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

function open(kind: "expense" | "income" = "expense") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <TransactionEntryModal
        clientId="cl"
        regime="VAT"
        kind={kind}
        categories={categories}
        onClose={() => {}}
        onSaved={() => {}}
      />
    </QueryClientProvider>,
  );
}

const tinBox = () => screen.getByLabelText("Supplier TIN"); // W24: was found by its old placeholder
const typeTin = (v: string) => fireEvent.change(tinBox(), { target: { value: v } });
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => {
  m.fetchPayeeDetails.mockReset();
  m.createPurchase.mockReset();
  m.createPurchase.mockResolvedValue({ id: "p1" });
});

describe("expense form — payee details", () => {
  it("offers Branch and the Individual/Company choice; names appear for an Individual", () => {
    open();
    expect(box("Branch")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Payee" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Individual"));
    expect(box("Last name")).toBeInTheDocument();
    expect(box("First name")).toBeInTheDocument();
    expect(box("Middle name")).toBeInTheDocument();
  });

  it("shows a short hint, and no name boxes, for a Company", () => {
    open();
    fireEvent.click(screen.getByLabelText("Company"));
    expect(document.querySelector("[data-company-hint]")).not.toBeNull();
    expect(screen.queryByLabelText("Last name")).not.toBeInTheDocument();
  });

  it("is not on a sale", () => {
    open("income");
    expect(document.querySelector("[data-payee-details]")).toBeNull();
  });

  it("saves the payee details it was given, and nothing when none were", async () => {
    open();
    fireEvent.click(screen.getByLabelText("Individual"));
    fireEvent.change(box("Branch"), { target: { value: "00012" } });
    fireEvent.change(box("Last name"), { target: { value: "Santos" } });
    fireEvent.change(box("First name"), { target: { value: "Maria" } });
    const input = screen.getByPlaceholderText("Select account…");
    fireEvent.focus(input);
    fireEvent.click(await screen.findByText("Office Supplies"));
    fireEvent.change(screen.getByPlaceholderText("Enter name or description"), {
      target: { value: "Paper" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.createPurchase).toHaveBeenCalledTimes(1));
    const body = m.createPurchase.mock.calls[0]![1] as Record<string, unknown>;
    expect(body).toMatchObject({
      vendorBranch: "00012",
      payeeKind: "individual",
      payeeLastName: "Santos",
      payeeFirstName: "Maria",
    });
    expect(body).not.toHaveProperty("payeeMiddleName");
  });
});

describe("expense form — prefill from the TIN", () => {
  it("fills the blank boxes once the TIN holds 9 digits, with the note", async () => {
    m.fetchPayeeDetails.mockResolvedValue(FOUND);
    open();
    typeTin("111-222-333");
    await waitFor(() => expect(box("Last name").value).toBe("Dela Cruz"));
    expect(box("First name").value).toBe("Juana");
    expect(box("Middle name").value).toBe("Reyes");
    expect(box("Branch").value).toBe("00000");
    expect((screen.getByLabelText("Individual") as HTMLInputElement).checked).toBe(true);
    expect(
      screen.getByText("Filled from the latest expense with this TIN."),
    ).toBeInTheDocument();
    expect(m.fetchPayeeDetails).toHaveBeenCalledWith("cl", "111222333");
  });

  it("does not ask before 9 digits", () => {
    open();
    typeTin("111-222-33");
    expect(m.fetchPayeeDetails).not.toHaveBeenCalled();
  });

  it("asks once per TIN, however often the field changes", async () => {
    m.fetchPayeeDetails.mockResolvedValue({ found: false });
    open();
    typeTin("111222333");
    typeTin("111-222-333");
    typeTin("111222333");
    await waitFor(() => expect(m.fetchPayeeDetails).toHaveBeenCalledTimes(1));
    typeTin("111222333 ");
    expect(m.fetchPayeeDetails).toHaveBeenCalledTimes(1);
  });

  it("never overwrites what was typed: it does not ask when a box holds something", () => {
    open();
    fireEvent.change(box("Branch"), { target: { value: "00007" } });
    typeTin("111222333");
    expect(m.fetchPayeeDetails).not.toHaveBeenCalled();
    expect(box("Branch").value).toBe("00007");
  });

  it("never overwrites what is typed while the answer is on its way", async () => {
    let resolve!: (v: typeof FOUND) => void;
    m.fetchPayeeDetails.mockReturnValue(new Promise((r) => (resolve = r)));
    open();
    typeTin("111222333");
    fireEvent.click(screen.getByLabelText("Company"));
    resolve(FOUND);
    await waitFor(() => expect(box("Branch").value).toBe("00000"));
    // The person chose Company; the saved Individual does not replace it.
    expect((screen.getByLabelText("Company") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Individual") as HTMLInputElement).checked).toBe(false);
  });

  it("shows nothing when nothing is found", async () => {
    m.fetchPayeeDetails.mockResolvedValue({ found: false });
    open();
    typeTin("111222333");
    await waitFor(() => expect(m.fetchPayeeDetails).toHaveBeenCalled());
    expect(document.querySelector("[data-payee-prefilled]")).toBeNull();
    expect(box("Branch").value).toBe("");
  });

  it("shows nothing when the API refuses (400)", async () => {
    m.fetchPayeeDetails.mockRejectedValue(new Error("The TIN must be 9 digits."));
    open();
    typeTin("111222333");
    await waitFor(() => expect(m.fetchPayeeDetails).toHaveBeenCalled());
    expect(document.querySelector("[data-payee-prefilled]")).toBeNull();
    expect(screen.queryByText(/must be 9 digits/)).not.toBeInTheDocument();
  });

  it("drops the note once the person edits a box", async () => {
    m.fetchPayeeDetails.mockResolvedValue(FOUND);
    open();
    typeTin("111222333");
    await screen.findByText("Filled from the latest expense with this TIN.");
    fireEvent.change(box("Last name"), { target: { value: "Cruz" } });
    expect(document.querySelector("[data-payee-prefilled]")).toBeNull();
  });
});

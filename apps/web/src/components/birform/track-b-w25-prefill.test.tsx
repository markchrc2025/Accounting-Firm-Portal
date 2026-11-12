// W25: the 0619-E, 1601-EQ and 1601-C editors fill the contact number and email from the
// client record (GET /clients/:id, the client page's read) while those boxes are blank, with the
// hint, and never over a typed or saved value; a filed return is left as stored. Invented data.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const never = () => new Promise<never>(() => undefined);
const api = vi.hoisted(() => ({
  fetchBirForm: vi.fn(),
  fetchClients: vi.fn(),
  fetchClient: vi.fn(),
  computeBirForm: vi.fn(),
  createBirForm: vi.fn(),
  updateBirForm: vi.fn(),
  fetchBookFigures: vi.fn(),
  fetchAlphalistCheck: vi.fn(),
  fetchUsers: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...api,
}));

import BirForm0619EEditor from "../../pages/BirForm0619EEditor";
import BirForm1601EQEditor from "../../pages/BirForm1601EQEditor";
import BirForm1601CEditor from "../../pages/BirForm1601CEditor";

const ALPHA = {
  id: "c-alpha",
  businessName: "INVENTED ALPHA TRADING",
  currency: "PHP",
  status: "Active",
  phone: "+63 917 800 5122",
  email: "owner@alpha.example",
};
const BETA = {
  id: "c-beta",
  businessName: "INVENTED BETA FOODS",
  currency: "PHP",
  status: "Active",
  phone: "(0918) 111 2222",
  email: "pay@beta.example",
};
const NOPHONE = { ...BETA, id: "c-none", businessName: "INVENTED NO PHONE", phone: null };

const draft = (
  over: Record<string, unknown> = {},
  data: Record<string, unknown> = {},
) => ({
  id: "f1",
  form: "0619E",
  clientId: "c-alpha",
  clientName: "INVENTED ALPHA TRADING",
  status: "draft",
  period: "2026-10",
  filedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  amendsId: null,
  sequence: 1,
  exports: [],
  computed: null,
  confirmation: null,
  confirmationRequired: false,
  filingUndos: [],
  data: { year: "2026", month: "10", amended: "no", contact: "", email: "", ...data },
  ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchClients.mockResolvedValue([ALPHA, BETA, NOPHONE]);
  api.fetchClient.mockImplementation((id: string) =>
    Promise.resolve([ALPHA, BETA, NOPHONE].find((c) => c.id === id)),
  );
  api.computeBirForm.mockImplementation(never);
  api.fetchBookFigures.mockImplementation(never);
  api.fetchAlphalistCheck.mockImplementation(never);
  api.fetchUsers.mockImplementation(never);
  api.updateBirForm.mockImplementation((_id: string, b: Record<string, unknown>) =>
    Promise.resolve({ ...draft(), ...b }),
  );
});
afterEach(() => cleanup());

let qc: QueryClient;
function open(editor: React.ReactElement, path = "/bir-forms/f1") {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/bir-forms/new" element={editor} />
          <Route path="/bir-forms/:id" element={editor} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const contact = () => screen.getByLabelText(/^Contact number/) as HTMLInputElement;
const email = () => screen.getByLabelText(/^Email address/) as HTMLInputElement;
const hints = () =>
  screen
    .queryAllByText("Filled from the client record.")
    .map((h) => h.previousElementSibling);

describe("W25 a saved draft fills its blank contact and email from the client", () => {
  it("0619-E: both filled (the phone as the API writes it), with the hint, read once per client", async () => {
    api.fetchBirForm.mockResolvedValue(draft());
    open(<BirForm0619EEditor />);
    await waitFor(() => expect(contact().value).toBe("09178005122"));
    expect(email().value).toBe("owner@alpha.example");
    expect(screen.getAllByText("Filled from the client record.")).toHaveLength(2);
    expect(api.fetchClient).toHaveBeenCalledWith("c-alpha");
    expect(api.fetchClient).toHaveBeenCalledTimes(1);
  });

  it("never overwrites a saved value; only the blank one is filled", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft({}, { contact: "0999 000 1111", email: "" }),
    );
    open(<BirForm0619EEditor />);
    await waitFor(() => expect(email().value).toBe("owner@alpha.example"));
    expect(contact().value).toBe("0999 000 1111");
    expect(screen.getAllByText("Filled from the client record.")).toHaveLength(1);
  });

  it("the hint goes once the owner edits the box, and the edit is kept", async () => {
    api.fetchBirForm.mockResolvedValue(draft());
    open(<BirForm0619EEditor />);
    await waitFor(() => expect(contact().value).toBe("09178005122"));
    fireEvent.change(contact(), { target: { value: "09170000000" } });
    expect(contact().value).toBe("09170000000");
    expect(screen.getAllByText("Filled from the client record.")).toHaveLength(1);
    // typing the same number back is still the owner's edit: the hint does not return
    fireEvent.change(contact(), { target: { value: "09178005122" } });
    expect(screen.getAllByText("Filled from the client record.")).toHaveLength(1);
  });

  it("a fresh read of the saved draft never lets the client's phone overwrite its saved number", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft({}, { contact: "0999 000 1111", email: "" }),
    );
    open(<BirForm0619EEditor />);
    await waitFor(() => expect(email().value).toBe("owner@alpha.example"));
    // the owner clears the box, then the saved draft is read again (as after a save)
    fireEvent.change(contact(), { target: { value: "" } });
    api.fetchBirForm.mockResolvedValue(
      draft(
        { updatedAt: "2026-10-02T00:00:00.000Z" },
        { contact: "0999 000 1111", email: "" },
      ),
    );
    await act(async () => {
      await qc.refetchQueries({ queryKey: ["bir-form", "f1"] });
    });
    await waitFor(() => expect(contact().value).toBe("0999 000 1111"));
    await new Promise((r) => setTimeout(r, 30));
    expect(contact().value).toBe("0999 000 1111");
  });

  it("the prefilled values are unsaved changes: Save sends them", async () => {
    api.fetchBirForm.mockResolvedValue(draft());
    open(<BirForm0619EEditor />);
    await waitFor(() => expect(email().value).toBe("owner@alpha.example"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.updateBirForm).toHaveBeenCalledTimes(1));
    const body = api.updateBirForm.mock.calls[0]![1] as { data: Record<string, unknown> };
    expect(body.data.contact).toBe("09178005122");
    expect(body.data.email).toBe("owner@alpha.example");
  });

  it("a client with no phone leaves the contact blank and fills the email only", async () => {
    api.fetchBirForm.mockResolvedValue(draft({ clientId: "c-none" }));
    open(<BirForm0619EEditor />);
    await waitFor(() => expect(email().value).toBe("pay@beta.example"));
    expect(contact().value).toBe("");
    expect(screen.getAllByText("Filled from the client record.")).toHaveLength(1);
  });

  it("a filed return is left as stored: nothing read, nothing filled", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft({ status: "filed", filedAt: "2026-11-05T00:00:00.000Z" }),
    );
    open(<BirForm0619EEditor />);
    await screen.findByText("0619-E", { exact: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(contact().value).toBe("");
    expect(email().value).toBe("");
    expect(api.fetchClient).not.toHaveBeenCalled();
  });

  it("1601-EQ and 1601-C fill the same way", async () => {
    api.fetchBirForm.mockResolvedValue(
      draft({ form: "1601EQ", period: "2026-Q3" }, { quarter: "3rd", month: undefined }),
    );
    const one = open(<BirForm1601EQEditor />);
    await waitFor(() => expect(contact().value).toBe("09178005122"));
    expect(email().value).toBe("owner@alpha.example");
    one.unmount();
    api.fetchBirForm.mockResolvedValue(draft({ form: "1601C" }));
    open(<BirForm1601CEditor />);
    await waitFor(() => expect(contact().value).toBe("09178005122"));
    expect(email().value).toBe("owner@alpha.example");
  });
});

describe("W25 a new form fills once a client is chosen", () => {
  const client = () => screen.getByLabelText("Client") as HTMLSelectElement;
  it("choosing a client fills; changing it refills only its own values and blanks, never a typed one", async () => {
    open(<BirForm0619EEditor />, "/bir-forms/new");
    await waitFor(() => expect(client().options.length).toBeGreaterThan(1));
    expect(contact().value).toBe("");
    fireEvent.change(client(), { target: { value: "c-alpha" } });
    await waitFor(() => expect(contact().value).toBe("09178005122"));
    expect(email().value).toBe("owner@alpha.example");
    // the owner types an email of their own; the contact is still the client's
    fireEvent.change(email(), { target: { value: "mine@x.example" } });
    fireEvent.change(client(), { target: { value: "c-beta" } });
    await waitFor(() => expect(contact().value).toBe("09181112222"));
    expect(email().value).toBe("mine@x.example");
    expect(hints()).toHaveLength(1);
    // a client with no phone: the previous client's prefilled phone goes
    fireEvent.change(client(), { target: { value: "c-none" } });
    await waitFor(() => expect(contact().value).toBe(""));
    expect(email().value).toBe("mine@x.example");
  });
});

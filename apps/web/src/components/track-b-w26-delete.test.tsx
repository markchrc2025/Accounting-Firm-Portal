// W26: Delete client (Track A U25, D72): only with Clients:Delete; blockers word for word and no
// delete button; what goes and what stays; the name to type; the API's 400, 409 and 404 as sent;
// after a delete the Clients list with the note, the client's queries gone, the switcher reset.
// The API module is mocked. Invented data.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchClientDeleteCheck: vi.fn(),
  deleteClient: vi.fn(),
}));
vi.mock("../lib/clientDelete", async (orig) => ({
  ...(await orig<typeof import("../lib/clientDelete")>()),
  ...api,
}));
const core = vi.hoisted(() => ({ fetchClients: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...core,
}));
const auth = vi.hoisted(() => ({ perms: new Set<string>() }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", userType: "FIRM", fullName: "Ana Reyes" },
    permissions: null,
    hasPermission: (p: string) => auth.perms.has(p),
  }),
  useOptionalAuth: () => ({
    user: { id: "u1" },
    hasPermission: (p: string) => auth.perms.has(p),
  }),
}));

import { ApiError } from "../lib/api";
import { DeleteClientButton } from "./DeleteClientButton";
import { ClientSwitcher } from "./ClientSwitcher";
import ClientsPage from "../pages/ClientsPage";

const A = {
  id: "c-a",
  businessName: "INVENTED ALPHA TRADING",
  currency: "PHP",
  status: "ACTIVE",
};
const B = {
  id: "c-b",
  businessName: "INVENTED BETA FOODS",
  currency: "PHP",
  status: "ACTIVE",
};
const OK = {
  canDelete: true,
  nameToType: "INVENTED ALPHA TRADING CORP",
  blockers: [],
  willDelete: [
    { kind: "purchaseTransactions", count: 124 },
    { kind: "birFormDrafts", count: 2 },
    { kind: "corFiles", count: 1 },
  ],
  willUnlink: [{ kind: "fsReports", count: 1 }],
};
const BLOCKED = {
  canDelete: false,
  nameToType: "INVENTED ALPHA TRADING CORP",
  blockers: [
    {
      kind: "filedBirReturns",
      count: 3,
      sentence:
        "This client cannot be deleted: it has 3 filed BIR returns. Archive it instead.",
    },
    {
      kind: "sentInvoices",
      count: 2,
      sentence:
        "This client cannot be deleted: it has 2 sent invoices. Archive it instead.",
    },
  ],
  willDelete: [{ kind: "incomeTransactions", count: 5 }],
  willUnlink: [],
};

let qc: QueryClient;
function open(path = "/clients/c-a") {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["clients"], [A, B]);
  qc.setQueryData(["client", "c-a"], A);
  qc.setQueryData(["dashboard-something", "c-a", "x"], { any: 1 });
  qc.setQueryData(["client", "c-b"], B);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/clients/:clientId"
            element={
              <>
                <ClientSwitcher activeClientId="c-a" />
                <DeleteClientButton clientId="c-a" clientName={A.businessName} />
              </>
            }
          />
          <Route
            path="/clients"
            element={
              <>
                <ClientSwitcher activeClientId={null} />
                <ClientsPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const dialog = () => within(screen.getByRole("dialog"));
const deleteBtn = () =>
  dialog().getByRole("button", { name: "Delete client" }) as HTMLButtonElement;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  core.fetchClients.mockReset();
  core.fetchClients.mockImplementation(() => new Promise(() => undefined));
  auth.perms = new Set(["Clients:Read", "Clients:Update", "Clients:Delete"]);
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe("W26 who sees Delete client", () => {
  it("is hidden without Clients:Delete, on the page and in the list", () => {
    auth.perms = new Set(["Clients:Read", "Clients:Update"]);
    const v = open();
    expect(screen.queryByRole("button", { name: "Delete client" })).toBeNull();
    v.unmount();
    open("/clients");
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
  });
  it("is shown with Clients:Delete, on the page and in the list's row actions", () => {
    const v = open();
    expect(screen.getByRole("button", { name: "Delete client" })).toBeTruthy();
    v.unmount();
    open("/clients");
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(2);
  });
});

describe("W26 the confirmation", () => {
  it("a blocked client: every blocker sentence word for word, and no delete button", async () => {
    api.fetchClientDeleteCheck.mockResolvedValue(BLOCKED);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete client" }));
    expect(api.fetchClientDeleteCheck).toHaveBeenCalledWith("c-a");
    await waitFor(() =>
      expect(document.querySelectorAll("[data-blocker]").length).toBe(2),
    );
    expect(
      [...document.querySelectorAll("[data-blocker]")].map((e) => e.textContent),
    ).toEqual(BLOCKED.blockers.map((b) => b.sentence));
    expect(dialog().queryByRole("button", { name: "Delete client" })).toBeNull();
    expect(dialog().queryByRole("textbox")).toBeNull();
    expect(document.querySelector("[data-will-delete]")).toBeNull();
    fireEvent.click(dialog().getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a deletable client: what goes, what stays, the name to type; Delete waits for it", async () => {
    api.fetchClientDeleteCheck.mockResolvedValue(OK);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete client" }));
    await waitFor(() =>
      expect(document.querySelector("[data-will-delete]")).not.toBeNull(),
    );
    expect(
      [...document.querySelectorAll("[data-delete-kind]")].map((e) => e.textContent),
    ).toEqual(["124 purchase records", "2 draft BIR returns", "1 COR file"]);
    expect(document.querySelector("[data-unlink-kind]")!.textContent).toBe(
      "1 financial statement report, kept and unlinked",
    );
    expect(
      dialog().getByText("This cannot be undone. Type the client's name to confirm:"),
    ).toBeTruthy();
    expect(document.querySelector("[data-name-to-type]")!.textContent).toBe(
      "INVENTED ALPHA TRADING CORP",
    );
    const box = dialog().getByLabelText(
      "This cannot be undone. Type the client's name to confirm:",
    );
    expect(deleteBtn().disabled).toBe(true);
    fireEvent.change(box, { target: { value: "INVENTED ALPHA TRADING" } }); // wrong name
    expect(deleteBtn().disabled).toBe(true);
    fireEvent.change(box, { target: { value: "  invented   alpha trading corp " } });
    expect(deleteBtn().disabled).toBe(false);
  });

  it.each([
    [400, "Type the client's name exactly to delete it."],
    [
      409,
      "This client cannot be deleted: it has 3 filed BIR returns and 2 sent invoices. Archive it instead.",
    ],
    [404, "Client not found"],
  ])("the API's %s shows word for word in the confirmation", async (status, sentence) => {
    api.fetchClientDeleteCheck.mockResolvedValue(OK);
    api.deleteClient.mockRejectedValue(
      new ApiError(status, sentence, { message: sentence }),
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete client" }));
    const box = await waitFor(() =>
      dialog().getByLabelText(
        "This cannot be undone. Type the client's name to confirm:",
      ),
    );
    fireEvent.change(box, { target: { value: "invented alpha trading corp" } });
    fireEvent.click(deleteBtn());
    await waitFor(() =>
      expect(document.querySelector("[data-delete-error]")?.textContent).toBe(sentence),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("a refusal of the check itself shows as sent", async () => {
    api.fetchClientDeleteCheck.mockRejectedValue(
      new ApiError(404, "Client not found", {}),
    );
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete client" }));
    expect((await dialog().findByRole("alert")).textContent).toBe("Client not found");
  });
});

describe("W26 after a delete", () => {
  async function typeAndDelete(filesNotRemoved: { key: string }[] = []) {
    api.fetchClientDeleteCheck.mockResolvedValue(OK);
    api.deleteClient.mockResolvedValue({
      deleted: OK.willDelete,
      unlinked: OK.willUnlink,
      filesNotRemoved,
    });
    open();
    fireEvent.click(screen.getByRole("button", { name: "Delete client" }));
    const box = await waitFor(() =>
      dialog().getByLabelText(
        "This cannot be undone. Type the client's name to confirm:",
      ),
    );
    fireEvent.change(box, { target: { value: "Invented Alpha Trading Corp" } });
    fireEvent.click(deleteBtn());
  }

  it("sends the typed name, goes to the Clients list with the note, the client gone everywhere", async () => {
    window.localStorage.setItem("mcrc.activeClientId", "c-a");
    // the switcher shows the deleted client while it is open
    await typeAndDelete();
    expect(api.deleteClient).toHaveBeenCalledWith("c-a", "Invented Alpha Trading Corp");
    await screen.findByText("Client deleted.");
    expect(screen.queryByText(/Some stored files/)).toBeNull();
    // the list and the switcher no longer have it; the switcher reads Select client
    expect(screen.queryByText("INVENTED ALPHA TRADING")).toBeNull();
    expect(screen.getByText("INVENTED BETA FOODS")).toBeTruthy();
    expect(screen.getByText("Select client")).toBeTruthy();
    // every cached query that named the client is gone; the other client's stay
    expect(qc.getQueryData(["client", "c-a"])).toBeUndefined();
    expect(qc.getQueryData(["dashboard-something", "c-a", "x"])).toBeUndefined();
    expect(qc.getQueryData(["client", "c-b"])).toEqual(B);
    expect(window.localStorage.getItem("mcrc.activeClientId")).toBeNull();
  });

  it("files that could not be removed: the note says so", async () => {
    await typeAndDelete([{ key: "cor/c-a.pdf" }]);
    expect(
      await screen.findByText(
        "Client deleted. Some stored files could not be removed. They are listed in the server log.",
      ),
    ).toBeTruthy();
  });

  it("from the Clients list's row actions: the note shows on the same list and the row goes", async () => {
    api.fetchClientDeleteCheck.mockResolvedValue({ ...OK, nameToType: A.businessName });
    api.deleteClient.mockResolvedValue({
      deleted: [],
      unlinked: [],
      filesNotRemoved: [],
    });
    open("/clients");
    const row = screen.getByText("INVENTED ALPHA TRADING").closest("tr") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    const box = await waitFor(() =>
      dialog().getByLabelText(
        "This cannot be undone. Type the client's name to confirm:",
      ),
    );
    fireEvent.change(box, { target: { value: A.businessName } });
    fireEvent.click(deleteBtn());
    expect(await screen.findByText("Client deleted.")).toBeTruthy();
    expect(screen.queryByText("INVENTED ALPHA TRADING")).toBeNull();
  });
});

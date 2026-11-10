// track-b-pb3-screens.test.tsx - PB3: the API tokens page (a token shown once, copy, revoke with a
// question, the Super Admin's firm tab), the Connect Claude help, and the link on the profile page,
// with the API mocked. The API's sentences are shown as sent. All data is invented.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchMyTokens: vi.fn(),
  fetchFirmTokens: vi.fn(),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
}));
vi.mock("../lib/apiTokens", async (orig) => ({
  ...(await orig<typeof import("../lib/apiTokens")>()),
  ...api,
}));
const profile = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...profile,
}));
vi.mock("../lib/notifications", async (orig) => ({
  ...(await orig<typeof import("../lib/notifications")>()),
  fetchNotificationPreferences: vi.fn().mockResolvedValue({ emailEnabled: false }),
}));
const auth = vi.hoisted(() => ({
  user: { userType: "FIRM", fullName: "Ana Reyes" } as {
    userType: string;
    fullName: string;
  },
  perms: new Set<string>(),
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: auth.user,
    hasPermission: (p: string) => auth.perms.has(p),
    refreshUser: vi.fn(),
  }),
  useOptionalAuth: () => ({
    user: auth.user,
    hasPermission: (p: string) => auth.perms.has(p),
  }),
}));

import { ApiError } from "../lib/api";
import type { ApiToken, FirmApiToken } from "../lib/apiTokens";
import { ConnectClaudeHelp } from "../components/projects/ConnectClaudeHelp";
import ApiTokensPage from "./ApiTokensPage";
import ProfilePage from "./ProfilePage";

const SECRET = "ppt_TESTONLYnotarealtoken0123456789abcdefghijk";
const token = (id: string, over: Partial<ApiToken> = {}): ApiToken => ({
  id,
  name: `Token ${id}`,
  scope: "read_write",
  prefix: `ppt_${id}abcd`.slice(0, 10),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-11-10T16:30:00.000Z",
  ...over,
});
const firmToken = (id: string, over: Partial<FirmApiToken> = {}): FirmApiToken => ({
  ...token(id),
  owner: { id: "u-ben", fullName: "Ben Cruz", email: "ben@example.test" },
  ...over,
});

function Where() {
  const l = useLocation();
  return <div data-where>{l.pathname + l.search}</div>;
}
let qc: QueryClient;
function mount(ui: React.ReactElement, path = "/profile/tokens") {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/profile" element={<div data-profile>profile</div>} />
          <Route
            path="*"
            element={
              <>
                {ui}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const where = () => document.querySelector("[data-where]")!.textContent;
const rowIds = () =>
  Array.from(document.querySelectorAll("[data-token]")).map((r) =>
    r.getAttribute("data-token"),
  );

const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }));
const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
  auth.user = { userType: "FIRM", fullName: "Ana Reyes" };
  auth.perms = new Set();
  api.fetchMyTokens.mockResolvedValue({
    items: [token("a1"), token("b2", { scope: "read" })],
  });
});
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(navigator, "clipboard", original);
});

const openCreate = async () => {
  await screen.findByText("Token a1");
  fireEvent.click(screen.getByRole("button", { name: "Create token" }));
  return screen.getByRole("dialog", { name: "Create token" });
};
const makeToken = async (name = "Laptop") => {
  const dlg = await openCreate();
  fireEvent.change(within(dlg).getByLabelText(/^Name/), { target: { value: name } });
  fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
  return screen.findByRole("region", { name: "New token" });
};

// ---------------------------------------------------------------------------------------------

describe("PB3 my tokens: the list", () => {
  it("shows name, the start of the token, what it may do, last used and created in Manila time, and the status", async () => {
    api.fetchMyTokens.mockResolvedValue({
      items: [
        token("a1", { lastUsedAt: "2026-11-10T16:30:00.000Z" }),
        token("b2", { scope: "read" }),
        token("c3", { revokedAt: "2026-11-09T04:00:00.000Z" }),
      ],
    });
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    expect(rowIds()).toEqual(["a1", "b2", "c3"]);
    const a = within(document.querySelector('[data-token="a1"]') as HTMLElement);
    expect(a.getByText("Token a1")).toBeTruthy();
    expect(a.getByText("ppt_a1abcd…")).toBeTruthy();
    expect(a.getByText("Read and write")).toBeTruthy();
    expect(
      a.getByText("Nov 11, 2026, 12:30 AM", { selector: "[data-last-used]" }),
    ).toBeTruthy(); // 16:30 UTC is Manila the next day
    expect(a.getByText("Active")).toBeTruthy();
    const b = within(document.querySelector('[data-token="b2"]') as HTMLElement);
    expect(b.getByText("Read")).toBeTruthy();
    expect(b.getByText("Never used")).toBeTruthy();
    const c = document.querySelector('[data-token="c3"]') as HTMLElement;
    expect(within(c).getByText("Revoked")).toBeTruthy();
    expect(within(c).getByText("Nov 09, 2026, 12:00 PM")).toBeTruthy();
    // a revoked token has no Revoke button; the others do
    expect(within(c).queryByRole("button", { name: /Revoke/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Revoke Token a1" })).toBeTruthy();
  });

  it("says so when there are none, and shows the API's sentence when the list cannot load", async () => {
    api.fetchMyTokens.mockResolvedValue({ items: [] });
    mount(<ApiTokensPage />);
    await screen.findByText("No tokens yet");
    cleanup();
    api.fetchMyTokens.mockRejectedValue(new ApiError(500, "Could not list tokens.", {}));
    mount(<ApiTokensPage />);
    await screen.findByText("Could not load your tokens.");
    expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
      "Could not list tokens.",
    );
  });

  it("a client user has no tokens page and is sent back to their profile", async () => {
    auth.user = { userType: "CLIENT", fullName: "Cora" };
    mount(<ApiTokensPage />);
    await screen.findByText("profile");
    expect(api.fetchMyTokens).not.toHaveBeenCalled();
  });
});

describe("PB3 my tokens: making one", () => {
  beforeEach(() => {
    mount(<ApiTokensPage />);
  });

  it("asks for a name and what it may do (Read by default); the name and scope go to the API", async () => {
    api.createApiToken.mockResolvedValue({
      ...token("n1", { name: "Laptop" }),
      token: SECRET,
    });
    const dlg = await openCreate();
    expect((within(dlg).getByLabelText(/^Name/) as HTMLInputElement).placeholder).toBe(
      "Claude Code laptop",
    );
    expect(
      (within(dlg).getByRole("radio", { name: /^Read\b(?! and)/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/^Name/), {
      target: { value: "Laptop" },
    });
    fireEvent.click(within(dlg).getByRole("radio", { name: /Read and write/ }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
    await screen.findByRole("region", { name: "New token" });
    expect(api.createApiToken).toHaveBeenCalledWith({
      name: "Laptop",
      scope: "read_write",
    });
  });

  it("shows the token once, in a box with the warning and a Copy button", async () => {
    api.createApiToken.mockResolvedValue({
      ...token("n1", { name: "Laptop" }),
      token: SECRET,
    });
    const box = within(await makeToken());
    expect(box.getByLabelText("The token").textContent).toBe(SECRET);
    expect(box.getByRole("alert").textContent).toBe(
      "This token is shown only once. Copy it now and keep it somewhere safe.",
    );
    fireEvent.click(box.getByRole("button", { name: "Copy the token" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(SECRET));
    expect(await box.findByText("Copied to the clipboard.")).toBeTruthy();
  });

  it("also gives the claude.ai address with the token in it, and the warning that it is as secret as the token", async () => {
    api.createApiToken.mockResolvedValue({ ...token("n1"), token: SECRET });
    const box = within(await makeToken());
    const address = box.getByText(/\/api\/v1\/projects\/mcp\//).textContent!;
    expect(address.endsWith(`/api/v1/projects/mcp/${SECRET}`)).toBe(true);
    expect(address.startsWith("http://localhost:3000")).toBe(true);
    expect(
      box.getByText(
        "This address contains your token. Anyone who has it can act as you. Do not share it.",
      ),
    ).toBeTruthy();
    fireEvent.click(box.getByRole("button", { name: "Copy the address" }));
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(address));
  });

  it("is gone once closed: not on the page, not in any cache, and the list never has it", async () => {
    api.createApiToken.mockResolvedValue({
      ...token("n1", { name: "Laptop" }),
      token: SECRET,
    });
    // after the token is made the list is asked for again, and answers with the new one
    api.fetchMyTokens.mockResolvedValue({
      items: [token("n1", { name: "Laptop" }), token("a1")],
    });
    const box = await makeToken();
    expect(document.body.textContent).toContain(SECRET);
    // the list refreshed behind the box and shows the new token by its start only
    await waitFor(() => expect(rowIds()).toEqual(["n1", "a1"]));
    fireEvent.click(within(box).getByRole("button", { name: "I have copied it" }));
    expect(screen.queryByRole("region", { name: "New token" })).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
    expect(
      JSON.stringify(
        qc
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(SECRET);
    expect(qc.getMutationCache().getAll()).toHaveLength(0);
  });

  it("leaving the page and coming back does not bring it back", async () => {
    api.createApiToken.mockResolvedValue({ ...token("n1"), token: SECRET });
    await makeToken();
    cleanup();
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    expect(document.body.textContent).not.toContain(SECRET);
    expect(screen.queryByRole("region", { name: "New token" })).toBeNull();
  });

  it("shows the API's sentence as sent when it refuses, keeps the window open and shows no token", async () => {
    api.createApiToken.mockRejectedValue(
      new ApiError(400, "Give the token a name, for example 'Claude Code laptop'.", {}),
    );
    const dlg = await openCreate();
    fireEvent.click(within(dlg).getByRole("button", { name: "Create token" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "Give the token a name, for example 'Claude Code laptop'.",
      ),
    );
    expect(screen.getByRole("dialog", { name: "Create token" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "New token" })).toBeNull();
  });

  it("Cancel closes the window and makes nothing", async () => {
    const dlg = await openCreate();
    fireEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.createApiToken).not.toHaveBeenCalled();
  });
});

describe("PB3 my tokens: revoking", () => {
  it("asks first, naming the token; Cancel sends nothing", async () => {
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Token a1" }));
    const dlg = within(screen.getByRole("dialog"));
    expect(dlg.getByText(/Revoke the token “Token a1”\?/)).toBeTruthy();
    fireEvent.click(dlg.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.revokeApiToken).not.toHaveBeenCalled();
  });

  it("Revoke sends one request, asks for the list again, marks it revoked and says so", async () => {
    api.revokeApiToken.mockResolvedValue(
      token("a1", { revokedAt: "2026-11-10T09:00:00.000Z" }),
    );
    api.fetchMyTokens.mockResolvedValueOnce({ items: [token("a1")] }).mockResolvedValue({
      items: [token("a1", { revokedAt: "2026-11-10T09:00:00.000Z" })],
    });
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Token a1" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }),
    );
    await screen.findByText("Token “Token a1” revoked.");
    expect(api.revokeApiToken).toHaveBeenCalledTimes(1);
    expect(api.revokeApiToken).toHaveBeenCalledWith("a1");
    await waitFor(() => expect(document.querySelector("[data-revoked]")).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Revoke Token a1" })).toBeNull();
  });

  it("a refusal shows the API's sentence as sent in the question and keeps it open", async () => {
    api.revokeApiToken.mockRejectedValue(new ApiError(404, "Token not found.", {}));
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Token a1" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Revoke" }),
    );
    expect(
      await within(screen.getByRole("dialog")).findByText("Token not found."),
    ).toBeTruthy();
    expect(screen.queryByText(/revoked\./)).toBeNull();
  });
});

describe("PB3 the Super Admin's firm tokens", () => {
  it("no Firm tokens tab for anyone else, and the firm list is never asked for", async () => {
    mount(<ApiTokensPage />, "/profile/tokens?tab=firm");
    await screen.findByText("Token a1");
    expect(screen.queryByRole("tab", { name: "Firm tokens" })).toBeNull();
    expect(api.fetchFirmTokens).not.toHaveBeenCalled();
    expect(rowIds()).toEqual(["a1", "b2"]); // ?tab=firm is ignored
  });

  it("a Super Admin sees the tab: every token with its owner, Revoke only, never a token", async () => {
    auth.perms = new Set(["IntegrationClient:Update"]);
    api.fetchFirmTokens.mockResolvedValue({
      items: [
        firmToken("f1", { lastUsedAt: "2026-11-10T16:30:00.000Z" }),
        firmToken("f2", { revokedAt: "2026-11-09T04:00:00.000Z" }),
      ],
    });
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    fireEvent.click(screen.getByRole("tab", { name: "Firm tokens" }));
    await screen.findByText("Token f1");
    expect(where()).toContain("tab=firm");
    expect(rowIds()).toEqual(["f1", "f2"]);
    const row = within(document.querySelector('[data-token="f1"]') as HTMLElement);
    expect(row.getByText("Ben Cruz")).toBeTruthy();
    expect(row.getByText("ben@example.test")).toBeTruthy();
    expect(row.getByRole("button", { name: "Revoke Token f1" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create token" })).toBeNull(); // making is on My tokens
    expect(
      within(document.querySelector('[data-token="f2"]') as HTMLElement).queryByRole(
        "button",
      ),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("ppt_TEST");
  });

  it("revoking another person's token names the owner and sends the id", async () => {
    auth.perms = new Set(["IntegrationClient:Update"]);
    api.fetchFirmTokens.mockResolvedValue({ items: [firmToken("f1")] });
    api.revokeApiToken.mockResolvedValue(token("f1"));
    mount(<ApiTokensPage />, "/profile/tokens?tab=firm");
    await screen.findByText("Token f1");
    fireEvent.click(screen.getByRole("button", { name: "Revoke Token f1" }));
    const dlg = within(screen.getByRole("dialog"));
    expect(dlg.getByText(/Revoke the token “Token f1” of Ben Cruz\?/)).toBeTruthy();
    fireEvent.click(dlg.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(api.revokeApiToken).toHaveBeenCalledWith("f1"));
  });

  it("the API's refusal of the firm list shows as sent", async () => {
    auth.perms = new Set(["IntegrationClient:Update"]);
    api.fetchFirmTokens.mockRejectedValue(
      new ApiError(403, "Only a Super Admin can list every token of the firm.", {}),
    );
    mount(<ApiTokensPage />, "/profile/tokens?tab=firm");
    await screen.findByText("Could not load the firm's tokens.");
    expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
      "Only a Super Admin can list every token of the firm.",
    );
  });
});

describe("PB3 Connect Claude help", () => {
  it("builds both addresses from the API origin; the claude.ai one shows where the token goes, not a token", () => {
    mount(<ConnectClaudeHelp origin="https://portal.example.test" />);
    expect(
      screen.getByText("https://portal.example.test/api/v1/projects/mcp"),
    ).toBeTruthy();
    expect(
      screen.getByText("Authorization: Bearer ${PORTAL_PROJECTS_TOKEN}"),
    ).toBeTruthy();
    expect(
      screen.getByText("https://portal.example.test/api/v1/projects/mcp/<your token>"),
    ).toBeTruthy();
    expect(screen.getByRole("note").textContent).toBe(
      "This address contains your token. Anyone who has it can act as you. Do not share it.",
    );
    expect(document.body.textContent).not.toMatch(/ppt_/);
  });

  it("uses the API origin the web app already uses when none is given", () => {
    mount(<ConnectClaudeHelp />);
    expect(screen.getByText("http://localhost:3000/api/v1/projects/mcp")).toBeTruthy();
  });

  it("each line copies", async () => {
    mount(<ConnectClaudeHelp origin="https://portal.example.test" />);
    fireEvent.click(screen.getAllByRole("button", { name: /Copy the address/ })[0]!);
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(
        "https://portal.example.test/api/v1/projects/mcp",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy the header" }));
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(
        "Authorization: Bearer ${PORTAL_PROJECTS_TOKEN}",
      ),
    );
  });

  it("is on the tokens page, with no token anywhere before one is made", async () => {
    mount(<ApiTokensPage />);
    await screen.findByText("Token a1");
    expect(document.querySelector("[data-connect-claude]")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/ppt_[A-Za-z0-9]{20}/);
  });
});

describe("PB3 the profile page", () => {
  const PROFILE = {
    id: "u1",
    fullName: "Ana Reyes",
    email: "ana@example.test",
    userType: "FIRM" as const,
    mfaEnabled: false,
    avatarUrl: null,
  };
  it("a firm user has a My API tokens link; a client user does not", async () => {
    profile.fetchProfile.mockResolvedValue(PROFILE);
    mount(<ProfilePage />, "/me");
    const link = await screen.findByRole("link", { name: "My API tokens" });
    expect(link.getAttribute("href")).toBe("/profile/tokens");
    cleanup();
    profile.fetchProfile.mockResolvedValue({ ...PROFILE, userType: "CLIENT" });
    mount(<ProfilePage />, "/me");
    await screen.findByText("Account details");
    expect(screen.queryByRole("link", { name: "My API tokens" })).toBeNull();
  });
});

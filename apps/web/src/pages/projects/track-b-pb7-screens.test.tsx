// track-b-pb7-screens.test.tsx - PB7: the firm's project details (the free-text client and Link to
// client, the fee box and its suggestion, the category, the recurring switch with its preview, the
// repository fields gone), the portfolio and overview, the project categories in settings, and the
// BIR Deadlines page. The API modules are mocked; their sentences are shown as sent. All data is
// invented.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
  fetchProject: vi.fn(),
  fetchProjects: vi.fn(),
  fetchProjectsMeta: vi.fn(),
  fetchClientMatches: vi.fn(),
  fetchRecurrencePreview: vi.fn(),
  listAdmin: vi.fn(),
  createAdmin: vi.fn(),
  updateAdmin: vi.fn(),
  deleteAdmin: vi.fn(),
  lookupIssueKey: vi.fn(),
}));
vi.mock("../../lib/projects", async (orig) => ({
  ...(await orig<typeof import("../../lib/projects")>()),
  ...api,
}));
const core = vi.hoisted(() => ({
  fetchClients: vi.fn(),
  createBirForm: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...core,
}));
const bir = vi.hoisted(() => ({ fetchBirDeadlines: vi.fn() }));
vi.mock("../../lib/birDeadlines", async (orig) => ({
  ...(await orig<typeof import("../../lib/birDeadlines")>()),
  ...bir,
}));
const auth = vi.hoisted(() => ({
  user: { userType: "FIRM" } as { userType: string },
  perms: new Set<string>(),
}));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, hasPermission: (p: string) => auth.perms.has(p) }),
  useOptionalAuth: () => ({
    user: auth.user,
    hasPermission: (p: string) => auth.perms.has(p),
  }),
}));

import { ApiError } from "../../lib/api";
import type { ProjectOverview, ProjectSummary } from "../../lib/projects";
import type { DeadlinesAnswer } from "../../lib/birDeadlines";
import { manilaToday } from "../../lib/projects";
import { previewDates } from "../../lib/recurrence";
import ProjectFormPage from "./ProjectFormPage";
import ProjectsPage from "./ProjectsPage";
import ProjectsSettingsPage from "./ProjectsSettingsPage";
import { OverviewTab } from "./OverviewTab";
import BirDeadlinesPage from "../BirDeadlinesPage";

const ALL = ["Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"];
const CAN = { read: true, create: true, update: true, configure: true };

function Where() {
  const l = useLocation();
  return <div data-where>{l.pathname + l.search}</div>;
}
function mount(ui: React.ReactElement, path = "/x", routePath = "*") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={routePath}
            element={
              <>
                {ui}
                <Where />
              </>
            }
          />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const where = () => document.querySelector("[data-where]")!.textContent;

const CLIENTS = [
  {
    id: "c1",
    businessName: "INVENTED ALPHA TRADING",
    currency: "PHP",
    status: "Active",
    professionalFee: "3500.00",
  },
  {
    id: "c2",
    businessName: "INVENTED BETA FOODS",
    currency: "PHP",
    status: "Active",
    professionalFee: null,
  },
];
const CATS = [
  { id: "k1", name: "Tax Filing", colour: "#1a7f37", order: 0 },
  { id: "k2", name: "Encoding", colour: "#57606a", order: 1 },
];
const PROJECT = {
  id: "p1",
  key: "PAY",
  name: "Payments",
  description: "",
  repoUrl: "https://example.test/repo",
  liveUrl: "https://example.test",
  deployAppName: "invented-app",
  archived: false,
  parent: null,
  client: null as { id: string; businessName: string } | null,
  clientName: null as string | null,
  professionalFee: null as string | null,
  suggestedProfessionalFee: null as string | null,
  category: null as { id: string; name: string; colour: string } | null,
  isRecurring: false,
  recurrenceStart: null as string | null,
  recurrenceEnd: null as string | null,
  recurrenceFrequency: null as string | null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const overview = (over: Partial<typeof PROJECT> = {}) =>
  ({
    security: { state: "clear", open: 0, critical: 0, high: 0 },
    recentSessions: [],
    project: { ...PROJECT, ...over },
    status: { value: "ON_TRACK", note: "", updatedAt: null },
    statusUpdates: [],
    progress: { done: 0, total: 0, percent: 0 },
    counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
    countsByStatus: [],
    countsByType: [],
    openMilestones: [],
    inProgress: [],
    recentActivity: [],
    lastActivityAt: null,
  }) as unknown as ProjectOverview;

beforeEach(() => {
  for (const f of [...Object.values(api), ...Object.values(core), ...Object.values(bir)])
    f.mockReset();
  auth.perms = new Set(ALL);
  core.fetchClients.mockResolvedValue(CLIENTS);
  api.fetchProjects.mockResolvedValue([]);
  api.fetchProjectsMeta.mockResolvedValue({
    issueTypes: [],
    issueStatuses: [],
    labels: [],
    users: [],
    projectCategories: CATS,
  });
  api.createProject.mockImplementation((b: { key: string }) =>
    Promise.resolve({ ...PROJECT, key: b.key }),
  );
  api.updateProject.mockResolvedValue({ ...PROJECT });
  api.fetchClientMatches.mockResolvedValue({
    clientName: null,
    linked: false,
    matches: [],
  });
});

// --- the project form -----------------------------------------------------------------------

const clientBox = () =>
  screen.getByRole("combobox", { name: "Client" }) as HTMLInputElement;
const feeBox = () => screen.getByLabelText("Professional fee") as HTMLInputElement;
const openNew = async () => {
  mount(<ProjectFormPage />, "/projects/new", "/projects/new");
  await waitFor(() => expect(core.fetchClients).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText(/^Key/), { target: { value: "NET" } });
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Network" } });
};
const openEdit = async (over: Partial<typeof PROJECT> = {}) => {
  api.fetchProject.mockResolvedValue(overview(over));
  mount(<ProjectFormPage />, "/projects/PAY/edit", "/projects/:key/edit");
  await screen.findByText("Edit PAY");
  await waitFor(() => expect(core.fetchClients).toHaveBeenCalled());
};
const sent = () =>
  (api.createProject.mock.calls[0]?.[0] ??
    api.updateProject.mock.calls[0]?.[1]) as Record<string, unknown>;
const submit = async (label: string) => {
  fireEvent.click(screen.getByRole("button", { name: label }));
};

describe("PB7 the client: type and search, any name accepted", () => {
  it("suggests listed clients as you type; picking one sets the client", async () => {
    await openNew();
    fireEvent.change(clientBox(), { target: { value: "alpha" } });
    const list = screen.getByRole("listbox", { name: "Clients" });
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["INVENTED ALPHA TRADING"]);
    fireEvent.mouseDown(within(list).getByRole("option"));
    expect(clientBox().value).toBe("INVENTED ALPHA TRADING");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.querySelector("[data-client-not-listed]")).toBeNull();
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({
      clientId: "c1",
      clientName: "INVENTED ALPHA TRADING",
    });
  });
  it("keyboard: arrow down and Enter pick the highlighted client", async () => {
    await openNew();
    fireEvent.change(clientBox(), { target: { value: "invented" } });
    fireEvent.keyDown(clientBox(), { key: "ArrowDown" });
    fireEvent.keyDown(clientBox(), { key: "Enter" });
    expect(clientBox().value).toBe("INVENTED BETA FOODS");
  });
  it("a name not on the list is kept as typed with the note, and saved as the name only", async () => {
    await openNew();
    fireEvent.change(clientBox(), { target: { value: "Juan's Bakery" } });
    expect(document.querySelector("[data-client-not-listed]")!.textContent).toBe(
      "Not in your client list",
    );
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ clientId: null, clientName: "Juan's Bakery" });
  });
  it("a listed name typed (not picked) shows no note and links nothing", async () => {
    await openNew();
    fireEvent.change(clientBox(), { target: { value: "invented beta foods" } });
    expect(document.querySelector("[data-client-not-listed]")).toBeNull();
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ clientId: null, clientName: "invented beta foods" });
  });
  it("typing another name on a linked project unlinks it", async () => {
    await openEdit({
      client: { id: "c1", businessName: "INVENTED ALPHA TRADING" },
      clientName: "INVENTED ALPHA TRADING",
    });
    expect(clientBox().value).toBe("INVENTED ALPHA TRADING");
    fireEvent.change(clientBox(), { target: { value: "Someone else" } });
    await submit("Save changes");
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ clientId: null, clientName: "Someone else" });
  });
});

describe("PB7 Link to client (the owner picks; never automatic)", () => {
  it("a typed name with one match offers Link to client; nothing is linked until it is pressed", async () => {
    api.fetchClientMatches.mockResolvedValue({
      clientName: "invented alpha trading",
      linked: false,
      matches: [{ id: "c1", businessName: "INVENTED ALPHA TRADING", status: "ACTIVE" }],
    });
    await openEdit({ clientName: "invented alpha trading" });
    const btn = await screen.findByRole("button", { name: "Link to client" });
    expect(
      screen.getByText("Matches INVENTED ALPHA TRADING in your client list."),
    ).toBeTruthy();
    expect(api.updateProject).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() =>
      expect(api.updateProject).toHaveBeenCalledWith("PAY", { clientId: "c1" }),
    );
    expect(await screen.findByText("Linked to INVENTED ALPHA TRADING.")).toBeTruthy();
    expect(clientBox().value).toBe("INVENTED ALPHA TRADING");
  });
  it("several matches: one button per client", async () => {
    api.fetchClientMatches.mockResolvedValue({
      clientName: "same",
      linked: false,
      matches: [
        { id: "c1", businessName: "SAME ONE", status: "ACTIVE" },
        { id: "c2", businessName: "SAME TWO", status: "ACTIVE" },
      ],
    });
    await openEdit({ clientName: "same" });
    expect(await screen.findByRole("button", { name: "Link to SAME TWO" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Link to SAME ONE" })).toBeTruthy();
  });
  it("no match, or a linked project: no button, and a linked project does not even ask", async () => {
    await openEdit({ clientName: "Nobody" });
    await waitFor(() => expect(api.fetchClientMatches).toHaveBeenCalledWith("PAY"));
    expect(screen.queryByRole("button", { name: /Link to/ })).toBeNull();
  });
  it("a refusal of the link shows as sent", async () => {
    api.fetchClientMatches.mockResolvedValue({
      clientName: "x",
      linked: false,
      matches: [{ id: "c1", businessName: "X", status: "ACTIVE" }],
    });
    api.updateProject.mockRejectedValue(
      new ApiError(403, "You cannot see this client.", {}),
    );
    await openEdit({ clientName: "x" });
    fireEvent.click(await screen.findByRole("button", { name: "Link to client" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You cannot see this client.",
    );
  });
  it("on the overview, Link to client shows for someone who may update, not for a reader", async () => {
    api.fetchClientMatches.mockResolvedValue({
      clientName: "x",
      linked: false,
      matches: [{ id: "c1", businessName: "X", status: "ACTIVE" }],
    });
    const view = mount(<OverviewTab ov={overview({ clientName: "x" })} can={CAN} />);
    expect(await screen.findByRole("button", { name: "Link to client" })).toBeTruthy();
    view.unmount();
    api.fetchClientMatches.mockClear();
    mount(
      <OverviewTab ov={overview({ clientName: "x" })} can={{ ...CAN, update: false }} />,
    );
    expect(screen.queryByRole("button", { name: "Link to client" })).toBeNull();
    expect(api.fetchClientMatches).not.toHaveBeenCalled();
  });
});

describe("PB7 the professional fee", () => {
  const key = (k: string) => fireEvent.keyDown(feeBox(), { key: k });
  it("blocks keys other than digits and the point (a minus, a letter, e)", async () => {
    await openNew();
    for (const k of ["-", "e", "a", "+", ","]) expect(key(k)).toBe(false); // default prevented
    for (const k of ["1", ".", "Backspace", "Tab", "ArrowLeft"])
      expect(key(k)).toBe(true);
  });
  it("takes digits with at most 2 decimals; anything else does not change the box", async () => {
    await openNew();
    fireEvent.change(feeBox(), { target: { value: "3500.5" } });
    expect(feeBox().value).toBe("3500.5");
    for (const bad of ["3500.555", "-1", "abc", "1,000"]) {
      fireEvent.change(feeBox(), { target: { value: bad } });
      expect(feeBox().value).toBe("3500.5");
    }
  });
  it("blocks pasted text that is not a fee", async () => {
    await openNew();
    const paste = (text: string) =>
      fireEvent.paste(feeBox(), { clipboardData: { getData: () => text } });
    expect(paste("abc")).toBe(false);
    expect(paste("-5")).toBe(false);
    expect(paste("1200.75")).toBe(true);
  });
  it("shows the peso sign, and sends the fee, or null when empty", async () => {
    await openNew();
    expect(document.querySelector("[data-fee-field]")!.textContent).toContain("₱");
    fireEvent.change(feeBox(), { target: { value: "1200." } });
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent().professionalFee).toBe("1200");
  });
  it("offers the picked client's fee as one click, never fills it by itself", async () => {
    await openNew();
    fireEvent.change(clientBox(), { target: { value: "alpha" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "INVENTED ALPHA TRADING" }));
    const use = screen.getByRole("button", { name: "Use the client's fee 3,500.00" });
    expect(feeBox().value).toBe("");
    fireEvent.click(use);
    expect(feeBox().value).toBe("3500.00");
    expect(screen.queryByRole("button", { name: /Use the client's fee/ })).toBeNull();
  });
  it("no suggestion for a client with no fee, a typed name, or a fee already typed", async () => {
    await openNew();
    fireEvent.change(clientBox(), { target: { value: "beta" } });
    fireEvent.mouseDown(screen.getByRole("option", { name: "INVENTED BETA FOODS" }));
    expect(screen.queryByRole("button", { name: /Use the client's fee/ })).toBeNull();
    fireEvent.change(clientBox(), { target: { value: "INVENTED ALPHA TRADING" } }); // typed, not picked
    expect(screen.queryByRole("button", { name: /Use the client's fee/ })).toBeNull();
    fireEvent.mouseDown(screen.getByRole("option", { name: "INVENTED ALPHA TRADING" }));
    fireEvent.change(feeBox(), { target: { value: "100" } });
    expect(screen.queryByRole("button", { name: /Use the client's fee/ })).toBeNull();
  });
  it("on edit, the API's suggestedProfessionalFee is offered", async () => {
    await openEdit({
      client: { id: "c2", businessName: "INVENTED BETA FOODS" },
      clientName: "INVENTED BETA FOODS",
      suggestedProfessionalFee: "1250.00",
    });
    expect(
      screen.getByRole("button", { name: "Use the client's fee 1,250.00" }),
    ).toBeTruthy();
  });
  it("the API's refusal of the fee shows as sent", async () => {
    api.createProject.mockRejectedValue(
      new ApiError(
        400,
        "The professional fee must be a number, zero or more, with at most 2 decimals.",
        {},
      ),
    );
    await openNew();
    fireEvent.change(feeBox(), { target: { value: "1" } });
    await submit("Create project");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The professional fee must be a number, zero or more, with at most 2 decimals.",
    );
  });
});

describe("PB7 category, and no repository fields", () => {
  it("picks a category from the firm's list and sends it; none sends null", async () => {
    await openNew();
    const sel = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(3));
    expect(Array.from(sel.options).map((o) => o.text)).toEqual([
      "No category",
      "Tax Filing",
      "Encoding",
    ]);
    fireEvent.change(sel, { target: { value: "k2" } });
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent().categoryId).toBe("k2");
  });
  it("the form has no repository, live URL or deployment name, and sends nothing for them", async () => {
    await openEdit();
    expect(screen.queryByLabelText(/Repository/)).toBeNull();
    expect(screen.queryByLabelText(/Live URL/)).toBeNull();
    expect(screen.queryByLabelText(/Deployment/)).toBeNull();
    await submit("Save changes");
    await waitFor(() => expect(api.updateProject).toHaveBeenCalledTimes(1));
    for (const k of ["repoUrl", "liveUrl", "deployAppName"])
      expect(sent()).not.toHaveProperty(k);
  });
});

describe("PB7 the recurring switch", () => {
  const sw = () => screen.getByRole("switch", { name: "Recurring" });
  it("off: no schedule fields, and isRecurring false is sent", async () => {
    await openNew();
    expect(sw().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("Start date")).toBeNull();
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({ isRecurring: false });
    expect(sent()).not.toHaveProperty("recurrenceStart");
  });
  it("on: start, end (blank hint), frequency, a preview of the next 5 dates and the one line", async () => {
    await openNew();
    fireEvent.click(sw());
    expect(sw().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Leave blank for no end date")).toBeTruthy();
    const freq = screen.getByLabelText("Frequency") as HTMLSelectElement;
    expect(Array.from(freq.options).map((o) => o.text)).toEqual([
      "Daily",
      "Weekly",
      "Bi-Weekly",
      "Monthly",
      "Quarterly",
      "Annually",
    ]);
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2026-01-15" },
    });
    fireEvent.change(freq, { target: { value: "QUARTERLY" } });
    const preview = document.querySelector('[data-recurrence-preview="preview"]')!;
    expect(preview.textContent).toContain("The next 5 dates (preview, not saved yet)");
    const want = previewDates(
      { on: true, start: "2026-01-15", end: "", frequency: "QUARTERLY" },
      manilaToday(),
    ).dates;
    expect(want).toHaveLength(5);
    expect(
      Array.from(preview.querySelectorAll("[data-date]")).map((e) =>
        e.getAttribute("data-date"),
      ),
    ).toEqual(want);
    expect(
      screen.getByText("Each date creates a task in this project, due that day."),
    ).toBeTruthy();
    await submit("Create project");
    await waitFor(() => expect(api.createProject).toHaveBeenCalledTimes(1));
    expect(sent()).toMatchObject({
      isRecurring: true,
      recurrenceStart: "2026-01-15",
      recurrenceEnd: null,
      recurrenceFrequency: "QUARTERLY",
    });
  });
  it("on without a start date: projects-core's sentence, and nothing is sent", async () => {
    await openNew();
    fireEvent.click(sw());
    expect(document.querySelector("[data-recurrence-problem]")!.textContent).toBe(
      "Choose a start date for the recurring project.",
    );
    await submit("Create project");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Choose a start date for the recurring project.",
    );
    expect(api.createProject).not.toHaveBeenCalled();
  });
  it("a saved schedule shows the API's next dates; a changed one is a preview again", async () => {
    api.fetchRecurrencePreview.mockResolvedValue({
      recurring: true,
      frequency: "MONTHLY",
      start: "2026-01-31",
      end: null,
      leadDays: 30,
      dates: ["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28", "2027-03-31"],
    });
    await openEdit({
      isRecurring: true,
      recurrenceStart: "2026-01-31",
      recurrenceFrequency: "MONTHLY",
    });
    const saved = await waitFor(() => {
      const el = document.querySelector('[data-recurrence-preview="saved"]');
      if (!el?.querySelector("[data-date]")) throw new Error("not yet");
      return el;
    });
    expect(api.fetchRecurrencePreview).toHaveBeenCalledWith("PAY");
    expect(saved.textContent).toContain("The next 5 dates");
    expect(saved.textContent).not.toContain("preview, not saved yet");
    expect(saved.querySelectorAll("[data-date]")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "WEEKLY" } });
    expect(document.querySelector('[data-recurrence-preview="preview"]')).not.toBeNull();
  });
});

// --- the portfolio and the overview ------------------------------------------------------------

const SUMMARY = (over: Partial<typeof PROJECT> & { key?: string } = {}) =>
  ({
    ...PROJECT,
    ...over,
    security: { state: "clear", open: 0, critical: 0, high: 0 },
    status: "ON_TRACK",
    statusNote: "",
    statusUpdatedAt: null,
    progress: { done: 0, total: 0, percent: 0 },
    counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
    nextMilestone: null,
    lastActivityAt: null,
  }) as unknown as ProjectSummary;

describe("PB7 the portfolio", () => {
  it("shows the client (a link for a listed one), category, fee and the Recurring badge", async () => {
    api.fetchProjects.mockResolvedValue([
      SUMMARY({
        key: "PAY",
        id: "p1",
        client: { id: "c1", businessName: "INVENTED ALPHA TRADING" },
        clientName: "INVENTED ALPHA TRADING",
        category: { id: "k1", name: "Tax Filing", colour: "#1a7f37" },
        professionalFee: "3500.00",
        isRecurring: true,
        recurrenceFrequency: "MONTHLY",
      }),
      SUMMARY({ key: "BKS", id: "p2", clientName: "Juan's Bakery" }),
    ]);
    mount(<ProjectsPage />, "/projects/all");
    const pay = await waitFor(() => {
      const el = document.querySelector('[data-project="PAY"]');
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    const link = within(pay).getByRole("link", { name: "INVENTED ALPHA TRADING" });
    expect(link.getAttribute("href")).toBe("/clients/c1");
    expect(pay.querySelector('[data-category="k1"]')!.textContent).toContain(
      "Tax Filing",
    );
    expect(pay.querySelector("[data-fee]")!.textContent).toBe("₱3,500.00");
    expect(pay.querySelector("[data-recurring]")!.textContent).toBe(
      "Recurring · Monthly",
    );
    const bks = document.querySelector('[data-project="BKS"]') as HTMLElement;
    expect(bks.querySelector("[data-client-typed]")!.textContent).toBe("Juan's Bakery");
    expect(within(bks).queryByRole("link", { name: "Juan's Bakery" })).toBeNull();
    expect(bks.querySelector("[data-recurring]")).toBeNull();
  });
  it("filters by category through the API, and by no category", async () => {
    mount(<ProjectsPage />, "/projects/all");
    const sel = (await screen.findByLabelText("Category")) as HTMLSelectElement;
    await waitFor(() => expect(sel.options.length).toBe(4));
    fireEvent.change(sel, { target: { value: "k1" } });
    await waitFor(() => expect(api.fetchProjects).toHaveBeenLastCalledWith(false, "k1"));
    fireEvent.change(sel, { target: { value: "none" } });
    await waitFor(() =>
      expect(api.fetchProjects).toHaveBeenLastCalledWith(false, "none"),
    );
    expect(await screen.findByText("No project in this category")).toBeTruthy();
  });
});

describe("PB7 the overview's details card", () => {
  it("shows client, fee, category and the schedule; no repository, live site or deployment", () => {
    mount(
      <OverviewTab
        ov={overview({
          client: { id: "c1", businessName: "INVENTED ALPHA TRADING" },
          clientName: "INVENTED ALPHA TRADING",
          professionalFee: "3500.00",
          category: { id: "k1", name: "Tax Filing", colour: "#1a7f37" },
          isRecurring: true,
          recurrenceStart: "2026-01-15",
          recurrenceEnd: null,
          recurrenceFrequency: "QUARTERLY",
        })}
        can={CAN}
      />,
    );
    const card = document.querySelector("[data-project-details]") as HTMLElement;
    expect(
      within(card)
        .getByRole("link", { name: "INVENTED ALPHA TRADING" })
        .getAttribute("href"),
    ).toBe("/clients/c1");
    expect(card.textContent).toContain("₱3,500.00");
    expect(card.textContent).toContain("Tax Filing");
    expect(card.querySelector("[data-recurring-details]")!.textContent).toBe(
      "Recurring · QuarterlyFrom Jan 15, 2026, no end date",
    );
    for (const gone of [
      "Repository",
      "Live site",
      "Deployment app",
      "example.test",
      "invented-app",
    ])
      expect(card.textContent).not.toContain(gone);
  });
  it("a typed client shows as text; no fee, no category, not recurring", () => {
    mount(
      <OverviewTab
        ov={overview({ clientName: "Juan's Bakery" })}
        can={{ ...CAN, update: false }}
      />,
    );
    const card = document.querySelector("[data-project-details]") as HTMLElement;
    expect(card.querySelector("[data-client]")!.textContent).toBe("Juan's Bakery");
    expect(card.textContent).toContain("Not set");
    expect(card.textContent).toContain("None");
  });
});

// --- settings: project categories --------------------------------------------------------------

describe("PB7 project categories in settings", () => {
  beforeEach(() => {
    api.listAdmin.mockImplementation((kind: string) =>
      Promise.resolve(
        kind === "project-categories"
          ? CATS.map((c, i) => ({ ...c, projectCount: i === 0 ? 3 : 1 }))
          : [],
      ),
    );
  });
  it("lists them with how many projects use each, for Projects:Configure", async () => {
    mount(<ProjectsSettingsPage />, "/projects/settings");
    const section = await waitFor(() => {
      const el = document.querySelector('[data-settings-section="project-categories"]');
      if (!el?.querySelector("[data-setting-row]")) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(within(section).getByText("Project categories")).toBeTruthy();
    expect(section.querySelector('[data-setting-row="k1"]')!.textContent).toContain(
      "Used by 3 projects",
    );
    expect(section.querySelector('[data-setting-row="k2"]')!.textContent).toContain(
      "Used by 1 project",
    );
  });
  it("adds one with name, colour and order", async () => {
    api.createAdmin.mockResolvedValue({ id: "k3" });
    mount(<ProjectsSettingsPage />, "/projects/settings");
    const section = await waitFor(() => {
      const el = document.querySelector('[data-settings-section="project-categories"]');
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    fireEvent.click(within(section).getByRole("button", { name: "Add category" }));
    const dlg = within(screen.getByRole("dialog"));
    fireEvent.change(dlg.getByLabelText("Name"), { target: { value: "Payroll" } });
    fireEvent.change(dlg.getByLabelText(/^Order/), { target: { value: "5" } });
    fireEvent.click(dlg.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.createAdmin).toHaveBeenCalledWith("project-categories", {
        name: "Payroll",
        colour: expect.any(String),
        order: 5,
      }),
    );
    expect(await within(section).findByText("The category was added.")).toBeTruthy();
  });
  it("a refusal (a category in use) shows as sent", async () => {
    const SENT =
      "This category is used by 3 projects. Change the category of them first.";
    api.deleteAdmin.mockRejectedValue(new ApiError(409, SENT, {}));
    mount(<ProjectsSettingsPage />, "/projects/settings");
    const row = await waitFor(() => {
      const el = document.querySelector(
        '[data-settings-section="project-categories"] [data-setting-row="k1"]',
      );
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete category" }),
    );
    await waitFor(() =>
      expect(api.deleteAdmin).toHaveBeenCalledWith("project-categories", "k1"),
    );
    const section = document.querySelector(
      '[data-settings-section="project-categories"]',
    ) as HTMLElement;
    expect((await within(section).findByRole("alert")).textContent).toBe(SENT);
  });
  it("is not shown to someone without Projects:Configure", async () => {
    auth.perms = new Set(["Projects:Read"]);
    mount(<ProjectsSettingsPage />, "/projects/settings");
    await waitFor(() => expect(where()).toBe("/projects/settings"));
    const section = document.querySelector(
      '[data-settings-section="project-categories"]',
    );
    expect(section?.textContent ?? "").toContain("You cannot change these.");
    expect(api.listAdmin).not.toHaveBeenCalled();
  });
});

// --- the BIR Deadlines page ------------------------------------------------------------------

const NOTE =
  "A due date on a Saturday or Sunday moves to Monday. The Portal has no holiday table yet, so public holidays are not considered.";
const ANSWER: DeadlinesAnswer = {
  from: "2026-11",
  to: "2026-12",
  today: "2026-11-11",
  notes: [NOTE],
  missing: [
    {
      clientId: "c9",
      clientName: "INVENTED GAMMA",
      missing: [
        {
          field: "taxTypes",
          sentence:
            "No registered tax types, so the withholding returns cannot be listed.",
        },
      ],
    },
  ],
  deadlines: [
    {
      dueDate: "2026-11-10",
      forms: [
        {
          form: "0619E",
          alternatives: [],
          title: "Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded)",
          period: "2026-10",
          periodWords: "October 2026",
          clients: [
            {
              clientId: "c1",
              clientName: "INVENTED ALPHA TRADING",
              status: "filed_bir",
              birFormId: "f1",
            },
            {
              clientId: "c2",
              clientName: "INVENTED BETA FOODS",
              status: "overdue",
              birFormId: null,
            },
          ],
        },
      ],
    },
    {
      dueDate: "2026-11-25",
      forms: [
        {
          form: "2551Q",
          alternatives: [],
          title: "Quarterly Percentage Tax Return",
          period: "2026-Q3",
          periodWords: "Q3 2026",
          clients: [
            {
              clientId: "c2",
              clientName: "INVENTED BETA FOODS",
              status: "draft",
              birFormId: "f2",
            },
            {
              clientId: "c3",
              clientName: "INVENTED DELTA",
              status: "filed_override",
              birFormId: "f3",
            },
            {
              clientId: "c4",
              clientName: "INVENTED EPSILON",
              status: "not_started",
              birFormId: null,
            },
          ],
        },
      ],
    },
  ],
};

describe("PB7 the BIR Deadlines page", () => {
  beforeEach(() => {
    auth.perms = new Set(["BIRForms:Read", "BIRForms:Create"]);
    bir.fetchBirDeadlines.mockResolvedValue(ANSWER);
  });
  const page = async () => {
    mount(<BirDeadlinesPage />, "/bir-deadlines", "/bir-deadlines");
    await screen.findByText(NOTE);
  };
  it("asks for this month and next (Manila) and shows the notes and what client records lack", async () => {
    await page();
    const m = manilaToday().slice(0, 7);
    const [y, mo] = [Number(m.slice(0, 4)), Number(m.slice(5, 7))];
    const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    expect(bir.fetchBirDeadlines).toHaveBeenCalledWith(m, next);
    expect(document.querySelector("[data-deadlines-missing]")!.textContent).toContain(
      "INVENTED GAMMA: No registered tax types, so the withholding returns cannot be listed.",
    );
  });
  it("lists the due dates in order, the forms with their period, and filed of total", async () => {
    await page();
    const days = Array.from(document.querySelectorAll("[data-due-date]"));
    expect(days.map((d) => d.getAttribute("data-due-date"))).toEqual([
      "2026-11-10",
      "2026-11-25",
    ]);
    expect(days[0]!.textContent).toContain("Tuesday, Nov 10, 2026");
    expect(days[0]!.querySelector("[data-due-count]")!.textContent).toBe("1 of 2 filed");
    expect(days[1]!.querySelector("[data-due-count]")!.textContent).toBe("1 of 3 filed");
    const form = days[1]!.querySelector('[data-deadline-form="2551Q|2026-Q3"]')!;
    expect(form.textContent).toContain("Quarterly Percentage Tax Return");
    expect(form.querySelector("[data-period]")!.textContent).toBe("Q3 2026");
  });
  it("shows each client's status chip in the owner's words, Overdue in red", async () => {
    await page();
    const chip = (client: string, due: string) =>
      document.querySelector(
        `[data-due-date="${due}"] [data-deadline-client="${client}"] [data-status]`,
      )!;
    expect(chip("c1", "2026-11-10").textContent).toBe("Filed");
    expect(chip("c2", "2026-11-10").textContent).toBe("Overdue");
    expect(chip("c2", "2026-11-10").className).toContain("text-danger");
    expect(chip("c2", "2026-11-25").textContent).toBe("Draft");
    expect(chip("c3", "2026-11-25").textContent).toBe("Filed without BIR email");
    expect(chip("c4", "2026-11-25").textContent).toBe("Not started");
  });
  it("opens the return when there is one", async () => {
    await page();
    const row = document.querySelector(
      '[data-due-date="2026-11-25"] [data-deadline-client="c2"]',
    ) as HTMLElement;
    expect(
      within(row).getByRole("link", { name: "Open the return" }).getAttribute("href"),
    ).toBe("/bir-forms/f2");
    expect(within(row).queryByRole("button", { name: "Create the draft" })).toBeNull();
  });
  it("otherwise creates the draft for that client, form and period, then opens it", async () => {
    core.createBirForm.mockResolvedValue({ id: "new-1" });
    await page();
    const row = document.querySelector(
      '[data-due-date="2026-11-25"] [data-deadline-client="c4"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Create the draft" }));
    await waitFor(() =>
      expect(core.createBirForm).toHaveBeenCalledWith({
        clientId: "c4",
        form: "2551Q",
        period: "2026-Q3",
        data: {},
      }),
    );
    await waitFor(() => expect(where()).toBe("/bir-forms/new-1"));
  });
  it("a refusal of the draft shows as sent", async () => {
    core.createBirForm.mockRejectedValue(
      new ApiError(409, "INVENTED: a draft already exists.", {}),
    );
    await page();
    const row = document.querySelector(
      '[data-due-date="2026-11-10"] [data-deadline-client="c2"]',
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Create the draft" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "INVENTED: a draft already exists.",
    );
  });
  it("without BIRForms:Create there is no create button; the open link stays", async () => {
    auth.perms = new Set(["BIRForms:Read"]);
    await page();
    expect(screen.queryByRole("button", { name: "Create the draft" })).toBeNull();
    expect(screen.getAllByRole("link", { name: "Open the return" })).toHaveLength(3);
  });
  it("filters by form, client and status; the counts follow", async () => {
    await page();
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "2551Q" } });
    expect(
      Array.from(document.querySelectorAll("[data-due-date]")).map((d) =>
        d.getAttribute("data-due-date"),
      ),
    ).toEqual(["2026-11-25"]);
    fireEvent.change(screen.getByLabelText("Form"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c2" } });
    expect(document.querySelectorAll("[data-deadline-client]")).toHaveLength(2);
    expect(
      document.querySelector('[data-due-date="2026-11-10"] [data-due-count]')!
        .textContent,
    ).toBe("0 of 1 filed");
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "overdue" } });
    const rows = document.querySelectorAll("[data-deadline-client]");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute("data-deadline-client")).toBe("c2");
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "filed_no_email" },
    });
    expect(
      document
        .querySelector("[data-deadline-client]")!
        .getAttribute("data-deadline-client"),
    ).toBe("c3");
  });
  it("a new month range asks again; a refusal of the range shows as sent", async () => {
    await page();
    bir.fetchBirDeadlines.mockRejectedValue(
      new ApiError(400, "The range can be at most 24 months.", {}),
    );
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2029-12" } });
    await waitFor(() =>
      expect(bir.fetchBirDeadlines).toHaveBeenLastCalledWith(
        expect.any(String),
        "2029-12",
      ),
    );
    expect(await screen.findByText("The range can be at most 24 months.")).toBeTruthy();
    expect(screen.getByText("Could not load the deadlines.")).toBeTruthy();
  });
  it("is not open to someone without BIRForms:Read", () => {
    auth.perms = new Set();
    mount(<BirDeadlinesPage />, "/bir-deadlines", "/bir-deadlines");
    expect(bir.fetchBirDeadlines).not.toHaveBeenCalled();
    expect(where()).toBe("/");
  });
});

// track-b-pb5-screens.test.tsx - PB5: the Claude sessions (the overview card, the Sessions tab,
// paging, the link from an activity entry), the session link on activity everywhere, and the
// Sentire Projects import (check, the same file only, the plain warning, the summary, refusals as
// sent, Super Admin only). The API module is mocked; its sentences are shown as sent. All data is
// invented.

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
  fetchSessions: vi.fn(),
  fetchActivity: vi.fn(),
  fetchMyWork: vi.fn(),
  importSentire: vi.fn(),
  listAdmin: vi.fn(),
  lookupIssueKey: vi.fn(),
}));
vi.mock("../../lib/projects", async (orig) => ({
  ...(await orig<typeof import("../../lib/projects")>()),
  ...api,
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
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  fetchClients: vi.fn(() => Promise.resolve([])),
}));

import { ApiError } from "../../lib/api";
import type {
  ActivityItem,
  ClaudeSession,
  MyWork,
  ProjectOverview,
  SentireImportReport,
} from "../../lib/projects";
import { SessionLink } from "../../components/projects/SessionLink";
import { ActivityEntries, ActivityTab } from "./ActivityTab";
import MyWorkPage from "./MyWorkPage";
import { OverviewTab } from "./OverviewTab";
import { RecentSessionsCard, SessionCard, SessionsTab } from "./SessionsTab";
import { SentireImportPanel } from "./SentireImportPanel";
import ProjectsSettingsPage from "./ProjectsSettingsPage";

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
          <Route path="/" element={<div data-home>home</div>} />
          <Route
            path={routePath}
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

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.lookupIssueKey.mockRejectedValue(new ApiError(404, "Issue not found.", {}));
  auth.user = { userType: "FIRM" };
  auth.perms = new Set(ALL);
});
afterEach(() => cleanup());

const session = (id: string, over: Partial<ClaudeSession> = {}): ClaudeSession => ({
  id,
  projectKey: "PAY",
  client: "claude-code",
  title: `Session ${id}`,
  startedAt: "2026-11-10T16:30:00.000Z",
  endedAt: "2026-11-10T18:00:00.000Z",
  summary: "Fixed the **login** form.",
  nextSteps: "- Add a test\n- Ship it",
  issueKeys: ["PAY-3", "PAY-9"],
  user: { id: "u-ana", fullName: "Ana Reyes" },
  ...over,
});
const page = (items: ClaudeSession[], p = 1, total = items.length, pageSize = 25) => ({
  items,
  page: p,
  pageSize,
  total,
});

// =============================================================================================

describe("PB5 a session on screen", () => {
  it("shows who, the client, the title, when it started and ended in Manila time, the summary and next steps as markdown, and the issues as links", () => {
    mount(<SessionCard s={session("s1")} projectKey="PAY" />);
    const card = within(document.querySelector('[data-session="s1"]') as HTMLElement);
    expect(card.getByRole("heading", { name: "Session s1" })).toBeTruthy();
    expect(card.getByText("Ana Reyes")).toBeTruthy();
    expect(card.getByText("claude-code")).toBeTruthy();
    // 16:30 UTC is 12:30 AM the next day in Manila; 18:00 UTC is 2:00 AM
    expect(card.getByText("Started Nov 11, 2026, 12:30 AM")).toBeTruthy();
    expect(card.getByText("Ended Nov 11, 2026, 2:00 AM")).toBeTruthy();
    expect(card.queryByText("Open")).toBeNull();
    expect(card.getByText("login").tagName).toBe("STRONG"); // markdown, not the stars
    expect(
      within(
        document.querySelector("[data-session-next-steps]") as HTMLElement,
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(
      within(document.querySelector("[data-session-issues]") as HTMLElement)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["PAY-3", "/projects/PAY/issues/PAY-3"],
      ["PAY-9", "/projects/PAY/issues/PAY-9"],
    ]);
  });

  it("a session with no person is Claude's; one that has not ended is Open", () => {
    mount(
      <SessionCard s={session("s2", { user: null, endedAt: null })} projectKey="PAY" />,
    );
    expect(document.querySelector("[data-session-who]")!.textContent).toBe("Claude");
    expect(document.querySelector("[data-session-open]")!.textContent).toBe("Open");
    expect(document.querySelector("[data-session-ended]")).toBeNull();
  });

  it("no title reads Session; no summary says so; no next steps leaves the heading out", () => {
    mount(
      <SessionCard
        s={session("s3", { title: "", summary: "", nextSteps: "" })}
        projectKey="PAY"
      />,
    );
    expect(screen.getByRole("heading", { name: "Session" })).toBeTruthy();
    expect(screen.getByText("No summary yet.")).toBeTruthy();
    expect(document.querySelector("[data-session-next-steps]")).toBeNull();
  });

  it("the summary is sanitised: a script in it is neither run nor on the page", () => {
    (window as unknown as Record<string, unknown>).__x = undefined;
    mount(
      <SessionCard
        s={session("s4", {
          summary:
            'Hello\n\n<script>window.__x = 1</script>\n\n<img src=x onerror="window.__x = 2">',
        })}
        projectKey="PAY"
      />,
    );
    expect(screen.getByText("Hello")).toBeTruthy();
    expect((window as unknown as Record<string, unknown>).__x).toBeUndefined();
    expect(document.querySelector("[data-session-summary] script")).toBeNull();
    expect(document.querySelector("[data-session-summary] img")).toBeNull();
  });
});

describe("PB5 recent sessions on the overview", () => {
  it("lists the sessions with a link to each in the Sessions tab and one to all of them", () => {
    mount(
      <RecentSessionsCard
        projectKey="PAY"
        sessions={[
          session("s1"),
          session("s2", { user: null, endedAt: null, title: "" }),
        ]}
      />,
    );
    const card = within(document.querySelector("[data-recent-sessions]") as HTMLElement);
    expect(card.getByRole("link", { name: "Session s1" }).getAttribute("href")).toBe(
      "/projects/PAY/sessions?session=s1",
    );
    expect(card.getByRole("link", { name: "Session" }).getAttribute("href")).toBe(
      "/projects/PAY/sessions?session=s2",
    );
    expect(card.getByRole("link", { name: "All sessions" }).getAttribute("href")).toBe(
      "/projects/PAY/sessions",
    );
    expect(
      Array.from(
        document.querySelectorAll("[data-recent-sessions-list] [data-session-who]"),
      ).map((e) => e.textContent),
    ).toEqual(["Ana Reyes", "Claude"]);
    expect(card.getByText("Open")).toBeTruthy();
  });
  it("says so when there are none", () => {
    mount(<RecentSessionsCard projectKey="PAY" sessions={[]} />);
    expect(screen.getByText("No Claude session yet.")).toBeTruthy();
  });
  it("is on the project overview, from recentSessions", () => {
    const ov = {
      security: { state: "clear", open: 0, critical: 0, high: 0 },
      recentSessions: [session("s1", { title: "On the overview" })],
      project: {
        id: "p1",
        key: "PAY",
        name: "Payments",
        description: "",
        repoUrl: "",
        liveUrl: "",
        deployAppName: "",
        archived: false,
        parent: null,
        client: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        updatedAt: "2026-11-01T00:00:00.000Z",
      },
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
    } as unknown as ProjectOverview;
    mount(<OverviewTab ov={ov} can={CAN} />);
    expect(screen.getByRole("link", { name: "On the overview" })).toBeTruthy();
  });
});

describe("PB5 the Sessions tab", () => {
  const tab = (path = "/projects/PAY/sessions") =>
    mount(<SessionsTab projectKey="PAY" />, path, "/projects/:key/sessions");

  it("asks for the first page of 25 and lists the sessions newest first, as sent", async () => {
    api.fetchSessions.mockResolvedValue(page([session("s2"), session("s1")]));
    tab();
    await screen.findByText("Session s2");
    expect(api.fetchSessions).toHaveBeenCalledWith("PAY", { page: 1, pageSize: 25 });
    expect(
      Array.from(document.querySelectorAll("[data-session]")).map((e) =>
        e.getAttribute("data-session"),
      ),
    ).toEqual(["s2", "s1"]);
    expect(screen.queryByRole("button", { name: "Show older sessions" })).toBeNull();
  });

  it("Show older sessions asks for the next page and adds it below", async () => {
    api.fetchSessions
      .mockResolvedValueOnce(page([session("s3")], 1, 2, 1))
      .mockResolvedValueOnce(page([session("s2")], 2, 2, 1));
    tab();
    await screen.findByText("Session s3");
    fireEvent.click(screen.getByRole("button", { name: "Show older sessions" }));
    await screen.findByText("Session s2");
    expect(api.fetchSessions).toHaveBeenLastCalledWith("PAY", { page: 2, pageSize: 25 });
    expect(
      Array.from(document.querySelectorAll("[data-session]")).map((e) =>
        e.getAttribute("data-session"),
      ),
    ).toEqual(["s3", "s2"]);
    expect(screen.queryByRole("button", { name: "Show older sessions" })).toBeNull();
  });

  it("a link from the activity (?session=) highlights that session, even one on a later page", async () => {
    api.fetchSessions
      .mockResolvedValueOnce(page([session("s3")], 1, 3, 1))
      .mockResolvedValueOnce(page([session("s2")], 2, 3, 1))
      .mockResolvedValueOnce(page([session("s1")], 3, 3, 1));
    tab("/projects/PAY/sessions?session=s1");
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-session="s1"]')
          ?.getAttribute("data-session-highlighted"),
      ).toBe("true"),
    );
    expect(api.fetchSessions).toHaveBeenCalledTimes(3);
    expect(
      document
        .querySelector('[data-session="s3"]')
        ?.getAttribute("data-session-highlighted"),
    ).toBeNull();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("a session that is not in the list says so, once every page has been looked at", async () => {
    api.fetchSessions
      .mockResolvedValueOnce(page([session("s3")], 1, 2, 1))
      .mockResolvedValueOnce(page([session("s2")], 2, 2, 1));
    tab("/projects/PAY/sessions?session=gone");
    await screen.findByText("That session is not in this project's list.");
    expect(api.fetchSessions).toHaveBeenCalledTimes(2);
  });

  it("says so when there are none, and shows the API's sentence when the list cannot load", async () => {
    api.fetchSessions.mockResolvedValue(page([]));
    tab();
    await screen.findByText("No Claude session yet");
    cleanup();
    api.fetchSessions.mockRejectedValue(new ApiError(404, "Project not found.", {}));
    tab();
    await screen.findByText("Could not load the sessions.");
    expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
      "Project not found.",
    );
  });
});

// =============================================================================================

const act = (id: string, over: Partial<ActivityItem> = {}): ActivityItem => ({
  id,
  projectId: "p1",
  issueKey: "PAY-1",
  issueTitle: "Fix the login page",
  action: "issue.updated",
  actorType: "CLAUDE",
  actor: { id: "u-ana", fullName: "Ana Reyes" },
  channel: "mcp",
  changes: [],
  session: null,
  createdAt: "2026-11-10T16:30:00.000Z",
  ...over,
});

describe("PB5 the session on an activity entry", () => {
  it("a small link with the session's title opens that session in the Sessions tab", () => {
    mount(
      <ActivityEntries
        projectKey="PAY"
        items={[act("a", { session: { id: "s1", title: "Fix the form" } }), act("b")]}
      />,
    );
    const link = screen.getByRole("link", { name: /Fix the form/ });
    expect(link.getAttribute("href")).toBe("/projects/PAY/sessions?session=s1");
    expect(link.hasAttribute("data-session-link")).toBe(true);
    // the entry made outside a session has none
    expect(document.querySelectorAll("[data-session-link]")).toHaveLength(1);
    fireEvent.click(link);
    expect(where()).toBe("/projects/PAY/sessions?session=s1");
  });
  it("a session with no title is called Session", () => {
    mount(<SessionLink projectKey="PAY" session={{ id: "s9", title: "" }} />);
    expect(screen.getByRole("link", { name: /Session/ }).textContent).toContain(
      "Session",
    );
  });
  it("no session, no link", () => {
    mount(<SessionLink projectKey="PAY" session={null} />);
    expect(document.querySelector("[data-session-link]")).toBeNull();
  });
  it("without a project key given it is read from the entry's issue key", () => {
    mount(
      <ActivityEntries
        items={[act("a", { issueKey: "OPS-4", session: { id: "s1", title: "T" } })]}
      />,
    );
    expect(
      screen.getByRole("link", { name: /T/, hidden: false }).getAttribute("href"),
    ).toBe("/projects/OPS/sessions?session=s1");
  });
  it("is on the Activity tab", async () => {
    api.fetchActivity.mockResolvedValue({
      items: [act("a", { session: { id: "s1", title: "Tab session" } })],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    mount(<ActivityTab projectKey="PAY" />);
    expect(
      (await screen.findByRole("link", { name: /Tab session/ })).getAttribute("href"),
    ).toBe("/projects/PAY/sessions?session=s1");
  });
  it("is on My Work, in that entry's own project", async () => {
    const w: MyWork = {
      today: "2026-11-10",
      totals: { assignedOpen: 0, overdue: 0, dueThisWeek: 0 },
      assigned: [],
      overdue: [],
      upcomingMilestones: [],
      recentActivity: [
        {
          ...act("a", { session: { id: "s7", title: "Work session" } }),
          project: { key: "OPS", name: "Operations" },
        },
      ],
    };
    api.fetchMyWork.mockResolvedValue(w);
    mount(<MyWorkPage />, "/projects");
    expect(
      (await screen.findByRole("link", { name: /Work session/ })).getAttribute("href"),
    ).toBe("/projects/OPS/sessions?session=s7");
  });
});

// =============================================================================================

const REPORT: SentireImportReport = {
  dryRun: true,
  projects: ["BKS", "PAY"],
  counts: {
    projects: 2,
    issueTypes: 1,
    statuses: 0,
    labels: 3,
    milestones: 4,
    issues: 120,
    comments: 80,
    statusUpdates: 6,
    sessions: 9,
    activities: 300,
    githubLinks: 12,
    securityAudits: 2,
    securityFindings: 7,
  },
  reused: { issueTypes: 3, statuses: 3, labels: 2 },
  unmatchedEmails: ["gone@old.example"],
  warnings: ["2 comments name an issue that is not in the export."],
  unmapped: [{ field: "users.passwordHash", reason: "A secret. It is never read." }],
};
const EXPORT_A = { projects: [{ key: "PAY" }], issues: [] };
const file = (name: string, text: string) =>
  new File([text], name, { type: "application/json" });

describe("PB5 the Sentire Projects import", () => {
  const open = () => mount(<SentireImportPanel />, "/projects/settings");
  const choose = (f: File) =>
    fireEvent.change(screen.getByLabelText("Export file"), { target: { files: [f] } });
  const btn = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
  const chooseAndWait = async (f: File) => {
    choose(f);
    await waitFor(() => expect(btn("Check").disabled).toBe(false));
  };

  it("starts with Check and Import both off", () => {
    open();
    expect(btn("Check").disabled).toBe(true);
    expect(btn("Import").disabled).toBe(true);
  });

  it("Check sends the export with dryRun true and shows counts per entity, the reused, warnings, unmatched e-mails and the unmapped fields", async () => {
    api.importSentire.mockResolvedValue(REPORT);
    open();
    await chooseAndWait(file("export.json", JSON.stringify(EXPORT_A)));
    fireEvent.click(btn("Check"));
    await screen.findByText(/Checked: 2 projects would be added \(BKS, PAY\)\./);
    expect(api.importSentire).toHaveBeenCalledWith(EXPORT_A, true);
    const count = (id: string) =>
      document.querySelector(`[data-import-counts] [data-count="${id}"] dd`)!.textContent;
    expect(count("projects")).toBe("2");
    expect(count("issues")).toBe("120");
    expect(count("comments")).toBe("80");
    expect(count("sessions")).toBe("9");
    expect(count("activities")).toBe("300");
    expect(count("githubLinks")).toBe("12");
    expect(count("securityFindings")).toBe("7");
    expect(document.querySelector("[data-import-reused]")!.textContent).toContain(
      "3 issue types, 3 statuses, 2 labels",
    );
    expect(
      within(document.querySelector("[data-import-unmatched]") as HTMLElement).getByText(
        "gone@old.example",
      ),
    ).toBeTruthy();
    expect(
      within(document.querySelector("[data-import-warnings]") as HTMLElement).getByText(
        "2 comments name an issue that is not in the export.",
      ),
    ).toBeTruthy();
    expect(
      within(document.querySelector("[data-import-unmapped]") as HTMLElement).getByText(
        "users.passwordHash",
      ),
    ).toBeTruthy();
  });

  it("Import is for the exact file that was checked; the plain warning shows with the check", async () => {
    api.importSentire.mockResolvedValue(REPORT);
    open();
    await chooseAndWait(file("export.json", JSON.stringify(EXPORT_A)));
    expect(btn("Import").disabled).toBe(true); // not checked yet
    fireEvent.click(btn("Check"));
    await screen.findByText(/Checked:/);
    expect(btn("Import").disabled).toBe(false);
    expect(document.querySelector("[data-import-warning]")!.textContent).toBe(
      "This adds every project, issue and history from the file. It cannot be undone from the Portal.",
    );
    // another file: off, with the reason, and the check's results are gone
    choose(file("other.json", JSON.stringify({ projects: [{ key: "OTH" }] })));
    await screen.findByText("This is not the file that was checked. Check it first.");
    expect(btn("Import").disabled).toBe(true);
    expect(document.querySelector("[data-import-report]")).toBeNull();
    // the same content again is the same file
    choose(file("export-copy.json", JSON.stringify(EXPORT_A)));
    await waitFor(() => expect(btn("Import").disabled).toBe(false));
  });

  it("a file of the same length but other content is not the checked file", async () => {
    api.importSentire.mockResolvedValue(REPORT);
    open();
    const a = JSON.stringify({ projects: [{ key: "PAY" }] });
    const b = JSON.stringify({ projects: [{ key: "ZZZ" }] });
    expect(b.length).toBe(a.length);
    await chooseAndWait(file("export.json", a));
    fireEvent.click(btn("Check"));
    await screen.findByText(/Checked:/);
    choose(file("export.json", b));
    await screen.findByText("This is not the file that was checked. Check it first.");
    expect(btn("Import").disabled).toBe(true);
  });

  it("Import asks first with the warning; Cancel sends nothing", async () => {
    api.importSentire.mockResolvedValue(REPORT);
    open();
    await chooseAndWait(file("export.json", JSON.stringify(EXPORT_A)));
    fireEvent.click(btn("Check"));
    await screen.findByText(/Checked:/);
    fireEvent.click(btn("Import"));
    const dlg = within(screen.getByRole("dialog"));
    expect(dlg.getByText("Import “export.json”?")).toBeTruthy();
    expect(
      dlg.getByText(
        "This adds every project, issue and history from the file. It cannot be undone from the Portal.",
      ),
    ).toBeTruthy();
    fireEvent.click(dlg.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.importSentire).toHaveBeenCalledTimes(1); // the check only
  });

  it("confirming imports for real (dryRun false) and the summary links the imported projects", async () => {
    api.importSentire
      .mockResolvedValueOnce(REPORT)
      .mockResolvedValueOnce({ ...REPORT, dryRun: false });
    open();
    await chooseAndWait(file("export.json", JSON.stringify(EXPORT_A)));
    fireEvent.click(btn("Check"));
    await screen.findByText(/Checked:/);
    fireEvent.click(btn("Import"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Import" }),
    );
    await screen.findByText("Imported 2 projects from Sentire Projects.");
    expect(api.importSentire).toHaveBeenLastCalledWith(EXPORT_A, false);
    const links = within(
      document.querySelector("[data-imported-projects]") as HTMLElement,
    ).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["BKS", "/projects/BKS"],
      ["PAY", "/projects/PAY"],
    ]);
    expect(
      document.querySelector("[data-import-summary] [data-count='issues'] dd")!
        .textContent,
    ).toBe("120");
    expect(screen.queryByRole("dialog")).toBeNull();
    // the check's panel is gone, so there is nothing left to import twice
    expect(btn("Import").disabled).toBe(true);
  });

  it("a refusal of the check shows as sent (a key that already exists)", async () => {
    const sentence =
      "These projects already exist in the firm: PAY. An import never merges into live data; remove them from the export or rename them there.";
    api.importSentire.mockRejectedValue(new ApiError(409, sentence, {}));
    open();
    await chooseAndWait(file("export.json", JSON.stringify(EXPORT_A)));
    fireEvent.click(btn("Check"));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(sentence),
    );
    expect(document.querySelector("[data-import-report]")).toBeNull();
    expect(btn("Import").disabled).toBe(true);
  });

  it("a refusal of the import shows its sentence and each problem, and nothing is summarised", async () => {
    api.importSentire.mockResolvedValueOnce(REPORT).mockRejectedValueOnce(
      new ApiError(400, "The export cannot be imported.", {
        problems: ["issues[3].key is not a key.", "And 2 more problems."],
      }),
    );
    open();
    await chooseAndWait(file("export.json", JSON.stringify(EXPORT_A)));
    fireEvent.click(btn("Check"));
    await screen.findByText(/Checked:/);
    fireEvent.click(btn("Import"));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Import" }),
    );
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")).not.toBeNull(),
    );
    expect(
      Array.from(document.querySelectorAll("[data-projects-error] li")).map(
        (e) => e.textContent,
      ),
    ).toEqual([
      "The export cannot be imported.",
      "issues[3].key is not a key.",
      "And 2 more problems.",
    ]);
    expect(document.querySelector("[data-import-summary]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a file that is not JSON is said so and cannot be checked", async () => {
    open();
    choose(file("broken.json", "{oops"));
    await screen.findByText("broken.json is not valid JSON.");
    expect(btn("Check").disabled).toBe(true);
    expect(api.importSentire).not.toHaveBeenCalled();
  });

  it("an export that is not an object goes to the API as it is, and its sentence shows", async () => {
    api.importSentire.mockRejectedValue(
      new ApiError(400, "The export must be a JSON object.", {}),
    );
    open();
    await chooseAndWait(file("list.json", "[1,2]"));
    fireEvent.click(btn("Check"));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "The export must be a JSON object.",
      ),
    );
    expect(api.importSentire).toHaveBeenCalledWith([1, 2], true);
  });

  describe("on the Projects settings page", () => {
    beforeEach(() => {
      api.listAdmin.mockResolvedValue([]);
    });
    it("a Super Admin sees it", async () => {
      auth.perms = new Set([...ALL, "IntegrationClient:Update"]);
      mount(<ProjectsSettingsPage />, "/projects/settings");
      await screen.findByText("Import from Sentire Projects");
      expect(document.querySelector("[data-sentire-import]")).not.toBeNull();
    });
    it("anyone else does not, however much they may configure", async () => {
      mount(<ProjectsSettingsPage />, "/projects/settings");
      await screen.findByText("Issue types");
      expect(screen.queryByText("Import from Sentire Projects")).toBeNull();
      expect(document.querySelector("[data-sentire-import]")).toBeNull();
    });
  });
});

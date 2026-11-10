// track-b-pb4-screens.test.tsx - PB4: GitHub links on an issue, the checklist import (preview then
// import), the security state (portfolio, overview, tab, history), importing an audit, the release
// gate's refusal with key links, and the GitHub webhook help. The API module is mocked; its
// sentences are shown as sent. All data is invented.

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
  fetchSecurity: vi.fn(),
  fetchAudits: vi.fn(),
  importAudit: vi.fn(),
  importChecklist: vi.fn(),
  updateMilestone: vi.fn(),
  createMilestone: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchRoadmap: vi.fn(),
  fetchProjects: vi.fn(),
  fetchProject: vi.fn(),
  fetchProjectsMeta: vi.fn(),
  fetchIssue: vi.fn(),
  fetchComments: vi.fn(),
  lookupIssueKey: vi.fn(),
  listAdmin: vi.fn(),
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
  ChecklistImportResult,
  GithubLink,
  IssueDetail,
  Milestone,
  ProjectOverview,
  ProjectSummary,
  ProjectsMeta,
  SecurityAudit,
  SecurityBadge,
  SecurityStatus,
} from "../../lib/projects";
import { GithubLinks } from "../../components/projects/GithubLinks";
import { GithubWebhookHelp } from "../../components/projects/GithubWebhookHelp";
import { SecurityChip } from "../../components/projects/SecurityChip";
import { ImportAuditDialog } from "./ImportAuditDialog";
import { ImportChecklistDialog } from "./ImportChecklistDialog";
import { MilestonesTab } from "./MilestonesTab";
import { OverviewTab } from "./OverviewTab";
import ProjectPage from "./ProjectPage";
import ProjectsPage from "./ProjectsPage";
import ProjectsSettingsPage from "./ProjectsSettingsPage";
import { SecurityTab } from "./SecurityTab";

const ALL = ["Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"];
const CAN = { read: true, create: true, update: true, configure: true };
const PROJECT = {
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
};
const CLEAR: SecurityBadge = { state: "clear", open: 0, critical: 0, high: 0 };

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
  auth.user = { userType: "FIRM" };
  auth.perms = new Set(ALL);
});
afterEach(() => cleanup());

// --- fixtures ------------------------------------------------------------------------------------

const link = (over: Partial<GithubLink> = {}): GithubLink => ({
  kind: "pr",
  repo: "acme/app",
  number: 12,
  sha: null,
  title: "Fix the login page",
  state: "open",
  merged: false,
  url: "https://github.com/acme/app/pull/12",
  updatedAt: "2026-11-10T16:30:00.000Z",
  ...over,
});

const audit = (over: Partial<SecurityAudit> = {}): SecurityAudit => ({
  id: "au1",
  runId: "run-1",
  commit: "abcdef0123456789abcdef0123456789abcdef01",
  profile: "standard",
  scope: [],
  complete: true,
  incompleteReason: "",
  partial: false,
  coverage: { covered: 2, candidate: 1 },
  findings: {
    total: 7,
    confirmed: 5,
    needsValidation: 1,
    rejected: 1,
    bySeverity: { critical: 1, high: 1, medium: 1, low: 1, informational: 1 },
  },
  created: ["PAY-3", "PAY-4"],
  updated: ["PAY-5"],
  reopened: [],
  notReported: [],
  rejectedNoted: [],
  rejected: [{ fingerprint: "fp-r", title: "Rejected one", reason: "Not reachable." }],
  importedBy: { id: "u-ana", fullName: "Ana Reyes" },
  actorType: "USER",
  channel: "web",
  createdAt: "2026-11-10T16:30:00.000Z",
  ...over,
});

const status = (over: Partial<SecurityStatus> = {}): SecurityStatus => ({
  projectKey: "PAY",
  state: "blocked",
  blockedBy: ["PAY-3", "PAY-9"],
  counts: {
    open: 4,
    critical: 1,
    high: 1,
    medium: 1,
    low: 0,
    informational: 0,
    needsValidation: 1,
    unrated: 0,
  },
  open: [
    {
      key: "PAY-3",
      title: "SQL injection",
      severity: "critical",
      needsValidation: false,
      fingerprint: "fp1",
    },
    {
      key: "PAY-9",
      title: "Weak session",
      severity: "high",
      needsValidation: false,
      fingerprint: "fp2",
    },
    {
      key: "PAY-11",
      title: "Verbose errors",
      severity: "medium",
      needsValidation: false,
      fingerprint: "fp3",
    },
    {
      key: "PAY-12",
      title: "Maybe a leak",
      severity: null,
      needsValidation: true,
      fingerprint: "fp4",
    },
    {
      key: "PAY-13",
      title: "Labelled by hand",
      severity: null,
      needsValidation: false,
      fingerprint: null,
    },
  ],
  lastAudit: audit(),
  ...over,
});

// =============================================================================================

describe("PB4 GitHub links", () => {
  it("shows each pull request and commit: kind, reference, title, state; latest first as the API sent them", () => {
    mount(
      <GithubLinks
        links={[
          link({
            number: 14,
            title: "Newest",
            url: "https://github.com/acme/app/pull/14",
          }),
          link({
            kind: "commit",
            number: null,
            sha: "0123456789abcdef",
            title: "Add the form",
            state: "pushed",
            url: "https://github.com/acme/app/commit/0123456789abcdef",
          }),
          link({
            number: 9,
            title: "Merged work",
            state: "closed",
            merged: true,
            url: "https://github.com/acme/app/pull/9",
          }),
        ]}
      />,
    );
    const rows = Array.from(document.querySelectorAll("[data-github-link]"));
    expect(rows.map((r) => r.getAttribute("data-github-link"))).toEqual([
      "https://github.com/acme/app/pull/14",
      "https://github.com/acme/app/commit/0123456789abcdef",
      "https://github.com/acme/app/pull/9",
    ]);
    const [pr, commit, merged] = rows.map((r) => within(r as HTMLElement));
    expect(pr!.getByText("Pull request")).toBeTruthy();
    expect(pr!.getByText("acme/app#14", { exact: false })).toBeTruthy();
    expect(pr!.getByText("Newest")).toBeTruthy();
    expect(pr!.getByText("Open")).toBeTruthy();
    expect(commit!.getByText("Commit")).toBeTruthy();
    expect(commit!.getByText("acme/app@0123456", { exact: false })).toBeTruthy();
    expect(commit!.getByText("Pushed")).toBeTruthy();
    expect(merged!.getByText("Merged")).toBeTruthy();
    expect(merged!.queryByText("Closed")).toBeNull(); // merged beats closed
    // Manila time: 16:30 UTC is 12:30 AM the next day
    expect(pr!.getByText("Nov 11, 2026, 12:30 AM")).toBeTruthy();
  });

  it("each opens GitHub in a new tab, without handing over the window", () => {
    mount(<GithubLinks links={[link()]} />);
    const a = screen.getByRole("link", { name: /acme\/app#12/ });
    expect(a.getAttribute("href")).toBe("https://github.com/acme/app/pull/12");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("an address that is not a web address is text, not a link", () => {
    mount(<GithubLinks links={[link({ url: "javascript:window.__x=1" })]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("acme/app#12")).toBeTruthy();
  });

  it("nothing at all when there are no links", () => {
    mount(<GithubLinks links={[]} />);
    expect(document.querySelector("[data-github-links]")).toBeNull();
  });

  it("is on the issue's page", async () => {
    const detail: IssueDetail = {
      id: "i1",
      key: "PAY-1",
      number: 1,
      title: "Fix the login page",
      priority: "NORMAL",
      startDate: null,
      dueDate: null,
      overdue: false,
      position: 1,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
      closedAt: null,
      project: { key: "PAY", name: "Payments" },
      type: { id: "t", name: "Task", colour: "#57606a" },
      status: { id: "s", name: "New", colour: "#57606a", category: "TODO" },
      assignee: null,
      milestone: null,
      parentKey: null,
      labels: [],
      description: "",
      author: null,
      parent: null,
      children: [],
      commentCount: 0,
      githubLinks: [link({ title: "The linked pull request" })],
    };
    const meta: ProjectsMeta = {
      issueTypes: [],
      issueStatuses: [],
      labels: [],
      users: [],
    };
    api.fetchProject.mockResolvedValue({
      ...({} as ProjectOverview),
      security: CLEAR,
      project: PROJECT,
      status: { value: "ON_TRACK", note: "", updatedAt: null },
    });
    api.fetchProjectsMeta.mockResolvedValue(meta);
    api.fetchMilestones.mockResolvedValue([]);
    api.fetchIssue.mockResolvedValue(detail);
    api.fetchComments.mockResolvedValue([]);
    api.lookupIssueKey.mockRejectedValue(new ApiError(404, "Issue not found.", {}));
    mount(
      <ProjectPage tab="issue" />,
      "/projects/PAY/issues/PAY-1",
      "/projects/:key/issues/:issueKey",
    );
    await screen.findByText("The linked pull request");
    expect(document.querySelector("[data-github-links]")).not.toBeNull();
  });
});

// =============================================================================================

describe("PB4 the security badge", () => {
  it("clear is green words, open counts, blocked says what blocks", () => {
    mount(
      <>
        <SecurityChip badge={CLEAR} />
        <SecurityChip badge={{ state: "open", open: 3, critical: 0, high: 0 }} />
        <SecurityChip badge={{ state: "blocked", open: 5, critical: 1, high: 2 }} />
      </>,
    );
    const chips = Array.from(document.querySelectorAll("[data-security-state]"));
    expect(
      chips.map((c) => [c.getAttribute("data-security-state"), c.textContent]),
    ).toEqual([
      ["clear", "Clear"],
      ["open", "3 open"],
      ["blocked", "Blocked: 1 critical, 2 high"],
    ]);
  });

  const summary = (security: SecurityBadge): ProjectSummary =>
    ({
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
      status: "ON_TRACK",
      statusNote: "",
      statusUpdatedAt: null,
      progress: { done: 0, total: 0, percent: 0 },
      counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
      nextMilestone: null,
      lastActivityAt: null,
      security,
    }) as ProjectSummary;

  it("the portfolio shows each project's security state", async () => {
    api.fetchProjects.mockResolvedValue([
      summary({ state: "blocked", open: 4, critical: 1, high: 2 }),
      { ...summary(CLEAR), id: "p2", key: "OPS", name: "Operations" },
    ]);
    mount(<ProjectsPage />, "/projects/all");
    await screen.findByText("Payments");
    expect(
      within(
        document.querySelector('[data-project="PAY"] [data-security]') as HTMLElement,
      ).getByText("Blocked: 1 critical, 2 high"),
    ).toBeTruthy();
    expect(
      within(
        document.querySelector('[data-project="OPS"] [data-security]') as HTMLElement,
      ).getByText("Clear"),
    ).toBeTruthy();
  });

  const overview = (security: SecurityBadge) =>
    ({
      security,
      project: PROJECT,
      status: { value: "ON_TRACK", note: "", updatedAt: null },
      statusUpdates: [],
      progress: { done: 0, total: 0, percent: 0 },
      counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
      countsByStatus: [],
      countsByType: [],
      openMilestones: [],
      inProgress: [],
      recentActivity: [],
      recentSessions: [], // PB5
      lastActivityAt: null,
    }) as unknown as ProjectOverview;

  it("the project's header shows the chip only when something is open or blocked", async () => {
    api.fetchProjectsMeta.mockResolvedValue({
      issueTypes: [],
      issueStatuses: [],
      labels: [],
      users: [],
    });
    const open = (security: SecurityBadge) => {
      api.fetchProject.mockResolvedValue({ ...overview(security), project: PROJECT });
      mount(<ProjectPage tab="overview" />, "/projects/PAY", "/projects/:key");
    };
    open({ state: "blocked", open: 2, critical: 1, high: 1 });
    await screen.findByRole("heading", { level: 1, name: "Payments" });
    expect(
      document.querySelector(
        "header [data-security-state], h1 ~ div [data-security-state]",
      ),
    ).not.toBeNull();
    cleanup();
    open(CLEAR);
    await screen.findByRole("heading", { level: 1, name: "Payments" });
    // only the overview's own card carries a chip, not the header
    expect(document.querySelectorAll("[data-security-state]")).toHaveLength(1);
    expect(
      document.querySelector("[data-overview-security] [data-security-state]"),
    ).not.toBeNull();
  });

  it("the overview shows it with a link to the Security tab", () => {
    mount(
      <OverviewTab
        ov={overview({ state: "open", open: 1, critical: 0, high: 0 })}
        can={CAN}
      />,
    );
    const card = within(
      document.querySelector("[data-overview-security]") as HTMLElement,
    );
    expect(card.getByText("1 open")).toBeTruthy();
    expect(card.getByText("1 open security issue.")).toBeTruthy();
    expect(
      card.getByRole("link", { name: "Security details" }).getAttribute("href"),
    ).toBe("/projects/PAY/security");
    cleanup();
    mount(<OverviewTab ov={overview(CLEAR)} can={CAN} />);
    expect(screen.getByText("No open security issues.")).toBeTruthy();
  });
});

// =============================================================================================

const PREVIEW: ChecklistImportResult = {
  dryRun: true,
  items: { total: 3, open: 2, closed: 1 },
  milestones: [
    { name: "First release", created: true },
    { name: "Later", created: false },
  ],
  labels: [
    { name: "frontend", created: false },
    { name: "newlabel", created: true },
  ],
  warnings: ["Line 7 is not a checklist item and was skipped."],
  keys: [],
  plan: [
    {
      title: "Sign-in page",
      closed: false,
      labels: ["frontend"],
      description: "",
      milestone: "First release",
    },
    {
      title: "Set up the database",
      closed: true,
      labels: [],
      description: "notes",
      milestone: "First release",
    },
    {
      title: "Reports",
      closed: false,
      labels: ["newlabel"],
      description: "",
      milestone: "Later",
    },
  ],
};
const CHECKLIST =
  "## First release\n- [ ] Sign-in page #frontend\n- [x] Set up the database";

describe("PB4 the checklist import", () => {
  const open = () => {
    mount(<ImportChecklistDialog projectKey="PAY" onClose={() => undefined} />);
    return screen.getByRole("dialog", { name: "Import a checklist" });
  };
  const type = (text: string) =>
    fireEvent.change(screen.getByLabelText(/^Markdown checklist/), {
      target: { value: text },
    });

  it("Preview and Import are off until there is text, and Import until a preview of that text", () => {
    open();
    expect(
      (screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    type(CHECKLIST);
    expect(
      (screen.getByRole("button", { name: "Preview" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("Preview is a dry run with the text and the switch; it shows the totals, milestones, labels, items and warnings", async () => {
    api.importChecklist.mockResolvedValue(PREVIEW);
    open();
    type(CHECKLIST);
    fireEvent.click(screen.getByLabelText("Headings become milestones"));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const box = within(await screen.findByRole("region", { name: "Preview" }));
    expect(api.importChecklist).toHaveBeenCalledWith("PAY", {
      markdown: CHECKLIST,
      headingsAsMilestones: true,
      dryRun: true,
    });
    expect(box.getByText("3 items: 2 open, 1 closed.")).toBeTruthy();
    const ms = within(document.querySelector("[data-preview-milestones]") as HTMLElement);
    expect(
      within(ms.getByText(/First release/).closest("li") as HTMLElement).getByText("new"),
    ).toBeTruthy();
    expect(
      within(ms.getByText(/Later/).closest("li") as HTMLElement).getByText("exists"),
    ).toBeTruthy();
    const labels = within(document.querySelector("[data-preview-labels]") as HTMLElement);
    expect(
      within(labels.getByText(/newlabel/).closest("li") as HTMLElement).getByText("new"),
    ).toBeTruthy();
    const items = Array.from(document.querySelectorAll("[data-preview-item]"));
    expect(items).toHaveLength(3);
    expect(within(items[0] as HTMLElement).getByText("#frontend")).toBeTruthy();
    expect(within(items[0] as HTMLElement).getByText("Open")).toBeTruthy();
    expect(within(items[1] as HTMLElement).getByText("Closed")).toBeTruthy();
    expect(box.getByText("Line 7 is not a checklist item and was skipped.")).toBeTruthy();
  });

  it("Import then makes the issues (not a dry run) and the summary links the keys it made", async () => {
    api.importChecklist.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce({
      ...PREVIEW,
      dryRun: false,
      keys: ["PAY-21", "PAY-22", "PAY-23"],
      plan: undefined,
    });
    open();
    type(CHECKLIST);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Imported 3 items: 2 open, 1 closed.");
    expect(api.importChecklist).toHaveBeenLastCalledWith("PAY", {
      markdown: CHECKLIST,
      headingsAsMilestones: false,
      dryRun: false,
    });
    const keys = within(document.querySelector("[data-created-keys]") as HTMLElement);
    expect(
      keys.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["PAY-21", "/projects/PAY/issues/PAY-21"],
      ["PAY-22", "/projects/PAY/issues/PAY-22"],
      ["PAY-23", "/projects/PAY/issues/PAY-23"],
    ]);
    expect(
      screen.getByText("Line 7 is not a checklist item and was skipped."),
    ).toBeTruthy();
  });

  it("a change to the text or the switch after a preview asks for a new preview before Import", async () => {
    api.importChecklist.mockResolvedValue(PREVIEW);
    open();
    type(CHECKLIST);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("region", { name: "Preview" });
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    type(`${CHECKLIST}\n- [ ] one more`);
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByLabelText("Headings become milestones"));
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("a preview with no items offers no Import", async () => {
    api.importChecklist.mockResolvedValue({
      ...PREVIEW,
      items: { total: 0, open: 0, closed: 0 },
      milestones: [],
      labels: [],
      warnings: [],
      plan: [],
    });
    open();
    type("just words");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByText("No items found.");
    expect(
      (screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("the API's refusals show as sent: the 500 item limit, in the preview", async () => {
    api.importChecklist.mockRejectedValue(
      new ApiError(400, "A checklist can have at most 500 items; this one has 501.", {}),
    );
    open();
    type(CHECKLIST);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "A checklist can have at most 500 items; this one has 501.",
      ),
    );
    expect(screen.queryByRole("region", { name: "Preview" })).toBeNull();
  });

  it("unknown labels that need Projects:Configure refuse the whole import, as sent, and nothing is summarised", async () => {
    const sentence =
      "The import uses labels that do not exist: newlabel. Creating a label needs Projects:Configure, so nothing was imported.";
    api.importChecklist
      .mockResolvedValueOnce(PREVIEW)
      .mockRejectedValueOnce(new ApiError(403, sentence, {}));
    open();
    type(CHECKLIST);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("region", { name: "Preview" });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(sentence),
    );
    expect(document.querySelector("[data-import-summary]")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Import a checklist" })).toBeTruthy();
  });

  it("after an import the lists a label could be in are asked for again (the project's issues and the label list)", async () => {
    api.importChecklist.mockResolvedValueOnce(PREVIEW).mockResolvedValueOnce({
      ...PREVIEW,
      dryRun: false,
      keys: ["PAY-21"],
      plan: undefined,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const spy = vi.spyOn(qc, "invalidateQueries");
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ImportChecklistDialog projectKey="PAY" onClose={() => undefined} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    type(CHECKLIST);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("region", { name: "Preview" });
    expect(spy).not.toHaveBeenCalled(); // a preview changes nothing
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText(/Imported 3 items/);
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]!.queryKey));
    expect(keys).toContain(JSON.stringify(["projects", "meta"]));
    expect(keys).toContain(JSON.stringify(["projects", "issues", "PAY"]));
  });

  it("Cancel closes it and sends nothing", () => {
    const onClose = vi.fn();
    mount(<ImportChecklistDialog projectKey="PAY" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.importChecklist).not.toHaveBeenCalled();
  });

  it("is offered on a project to someone with Projects:Create, and to no one else", async () => {
    api.fetchProject.mockResolvedValue({
      security: CLEAR,
      project: PROJECT,
      status: { value: "ON_TRACK", note: "", updatedAt: null },
      statusUpdates: [],
      progress: { done: 0, total: 0, percent: 0 },
      counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
      countsByStatus: [],
      countsByType: [],
      openMilestones: [],
      inProgress: [],
      recentActivity: [],
      recentSessions: [], // PB5
      lastActivityAt: null,
    });
    api.fetchProjectsMeta.mockResolvedValue({
      issueTypes: [],
      issueStatuses: [],
      labels: [],
      users: [],
    });
    mount(<ProjectPage tab="overview" />, "/projects/PAY", "/projects/:key");
    fireEvent.click(await screen.findByRole("button", { name: "Import checklist" }));
    expect(screen.getByRole("dialog", { name: "Import a checklist" })).toBeTruthy();
    cleanup();
    auth.perms = new Set(["Projects:Read", "Projects:Update"]);
    mount(<ProjectPage tab="overview" />, "/projects/PAY", "/projects/:key");
    await screen.findByRole("button", { name: "Edit project" });
    expect(screen.queryByRole("button", { name: "Import checklist" })).toBeNull();
  });
});

// =============================================================================================

describe("PB4 the Security tab", () => {
  const tab = (can = CAN) =>
    mount(<SecurityTab projectKey="PAY" can={can} />, "/projects/PAY/security");

  it("blocked: names what blocks as links, counts by severity, and lists the open issues with their severity", async () => {
    api.fetchSecurity.mockResolvedValue(status());
    api.fetchAudits.mockResolvedValue({ items: [] });
    tab();
    await screen.findByText("SQL injection");
    const gate = within(
      document.querySelector('[data-security-status="blocked"]') as HTMLElement,
    );
    expect(gate.getByText("Blocked: 1 critical, 1 high")).toBeTruthy();
    const blocked = within(document.querySelector("[data-blocked-by]") as HTMLElement);
    expect(
      blocked.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["PAY-3", "/projects/PAY/issues/PAY-3"],
      ["PAY-9", "/projects/PAY/issues/PAY-9"],
    ]);
    const counts = (id: string) =>
      document.querySelector(`[data-security-counts] [data-count="${id}"] dd`)!
        .textContent;
    expect(counts("critical")).toBe("1");
    expect(counts("high")).toBe("1");
    expect(counts("medium")).toBe("1");
    expect(counts("needsValidation")).toBe("1");
    expect(counts("unrated")).toBe("0");
    const sev = (key: string) =>
      document.querySelector(`[data-security-issue="${key}"] [data-severity]`)!
        .textContent;
    expect(sev("PAY-3")).toBe("Critical");
    expect(sev("PAY-9")).toBe("High");
    expect(sev("PAY-11")).toBe("Medium");
    expect(sev("PAY-12")).toBe("Needs validation");
    expect(sev("PAY-13")).toBe("Unrated");
    expect(
      within(document.querySelector('[data-security-issue="PAY-3"]') as HTMLElement)
        .getByRole("link", { name: "PAY-3" })
        .getAttribute("href"),
    ).toBe("/projects/PAY/issues/PAY-3");
  });

  it("open (nothing critical or high) says no milestone is held back; clear says there is nothing open", async () => {
    api.fetchAudits.mockResolvedValue({ items: [] });
    api.fetchSecurity.mockResolvedValue(
      status({
        state: "open",
        blockedBy: [],
        counts: { ...status().counts, open: 1, critical: 0, high: 0 },
        open: [status().open[2]!],
      }),
    );
    tab();
    await screen.findByText(/no milestone is held back/);
    expect(document.querySelector("[data-blocked-by]")).toBeNull();
    cleanup();
    api.fetchSecurity.mockResolvedValue(
      status({
        state: "clear",
        blockedBy: [],
        counts: {
          ...status().counts,
          open: 0,
          critical: 0,
          high: 0,
          medium: 0,
          needsValidation: 0,
        },
        open: [],
        lastAudit: null,
      }),
    );
    tab();
    await screen.findAllByText("No open security issues.");
    expect(screen.getByText("No audit has been imported yet.")).toBeTruthy();
  });

  it("the last audit: run, commit (12 characters), when in Manila time, result", async () => {
    api.fetchSecurity.mockResolvedValue(status());
    api.fetchAudits.mockResolvedValue({ items: [] });
    tab();
    const last = within(
      await waitFor(() => {
        const el = document.querySelector("[data-last-audit]");
        if (!el || !el.textContent?.includes("run-1")) throw new Error("not yet");
        return el as HTMLElement;
      }),
    );
    expect(last.getByText("abcdef012345")).toBeTruthy();
    expect(last.getByText("Nov 11, 2026, 12:30 AM")).toBeTruthy();
    expect(last.getByText("Complete")).toBeTruthy();
    expect(
      last.getByText("7 total, 5 confirmed, 1 to validate, 1 rejected"),
    ).toBeTruthy();
  });

  it("the audit history: run, commit, profile, scope, result, coverage, findings, who imported, when", async () => {
    api.fetchSecurity.mockResolvedValue(status());
    api.fetchAudits.mockResolvedValue({
      items: [
        audit({
          id: "au2",
          runId: "run-2",
          profile: "quick",
          scope: ["src/auth", "src/pay"],
          complete: false,
          incompleteReason: "Ran out of time.",
          partial: true,
          coverage: { covered: 4, not_started: 9 },
          actorType: "CLAUDE",
          importedBy: { id: "u-ana", fullName: "Ana Reyes" },
          createdAt: "2026-11-12T03:00:00.000Z",
        }),
        audit(),
      ],
    });
    tab();
    await screen.findByText("run-2");
    const rows = Array.from(
      document.querySelectorAll("[data-audit-history] [data-audit]"),
    );
    expect(rows.map((r) => r.getAttribute("data-audit"))).toEqual(["au2", "au1"]);
    const r2 = within(rows[0] as HTMLElement);
    expect(r2.getByText("quick")).toBeTruthy();
    expect(r2.getByText("src/auth, src/pay")).toBeTruthy();
    expect(r2.getByText("Incomplete")).toBeTruthy();
    expect(r2.getByText("Ran out of time.")).toBeTruthy();
    expect(r2.getByText("covered 4, not started 9")).toBeTruthy();
    expect(r2.getByText("Claude")).toBeTruthy(); // imported through Claude: named Claude, not the person
    expect(r2.getByText(/Nov 12, 2026, 11:00 AM/)).toBeTruthy(); // 03:00 UTC is 11:00 AM in Manila
    const r1 = within(rows[1] as HTMLElement);
    expect(r1.getByText("Whole repository")).toBeTruthy();
    expect(r1.getByText("abcdef012345")).toBeTruthy();
    expect(r1.getByText("Complete", { selector: "[data-audit-result]" })).toBeTruthy();
    expect(r1.getByText("Ana Reyes")).toBeTruthy();
    expect(r1.getByText("covered 2, candidate 1")).toBeTruthy();
    expect(
      r1.getByText("critical 1, high 1, medium 1, low 1, informational 1"),
    ).toBeTruthy();
  });

  it("What it did opens the issues an audit made, updated and reopened, as links", async () => {
    api.fetchSecurity.mockResolvedValue(status());
    api.fetchAudits.mockResolvedValue({ items: [audit({ reopened: ["PAY-6"] })] });
    tab();
    await screen.findByText("run-1", { selector: "td" });
    fireEvent.click(screen.getByRole("button", { name: "What it did" }));
    const out = within(document.querySelector("[data-audit-outcome]") as HTMLElement);
    expect(out.getByText("PAY-3").closest("a")!.getAttribute("href")).toBe(
      "/projects/PAY/issues/PAY-3",
    );
    expect(out.getByText("PAY-5")).toBeTruthy();
    expect(out.getByText("PAY-6")).toBeTruthy();
    expect(out.getByText(/Rejected one/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide what it did" }));
    expect(document.querySelector("[data-audit-outcome]")).toBeNull();
  });

  it("an empty history says so", async () => {
    api.fetchSecurity.mockResolvedValue(status({ lastAudit: null }));
    api.fetchAudits.mockResolvedValue({ items: [] });
    tab();
    await screen.findByText("No audit imported yet");
  });

  it("the API's sentences show as sent when either call fails", async () => {
    api.fetchSecurity.mockRejectedValue(new ApiError(404, "Project not found.", {}));
    api.fetchAudits.mockRejectedValue(
      new ApiError(403, "Missing permission(s): Projects:Read", {}),
    );
    tab();
    await screen.findByText("Could not load the security state.");
    await screen.findByText("Could not load the audit history.");
    expect(
      Array.from(document.querySelectorAll("[data-projects-error]")).map(
        (e) => e.textContent,
      ),
    ).toEqual(["Project not found.", "Missing permission(s): Projects:Read"]);
  });

  it("Import audit is for someone who may create and update; a Viewer or an updater alone does not get it", async () => {
    api.fetchSecurity.mockResolvedValue(status());
    api.fetchAudits.mockResolvedValue({ items: [] });
    tab();
    await screen.findByRole("button", { name: "Import audit" });
    cleanup();
    tab({ read: true, create: false, update: true, configure: false });
    await screen.findByText("SQL injection");
    expect(screen.queryByRole("button", { name: "Import audit" })).toBeNull();
    cleanup();
    tab({ read: true, create: true, update: false, configure: false });
    await screen.findByText("SQL injection");
    expect(screen.queryByRole("button", { name: "Import audit" })).toBeNull();
  });
});

// =============================================================================================

describe("PB4 importing an audit", () => {
  const open = (onImported = vi.fn()) => {
    mount(
      <ImportAuditDialog
        projectKey="PAY"
        onClose={() => undefined}
        onImported={onImported}
      />,
    );
    return onImported;
  };
  const file = (name: string, text: string) =>
    new File([text], name, { type: "application/json" });
  const choose = (label: string, f: File) =>
    fireEvent.change(screen.getByLabelText(label), { target: { files: [f] } });

  it("needs findings before it can be sent", () => {
    open();
    expect(
      (screen.getByRole("button", { name: "Import audit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Text of findings.json"), {
      target: { value: "[]" },
    });
    expect(
      (screen.getByRole("button", { name: "Import audit" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("pasted findings go as text; the API's answer is shown with the issues it made as links", async () => {
    api.importAudit.mockResolvedValue(audit());
    const onImported = open();
    fireEvent.change(screen.getByLabelText("Text of findings.json"), {
      target: { value: '[{"a":1}]' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await screen.findByText(
      /Run run-1: 7 findings, 5 confirmed, 1 to validate, 1 rejected\./,
    );
    expect(api.importAudit).toHaveBeenCalledWith("PAY", { findings: '[{"a":1}]' });
    const out = within(document.querySelector("[data-audit-imported]") as HTMLElement);
    expect(out.getByText("PAY-3").closest("a")!.getAttribute("href")).toBe(
      "/projects/PAY/issues/PAY-3",
    );
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ id: "au1" }));
  });

  it("findings.json from a file, with the run metadata and the ledger, go as parsed JSON", async () => {
    api.importAudit.mockResolvedValue(audit({ complete: false }));
    open();
    choose("findings.json file", file("findings.json", '[{"fingerprint":"fp"}]'));
    choose(
      "run-metadata.json file",
      file("run-metadata.json", '{"run_id":"r9","profile":"deep"}'),
    );
    choose(
      "coverage-ledger.json file",
      file("coverage-ledger.json", '[{"status":"covered"}]'),
    );
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await screen.findByText(/The run is incomplete\./);
    expect(api.importAudit).toHaveBeenCalledWith("PAY", {
      findings: '[{"fingerprint":"fp"}]',
      run: { run_id: "r9", profile: "deep" },
      ledger: [{ status: "covered" }],
    });
  });

  it("a chosen file wins over pasted text", async () => {
    api.importAudit.mockResolvedValue(audit());
    open();
    fireEvent.change(screen.getByLabelText("Text of findings.json"), {
      target: { value: "[]" },
    });
    choose("findings.json file", file("findings.json", '[{"x":1}]'));
    expect(
      (screen.getByLabelText("Text of findings.json") as HTMLTextAreaElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await waitFor(() =>
      expect(api.importAudit).toHaveBeenCalledWith("PAY", { findings: '[{"x":1}]' }),
    );
  });

  it("a file that is not JSON is said so before anything is sent", async () => {
    open();
    choose("findings.json file", file("findings.json", "[]"));
    choose("run-metadata.json file", file("run-metadata.json", "{oops"));
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "run-metadata.json is not valid JSON.",
      ),
    );
    expect(api.importAudit).not.toHaveBeenCalled();
  });

  it("a ledger that is not an array, and run metadata that is not an object, are said so", async () => {
    open();
    choose("findings.json file", file("findings.json", "[]"));
    choose("coverage-ledger.json file", file("coverage-ledger.json", '{"a":1}'));
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "coverage-ledger.json must be a JSON array.",
      ),
    );
    choose("coverage-ledger.json file", file("coverage-ledger.json", "[]"));
    choose("run-metadata.json file", file("run-metadata.json", "[1]"));
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "run-metadata.json must be a JSON object.",
      ),
    );
    expect(api.importAudit).not.toHaveBeenCalled();
  });

  it("the API's refusal shows as sent and the window stays", async () => {
    api.importAudit.mockRejectedValue(
      new ApiError(400, "findings[0] is not an object.", {}),
    );
    open();
    fireEvent.change(screen.getByLabelText("Text of findings.json"), {
      target: { value: "[1]" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import audit" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "findings[0] is not an object.",
      ),
    );
    expect(screen.getByRole("dialog", { name: "Import audit" })).toBeTruthy();
    expect(document.querySelector("[data-audit-imported]")).toBeNull();
  });
});

// =============================================================================================

describe("PB4 the release gate", () => {
  const GATE =
    "This milestone cannot be closed while security issues are open: PAY-3, PAY-9.";
  const MS: Milestone = {
    id: "m1",
    name: "Beta",
    description: "",
    startDate: null,
    dueDate: "2026-12-01",
    state: "OPEN",
    progress: { done: 1, total: 4, percent: 25 },
    percent: 25,
    today: "2026-11-10",
    overdueIssues: 0,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };

  async function closeIt() {
    api.fetchMilestones.mockResolvedValue([MS]);
    api.fetchRoadmap.mockResolvedValue({ today: "2026-11-10", dated: [], undated: [] });
    mount(<MilestonesTab projectKey="PAY" canWrite />, "/projects/PAY/milestones");
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dlg = screen.getByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("State"), {
      target: { value: "CLOSED" },
    });
    fireEvent.click(within(dlg).getByRole("button", { name: /^Save/ }));
    return dlg;
  }

  it("shows the API's sentence as sent, with the blocking keys as links to those issues", async () => {
    api.updateMilestone.mockRejectedValue(new ApiError(409, GATE, {}));
    await closeIt();
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")).not.toBeNull(),
    );
    const banner = document.querySelector("[data-projects-error]") as HTMLElement;
    expect(banner.textContent).toBe(GATE);
    expect(
      within(banner)
        .getAllByRole("link")
        .map((a) => [a.textContent, a.getAttribute("href")]),
    ).toEqual([
      ["PAY-3", "/projects/PAY/issues/PAY-3"],
      ["PAY-9", "/projects/PAY/issues/PAY-9"],
    ]);
    // the window stays so the person can read it
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("clicking a key goes to that issue", async () => {
    api.updateMilestone.mockRejectedValue(new ApiError(409, GATE, {}));
    await closeIt();
    const link = await screen.findByRole("link", { name: "PAY-9" });
    fireEvent.click(link);
    await waitFor(() => expect(where()).toBe("/projects/PAY/issues/PAY-9"));
  });

  it("another refusal is still just its sentence, with no links made up", async () => {
    api.updateMilestone.mockRejectedValue(
      new ApiError(400, "The due date cannot be before the start date.", {}),
    );
    await closeIt();
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")).not.toBeNull(),
    );
    const banner = document.querySelector("[data-projects-error]") as HTMLElement;
    expect(banner.textContent).toBe("The due date cannot be before the start date.");
    expect(within(banner).queryAllByRole("link")).toHaveLength(0);
  });
});

// =============================================================================================

describe("PB4 the GitHub webhook help", () => {
  it("gives the payload URL from the API origin, the content type, where the secret lives, the events and the rule", () => {
    mount(<GithubWebhookHelp origin="https://portal.example.test" />);
    expect(
      screen.getByText("https://portal.example.test/api/v1/projects/github/webhook"),
    ).toBeTruthy();
    expect(screen.getByText("application/json")).toBeTruthy();
    expect(screen.getByText("GITHUB_WEBHOOK_SECRET")).toBeTruthy();
    expect(screen.getByText(/The Portal never shows it\./)).toBeTruthy();
    expect(screen.getByText("Pull requests and Pushes.")).toBeTruthy();
    expect(document.querySelector("[data-webhook-rules]")!.textContent).toBe(
      "Put an issue key such as PAY-12 in branch names, commits and PR titles. A merged PR whose description says fixes PAY-12 closes it. The project's repository URL must match the repository.",
    );
  });

  it("copies the payload URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mount(<GithubWebhookHelp origin="https://portal.example.test" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy the payload URL" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://portal.example.test/api/v1/projects/github/webhook",
      ),
    );
  });

  it("uses the API origin the web app already uses when none is given", () => {
    mount(<GithubWebhookHelp />);
    expect(
      screen.getByText("http://localhost:3000/api/v1/projects/github/webhook"),
    ).toBeTruthy();
  });

  it("no secret value is on the page", () => {
    mount(<GithubWebhookHelp origin="https://portal.example.test" />);
    expect(document.body.textContent).not.toMatch(/whsec|sha256=|[A-Fa-f0-9]{32,}/);
  });

  describe("on the Projects settings page", () => {
    beforeEach(() => {
      api.listAdmin.mockResolvedValue([]);
    });
    it("a Super Admin sees it", async () => {
      auth.perms = new Set([...ALL, "IntegrationClient:Update"]);
      mount(<ProjectsSettingsPage />, "/projects/settings");
      await screen.findByText("Connect GitHub");
      expect(document.querySelector("[data-webhook-url]")!.textContent).toBe(
        "http://localhost:3000/api/v1/projects/github/webhook",
      );
    });
    it("anyone else does not", async () => {
      mount(<ProjectsSettingsPage />, "/projects/settings");
      await screen.findByText("Issue types");
      expect(screen.queryByText("Connect GitHub")).toBeNull();
      expect(document.querySelector("[data-github-webhook]")).toBeNull();
    });
  });
});

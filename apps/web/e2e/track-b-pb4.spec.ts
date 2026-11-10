// track-b-pb4.spec.ts - hermetic browser tests for PB4: GitHub links on an issue, the checklist
// import (preview then import, and its refusals), the security state, the Security tab with its
// audit history, importing an audit, the release gate refusing to close a milestone, and the GitHub
// webhook help (Track A PA4 / D68). One router answers every /api/v1 call from a table of mocks
// backed by a small in-memory world; any call the table does not cover is recorded and FAILS the
// test. All data is invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222p4";
const USER_ID = "u3400000-0000-4000-8000-0000000000p4";
const ALL = ["Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"];

const me = (perms: string[]) => ({
  user: {
    id: USER_ID,
    email: "operator@example.test",
    fullName: "Ana Reyes",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: ["Clients:Read", ...perms],
    clients: [],
    assignedClientIds: [],
    canViewAllClients: true,
  },
});

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  request: Request;
}
type Handler = (route: Route, seen: Seen, m: RegExpExecArray) => Promise<void> | void;
type Entry = [method: string, pattern: RegExp, handler: Handler];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
const sentence = (route: Route, message: string, status: number) =>
  json(route, { message }, status);

// --- the world --------------------------------------------------------------------------------

const S_NEW = { id: "s-new", name: "New", colour: "#57606a", category: "TODO" };
const T_TASK = { id: "t-task", name: "Task", colour: "#57606a" };
const GATE =
  "This milestone cannot be closed while security issues are open: PAY-3, PAY-9.";

interface World {
  security: {
    state: "clear" | "open" | "blocked";
    open: number;
    critical: number;
    high: number;
  };
  audits: Array<Record<string, unknown>>;
  /** When set, the checklist preview is refused with this sentence. */
  previewRefusal?: string;
  /** When set, the real checklist import is refused with this sentence. */
  importRefusal?: string;
  /** When set, the audit import is refused with this sentence. */
  auditRefusal?: string;
  /** When set, closing a milestone is refused with this sentence. */
  closeRefusal?: string;
}

const audit = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  runId: `run-${id}`,
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
  rejected: [],
  importedBy: { id: USER_ID, fullName: "Ana Reyes" },
  actorType: "USER",
  channel: "web",
  createdAt: "2026-11-10T16:30:00.000Z",
  ...over,
});

const world = (over: Partial<World> = {}): World => ({
  security: { state: "blocked", open: 4, critical: 1, high: 1 },
  audits: [
    audit("a2", {
      runId: "run-2",
      profile: "quick",
      complete: false,
      incompleteReason: "Stopped early.",
      partial: true,
      scope: ["src/auth"],
      createdAt: "2026-11-12T03:00:00.000Z",
    }),
    audit("a1"),
  ],
  ...over,
});

const projectDto = {
  id: "pid-PAY",
  key: "PAY",
  name: "Payments",
  description: "",
  repoUrl: "https://github.com/acme/app",
  liveUrl: "",
  deployAppName: "",
  archived: false,
  parent: null,
  client: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const issue = (n: number, title: string) => ({
  id: `id-PAY-${n}`,
  key: `PAY-${n}`,
  number: n,
  title,
  priority: "NORMAL",
  startDate: null,
  dueDate: null,
  overdue: false,
  position: n,
  createdAt: "2026-11-01T01:00:00.000Z",
  updatedAt: "2026-11-05T01:00:00.000Z",
  closedAt: null,
  project: { key: "PAY", name: "Payments" },
  type: T_TASK,
  status: S_NEW,
  assignee: null,
  milestone: null,
  parentKey: null,
  labels: [],
});
const LINKS = [
  {
    kind: "pr",
    repo: "acme/app",
    number: 14,
    sha: null,
    title: "Fix the login page",
    state: "open",
    merged: false,
    url: "https://github.com/acme/app/pull/14",
    updatedAt: "2026-11-10T16:30:00.000Z",
  },
  {
    kind: "commit",
    repo: "acme/app",
    number: null,
    sha: "0123456789abcdef",
    title: "Add the form",
    state: "pushed",
    merged: false,
    url: "https://github.com/acme/app/commit/0123456789abcdef",
    updatedAt: "2026-11-09T04:00:00.000Z",
  },
  {
    kind: "pr",
    repo: "acme/app",
    number: 9,
    sha: null,
    title: "Earlier merged work",
    state: "closed",
    merged: true,
    url: "https://github.com/acme/app/pull/9",
    updatedAt: "2026-11-08T04:00:00.000Z",
  },
];
const MILESTONE = {
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

const PREVIEW = {
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
      description: "",
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

async function mockApi(
  page: Page,
  w: World,
  who: { perms: string[] } = { perms: ALL },
  extra: Entry[] = [],
) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const body = (s: Seen) => s.request.postDataJSON() as Record<string, unknown>;
  const overview = () => ({
    security: w.security,
    recentSessions: [], // PB5
    project: projectDto,
    status: { value: "ON_TRACK", note: "", updatedAt: null },
    statusUpdates: [],
    progress: { done: 1, total: 4, percent: 25 },
    counts: { todo: 3, inProgress: 0, done: 1, overdue: 0, openBugs: 0 },
    countsByStatus: [],
    countsByType: [],
    openMilestones: [MILESTONE],
    inProgress: [],
    recentActivity: [],
    lastActivityAt: null,
  });

  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me(who.perms))],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: USER_ID,
          fullName: "Ana Reyes",
          email: "operator@example.test",
          userType: "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/notifications\/unread-count$/, (r) => json(r, { count: 0 })],
    [
      "GET",
      /^\/api\/v1\/projects\/meta$/,
      (r) =>
        json(r, {
          issueTypes: [{ ...T_TASK, order: 0 }],
          issueStatuses: [{ ...S_NEW, order: 0, isDefault: true }],
          labels: [],
          users: [],
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects$/,
      (r) =>
        json(r, [
          {
            ...projectDto,
            status: "ON_TRACK",
            statusNote: "",
            statusUpdatedAt: null,
            progress: { done: 1, total: 4, percent: 25 },
            counts: { todo: 3, inProgress: 0, done: 1, overdue: 0, openBugs: 0 },
            nextMilestone: null,
            lastActivityAt: null,
            security: w.security,
          },
        ]),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY$/, (r) => json(r, overview())],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/issues$/,
      (r) =>
        json(r, {
          items: [issue(1, "Fix the login page")],
          total: 1,
          limit: 200,
          offset: 0,
        }),
    ],
    // the generic one first: a later entry wins
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/issues\/PAY-(\d+)$/,
      (r, _s, m) =>
        json(r, {
          ...issue(Number(m[1]), `Issue ${m[1]}`),
          description: "",
          author: null,
          parent: null,
          children: [],
          commentCount: 0,
          githubLinks: [],
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/issues\/PAY-1$/,
      (r) =>
        json(r, {
          ...issue(1, "Fix the login page"),
          description: "",
          author: null,
          parent: null,
          children: [],
          commentCount: 0,
          githubLinks: LINKS,
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY\/issues\/PAY-\d+\/comments$/, (r) => json(r, [])],
    // checklist import
    [
      "POST",
      /^\/api\/v1\/projects\/PAY\/import$/,
      (r, s) => {
        const b = body(s) as { dryRun: boolean };
        if (b.dryRun) {
          return w.previewRefusal ? sentence(r, w.previewRefusal, 400) : json(r, PREVIEW);
        }
        if (w.importRefusal) return sentence(r, w.importRefusal, 403);
        return json(
          r,
          {
            ...PREVIEW,
            dryRun: false,
            plan: undefined,
            keys: ["PAY-21", "PAY-22", "PAY-23"],
          },
          201,
        );
      },
    ],
    // milestones and the gate
    ["GET", /^\/api\/v1\/projects\/PAY\/milestones$/, (r) => json(r, [MILESTONE])],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/roadmap$/,
      (r) => json(r, { today: "2026-11-10", dated: [MILESTONE], undated: [] }),
    ],
    [
      "PATCH",
      /^\/api\/v1\/projects\/PAY\/milestones\/m1$/,
      (r, s) => {
        const b = body(s) as { state?: string };
        if (b.state === "CLOSED" && w.closeRefusal)
          return sentence(r, w.closeRefusal, 409);
        return json(r, { ...MILESTONE, ...b });
      },
    ],
    // security
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/security$/,
      (r) =>
        json(r, {
          projectKey: "PAY",
          state: w.security.state,
          blockedBy: w.security.state === "blocked" ? ["PAY-3", "PAY-9"] : [],
          counts: {
            open: w.security.open,
            critical: w.security.critical,
            high: w.security.high,
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
              key: "PAY-12",
              title: "Maybe a leak",
              severity: null,
              needsValidation: true,
              fingerprint: "fp4",
            },
          ],
          lastAudit: w.audits[0] ?? null,
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY\/audits$/, (r) => json(r, { items: w.audits })],
    [
      "POST",
      /^\/api\/v1\/projects\/PAY\/audits$/,
      (r) => {
        if (w.auditRefusal) return sentence(r, w.auditRefusal, 400);
        const a = audit("a3", {
          runId: "run-3",
          created: ["PAY-30", "PAY-31"],
          updated: [],
          createdAt: "2026-11-13T03:00:00.000Z",
        });
        w.audits.unshift(a);
        return json(r, a, 201);
      },
    ],
    // the settings page
    [
      "GET",
      /^\/api\/v1\/projects\/admin\/(issue-types|issue-statuses|labels)$/,
      (r) => json(r, []),
    ],
  ];
  const table = [...base, ...extra];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const s: Seen = {
      method: req.method(),
      path: url.pathname,
      search: url.searchParams,
      request: req,
    };
    seen.push(s);
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, h] = table[i]!;
      const hit = re.exec(s.path);
      if (m === s.method && hit) return h(route, s, hit);
    }
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const posts = (seen: Seen[], re: RegExp) =>
  seen.filter((s) => s.method === "POST" && re.test(s.path));
const CHECKLIST =
  "## First release\n- [ ] Sign-in page #frontend\n- [x] Set up the database\n## Later\n- [ ] Reports #newlabel";

// ===========================================================================
// GitHub links
// ===========================================================================

test.describe("PB4 GitHub links (hermetic)", () => {
  test("T1 an issue shows its pull requests and commits, newest first, each opening GitHub in a new tab", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues/PAY-1");
    const rows = page.locator("[data-github-link]");
    await expect(rows).toHaveCount(3);
    expect(
      await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-github-link"))),
    ).toEqual([
      "https://github.com/acme/app/pull/14",
      "https://github.com/acme/app/commit/0123456789abcdef",
      "https://github.com/acme/app/pull/9",
    ]);
    await expect(rows.nth(0)).toContainText("Pull request");
    await expect(rows.nth(0)).toContainText("acme/app#14");
    await expect(rows.nth(0)).toContainText("Open");
    await expect(rows.nth(1)).toContainText("Commit");
    await expect(rows.nth(1)).toContainText("acme/app@0123456");
    await expect(rows.nth(1)).toContainText("Pushed");
    await expect(rows.nth(2)).toContainText("Merged");
    const a = rows.nth(0).getByRole("link");
    await expect(a).toHaveAttribute("href", "https://github.com/acme/app/pull/14");
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", "noopener noreferrer");
    clean(unmocked, dialogs);
  });

  test("T1 the split view beside the issue list shows them too", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues");
    await page.getByText("Fix the login page").first().click();
    await expect(page.locator("[data-github-links]")).toBeVisible();
    await expect(page.locator("[data-github-link]")).toHaveCount(3);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// Checklist import
// ===========================================================================

test.describe("PB4 the checklist import (hermetic)", () => {
  test("T2 preview, then import: nothing is written by the preview, the summary links the new keys", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    await page.getByRole("button", { name: "Import checklist" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a checklist" });
    await expect(
      dialog.getByRole("button", { name: "Import", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel(/^Markdown checklist/).fill(CHECKLIST);
    await dialog.getByLabel("Headings become milestones").check();
    await dialog.getByRole("button", { name: "Preview" }).click();

    const preview = dialog.getByRole("region", { name: "Preview" });
    await expect(preview).toContainText("3 items: 2 open, 1 closed.");
    await expect(preview.locator("[data-milestone-name='First release']")).toContainText(
      "new",
    );
    await expect(preview.locator("[data-milestone-name='Later']")).toContainText(
      "exists",
    );
    await expect(preview.locator("[data-label-name='newlabel']")).toContainText("new");
    await expect(preview.locator("[data-preview-item]")).toHaveCount(3);
    await expect(preview.locator("[data-preview-item]").nth(1)).toContainText("Closed");
    await expect(preview).toContainText(
      "Line 7 is not a checklist item and was skipped.",
    );
    expect(posts(seen, /\/import$/)).toHaveLength(1);
    expect(posts(seen, /\/import$/)[0]!.request.postDataJSON()).toEqual({
      markdown: CHECKLIST,
      headingsAsMilestones: true,
      dryRun: true,
    });

    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Checklist imported" })).toContainText(
      "Imported 3 items: 2 open, 1 closed.",
    );
    expect(posts(seen, /\/import$/)).toHaveLength(2);
    expect(posts(seen, /\/import$/)[1]!.request.postDataJSON()).toEqual({
      markdown: CHECKLIST,
      headingsAsMilestones: true,
      dryRun: false,
    });
    const keys = page.locator("[data-created-keys] a");
    await expect(keys).toHaveText(["PAY-21", "PAY-22", "PAY-23"]);
    await keys.nth(1).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-22$/);
    clean(unmocked, dialogs);
  });

  test("T3 the API's refusals show as sent: the 500 item limit in the preview", async ({
    page,
  }) => {
    const w = world({
      previewRefusal: "A checklist can have at most 500 items; this one has 501.",
    });
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    await page.getByRole("button", { name: "Import checklist" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a checklist" });
    await dialog.getByLabel(/^Markdown checklist/).fill(CHECKLIST);
    await dialog.getByRole("button", { name: "Preview" }).click();
    await expect(dialog.locator("[data-projects-error]")).toHaveText(
      "A checklist can have at most 500 items; this one has 501.",
    );
    await expect(
      dialog.getByRole("button", { name: "Import", exact: true }),
    ).toBeDisabled();
    expect(posts(seen, /\/import$/)).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T3 unknown labels that need Projects:Configure refuse the import as sent; nothing is summarised", async ({
    page,
  }) => {
    const sentenceText =
      "The import uses labels that do not exist: newlabel. Creating a label needs Projects:Configure, so nothing was imported.";
    const w = world({ importRefusal: sentenceText });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    await page.getByRole("button", { name: "Import checklist" }).click();
    const dialog = page.getByRole("dialog", { name: "Import a checklist" });
    await dialog.getByLabel(/^Markdown checklist/).fill(CHECKLIST);
    await dialog.getByRole("button", { name: "Preview" }).click();
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await expect(dialog.locator("[data-projects-error]")).toHaveText(sentenceText);
    await expect(page.locator("[data-import-summary]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 someone without Projects:Create is not offered it", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, {
      perms: ["Projects:Read", "Projects:Update"],
    });
    await page.goto("/projects/PAY");
    await expect(page.getByRole("button", { name: "Edit project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import checklist" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// Security
// ===========================================================================

test.describe("PB4 security (hermetic)", () => {
  test("T4 the portfolio and the overview show the security state", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/all");
    await expect(page.locator('[data-project="PAY"] [data-security]')).toContainText(
      "Blocked: 1 critical, 1 high",
    );
    await page.getByRole("link", { name: "Payments" }).first().click();
    await expect(page.getByRole("link", { name: "Security", exact: true })).toBeVisible();
    await expect(page.locator("[data-overview-security]")).toContainText(
      "Blocked: 1 critical, 1 high",
    );
    await page.getByRole("link", { name: "Security details" }).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/security$/);
    clean(unmocked, dialogs);
  });

  test("T4 the Security tab: what blocks as links, the open issues by severity, the last audit and the history", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/security");
    await expect(page.locator("[data-blocked-by] a")).toHaveText(["PAY-3", "PAY-9"]);
    await expect(
      page.locator('[data-security-issue="PAY-3"] [data-severity]'),
    ).toHaveText("Critical");
    await expect(
      page.locator('[data-security-issue="PAY-9"] [data-severity]'),
    ).toHaveText("High");
    await expect(
      page.locator('[data-security-issue="PAY-12"] [data-severity]'),
    ).toHaveText("Needs validation");
    await expect(
      page.locator('[data-security-counts] [data-count="critical"] dd'),
    ).toHaveText("1");
    const history = page.locator("[data-audit-history] [data-audit]");
    await expect(history).toHaveCount(2);
    const r2 = history.nth(0);
    await expect(r2).toContainText("run-2");
    await expect(r2).toContainText("quick");
    await expect(r2).toContainText("src/auth");
    await expect(r2).toContainText("Incomplete");
    await expect(r2).toContainText("Stopped early.");
    await expect(r2).toContainText("Nov 12, 2026, 11:00 AM");
    const r1 = history.nth(1);
    await expect(r1).toContainText("abcdef012345");
    await expect(r1).toContainText("Whole repository");
    await expect(r1).toContainText("covered 2, candidate 1");
    await expect(r1).toContainText("7 total, 5 confirmed, 1 to validate, 1 rejected");
    await expect(r1).toContainText("Ana Reyes");
    await expect(r1).toContainText("Nov 11, 2026, 12:30 AM");
    await r1.getByRole("button", { name: "What it did" }).click();
    await expect(page.locator('[data-audit-outcome="a1"] a')).toHaveText([
      "PAY-3",
      "PAY-4",
      "PAY-5",
    ]);
    clean(unmocked, dialogs);
  });

  test("T5 import an audit from files: the run and the ledger are sent as JSON, the answer shows, the history gains it", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/security");
    await page.getByRole("button", { name: "Import audit" }).click();
    const dialog = page.getByRole("dialog", { name: "Import audit" });
    await expect(dialog.getByRole("button", { name: "Import audit" })).toBeDisabled();
    await dialog.getByLabel("findings.json file").setInputFiles({
      name: "findings.json",
      mimeType: "application/json",
      buffer: Buffer.from('[{"fingerprint":"fp-a","verdict":"confirmed"}]'),
    });
    await dialog.getByLabel("run-metadata.json file").setInputFiles({
      name: "run-metadata.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"run_id":"run-3","profile":"standard"}'),
    });
    await dialog.getByLabel("coverage-ledger.json file").setInputFiles({
      name: "coverage-ledger.json",
      mimeType: "application/json",
      buffer: Buffer.from('[{"status":"covered"}]'),
    });
    await dialog.getByRole("button", { name: "Import audit" }).click();
    await expect(page.locator("[data-audit-imported]")).toContainText(
      "Run run-3: 7 findings",
    );
    await expect(page.locator('[data-outcome="Created"] a')).toHaveText([
      "PAY-30",
      "PAY-31",
    ]);
    expect(posts(seen, /\/audits$/)[0]!.request.postDataJSON()).toEqual({
      findings: '[{"fingerprint":"fp-a","verdict":"confirmed"}]',
      run: { run_id: "run-3", profile: "standard" },
      ledger: [{ status: "covered" }],
    });
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await expect(page.locator("[data-projects-success]")).toContainText(
      "Imported audit run-3.",
    );
    await expect(page.locator("[data-audit-history] [data-audit]")).toHaveCount(3);
    await expect(page.locator("[data-audit-history] [data-audit]").first()).toContainText(
      "run-3",
    );
    clean(unmocked, dialogs);
  });

  test("T5 pasted findings go as text; a file that is not JSON is said so before sending; a refusal shows as sent", async ({
    page,
  }) => {
    const w = world({ auditRefusal: "findings[0] is not an object." });
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/security");
    await page.getByRole("button", { name: "Import audit" }).click();
    const dialog = page.getByRole("dialog", { name: "Import audit" });
    await dialog.getByLabel("Text of findings.json").fill("[1]");
    await dialog.getByLabel("run-metadata.json file").setInputFiles({
      name: "run-metadata.json",
      mimeType: "application/json",
      buffer: Buffer.from("{oops"),
    });
    await dialog.getByRole("button", { name: "Import audit" }).click();
    await expect(dialog.locator("[data-projects-error]")).toHaveText(
      "run-metadata.json is not valid JSON.",
    );
    expect(posts(seen, /\/audits$/)).toHaveLength(0);
    await dialog.getByLabel("run-metadata.json file").setInputFiles([]);
    await dialog.getByRole("button", { name: "Import audit" }).click();
    await expect(dialog.locator("[data-projects-error]")).toHaveText(
      "findings[0] is not an object.",
    );
    expect(posts(seen, /\/audits$/)[0]!.request.postDataJSON()).toEqual({
      findings: "[1]",
    });
    clean(unmocked, dialogs);
  });

  test("T5 a Viewer sees the tab and cannot import", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, { perms: ["Projects:Read"] });
    await page.goto("/projects/PAY/security");
    await expect(page.locator("[data-audit-history]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Import audit" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// The release gate
// ===========================================================================

test.describe("PB4 the release gate (hermetic)", () => {
  test("T6 closing a milestone the API refuses shows its sentence with the blocking keys as links", async ({
    page,
  }) => {
    const w = world({ closeRefusal: GATE });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/milestones");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("State").selectOption("CLOSED");
    await dialog.getByRole("button", { name: /^Save/ }).click();
    const banner = dialog.locator("[data-projects-error]");
    await expect(banner).toHaveText(GATE);
    await expect(banner.getByRole("link")).toHaveText(["PAY-3", "PAY-9"]);
    await expect(banner.getByRole("link").nth(1)).toHaveAttribute(
      "href",
      "/projects/PAY/issues/PAY-9",
    );
    await banner.getByRole("link").nth(0).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-3$/);
    clean(unmocked, dialogs);
  });

  test("T6 when nothing blocks, the milestone closes as before", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/milestones");
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("State").selectOption("CLOSED");
    await dialog.getByRole("button", { name: /^Save/ }).click();
    await expect(page.locator("[data-projects-success]")).toContainText(
      "Milestone saved.",
    );
    expect(seen.filter((s) => s.method === "PATCH")).toHaveLength(1);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// The GitHub webhook help
// ===========================================================================

test.describe("PB4 the GitHub webhook help (hermetic)", () => {
  test("T7 a Super Admin sees how to connect GitHub: the URL from the API origin, the content type, the secret's place, the events", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, {
      perms: [...ALL, "IntegrationClient:Update"],
    });
    await page.goto("/projects/settings");
    const help = page.locator("[data-github-webhook]");
    await expect(help.locator("[data-webhook-url]")).toHaveText(
      "http://localhost:3000/api/v1/projects/github/webhook",
    );
    await expect(help).toContainText("application/json");
    await expect(help.locator("[data-webhook-secret]")).toContainText(
      "GITHUB_WEBHOOK_SECRET",
    );
    await expect(help.locator("[data-webhook-secret]")).toContainText(
      "The Portal never shows it.",
    );
    await expect(help).toContainText("Pull requests and Pushes.");
    await expect(help.locator("[data-webhook-rules]")).toHaveText(
      "Put an issue key such as PAY-12 in branch names, commits and PR titles. A merged PR whose description says fixes PAY-12 closes it. The project's repository URL must match the repository.",
    );
    // PB6: the settings page offers no import of another system's data, and names none.
    await expect(page.locator("[data-sentire-import]")).toHaveCount(0);
    await expect(page.getByText(/sentire|import from/i)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T7 anyone else does not see it", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/settings");
    await expect(page.getByRole("heading", { name: "Issue types" })).toBeVisible();
    await expect(page.locator("[data-github-webhook]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

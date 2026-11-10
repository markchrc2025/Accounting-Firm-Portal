// track-b-pb5.spec.ts - hermetic browser tests for PB5: the Claude sessions card on the overview, the
// Sessions tab (paging, a link from an activity entry that lands on and highlights its session),
// and the session link on activity entries (activity tab, overview, My Work) - Track A PA5 / D69.
// One router answers every /api/v1 call from a table of mocks; any call the table does not cover
// is recorded and FAILS the test. All data is invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222p5";
const USER_ID = "u3500000-0000-4000-8000-0000000000p5";
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

// --- the world --------------------------------------------------------------------------------

const S_NEW = { id: "s-new", name: "New", colour: "#57606a", category: "TODO" };
const T_TASK = { id: "t-task", name: "Task", colour: "#57606a" };

const session = (n: number, over: Record<string, unknown> = {}) => ({
  id: `ses-${n}`,
  projectKey: "PAY",
  client: "claude-code",
  title: `Session number ${n}`,
  startedAt: "2026-11-10T16:30:00.000Z", // Nov 11, 12:30 AM in Manila
  endedAt: "2026-11-10T17:45:00.000Z", // Nov 11, 1:45 AM in Manila
  summary: `Did the work of **session ${n}**.`,
  nextSteps: "- Check the report\n- Tell the owner",
  issueKeys: ["PAY-1"],
  user: { id: USER_ID, fullName: "Ana Reyes" },
  ...over,
});

interface World {
  sessions: Array<Record<string, unknown>>;
  /** Activity items; each may carry a session. */
  activity: Array<Record<string, unknown>>;
}

const entry = (id: string, sessionRef: { id: string; title: string } | null) => ({
  id,
  projectId: "pid-PAY",
  issueKey: "PAY-1",
  issueTitle: "Fix the login page",
  action: "issue.updated",
  actorType: "CLAUDE",
  actor: null,
  channel: "claude-code",
  changes: [{ field: "status", old: "New", new: "In progress" }],
  session: sessionRef,
  createdAt: "2026-11-10T16:30:00.000Z",
});

const world = (over: Partial<World> = {}): World => ({
  sessions: [session(1), session(2, { endedAt: null, user: null, client: "" })],
  activity: [
    entry("a1", { id: "ses-2", title: "Session number 2" }),
    entry("a2", null),
    entry("a3", { id: "ses-1", title: "" }),
  ],
  ...over,
});

const projectDto = {
  id: "pid-PAY",
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
const issue1 = {
  id: "id-PAY-1",
  key: "PAY-1",
  number: 1,
  title: "Fix the login page",
  priority: "NORMAL",
  startDate: null,
  dueDate: null,
  overdue: false,
  position: 1,
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
};

async function mockApi(page: Page, w: World, perms: string[] = ALL, extra: Entry[] = []) {
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
  const overview = () => ({
    security: { state: "clear", open: 0, critical: 0, high: 0 },
    recentSessions: w.sessions.slice(0, 5),
    project: projectDto,
    status: { value: "ON_TRACK", note: "", updatedAt: null },
    statusUpdates: [],
    progress: { done: 1, total: 4, percent: 25 },
    counts: { todo: 3, inProgress: 0, done: 1, overdue: 0, openBugs: 0 },
    countsByStatus: [],
    countsByType: [],
    openMilestones: [],
    inProgress: [],
    recentActivity: w.activity,
    lastActivityAt: null,
  });

  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me(perms))],
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
            security: { state: "clear", open: 0, critical: 0, high: 0 },
          },
        ]),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY$/, (r) => json(r, overview())],
    [
      "GET",
      /^\/api\/v1\/projects\/my-work$/,
      (r) =>
        json(r, {
          today: "2026-11-10",
          totals: { assignedOpen: 0, overdue: 0, dueThisWeek: 0 },
          assigned: [],
          overdue: [],
          upcomingMilestones: [],
          recentActivity: w.activity.map((a) => ({
            ...a,
            project: { key: "PAY", name: "Payments" },
          })),
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/issues\/PAY-(\d+)$/,
      (r, _s, m) =>
        json(r, {
          ...issue1,
          key: `PAY-${m[1]}`,
          description: "",
          author: null,
          parent: null,
          children: [],
          commentCount: 0,
          githubLinks: [],
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY\/issues\/PAY-\d+\/comments$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/projects\/PAY\/milestones$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/activity$/,
      (r) =>
        json(r, {
          items: w.activity,
          page: 1,
          pageSize: 25,
          total: w.activity.length,
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/sessions$/,
      (r, s) => {
        const page = Number(s.search.get("page") ?? "1");
        const pageSize = Number(s.search.get("pageSize") ?? "25");
        return json(r, {
          items: w.sessions.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: w.sessions.length,
        });
      },
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

// ===========================================================================
// The sessions card and the Sessions tab
// ===========================================================================

test.describe("PB5 Claude sessions (hermetic)", () => {
  test("T1 the overview shows the recent sessions: who, Manila times, Open, issue keys as links", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    const card = page.locator("[data-recent-sessions]");
    await expect(card).toContainText("Recent Claude sessions");
    const rows = card.locator("[data-recent-sessions-list] > li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Session number 1");
    await expect(rows.nth(0).locator("[data-session-who]")).toHaveText("Ana Reyes");
    await expect(rows.nth(0).locator("[data-session-started]")).toContainText("12:30 AM");
    await expect(rows.nth(0).locator("[data-session-ended]")).toContainText("1:45 AM");
    // no person known: it is Claude, and it has not ended
    await expect(rows.nth(1).locator("[data-session-who]")).toHaveText("Claude");
    await expect(rows.nth(1).locator("[data-session-open]")).toHaveText("Open");
    await expect(rows.nth(1).locator("[data-session-ended]")).toHaveCount(0);
    await rows.nth(0).getByRole("link", { name: "PAY-1" }).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-1$/);
    clean(unmocked, dialogs);
  });

  test("T1 the card says so when there is no session; All sessions opens the tab", async ({
    page,
  }) => {
    const w = world({ sessions: [] });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    await expect(page.locator("[data-recent-sessions]")).toContainText(
      "No Claude session yet.",
    );
    await page.getByRole("link", { name: "All sessions" }).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/sessions$/);
    await expect(page.getByText("No Claude session yet", { exact: true })).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T2 the Sessions tab shows each session with sanitised markdown and next steps", async ({
    page,
  }) => {
    const w = world({
      sessions: [
        session(1, {
          summary:
            'Did **the work**.\n\n<script>window.__x=1</script><img src=x onerror="window.__x=2">',
        }),
        session(2, { nextSteps: "", client: "web" }),
      ],
    });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/sessions");
    const cards = page.locator("[data-sessions-tab] [data-session]");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator("h3")).toHaveText("Session number 1");
    await expect(cards.nth(0).locator("[data-session-summary] strong")).toHaveText(
      "the work",
    );
    await expect(cards.nth(0).locator("[data-session-next-steps] li")).toHaveText([
      "Check the report",
      "Tell the owner",
    ]);
    await expect(cards.nth(0)).toContainText("claude-code");
    await expect(cards.nth(1).locator("[data-session-next-steps]")).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { __x?: number }).__x),
    ).toBeUndefined();
    await expect(
      page
        .getByRole("tab", { name: "Sessions" })
        .or(page.getByRole("link", { name: "Sessions" }))
        .first(),
    ).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T2 paging: the first 25, then Show older sessions fetches the next page", async ({
    page,
  }) => {
    const w = world({
      sessions: Array.from({ length: 30 }, (_, i) => session(i + 1)),
    });
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/sessions");
    await expect(page.locator("[data-sessions-tab] [data-session]")).toHaveCount(25);
    await page.getByRole("button", { name: "Show older sessions" }).click();
    await expect(page.locator("[data-sessions-tab] [data-session]")).toHaveCount(30);
    await expect(page.getByRole("button", { name: "Show older sessions" })).toHaveCount(
      0,
    );
    const pages = seen
      .filter((s) => /\/PAY\/sessions$/.test(s.path))
      .map((s) => `${s.search.get("page")}/${s.search.get("pageSize")}`);
    expect(pages).toEqual(["1/25", "2/25"]);
    clean(unmocked, dialogs);
  });

  test("T3 a session link on an activity entry opens the Sessions tab on that session, even on a later page", async ({
    page,
  }) => {
    const w = world({
      sessions: Array.from({ length: 30 }, (_, i) => session(i + 1)),
      activity: [entry("a1", { id: "ses-28", title: "Session number 28" })],
    });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/activity");
    const link = page.locator('[data-activity="a1"] [data-session-link]');
    await expect(link).toHaveText(/Session number 28/);
    await link.click();
    await expect(page).toHaveURL(/\/projects\/PAY\/sessions\?session=ses-28$/);
    const target = page.locator('[data-session="ses-28"]');
    await expect(target).toBeVisible();
    await expect(target).toHaveAttribute("data-session-highlighted", "true");
    await expect(page.locator('[data-session-highlighted="true"]')).toHaveCount(1);
    clean(unmocked, dialogs);
  });

  test("T3 a session that is not in the list is said so", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/sessions?session=ses-gone");
    await expect(
      page.getByText("That session is not in this project's list."),
    ).toBeVisible();
    await expect(page.locator("[data-session-highlighted]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T4 activity entries show their session as a small link (title, or Session) on the activity tab, the overview and My Work; none without a session", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);

    await page.goto("/projects/PAY/activity");
    await expect(page.locator('[data-activity="a1"] [data-session-link]')).toHaveText(
      /Session number 2/,
    );
    await expect(page.locator('[data-activity="a2"] [data-session-link]')).toHaveCount(0);
    // a session with no title is called Session
    await expect(page.locator('[data-activity="a3"] [data-session-link]')).toHaveText(
      /Session$/,
    );

    await page.goto("/projects/PAY");
    await expect(
      page.locator('[data-activity="a1"] [data-session-link="ses-2"]'),
    ).toHaveAttribute("href", "/projects/PAY/sessions?session=ses-2");

    await page.goto("/projects");
    await expect(
      page.locator('[data-activity="a1"] [data-session-link="ses-2"]'),
    ).toHaveAttribute("href", "/projects/PAY/sessions?session=ses-2");
    await expect(page.locator('[data-activity="a2"] [data-session-link]')).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T5 a failing sessions list shows the API's sentence and a retry", async ({
    page,
  }) => {
    const w = world();
    let fail = true;
    const { unmocked, dialogs } = await mockApi(page, w, ALL, [
      [
        "GET",
        /^\/api\/v1\/projects\/PAY\/sessions$/,
        (r) =>
          fail
            ? json(r, { message: "You cannot read this project." }, 403)
            : json(r, {
                items: w.sessions,
                page: 1,
                pageSize: 25,
                total: w.sessions.length,
              }),
      ],
    ]);
    await page.goto("/projects/PAY/sessions");
    await expect(page.getByRole("alert").first()).toContainText(
      "You cannot read this project.",
    );
    await expect(page.getByText("Could not load the sessions.")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: /retry|try again/i }).click();
    await expect(page.locator("[data-sessions-tab] [data-session]")).toHaveCount(2);
    clean(unmocked, dialogs);
  });
});

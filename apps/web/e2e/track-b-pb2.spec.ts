// track-b-pb2.spec.ts - hermetic browser tests for PB2: the board (drag a card across columns and
// within a column, a failed move rolling back with the API's sentence, the keyboard, the Done
// window, filters), the roadmap, My Work, the Projects search (jump and results), the notification
// bell (count, polling, opening one, read all) and the email preference on the profile page
// (Track A PA2). One router answers every /api/v1 call from a table of mocks backed by a small
// in-memory world; any call the table does not cover is recorded and FAILS the test. All data is
// invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222p2";
const CLIENT = {
  id: "c3200000-0000-4000-8000-0000000000p2",
  businessName: "INVENTED THIRTY-TWO TRADING",
};
const USER_ID = "u3200000-0000-4000-8000-0000000000p2";
const ALL = ["Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"];
const VIEWER = ["Projects:Read"];

const me = (perms: string[], userType = "FIRM") => ({
  user: {
    id: USER_ID,
    email: "operator@example.test",
    fullName: "Ana Reyes",
    userType,
    firmId: FIRM_ID,
    mfaEnabled: true,
    ...(userType === "CLIENT" ? { clientId: CLIENT.id } : {}),
  },
  permissions: {
    global: ["Clients:Read", ...perms],
    clients: [],
    assignedClientIds: [CLIENT.id],
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

const S_NEW = {
  id: "s-new",
  name: "To do",
  colour: "#57606a",
  category: "TODO",
  isDefault: true,
};
const S_PROG = {
  id: "s-prog",
  name: "In progress",
  colour: "#bf8700",
  category: "IN_PROGRESS",
  isDefault: false,
};
const S_DONE = {
  id: "s-done",
  name: "Done",
  colour: "#1a7f37",
  category: "DONE",
  isDefault: false,
};
const STATUSES = [S_NEW, S_PROG, S_DONE];
const T_TASK = { id: "t-task", name: "Task", colour: "#57606a" };
const META = {
  issueTypes: [{ ...T_TASK, order: 0 }],
  issueStatuses: STATUSES.map((s, order) => ({ ...s, order })),
  labels: [],
  users: [{ id: USER_ID, fullName: "Ana Reyes", email: "operator@example.test" }],
};

interface IssueRec {
  key: string;
  number: number;
  title: string;
  statusId: string;
  position: number;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
  assigneeId: string | null;
}
interface Note {
  id: string;
  title: string;
  body: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}
interface World {
  issues: IssueRec[];
  /** Done cards the 14-day window leaves out. */
  olderHidden: number;
  /** When set, every reorder is refused with this sentence. */
  reorderRefusal?: string;
  notes: Note[];
  emailEnabled: boolean;
  /** When set, saving the email setting is refused with this sentence. */
  prefsRefusal?: string;
  milestones: Array<Record<string, unknown>>;
  /** The Manila day the API calls today. */
  today: string;
}

const rec = (n: number, over: Partial<IssueRec> = {}): IssueRec => ({
  key: `PAY-${n}`,
  number: n,
  title: `Card number ${n}`,
  statusId: "s-new",
  position: n,
  priority: "NORMAL",
  dueDate: null,
  overdue: false,
  assigneeId: null,
  ...over,
});
const note = (n: number, over: Partial<Note> = {}): Note => ({
  id: `n${n}`,
  title: `PAY-${n} was assigned to you`,
  body: `Ben Cruz assigned you PAY-${n}: Card number ${n}`,
  link: `/projects/PAY/issues/PAY-${n}`,
  readAt: null,
  createdAt: `2026-11-1${n}T08:00:00.000Z`,
  ...over,
});
const milestone = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: id,
  description: "",
  startDate: null,
  dueDate: null,
  state: "OPEN",
  progress: { done: 0, total: 0, percent: 0 },
  percent: 0,
  today: "2026-11-10",
  overdueIssues: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

const world = (over: Partial<World> = {}): World => ({
  issues: [
    rec(1, { title: "Fix the login page", priority: "HIGH", assigneeId: USER_ID }),
    rec(2, { title: "Late invoice export", dueDate: "2026-10-01", overdue: true }),
    rec(3),
    rec(4, { statusId: "s-prog", position: 10 }),
    rec(5, { statusId: "s-done", position: 1 }),
  ],
  olderHidden: 3,
  notes: [note(1), note(2), note(3, { readAt: "2026-11-09T01:00:00.000Z" })],
  emailEnabled: false,
  milestones: [
    milestone("Alpha", {
      startDate: "2026-11-01",
      dueDate: "2026-11-10",
      progress: { done: 2, total: 5, percent: 40 },
      percent: 40,
    }),
    milestone("Beta", { startDate: "2026-11-11", dueDate: "2026-11-20" }),
    milestone("Someday"),
  ],
  today: "2026-11-10",
  ...over,
});

const statusOf = (id: string) => STATUSES.find((s) => s.id === id)!;
const issueItem = (i: IssueRec) => ({
  id: `id-${i.key}`,
  key: i.key,
  number: i.number,
  title: i.title,
  priority: i.priority,
  startDate: null,
  dueDate: i.dueDate,
  overdue: i.overdue,
  position: i.position,
  createdAt: "2026-11-01T01:00:00.000Z",
  updatedAt: "2026-11-05T01:00:00.000Z",
  closedAt: statusOf(i.statusId).category === "DONE" ? "2026-11-08T01:00:00.000Z" : null,
  project: { key: "PAY", name: "Payments" },
  type: T_TASK,
  status: { ...statusOf(i.statusId) },
  assignee: i.assigneeId ? { id: USER_ID, fullName: "Ana Reyes" } : null,
  milestone: null,
  parentKey: null,
  labels: [],
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
  client: CLIENT,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const overview = {
  project: projectDto,
  status: { value: "ON_TRACK", note: "", updatedAt: null },
  statusUpdates: [],
  progress: { done: 1, total: 5, percent: 20 },
  counts: { todo: 3, inProgress: 1, done: 1, overdue: 1, openBugs: 0 },
  countsByStatus: [],
  countsByType: [],
  openMilestones: [],
  inProgress: [],
  recentActivity: [],
  lastActivityAt: null,
};

async function mockApi(
  page: Page,
  w: World,
  who: { perms: string[]; userType?: string } = { perms: ALL },
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

  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me(who.perms, who.userType))],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: USER_ID,
          fullName: "Ana Reyes",
          email: "operator@example.test",
          userType: who.userType ?? "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [])],
    // The firm home page asks for its dashboard; these tests are not about it.
    [
      "GET",
      /^\/api\/v1\/dashboard/,
      (r) =>
        json(r, {
          kpis: [],
          incomeVsExpenses: [],
          recentActivity: [],
          upcomingFilings: [],
          regimeMix: { vat: 0, percentage: 0 },
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/meta$/, (r) => json(r, META)],
    ["GET", /^\/api\/v1\/projects\/PAY$/, (r) => json(r, overview)],
    // the board: columns in status order, cards by position, Done limited to the window
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/board$/,
      (r, s) => {
        const all = s.search.get("doneRange") === "all";
        const assignee = s.search.get("assigneeId");
        const items = w.issues.filter(
          (i) =>
            !assignee ||
            (assignee === "me" && i.assigneeId === USER_ID) ||
            (assignee === "none" && i.assigneeId === null),
        );
        return json(r, {
          today: w.today,
          doneRange: all ? "all" : "14d",
          doneSince: all ? null : "2026-10-27T00:00:00.000Z",
          total: items.length,
          columns: STATUSES.map((st) => ({
            status: st,
            items: items
              .filter((i) => i.statusId === st.id)
              .sort((a, b) => a.position - b.position || a.number - b.number)
              .map(issueItem),
            olderHidden: st.category === "DONE" && !all ? w.olderHidden : 0,
          })),
        });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/PAY\/issues\/(PAY-\d+)\/reorder$/,
      async (r, s, m) => {
        if (w.reorderRefusal) return sentence(r, w.reorderRefusal, 409);
        const b = body(s) as { position: number; statusId?: string };
        const i = w.issues.find((x) => x.key === m[1])!;
        i.position = b.position;
        if (b.statusId) i.statusId = b.statusId;
        return json(r, {
          ...issueItem(i),
          description: "",
          author: null,
          parent: null,
          children: [],
          commentCount: 0,
        });
      },
    ],
    ["GET", /^\/api\/v1\/projects\/PAY\/milestones$/, (r) => json(r, w.milestones)],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/roadmap$/,
      (r) =>
        json(r, {
          today: w.today,
          dated: w.milestones.filter((m) => m.startDate || m.dueDate),
          undated: w.milestones.filter((m) => !m.startDate && !m.dueDate),
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/my-work$/,
      (r) =>
        json(r, {
          today: w.today,
          totals: { assignedOpen: 2, overdue: 1, dueThisWeek: 1 },
          assigned: [issueItem(w.issues[0]!), issueItem(w.issues[2]!)],
          overdue: [issueItem(w.issues[1]!)],
          upcomingMilestones: [
            {
              ...milestone("Beta", { dueDate: "2026-11-20" }),
              project: { key: "PAY", name: "Payments" },
            },
          ],
          recentActivity: [
            {
              id: "a1",
              projectId: "pid-PAY",
              issueKey: "PAY-1",
              issueTitle: "Fix the login page",
              action: "issue.created",
              actorType: "USER",
              actor: { id: USER_ID, fullName: "Ana Reyes" },
              channel: "WEB",
              changes: [],
              createdAt: "2026-11-10T16:30:00.000Z",
              project: { key: "PAY", name: "Payments" },
            },
          ],
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/search$/,
      (r, s) => {
        const q = (s.search.get("q") ?? "").trim();
        if (!q) return sentence(r, "Type something to search for.", 400);
        if (q.toUpperCase() === "PAY-12")
          return json(r, {
            jump: { projectKey: "PAY", issueKey: "PAY-12" },
            issues: [],
            projects: [],
          });
        return json(r, {
          jump: null,
          issues: w.issues
            .filter((i) => i.title.toLowerCase().includes(q.toLowerCase()))
            .map(issueItem),
          projects: "payments".includes(q.toLowerCase())
            ? [
                {
                  id: "pid-PAY",
                  key: "PAY",
                  name: "Payments",
                  archived: false,
                  client: CLIENT,
                },
              ]
            : [],
        });
      },
    ],
    // the issue a jump opens
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/issues\/PAY-12$/,
      (r) =>
        json(r, {
          ...issueItem(rec(12, { title: "The jumped to issue" })),
          description: "",
          author: null,
          parent: null,
          children: [],
          commentCount: 0,
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY\/issues\/PAY-12\/comments$/, (r) => json(r, [])],
    // notifications
    [
      "GET",
      /^\/api\/v1\/notifications\/unread-count$/,
      (r) => json(r, { count: w.notes.filter((n) => !n.readAt).length }),
    ],
    [
      "GET",
      /^\/api\/v1\/notifications$/,
      (r) => {
        const sorted = [...w.notes].sort(
          (a, b) =>
            Number(!!a.readAt) - Number(!!b.readAt) ||
            b.createdAt.localeCompare(a.createdAt),
        );
        return json(r, {
          items: sorted.map((n) => ({
            ...n,
            kind: "project.issue.assigned",
            entityType: "Issue",
            entityId: "e",
          })),
          page: 1,
          pageSize: 25,
          total: sorted.length,
          unread: sorted.filter((n) => !n.readAt).length,
        });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/notifications\/read-all$/,
      (r) => {
        const open = w.notes.filter((n) => !n.readAt);
        open.forEach((n) => (n.readAt = "2026-11-10T09:00:00.000Z"));
        return json(r, { updated: open.length });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/notifications\/([^/]+)\/read$/,
      (r, _s, m) => {
        const n = w.notes.find((x) => x.id === m[1])!;
        n.readAt = n.readAt ?? "2026-11-10T09:00:00.000Z";
        return json(r, {
          ...n,
          kind: "project.issue.assigned",
          entityType: "Issue",
          entityId: "e",
        });
      },
    ],
    [
      "GET",
      /^\/api\/v1\/notifications\/preferences$/,
      (r) => json(r, { emailEnabled: w.emailEnabled }),
    ],
    [
      "PATCH",
      /^\/api\/v1\/notifications\/preferences$/,
      (r, s) => {
        if (w.prefsRefusal) return sentence(r, w.prefsRefusal, 500);
        w.emailEnabled = (body(s) as { emailEnabled: boolean }).emailEnabled;
        return json(r, { emailEnabled: w.emailEnabled });
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
const reorders = (seen: Seen[]) =>
  seen.filter((s) => s.method === "POST" && /\/reorder$/.test(s.path));
const column = (page: Page, id: string) => page.locator(`[data-column="${id}"]`);
const card = (page: Page, key: string) => page.locator(`[data-card="${key}"]`);
const keysIn = (page: Page, id: string) =>
  column(page, id)
    .locator("[data-card]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-card")));

// ===========================================================================
// The board
// ===========================================================================

test.describe("PB2 the board (hermetic)", () => {
  test("T1 one column per status in order; a card shows its key, title, priority, assignee and an overdue due date", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await expect(page.locator("[data-column]")).toHaveCount(3);
    await expect(page.locator("[data-column] h2")).toHaveText([
      "To do",
      "In progress",
      "Done",
    ]);
    expect(await keysIn(page, "s-new")).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
    await expect(card(page, "PAY-1")).toContainText("Fix the login page");
    await expect(card(page, "PAY-1")).toContainText("High");
    await expect(card(page, "PAY-1")).toContainText("Ana Reyes");
    await expect(card(page, "PAY-2")).toContainText("Overdue, due Oct 01, 2026");
    await expect(page.getByRole("link", { name: "Board", exact: true })).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T2 drag a card to another column: it is there at once and the API is told the status and a position", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await card(page, "PAY-1").dragTo(card(page, "PAY-4"), {
      targetPosition: { x: 40, y: 4 },
    });
    await expect.poll(() => reorders(seen).length).toBe(1);
    expect(reorders(seen)[0]!.path).toBe("/api/v1/projects/PAY/issues/PAY-1/reorder");
    expect(reorders(seen)[0]!.request.postDataJSON()).toEqual({
      position: 9,
      statusId: "s-prog",
    });
    await expect.poll(() => keysIn(page, "s-prog")).toEqual(["PAY-1", "PAY-4"]);
    expect(await keysIn(page, "s-new")).toEqual(["PAY-2", "PAY-3"]);
    await expect(page.locator("[data-projects-error]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T2 drag a card within its column: reordered, and only a position is sent", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await card(page, "PAY-1").dragTo(card(page, "PAY-3"), {
      targetPosition: { x: 40, y: 60 },
    });
    await expect.poll(() => reorders(seen).length).toBe(1);
    expect(reorders(seen)[0]!.request.postDataJSON()).toEqual({ position: 4 });
    await expect.poll(() => keysIn(page, "s-new")).toEqual(["PAY-2", "PAY-3", "PAY-1"]);
    clean(unmocked, dialogs);
  });

  test("T3 a refused move: the card goes back and the API's sentence shows as sent", async ({
    page,
  }) => {
    const w = world({ reorderRefusal: "That status does not exist any more." });
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await card(page, "PAY-1").dragTo(card(page, "PAY-4"), {
      targetPosition: { x: 40, y: 4 },
    });
    await expect(page.locator("[data-projects-error]")).toHaveText(
      "That status does not exist any more.",
    );
    await expect.poll(() => keysIn(page, "s-new")).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
    expect(await keysIn(page, "s-prog")).toEqual(["PAY-4"]);
    expect(reorders(seen)).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T4 by keyboard: Space picks a card up, the arrows move it, Space drops it; Escape cancels", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await card(page, "PAY-1").focus();
    await page.keyboard.press("Space");
    await expect(card(page, "PAY-1")).toHaveAttribute("data-grabbed", "true");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => keysIn(page, "s-prog")).toEqual(["PAY-1", "PAY-4"]);
    await expect(card(page, "PAY-1")).toBeFocused();
    await expect(page.locator("[data-board-live]")).toContainText(
      "PAY-1 now in In progress, position 1 of 2",
    );
    // Escape: back where it was, nothing sent
    await page.keyboard.press("Escape");
    await expect.poll(() => keysIn(page, "s-new")).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
    expect(reorders(seen)).toHaveLength(0);
    // and now for real
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect.poll(() => reorders(seen).length).toBe(1);
    expect(reorders(seen)[0]!.request.postDataJSON()).toEqual({
      position: 11,
      statusId: "s-prog",
    });
    await expect.poll(() => keysIn(page, "s-prog")).toEqual(["PAY-4", "PAY-1"]);
    await expect(card(page, "PAY-1")).toBeFocused();
    clean(unmocked, dialogs);
  });

  test("T5 the Done column shows the last 14 days and how many older cards are hidden; Show all asks for all", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await expect(column(page, "s-done")).toContainText("3 older cards hidden");
    expect(
      seen
        .filter((s) => s.path.endsWith("/board"))
        .at(-1)!
        .search.get("doneRange"),
    ).toBeNull();
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(column(page, "s-done")).not.toContainText("older");
    await expect(page).toHaveURL(/done=all/);
    await expect
      .poll(() =>
        seen
          .filter((s) => s.path.endsWith("/board"))
          .at(-1)!
          .search.get("doneRange"),
      )
      .toBe("all");
    await page.getByRole("button", { name: "Show last 14 days" }).click();
    await expect(column(page, "s-done")).toContainText("3 older cards hidden");
    clean(unmocked, dialogs);
  });

  test("T5 the assignee filter: me and unassigned are asked of the API", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    await page.getByLabel("Assignee").selectOption("me");
    await expect.poll(() => keysIn(page, "s-new")).toEqual(["PAY-1"]);
    expect(
      seen
        .filter((s) => s.path.endsWith("/board"))
        .at(-1)!
        .search.get("assigneeId"),
    ).toBe("me");
    await page.getByLabel("Assignee").selectOption("none");
    await expect.poll(() => keysIn(page, "s-new")).toEqual(["PAY-2", "PAY-3"]);
    await page.getByLabel("Milestone").selectOption("none");
    await expect
      .poll(() =>
        seen
          .filter((s) => s.path.endsWith("/board"))
          .at(-1)!
          .search.get("milestoneId"),
      )
      .toBe("none");
    clean(unmocked, dialogs);
  });

  test("T6 a Viewer sees the board and cannot move a card", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w, { perms: VIEWER });
    await page.goto("/projects/PAY/board");
    await expect(card(page, "PAY-1")).toBeVisible();
    await expect(card(page, "PAY-1")).toHaveAttribute("draggable", "false");
    await card(page, "PAY-1").focus();
    await page.keyboard.press("Space");
    await expect(card(page, "PAY-1")).not.toHaveAttribute("data-grabbed", "true");
    expect(reorders(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });
});

test.describe("PB2 where Projects lists go (hermetic)", () => {
  test("T7 the Projects crumb inside a project opens All projects; a new project's Back does too", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, { perms: ALL }, [
      ["GET", /^\/api\/v1\/projects$/, (r) => json(r, [])],
    ]);
    await page.goto("/projects/PAY/board");
    await page.getByRole("link", { name: "Projects", exact: true }).first().click();
    await expect(page).toHaveURL(/\/projects\/all$/);
    await page.goto("/projects/new");
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/projects\/all$/);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// The roadmap
// ===========================================================================

test.describe("PB2 the roadmap (hermetic)", () => {
  test("T7 a bar per dated milestone, filled by percent done, today marked, undated listed below", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/milestones");
    const alpha = page.getByRole("progressbar", { name: "Alpha, 40% done" });
    await expect(alpha).toBeVisible();
    await expect(alpha).toHaveAttribute("data-bar-left", "0.00");
    await expect(alpha).toHaveAttribute("data-bar-width", "50.00");
    await expect(alpha.locator("[data-bar-fill]")).toHaveAttribute("data-bar-fill", "40");
    const beta = page.getByRole("progressbar", { name: "Beta, 0% done" });
    await expect(beta).toHaveAttribute("data-bar-left", "50.00");
    // today (Nov 10) is the tenth of twenty days: the middle of day ten is 47.5% along
    const today = page.locator("[data-today]");
    await expect(today).toHaveAttribute("data-today", "2026-11-10");
    await expect(today).toHaveAttribute("style", /left: 47\.5%/);
    await expect(page.locator("[data-undated]")).toContainText("Someday");
    await expect(page.locator("[data-roadmap-bar]")).toHaveCount(2);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// My Work and search
// ===========================================================================

test.describe("PB2 My Work and search (hermetic)", () => {
  test("T8 Projects opens on My Work: totals, my issues, overdue, milestones, activity in Manila time", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/");
    await page.locator("aside").getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { name: "My Work", level: 1 })).toBeVisible();
    await expect(page.locator('[data-total="assignedOpen"]')).toContainText("2");
    await expect(page.locator('[data-total="overdue"]')).toContainText("1");
    await expect(page.locator('[data-total="dueThisWeek"]')).toContainText("1");
    await expect(page.locator('[data-section="assigned"] [data-issue]')).toHaveText([
      /PAY-1/,
      /PAY-3/,
    ]);
    await expect(page.locator('[data-section="overdue"]')).toContainText(
      "Overdue, due Oct 01, 2026",
    );
    await expect(page.locator('[data-section="milestones"]')).toContainText(
      "Due Nov 20, 2026",
    );
    await expect(page.locator('[data-section="activity"]')).toContainText(
      "Nov 11, 2026, 12:30 AM",
    );
    await page.getByRole("link", { name: "All projects" }).click();
    await expect(page).toHaveURL(/\/projects\/all$/);
    clean(unmocked, dialogs);
  });

  test("T9 an exact key goes straight to that issue; a normal search shows issues and projects; empty shows the API's sentence", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects");
    const box = page.getByRole("searchbox", { name: "Search issues and projects" });
    await box.fill("pay-12");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-12$/);
    await expect
      .poll(() =>
        seen.some(
          (s) => s.method === "GET" && s.path === "/api/v1/projects/PAY/issues/PAY-12",
        ),
      )
      .toBe(true);
    // Back does not return to a results page that would jump again
    await page.goBack();
    await expect(page).toHaveURL(/\/projects$/);

    await box.fill("login");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/projects\/search\?q=login$/);
    await expect(
      page.locator('[data-section="issues"] [data-issue="PAY-1"]'),
    ).toBeVisible();
    await expect(page.locator('[data-section="projects"]')).toContainText(
      "No project matches",
    );
    await box.fill("payments");
    await box.press("Enter");
    await expect(
      page.locator('[data-section="projects"] [data-project="PAY"]'),
    ).toContainText("INVENTED THIRTY-TWO TRADING");

    await box.fill("   ");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/projects\/search$/);
    await expect(page.locator("[data-projects-error]")).toHaveText(
      "Type something to search for.",
    );
    expect(
      seen.some((s) => s.path.endsWith("/search") && s.search.get("q") === "pay-12"),
    ).toBe(true);
    clean(unmocked, dialogs);
  });

  test("T9 the search box is also inside a project", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/board");
    const box = page.getByRole("searchbox", { name: "Search issues and projects" });
    await box.fill("PAY-12");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-12$/);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// The bell and the email setting
// ===========================================================================

const bellButton = (page: Page) => page.getByRole("button", { name: /^Notifications/ });

test.describe("PB2 notifications (hermetic)", () => {
  test("T10 the bell shows the unread count; opening the panel lists unread first; opening one marks it read and goes to its link", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/");
    await expect(page.locator("[data-bell-count]")).toHaveText("2");
    await bellButton(page).click();
    const dialog = page.getByRole("dialog", { name: "Notifications" });
    await expect(dialog.locator("[data-notification]")).toHaveCount(3);
    expect(
      await dialog
        .locator("[data-notification]")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-unread"))),
    ).toEqual(["true", "true", "false"]);
    await dialog.getByText("PAY-1 was assigned to you").click();
    await expect
      .poll(
        () =>
          seen.filter((s) => s.method === "POST" && s.path.endsWith("/n1/read")).length,
      )
      .toBe(1);
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-1$/);
    await expect(page.getByRole("dialog", { name: "Notifications" })).toHaveCount(0);
    await expect(page.locator("[data-bell-count]")).toHaveText("1");
    clean(unmocked, dialogs);
  });

  test("T10 Mark all as read clears the count and the unread marks", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/");
    await expect(page.locator("[data-bell-count]")).toHaveText("2");
    await bellButton(page).click();
    await page.getByRole("button", { name: "Mark all as read" }).click();
    await expect(page.locator("[data-bell-count]")).toHaveCount(0);
    await expect(page.locator('[data-notification][data-unread="true"]')).toHaveCount(0);
    expect(
      seen.filter((s) => s.method === "POST" && s.path.endsWith("/read-all")),
    ).toHaveLength(1);
    await expect(page.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
    clean(unmocked, dialogs);
  });

  test("T11 the count is asked again after 60 seconds", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator("[data-bell-count]")).toHaveText("2");
    const counts = () => seen.filter((s) => s.path.endsWith("/unread-count")).length;
    const before = counts();
    w.notes.push(note(4));
    await page.clock.runFor(59_000);
    expect(counts()).toBe(before);
    await page.clock.runFor(2_000);
    await expect.poll(counts).toBe(before + 1);
    await expect(page.locator("[data-bell-count]")).toHaveText("3");
    clean(unmocked, dialogs);
  });

  test("T12 a client user has the bell too", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(
      page,
      w,
      { perms: [], userType: "CLIENT" },
      [["GET", /^\/api\/v1\/portal\/.*$/, (r) => json(r, {})]],
    );
    await page.goto("/portal");
    await expect(bellButton(page)).toBeVisible();
    await expect(page.locator("[data-bell-count]")).toHaveText("2");
    void unmocked;
    void dialogs;
  });

  test("T13 the email setting on the profile page: off by default, switched on and saved", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile");
    const box = page.getByRole("checkbox", { name: "Email me my notifications" });
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const patches = seen.filter(
      (s) => s.method === "PATCH" && s.path.endsWith("/notifications/preferences"),
    );
    expect(patches).toHaveLength(1);
    expect(patches[0]!.request.postDataJSON()).toEqual({ emailEnabled: true });
    await expect(box).toBeChecked();
    expect(w.emailEnabled).toBe(true);
    // it is still on after a reload
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: "Email me my notifications" }),
    ).toBeChecked();
    clean(unmocked, dialogs);
  });

  test("T13 a refused save shows the API's sentence and the box stays off", async ({
    page,
  }) => {
    const w = world({ prefsRefusal: "Could not save that." });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile");
    const box = page.getByRole("checkbox", { name: "Email me my notifications" });
    await box.click();
    await expect(page.getByText("Could not save that.")).toBeVisible();
    await expect(box).not.toBeChecked();
    clean(unmocked, dialogs);
  });
});

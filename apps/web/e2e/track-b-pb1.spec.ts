// track-b-pb1.spec.ts — hermetic browser tests for PB1: the Projects screens (Track A PA1). One
// router answers every /api/v1 call from a table of mocks backed by a small in-memory world;
// any call the table does not cover is recorded and FAILS the test (except where a test says
// it does not look). All data is invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { answerBell } from "./helpers/bell";

const FIRM_ID = "22222222-2222-4222-8222-2222222222p1";
const CLIENT = {
  id: "c3100000-0000-4000-8000-0000000000p1",
  businessName: "INVENTED THIRTY-ONE TRADING",
};
const OTHER_CLIENT = {
  id: "c3100000-0000-4000-8000-0000000000p2",
  businessName: "INVENTED OTHER FOODS",
};
const USER_ID = "u3100000-0000-4000-8000-0000000000p1";
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
  name: "New",
  colour: "#57606a",
  category: "TODO",
  order: 0,
  isDefault: true,
};
const S_PROG = {
  id: "s-prog",
  name: "In progress",
  colour: "#bf8700",
  category: "IN_PROGRESS",
  order: 1,
  isDefault: false,
};
const S_DONE = {
  id: "s-done",
  name: "Done",
  colour: "#1a7f37",
  category: "DONE",
  order: 2,
  isDefault: false,
};
const T_TASK = { id: "t-task", name: "Task", colour: "#57606a", order: 0 };
const T_BUG = { id: "t-bug", name: "Bug", colour: "#cf222e", order: 1 };
const META = {
  issueTypes: [T_TASK, T_BUG],
  issueStatuses: [S_NEW, S_PROG, S_DONE],
  labels: [{ id: "l-front", name: "frontend", colour: "#1a7f37" }],
  users: [{ id: USER_ID, fullName: "Ana Reyes", email: "operator@example.test" }],
};

interface IssueRec {
  key: string;
  number: number;
  title: string;
  description: string;
  statusId: string;
  typeId: string;
  priority: string;
  dueDate: string | null;
  overdue: boolean;
  assigneeId: string | null;
  parentKey: string | null;
  updatedAt: string;
  deleted?: boolean;
}
interface World {
  projects: Array<{
    key: string;
    name: string;
    description: string;
    archived: boolean;
    client: { id: string; businessName: string } | null;
    status: string;
  }>;
  issues: IssueRec[];
  comments: Record<string, Array<{ id: string; body: string; createdAt: string }>>;
  milestones: Array<{
    id: string;
    name: string;
    description: string;
    startDate: string | null;
    dueDate: string | null;
    state: string;
  }>;
  statusUpdates: Array<{ id: string; status: string; note: string; createdAt: string }>;
  activity: Array<Record<string, unknown>>;
  nextIssue: number;
  /** The default for any call the world does not model: undefined means "fail it". */
  deleteStatusRefusal?: string;
}

const issueRec = (n: number, over: Partial<IssueRec> = {}): IssueRec => ({
  key: `PAY-${n}`,
  number: n,
  title: `Issue number ${n}`,
  description: "",
  statusId: "s-new",
  typeId: "t-task",
  priority: "NORMAL",
  dueDate: null,
  overdue: false,
  assigneeId: null,
  parentKey: null,
  updatedAt: `2026-11-0${n}T01:00:00.000Z`,
  ...over,
});

const world = (over: Partial<World> = {}): World => ({
  projects: [
    {
      key: "PAY",
      name: "Payments",
      description: "The **payments** project",
      archived: false,
      client: CLIENT,
      status: "ON_TRACK",
    },
    {
      key: "OLD",
      name: "Old thing",
      description: "",
      archived: true,
      client: null,
      status: "FINISHED",
    },
  ],
  issues: [
    issueRec(1, {
      title: "Fix the login page",
      statusId: "s-prog",
      priority: "HIGH",
      assigneeId: USER_ID,
    }),
    issueRec(2, {
      title: "Late invoice export",
      dueDate: "2026-10-01",
      overdue: true,
      typeId: "t-bug",
    }),
    issueRec(3, { title: "Ship it", statusId: "s-done" }),
    issueRec(4, { title: "A child task", parentKey: "PAY-1" }),
  ],
  comments: {},
  milestones: [
    {
      id: "m1",
      name: "Beta",
      description: "",
      startDate: null,
      dueDate: "2026-12-01",
      state: "OPEN",
    },
  ],
  statusUpdates: [
    {
      id: "su1",
      status: "ON_TRACK",
      note: "Going well",
      createdAt: "2026-11-05T01:00:00.000Z",
    },
  ],
  activity: [],
  nextIssue: 5,
  ...over,
});

const statusOf = (id: string) => [S_NEW, S_PROG, S_DONE].find((s) => s.id === id)!;
const typeOf = (id: string) => [T_TASK, T_BUG].find((t) => t.id === id)!;
const issueItem = (i: IssueRec) => ({
  id: `id-${i.key}`,
  key: i.key,
  number: i.number,
  title: i.title,
  priority: i.priority,
  startDate: null,
  dueDate: i.dueDate,
  overdue: i.overdue,
  position: i.number,
  createdAt: "2026-11-01T01:00:00.000Z",
  updatedAt: i.updatedAt,
  closedAt: null,
  project: { key: "PAY", name: "Payments" },
  type: typeOf(i.typeId),
  status: statusOf(i.statusId),
  assignee: i.assigneeId ? { id: USER_ID, fullName: "Ana Reyes" } : null,
  milestone: null,
  parentKey: i.parentKey,
  labels: [],
});
const issueDetail = (w: World, i: IssueRec) => ({
  ...issueItem(i),
  description: i.description,
  author: { id: USER_ID, fullName: "Ana Reyes" },
  parent: i.parentKey
    ? {
        key: i.parentKey,
        title: w.issues.find((x) => x.key === i.parentKey)?.title ?? "",
      }
    : null,
  children: w.issues.filter((c) => c.parentKey === i.key && !c.deleted).map(issueItem),
  commentCount: (w.comments[i.key] ?? []).length,
  githubLinks: [], // PB4
});
const live = (w: World) => w.issues.filter((i) => !i.deleted);
const counts = (w: World) => {
  const l = live(w);
  const cat = (i: IssueRec) => statusOf(i.statusId).category;
  return {
    todo: l.filter((i) => cat(i) === "TODO").length,
    inProgress: l.filter((i) => cat(i) === "IN_PROGRESS").length,
    done: l.filter((i) => cat(i) === "DONE").length,
    overdue: l.filter((i) => i.overdue && cat(i) !== "DONE").length,
    openBugs: l.filter((i) => i.typeId === "t-bug" && cat(i) !== "DONE").length,
  };
};
const milestoneDto = (m: World["milestones"][number]) => ({
  ...m,
  progress: { done: 1, total: 4, percent: 25 },
  percent: 25,
  today: "2026-11-10",
  overdueIssues: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});
const projectDto = (p: World["projects"][number]) => ({
  id: `pid-${p.key}`,
  key: p.key,
  name: p.name,
  description: p.description,
  repoUrl: "",
  liveUrl: "",
  deployAppName: "",
  archived: p.archived,
  parent: null,
  client: p.client,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
});
const summary = (w: World, p: World["projects"][number]) => {
  const c = counts(w);
  const total = c.todo + c.inProgress + c.done;
  return {
    ...projectDto(p),
    security: { state: "clear", open: 0, critical: 0, high: 0 }, // PB4
    status: p.status,
    statusNote: "",
    statusUpdatedAt: "2026-11-05T01:00:00.000Z",
    progress: {
      done: c.done,
      total,
      percent: total ? Math.round((c.done / total) * 100) : 0,
    },
    counts: c,
    nextMilestone: w.milestones[0] ? milestoneDto(w.milestones[0]) : null,
    lastActivityAt: "2026-11-10T16:30:00.000Z",
  };
};
const overview = (w: World, p: World["projects"][number]) => {
  const c = counts(w);
  const total = c.todo + c.inProgress + c.done;
  const updates = [...w.statusUpdates].reverse().map((u) => ({
    ...u,
    actorType: "USER",
    actor: { id: USER_ID, fullName: "Ana Reyes" },
  }));
  return {
    security: { state: "clear", open: 0, critical: 0, high: 0 }, // PB4
    recentSessions: [], // PB5
    project: projectDto(p),
    status: {
      value: updates[0]?.status ?? "NOT_STARTED",
      note: updates[0]?.note ?? "",
      updatedAt: updates[0]?.createdAt ?? null,
    },
    statusUpdates: updates,
    progress: {
      done: c.done,
      total,
      percent: total ? Math.round((c.done / total) * 100) : 0,
    },
    counts: c,
    countsByStatus: [S_NEW, S_PROG, S_DONE].map((s) => ({
      status: s,
      count: live(w).filter((i) => i.statusId === s.id).length,
    })),
    countsByType: [T_TASK, T_BUG].map((t) => ({
      type: t,
      count: live(w).filter((i) => i.typeId === t.id).length,
    })),
    openMilestones: w.milestones.filter((m) => m.state !== "CLOSED").map(milestoneDto),
    inProgress: live(w)
      .filter((i) => statusOf(i.statusId).category === "IN_PROGRESS")
      .map(issueItem),
    recentActivity: [],
    lastActivityAt: "2026-11-10T16:30:00.000Z",
  };
};

// --- the router ---------------------------------------------------------------------------------

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
  const pk = (path: string) => decodeURIComponent(path.split("/")[4]!);
  const project = (path: string) => w.projects.find((p) => p.key === pk(path));
  const issue = (path: string) =>
    w.issues.find((i) => i.key === decodeURIComponent(path.split("/")[6]!) && !i.deleted);
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
    [
      "GET",
      /^\/api\/v1\/clients$/,
      (r) =>
        json(
          r,
          [CLIENT, OTHER_CLIENT].map((c) => ({
            ...c,
            tin: "000-111-222-00000",
            taxType: "VAT",
            currency: "PHP",
            status: "Active",
          })),
        ),
    ],
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
    // PB2: Projects opens on My Work
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
          recentActivity: [],
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/meta$/, (r) => json(r, META)],
    [
      "GET",
      /^\/api\/v1\/projects\/issue-keys\/([^/]+)$/,
      (r, s) => {
        const i = w.issues.find(
          (x) => x.key === decodeURIComponent(s.path.split("/")[5]!) && !x.deleted,
        );
        return i ? json(r, issueItem(i)) : sentence(r, "Issue not found.", 404);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects$/,
      (r, s) =>
        json(
          r,
          w.projects
            .filter((p) => s.search.get("includeArchived") === "true" || !p.archived)
            .map((p) => summary(w, p)),
        ),
    ],
    [
      "POST",
      /^\/api\/v1\/projects$/,
      (r, s) => {
        const b = body(s) as { key: string; name: string; clientId?: string | null };
        const client = [CLIENT, OTHER_CLIENT].find((c) => c.id === b.clientId) ?? null;
        w.projects.push({
          key: b.key,
          name: b.name,
          description: "",
          archived: false,
          client,
          status: "NOT_STARTED",
        });
        return json(r, projectDto(w.projects.at(-1)!), 201);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/(?!meta$)[^/]+$/,
      (r, s) => {
        const p = project(s.path);
        return p ? json(r, overview(w, p)) : sentence(r, "Project not found.", 404);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/[^/]+\/status-updates$/,
      (r, s) => {
        const b = body(s) as { status: string; note: string };
        w.statusUpdates.push({
          id: `su${w.statusUpdates.length + 1}`,
          status: b.status,
          note: b.note,
          createdAt: "2026-11-11T02:00:00.000Z",
        });
        return json(r, {
          ...w.statusUpdates.at(-1),
          actorType: "USER",
          actor: { id: USER_ID, fullName: "Ana Reyes" },
        });
      },
    ],
    // PB2: the Milestones tab also draws the roadmap
    [
      "GET",
      /^\/api\/v1\/projects\/[^/]+\/roadmap$/,
      (r) =>
        json(r, {
          today: "2026-11-10",
          dated: w.milestones.filter((m) => m.startDate || m.dueDate).map(milestoneDto),
          undated: w.milestones
            .filter((m) => !m.startDate && !m.dueDate)
            .map(milestoneDto),
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/[^/]+\/milestones$/,
      (r) => json(r, w.milestones.map(milestoneDto)),
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/[^/]+\/milestones$/,
      (r, s) => {
        const b = body(s) as {
          name: string;
          description?: string;
          dueDate?: string | null;
        };
        w.milestones.push({
          id: `m${w.milestones.length + 1}`,
          name: b.name,
          description: b.description ?? "",
          startDate: null,
          dueDate: b.dueDate ?? null,
          state: "OPEN",
        });
        return json(r, milestoneDto(w.milestones.at(-1)!), 201);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/[^/]+\/activity$/,
      (r, s) => {
        const t = s.search.get("actorType");
        const items = w.activity.filter((a) => !t || a.actorType === t);
        return json(r, { items, page: 1, pageSize: 25, total: items.length });
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/[^/]+\/issues$/,
      (r, s) => {
        const view = s.search.get("view") ?? "open";
        const q = (s.search.get("q") ?? "").toLowerCase();
        const items = live(w).filter((i) => {
          const cat = statusOf(i.statusId).category;
          if (view === "open" && cat === "DONE") return false;
          if (view === "closed" && cat !== "DONE") return false;
          if (view === "overdue" && !(i.overdue && cat !== "DONE")) return false;
          if (view === "bugs" && !(i.typeId === "t-bug" && cat !== "DONE")) return false;
          if (view === "mine" && i.assigneeId !== USER_ID) return false;
          if (q && !i.title.toLowerCase().includes(q)) return false;
          return true;
        });
        return json(r, {
          items: items.map(issueItem),
          total: items.length,
          limit: 200,
          offset: 0,
        });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/[^/]+\/issues\/quick$/,
      (r, s) => {
        const b = body(s) as { title: string };
        const rec = issueRec(w.nextIssue++, {
          title: b.title,
          updatedAt: "2026-11-11T02:00:00.000Z",
        });
        w.issues.push(rec);
        return json(r, issueDetail(w, rec), 201);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/[^/]+\/issues$/,
      (r, s) => {
        const b = body(s) as { title: string; priority?: string };
        const rec = issueRec(w.nextIssue++, {
          title: b.title,
          priority: b.priority ?? "NORMAL",
          updatedAt: "2026-11-11T02:00:00.000Z",
        });
        w.issues.push(rec);
        return json(r, issueDetail(w, rec), 201);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/[^/]+\/issues\/[^/]+$/,
      (r, s) => {
        const i = issue(s.path);
        return i ? json(r, issueDetail(w, i)) : sentence(r, "Issue not found.", 404);
      },
    ],
    [
      "PATCH",
      /^\/api\/v1\/projects\/[^/]+\/issues\/[^/]+$/,
      (r, s) => {
        const i = issue(s.path);
        if (!i) return sentence(r, "Issue not found.", 404);
        const b = body(s) as Partial<IssueRec> & { statusId?: string };
        if (b.statusId) i.statusId = b.statusId;
        if (b.priority) i.priority = b.priority;
        return json(r, issueDetail(w, i));
      },
    ],
    [
      "DELETE",
      /^\/api\/v1\/projects\/[^/]+\/issues\/[^/]+$/,
      (r, s) => {
        const i = issue(s.path);
        if (!i) return sentence(r, "Issue not found.", 404);
        i.deleted = true;
        return json(r, { deleted: true, key: i.key });
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/[^/]+\/issues\/[^/]+\/comments$/,
      (r, s) => {
        const k = decodeURIComponent(s.path.split("/")[6]!);
        return json(
          r,
          (w.comments[k] ?? []).map((c) => ({
            ...c,
            author: { id: USER_ID, fullName: "Ana Reyes" },
            updatedAt: c.createdAt,
          })),
        );
      },
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/[^/]+\/issues\/[^/]+\/comments$/,
      (r, s) => {
        const k = decodeURIComponent(s.path.split("/")[6]!);
        const c = {
          id: `cm${(w.comments[k] ?? []).length + 1}`,
          body: (body(s) as { body: string }).body,
          createdAt: "2026-11-11T02:00:00.000Z",
        };
        (w.comments[k] ??= []).push(c);
        return json(
          r,
          {
            ...c,
            author: { id: USER_ID, fullName: "Ana Reyes" },
            updatedAt: c.createdAt,
          },
          201,
        );
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/admin\/issue-types$/,
      (r) =>
        json(
          r,
          [T_TASK, T_BUG].map((t) => ({ ...t, issueCount: 2 })),
        ),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/admin\/issue-statuses$/,
      (r) =>
        json(
          r,
          [S_NEW, S_PROG, S_DONE].map((s) => ({
            ...s,
            issueCount: s.id === "s-new" ? 3 : 0,
          })),
        ),
    ],
    // PB7: the settings page also lists the project categories
    ["GET", /^\/api\/v1\/projects\/admin\/project-categories$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/projects\/admin\/labels$/,
      (r) =>
        json(
          r,
          META.labels.map((l) => ({ ...l, issueCount: 1 })),
        ),
    ],
    [
      "DELETE",
      /^\/api\/v1\/projects\/admin\/issue-statuses\/[^/]+$/,
      (r) => sentence(r, w.deleteStatusRefusal ?? "Issue status not found.", 409),
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
    if (await answerBell(route)) return; // PB2: the header bell
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const posts = (seen: Seen[], tail: RegExp) =>
  seen.filter((s) => s.method === "POST" && tail.test(s.path));
const nav = (page: Page) => page.locator("aside");

// ===========================================================================

test.describe("PB1 the sidebar and who sees Projects (hermetic)", () => {
  test("T1 a firm user with Projects:Read sees the Projects item and it opens Projects (My Work since PB2)", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, { perms: VIEWER });
    await page.goto("/");
    await nav(page).getByRole("link", { name: "Projects" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T1 a firm user without Projects:Read has no Projects item, and the page sends them home", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w, { perms: [] });
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/$/);
    await expect(nav(page).getByRole("link", { name: "Clients" })).toBeVisible();
    await expect(nav(page).getByRole("link", { name: "Projects" })).toHaveCount(0);
    expect(seen.filter((s) => s.path.startsWith("/api/v1/projects"))).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T1 a client user has no Projects item and is sent to their portal; nothing is asked of Projects", async ({
    page,
  }) => {
    const w = world();
    const { seen } = await mockApi(page, w, {
      perms: ["Projects:Read"],
      userType: "CLIENT",
    });
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/portal$/);
    await expect(nav(page).getByRole("link", { name: "Projects" })).toHaveCount(0);
    await expect(nav(page).getByRole("link", { name: "Home" })).toBeVisible();
    expect(seen.filter((s) => s.path.startsWith("/api/v1/projects"))).toHaveLength(0);
  });
});

test.describe("PB1 the portfolio and creating a project (hermetic)", () => {
  test("T2 the portfolio shows each project with its client, status, progress and counts; archived ones only when asked", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/all"); // PB2: the portfolio moved to All projects
    const row = page.locator('[data-project="PAY"]');
    await expect(row).toBeVisible();
    await expect(row.locator("[data-client]")).toHaveText(
      "Client: INVENTED THIRTY-ONE TRADING",
    );
    await expect(row.locator("[data-project-status]")).toHaveText("On track");
    await expect(row.locator('[data-count="todo"]')).toHaveText("2 to do");
    await expect(row.locator('[data-count="inProgress"]')).toHaveText("1 in progress");
    await expect(row.locator('[data-count="done"]')).toHaveText("1 done");
    await expect(row.locator('[data-count="overdue"]')).toHaveText("1 overdue");
    await expect(row.locator('[data-count="openBugs"]')).toHaveText("1 open bugs");
    await expect(row.locator('[role="progressbar"]').first()).toHaveAttribute(
      "aria-valuenow",
      "25",
    );
    await expect(row.locator("[data-next-milestone]")).toContainText("Beta");
    await expect(row.locator("[data-next-milestone]")).toContainText("Due Dec 01, 2026");
    await expect(page.locator('[data-project="OLD"]')).toHaveCount(0);
    await page.getByLabel("Show archived").check();
    await expect(page.locator('[data-project="OLD"]')).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T3 create a project with a client link: the key is typed once, the client is chosen, and the project opens", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/all"); // PB2: the portfolio moved to All projects
    await page.getByRole("button", { name: "New project" }).click();
    await expect(page).toHaveURL(/\/projects\/new$/);
    // The key format is a hint here; the API decides.
    await page.getByLabel("Key").fill("1x");
    await expect(page.locator("[data-key-hint]")).toBeVisible();
    await page.getByLabel("Key").fill("net");
    await expect(page.getByLabel("Key")).toHaveValue("NET");
    await expect(page.locator("[data-key-hint]")).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill("Network upgrade");
    await page.getByLabel("Description").fill("Replace the **router**");
    // PB7: the client is typed and picked from the suggestions (it was a select)
    await page.getByRole("combobox", { name: "Client" }).fill("thirty");
    await page.getByRole("option", { name: CLIENT.businessName }).click();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => posts(seen, /\/api\/v1\/projects$/).length).toBe(1);
    // PB7: the repository, live address and deployment name are no longer sent
    expect(posts(seen, /\/api\/v1\/projects$/)[0]!.request.postDataJSON()).toEqual({
      key: "NET",
      name: "Network upgrade",
      description: "Replace the **router**",
      parentKey: null,
      clientId: CLIENT.id,
      clientName: CLIENT.businessName,
      professionalFee: null,
      categoryId: null,
      isRecurring: false,
    });
    await expect(page).toHaveURL(/\/projects\/NET$/);
    await expect(page.locator("[data-projects-success]")).toHaveText(
      "✓Project NET created.",
    );
    await expect(page.locator("[data-client]").first()).toContainText(
      "INVENTED THIRTY-ONE TRADING",
    );
    clean(unmocked, dialogs);
  });

  test("T3 the API's refusal of a project is shown as sent and nothing navigates", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, { perms: ALL }, [
      [
        "POST",
        /^\/api\/v1\/projects$/,
        (r) => sentence(r, "A project with this key already exists.", 409),
      ],
    ]);
    await page.goto("/projects/new");
    await page.getByLabel("Key").fill("PAY");
    await page.getByLabel("Name", { exact: true }).fill("Again");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.locator("[data-projects-error]")).toHaveText(
      "A project with this key already exists.",
    );
    await expect(page).toHaveURL(/\/projects\/new$/);
    clean(unmocked, dialogs);
  });

  test("T3 the key of an existing project is shown and cannot be edited", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/edit");
    await expect(page.locator("[data-key-fixed]")).toContainText("PAY");
    await expect(page.getByLabel("Key")).toHaveCount(0);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Payments");
    // PB7: the client box holds the client's name (it was a select holding the id)
    await expect(page.getByRole("combobox", { name: "Client" })).toHaveValue(
      CLIENT.businessName,
    );
    clean(unmocked, dialogs);
  });
});

test.describe("PB1 issues (hermetic)", () => {
  test("T4 quick add an issue, then change its status in the row", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues");
    await expect(page.locator('[data-issue="PAY-1"]')).toBeVisible();
    await page.getByLabel("Quick add an issue").fill("Write the release notes");
    await page.getByLabel("Quick add an issue").press("Enter");
    await expect.poll(() => posts(seen, /\/issues\/quick$/).length).toBe(1);
    expect(posts(seen, /\/issues\/quick$/)[0]!.request.postDataJSON()).toEqual({
      title: "Write the release notes",
    });
    await expect(page.getByLabel("Quick add an issue")).toHaveValue("");
    await expect(page.locator("[data-projects-success]")).toHaveText("✓Added PAY-5.");
    const row = page.locator('[data-issue="PAY-5"]');
    await expect(row).toContainText("Write the release notes");
    await row.getByLabel("Status of PAY-5").selectOption("s-prog");
    await expect
      .poll(
        () =>
          seen.filter((s) => s.method === "PATCH" && s.path.endsWith("/issues/PAY-5"))
            .length,
      )
      .toBe(1);
    expect(seen.find((s) => s.method === "PATCH")!.request.postDataJSON()).toEqual({
      statusId: "s-prog",
    });
    await expect(row.getByLabel("Status of PAY-5")).toHaveValue("s-prog");
    clean(unmocked, dialogs);
  });

  test("T4 the views are chips and each shows its own issues; an overdue issue is marked", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues");
    await expect(page.locator("[data-issue]")).toHaveCount(3); // Open: not the done one
    await expect(page.locator('[data-issue="PAY-2"]')).toHaveAttribute(
      "data-overdue",
      "true",
    );
    await expect(page.locator('[data-issue="PAY-2"] [data-overdue-chip]')).toHaveText(
      "Overdue",
    );
    await page.getByRole("button", { name: "Closed" }).click();
    await expect(page.locator("[data-issue]")).toHaveCount(1);
    await expect(page.locator('[data-issue="PAY-3"]')).toBeVisible();
    await page.getByRole("button", { name: "Open bugs" }).click();
    await expect(page.locator("[data-issue]")).toHaveCount(1);
    await expect(page.locator('[data-issue="PAY-2"]')).toBeVisible();
    await page.getByRole("button", { name: "Assigned to me" }).click();
    await expect(page.locator('[data-issue="PAY-1"]')).toBeVisible();
    await expect(page.locator("[data-issue]")).toHaveCount(1);
    await page.getByRole("button", { name: "All" }).click();
    await expect(page.locator("[data-issue]")).toHaveCount(4);
    await expect(page).toHaveURL(/view=all/);
    // The address is the view: a reload keeps it.
    await page.reload();
    await expect(page.locator("[data-issue]")).toHaveCount(4);
    clean(unmocked, dialogs);
  });

  test("T5 a row opens the details beside the list, and Open as a page opens the issue's own address", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues");
    await page.locator('[data-issue="PAY-1"] [data-select-issue]').click();
    const details = page.locator('[data-issue-details="PAY-1"]');
    await expect(details).toBeVisible();
    await expect(page.locator("[data-issue-list]")).toBeVisible(); // the list is still there
    await expect(page).toHaveURL(/issue=PAY-1/);
    await expect(details.locator("[data-sub-issues]")).toContainText("A child task");
    await details.getByRole("link", { name: "Open as a page" }).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-1$/);
    await expect(page.locator('[data-issue-details="PAY-1"]')).toBeVisible();
    await expect(page.locator("[data-issue-list]")).toHaveCount(0);
    // A child opens at its own address, with a link back to its parent.
    await page.locator("[data-sub-issues]").getByRole("link", { name: "PAY-4" }).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-4$/);
    await expect(page.locator("[data-parent-link]")).toContainText("PAY-1");
    clean(unmocked, dialogs);
  });

  test("T6 a comment with an issue key: the key that exists is a link, the one that does not is plain text, and the link opens that issue", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues/PAY-1");
    await page
      .getByLabel("Add a comment")
      .fill("Blocked by PAY-2, see also PAY-999 and `PAY-3`.");
    await page.getByRole("button", { name: "Add comment" }).click();
    await expect.poll(() => posts(seen, /\/comments$/).length).toBe(1);
    expect(posts(seen, /\/comments$/)[0]!.request.postDataJSON()).toEqual({
      body: "Blocked by PAY-2, see also PAY-999 and `PAY-3`.",
    });
    const comment = page.locator("[data-comment]").first();
    await expect(comment.getByRole("link", { name: "PAY-2" })).toBeVisible();
    await expect(comment.getByRole("link", { name: "PAY-999" })).toHaveCount(0);
    await expect(comment.getByRole("link", { name: "PAY-3" })).toHaveCount(0); // in code
    await expect(comment).toContainText("PAY-999");
    await expect(page.getByLabel("Add a comment")).toHaveValue("");
    await comment.getByRole("link", { name: "PAY-2" }).click();
    await expect(page).toHaveURL(/\/projects\/PAY\/issues\/PAY-2$/);
    await expect(page.locator('[data-issue-details="PAY-2"]')).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T6 a description's script tag is never run, and a Delete asks first", async ({
    page,
  }) => {
    const w = world();
    w.issues[0]!.description =
      'Hello\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror="window.__pwned = 2">';
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues/PAY-1");
    await expect(page.locator("[data-description]")).toContainText("Hello");
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__pwned),
    ).toBeUndefined();
    await expect(page.locator("[data-description] script")).toHaveCount(0);
    await page.getByRole("button", { name: "Delete issue" }).click();
    await expect(page.getByRole("dialog")).toContainText("Delete PAY-1?");
    expect(seen.filter((s) => s.method === "DELETE")).toHaveLength(0);
    await page.getByRole("dialog").getByRole("button", { name: "Delete issue" }).click();
    await expect.poll(() => seen.filter((s) => s.method === "DELETE").length).toBe(1);
    await expect(page).toHaveURL(/\/projects\/PAY\/issues$/);
    await expect(page.locator("[data-projects-success]")).toHaveText("✓Deleted PAY-1.");
    await expect(page.locator('[data-issue="PAY-1"]')).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T6 the full create form: Create and add another keeps the window open", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/issues");
    await page.getByRole("button", { name: "New issue" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill("First of two");
    await dialog.getByLabel("Priority").selectOption("URGENT");
    await dialog.getByRole("button", { name: "Create and add another" }).click();
    await expect(dialog.locator("[data-projects-success]")).toHaveText("✓Created PAY-5.");
    await expect(dialog.getByLabel("Title")).toHaveValue("");
    await expect(dialog.getByLabel("Priority")).toHaveValue("URGENT");
    await dialog.getByLabel("Title").fill("Second of two");
    await dialog.getByRole("button", { name: "Create issue" }).click();
    await expect(dialog).toHaveCount(0);
    expect(posts(seen, /\/issues$/).map((s) => s.request.postDataJSON())).toEqual([
      { title: "First of two", priority: "URGENT" },
      { title: "Second of two", priority: "URGENT" },
    ]);
    await expect(page.locator('[data-issue-details="PAY-6"]')).toBeVisible();
    clean(unmocked, dialogs);
  });
});

test.describe("PB1 milestones, status, activity and settings (hermetic)", () => {
  test("T7 create a milestone", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/milestones");
    await expect(page.locator('[data-milestone="m1"]')).toContainText("Beta");
    await page.getByRole("button", { name: "New milestone" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Launch");
    await dialog.getByLabel("Due date").fill("2027-01-15");
    await dialog.getByRole("button", { name: "Create milestone" }).click();
    await expect.poll(() => posts(seen, /\/milestones$/).length).toBe(1);
    expect(posts(seen, /\/milestones$/)[0]!.request.postDataJSON()).toEqual({
      name: "Launch",
      description: "",
      startDate: null,
      dueDate: "2027-01-15",
    });
    await expect(page.locator("[data-projects-success]")).toHaveText(
      "✓Milestone Launch created.",
    );
    await expect(page.locator("[data-milestone]")).toHaveCount(2);
    await expect(page.locator("[data-milestone]").nth(1)).toContainText(
      "Due Jan 15, 2027",
    );
    clean(unmocked, dialogs);
  });

  test("T8 post a status update: it is the new status and the first line of the history", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    const card = page.locator("[data-status-card]");
    await expect(card.locator("[data-status-update]")).toHaveCount(1);
    await card.getByLabel("Status").selectOption("AT_RISK");
    await card.getByLabel("Note").fill("A supplier is late");
    await card.getByRole("button", { name: "Post status update" }).click();
    await expect.poll(() => posts(seen, /\/status-updates$/).length).toBe(1);
    expect(posts(seen, /\/status-updates$/)[0]!.request.postDataJSON()).toEqual({
      status: "AT_RISK",
      note: "A supplier is late",
    });
    await expect(card.locator("[data-projects-success]")).toHaveText(
      "✓Status update posted.",
    );
    await expect(card.locator("[data-status-update]")).toHaveCount(2);
    await expect(card.locator("[data-status-update]").first()).toContainText("At risk");
    await expect(card.locator("[data-status-update]").first()).toContainText(
      "A supplier is late",
    );
    await expect(page.locator("[data-project-status]").first()).toHaveText("At risk");
    clean(unmocked, dialogs);
  });

  test("T9 the activity is grouped by Manila day and can be filtered by who acted", async ({
    page,
  }) => {
    const w = world();
    const entry = (id: string, iso: string, actorType: string) => ({
      id,
      projectId: "pid-PAY",
      issueKey: "PAY-1",
      issueTitle: "Fix the login page",
      action: "issue.updated",
      actorType,
      actor: actorType === "USER" ? { id: USER_ID, fullName: "Ana Reyes" } : null,
      channel: "web",
      changes: [{ field: "status", old: "New", new: "In progress" }],
      createdAt: iso,
    });
    w.activity = [
      entry("a1", "2026-11-10T16:30:00.000Z", "USER"), // Nov 11, 12:30 AM in Manila
      entry("a2", "2026-11-10T15:30:00.000Z", "CLAUDE"), // Nov 10, 11:30 PM
    ];
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY/activity");
    await expect(page.locator("[data-activity-day]")).toHaveCount(2);
    await expect(page.locator("[data-activity-day]").nth(0)).toHaveAttribute(
      "data-activity-day",
      "2026-11-11",
    );
    await expect(page.locator("[data-activity-day]").nth(1)).toHaveAttribute(
      "data-activity-day",
      "2026-11-10",
    );
    await expect(page.locator('[data-activity="a1"]')).toContainText("Ana Reyes");
    await expect(page.locator('[data-activity="a1"]')).toContainText(
      "Status changed from New to In progress.",
    );
    await expect(page.locator('[data-activity="a1"]')).toContainText("12:30 AM");
    await page.getByRole("button", { name: "Claude" }).click();
    await expect(page.locator("[data-activity]")).toHaveCount(1);
    await expect(page.locator('[data-activity="a2"]')).toContainText("Claude");
    expect(seen.some((s) => s.search.get("actorType") === "CLAUDE")).toBe(true);
    clean(unmocked, dialogs);
  });

  test("T10 the settings show an in-use refusal exactly as the API sent it", async ({
    page,
  }) => {
    const SENT = "This status is used by 3 issues. Move them to another status first.";
    const w = world({ deleteStatusRefusal: SENT });
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/settings");
    const section = page.locator('[data-settings-section="issue-statuses"]');
    await expect(section.locator('[data-setting-row="s-new"]')).toContainText(
      "Used by 3 issues",
    );
    await expect(section.locator('[data-setting-row="s-new"]')).toContainText("Default");
    await section
      .locator('[data-setting-row="s-new"]')
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete issue status" })
      .click();
    await expect(section.getByRole("alert")).toHaveText(SENT);
    expect(seen.filter((s) => s.method === "DELETE")).toHaveLength(1);
    clean(unmocked, dialogs);
  });
});

test.describe("PB1 a Viewer (hermetic)", () => {
  test("T11 a Viewer reads everything and sees no write button anywhere", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, { perms: VIEWER });
    // Portfolio
    await page.goto("/projects/all"); // PB2: the portfolio moved to All projects
    await expect(page.locator('[data-project="PAY"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "New project" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Settings" })).toHaveCount(0);
    // Overview
    await page
      .locator('[data-project="PAY"]')
      .getByRole("link", { name: "Payments" })
      .click();
    await expect(page.locator("[data-status-card]")).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Post status update" })).toHaveCount(0);
    // Issues
    await page.getByRole("link", { name: "Issues" }).click();
    await expect(page.locator('[data-issue="PAY-1"]')).toBeVisible();
    await expect(page.getByLabel("Quick add an issue")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New issue" })).toHaveCount(0);
    await expect(page.getByLabel("Status of PAY-1")).toHaveCount(0);
    await page.locator('[data-issue="PAY-1"] [data-select-issue]').click();
    const details = page.locator('[data-issue-details="PAY-1"]');
    await expect(details).toBeVisible();
    await expect(details.getByLabel("Priority")).toBeDisabled();
    await expect(details.getByLabel("Add a comment")).toHaveCount(0);
    await expect(details.getByRole("button", { name: "Delete issue" })).toHaveCount(0);
    // Milestones
    await page.getByRole("link", { name: "Milestones" }).click();
    await expect(page.locator('[data-milestone="m1"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "New milestone" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    // Settings: nothing to change, and the API's sentence for it
    await page.goto("/projects/settings");
    await expect(page.locator("[data-projects-error]").first()).toHaveText(
      "Missing permission(s): Projects:Configure",
    );
    await expect(page.getByRole("button", { name: /^Add / })).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

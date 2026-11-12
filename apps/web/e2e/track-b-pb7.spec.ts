// track-b-pb7.spec.ts - hermetic browser tests for PB7 (Track A PA8 / D70): the firm's project
// details (the free-text client and Link to client, the fee box rules and the client's fee, the
// category, the recurring switch with its preview, the repository fields gone), the portfolio,
// the project categories in settings, and the BIR Deadlines page (grouping, filters, status chips,
// open or create). One router answers every /api/v1 call from a table of mocks; any call the table
// does not cover is recorded and FAILS the test. All data is invented.

import { answerBell } from "./helpers/bell";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222p7";
const USER_ID = "u3700000-0000-4000-8000-0000000000p7";
const ALL = [
  "Clients:Read",
  "Projects:Read",
  "Projects:Create",
  "Projects:Update",
  "Projects:Configure",
  "BIRForms:Read",
  "BIRForms:Create",
];

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
    global: perms,
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
type Handler = (route: Route, seen: Seen) => Promise<void> | void;
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

const CLIENTS = [
  {
    id: "c3700000-0000-4000-8000-000000000001",
    businessName: "INVENTED ALPHA TRADING",
    currency: "PHP",
    status: "Active",
    professionalFee: "3500.00",
  },
  {
    id: "c3700000-0000-4000-8000-000000000002",
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

const project = (over: Record<string, unknown> = {}) => ({
  id: "pid-PAY",
  key: "PAY",
  name: "Payments",
  description: "",
  repoUrl: "https://example.test/repo",
  liveUrl: "https://example.test",
  deployAppName: "invented-app",
  archived: false,
  parent: null,
  client: null,
  clientName: null,
  professionalFee: null,
  suggestedProfessionalFee: null,
  category: null,
  isRecurring: false,
  recurrenceStart: null,
  recurrenceEnd: null,
  recurrenceFrequency: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});
const overview = (p: Record<string, unknown>) => ({
  security: { state: "clear", open: 0, critical: 0, high: 0 },
  recentSessions: [],
  project: p,
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
});
const summary = (p: Record<string, unknown>) => ({
  ...p,
  security: { state: "clear", open: 0, critical: 0, high: 0 },
  status: "ON_TRACK",
  statusNote: "",
  statusUpdatedAt: null,
  progress: { done: 0, total: 0, percent: 0 },
  counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
  nextMilestone: null,
  lastActivityAt: null,
});

const NOTE =
  "A due date on a Saturday or Sunday moves to Monday. The Portal has no holiday table yet, so public holidays are not considered.";
const DEADLINES = {
  from: "2026-11",
  to: "2026-12",
  today: "2026-11-11",
  notes: [NOTE],
  missing: [
    {
      clientId: CLIENTS[1]!.id,
      clientName: "INVENTED BETA FOODS",
      missing: [
        {
          field: "fiscalYearStart",
          sentence: "INVENTED: no fiscal year start, so the calendar year is assumed.",
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
              clientId: CLIENTS[0]!.id,
              clientName: "INVENTED ALPHA TRADING",
              status: "filed_bir",
              birFormId: "f-1",
            },
            {
              clientId: CLIENTS[1]!.id,
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
              clientId: CLIENTS[0]!.id,
              clientName: "INVENTED ALPHA TRADING",
              status: "filed_override",
              birFormId: "f-2",
            },
            {
              clientId: CLIENTS[1]!.id,
              clientName: "INVENTED BETA FOODS",
              status: "not_started",
              birFormId: null,
            },
          ],
        },
      ],
    },
  ],
};

interface World {
  /** The project PAY as the API answers it. */
  pay: Record<string, unknown>;
  portfolio: Record<string, unknown>[];
  matches: { id: string; businessName: string; status: string }[];
  categories: (typeof CATS)[number][];
}
const world = (over: Partial<World> = {}): World => ({
  pay: project(),
  portfolio: [],
  matches: [],
  categories: [...CATS],
  ...over,
});

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
  const body = (s: Seen) => s.request.postDataJSON() as Record<string, unknown>;
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
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, CLIENTS)],
    [
      "GET",
      /^\/api\/v1\/projects\/meta$/,
      (r) =>
        json(r, {
          issueTypes: [],
          issueStatuses: [],
          labels: [],
          users: [],
          projectCategories: w.categories,
        }),
    ],
    ["GET", /^\/api\/v1\/projects$/, (r) => json(r, w.portfolio)],
    ["GET", /^\/api\/v1\/projects\/PAY$/, (r) => json(r, overview(w.pay))],
    [
      "POST",
      /^\/api\/v1\/projects$/,
      (r, s) => json(r, project({ ...body(s), key: body(s).key }), 201),
    ],
    [
      "PATCH",
      /^\/api\/v1\/projects\/PAY$/,
      (r, s) => {
        w.pay = { ...w.pay, ...body(s) };
        return json(r, w.pay);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/client-matches$/,
      (r) =>
        json(r, {
          clientName: w.pay.clientName,
          linked: !!w.pay.client,
          matches: w.matches,
        }),
    ],
    ["GET", /^\/api\/v1\/projects\/PAY\/repo-kit$/, (r) => json(r, { files: [] })],
    // settings
    [
      "GET",
      /^\/api\/v1\/projects\/admin\/(issue-types|issue-statuses|labels)$/,
      (r) => json(r, []),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/admin\/project-categories$/,
      (r) =>
        json(
          r,
          w.categories.map((c, i) => ({ ...c, projectCount: i === 0 ? 2 : 0 })),
        ),
    ],
    [
      "POST",
      /^\/api\/v1\/projects\/admin\/project-categories$/,
      (r, s) => {
        const c = {
          id: `k${w.categories.length + 1}`,
          colour: "#57606a",
          order: 9,
          ...body(s),
        } as (typeof CATS)[number];
        w.categories.push(c);
        return json(r, c, 201);
      },
    ],
    [
      "DELETE",
      /^\/api\/v1\/projects\/admin\/project-categories\/k1$/,
      (r) =>
        sentence(
          r,
          "This category is used by 2 projects. Change the category of them first.",
          409,
        ),
    ],
    // BIR deadlines
    ["GET", /^\/api\/v1\/bir\/deadlines$/, (r) => json(r, DEADLINES)],
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
      if (m === s.method && re.test(s.path)) return h(route, s);
    }
    if (await answerBell(route)) return;
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const calls = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path));

// ===========================================================================
// The project form
// ===========================================================================

test.describe("PB7 the project form (hermetic)", () => {
  test("T1 a client not on the list is kept as typed with the note; later Link to client links it, only when pressed", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/new");
    await page.getByLabel("Key").fill("PAY");
    await page.getByLabel("Name", { exact: true }).fill("Payments");
    await page
      .getByRole("combobox", { name: "Client" })
      .fill("invented alpha trading inc");
    await expect(page.locator("[data-client-not-listed]")).toHaveText(
      "Not in your client list",
    );
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => calls(seen, "POST", /\/api\/v1\/projects$/).length).toBe(1);
    expect(
      calls(seen, "POST", /\/api\/v1\/projects$/)[0]!.request.postDataJSON(),
    ).toMatchObject({
      clientId: null,
      clientName: "invented alpha trading inc",
    });

    // the saved project has the typed name; the API finds a listed client with that name
    w.pay = project({ clientName: "INVENTED ALPHA TRADING" });
    w.matches = [
      { id: CLIENTS[0]!.id, businessName: "INVENTED ALPHA TRADING", status: "ACTIVE" },
    ];
    await page.goto("/projects/PAY/edit");
    const link = page.getByRole("button", { name: "Link to client" });
    await expect(link).toBeVisible();
    expect(calls(seen, "PATCH", /\/projects\/PAY$/)).toHaveLength(0); // never by itself
    await link.click();
    await expect(page.getByText("Linked to INVENTED ALPHA TRADING.")).toBeVisible();
    const patches = calls(seen, "PATCH", /\/projects\/PAY$/);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.request.postDataJSON()).toEqual({ clientId: CLIENTS[0]!.id });
    clean(unmocked, dialogs);
  });

  test("T2 the fee takes digits and 2 decimals only; the picked client's fee is offered, never filled by itself", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/new");
    await page.getByLabel("Key").fill("NET");
    await page.getByLabel("Name", { exact: true }).fill("Network");
    const fee = page.getByLabel("Professional fee");
    await expect(page.locator("[data-fee-field]")).toContainText("₱");
    await fee.click();
    await page.keyboard.type("-12a.3e45");
    await expect(fee).toHaveValue("12.34");
    // pasted text that is not a fee is not taken
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await fee.fill("");
    await page.evaluate(() => navigator.clipboard.writeText("1,500 pesos"));
    await fee.focus();
    await page.keyboard.press("ControlOrMeta+V");
    await expect(fee).toHaveValue("");

    await page.getByRole("combobox", { name: "Client" }).fill("alpha");
    await page.getByRole("option", { name: "INVENTED ALPHA TRADING" }).click();
    const use = page.getByRole("button", { name: "Use the client's fee 3,500.00" });
    await expect(use).toBeVisible();
    await expect(fee).toHaveValue("");
    await use.click();
    await expect(fee).toHaveValue("3500.00");
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => calls(seen, "POST", /\/api\/v1\/projects$/).length).toBe(1);
    expect(
      calls(seen, "POST", /\/api\/v1\/projects$/)[0]!.request.postDataJSON(),
    ).toMatchObject({
      clientId: CLIENTS[0]!.id,
      clientName: "INVENTED ALPHA TRADING",
      professionalFee: "3500.00",
    });
    clean(unmocked, dialogs);
  });

  test("T3 recurring: the switch shows the schedule, a preview of the next 5 dates and the one line; a blank end is sent as none", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/new");
    await page.getByLabel("Key").fill("BKS");
    await page.getByLabel("Name", { exact: true }).fill("Bookkeeping");
    await page.getByLabel("Category").selectOption("k2");
    await expect(page.getByLabel("Start date")).toHaveCount(0);
    await page.getByRole("switch", { name: "Recurring" }).click();
    await expect(page.getByText("Leave blank for no end date")).toBeVisible();
    await page.getByLabel("Start date").fill("2026-01-05");
    await page.getByLabel("Frequency").selectOption("WEEKLY");
    const preview = page.locator('[data-recurrence-preview="preview"]');
    await expect(preview).toContainText("The next 5 dates (preview, not saved yet)");
    await expect(preview.locator("[data-date]")).toHaveCount(5);
    // every Monday from 5 January 2026: each date is a Monday
    const dates = await preview
      .locator("[data-date]")
      .evaluateAll((els) => els.map((e) => e.getAttribute("data-date")!));
    for (const d of dates) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(1);
    await expect(
      page.getByText("Each date creates a task in this project, due that day."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Create project" }).click();
    await expect.poll(() => calls(seen, "POST", /\/api\/v1\/projects$/).length).toBe(1);
    expect(
      calls(seen, "POST", /\/api\/v1\/projects$/)[0]!.request.postDataJSON(),
    ).toMatchObject({
      categoryId: "k2",
      isRecurring: true,
      recurrenceStart: "2026-01-05",
      recurrenceEnd: null,
      recurrenceFrequency: "WEEKLY",
    });
    clean(unmocked, dialogs);
  });

  test("T4 the repository, live URL and deployment name are gone from the form and the overview, and nothing is sent for them", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    const card = page.locator("[data-project-details]");
    await expect(card).toBeVisible();
    for (const gone of [
      "Repository",
      "Live site",
      "Deployment app",
      "example.test",
      "invented-app",
    ])
      await expect(card).not.toContainText(gone);
    await page.goto("/projects/PAY/edit");
    await expect(page.getByLabel(/Repository/)).toHaveCount(0);
    await expect(page.getByLabel(/Live URL/)).toHaveCount(0);
    await expect(page.getByLabel(/Deployment/)).toHaveCount(0);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => calls(seen, "PATCH", /\/projects\/PAY$/).length).toBe(1);
    const b = calls(seen, "PATCH", /\/projects\/PAY$/)[0]!.request.postDataJSON();
    for (const k of ["repoUrl", "liveUrl", "deployAppName"])
      expect(b).not.toHaveProperty(k);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// The portfolio and settings
// ===========================================================================

test.describe("PB7 the portfolio and project categories (hermetic)", () => {
  test("T5 the portfolio shows client, category, fee and the Recurring badge, and filters by category", async ({
    page,
  }) => {
    const w = world({
      portfolio: [
        summary(
          project({
            client: { id: CLIENTS[0]!.id, businessName: "INVENTED ALPHA TRADING" },
            clientName: "INVENTED ALPHA TRADING",
            category: { id: "k1", name: "Tax Filing", colour: "#1a7f37" },
            professionalFee: "3500.00",
            isRecurring: true,
            recurrenceFrequency: "MONTHLY",
          }),
        ),
      ],
    });
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/all");
    const row = page.locator('[data-project="PAY"]');
    await expect(
      row.getByRole("link", { name: "INVENTED ALPHA TRADING" }),
    ).toHaveAttribute("href", `/clients/${CLIENTS[0]!.id}`);
    await expect(row.locator('[data-category="k1"]')).toContainText("Tax Filing");
    await expect(row.locator("[data-fee]")).toHaveText("₱3,500.00");
    await expect(row.locator("[data-recurring]")).toHaveText("Recurring · Monthly");
    await page.getByLabel("Category").selectOption("k1");
    await expect
      .poll(() =>
        calls(seen, "GET", /\/api\/v1\/projects$/).map((s) => s.search.get("categoryId")),
      )
      .toContain("k1");
    clean(unmocked, dialogs);
  });

  test("T6 settings: the project categories with their use, add one, and a refusal shown as sent", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/settings");
    const section = page.locator('[data-settings-section="project-categories"]');
    await expect(section.locator('[data-setting-row="k1"]')).toContainText(
      "Used by 2 projects",
    );
    await section.getByRole("button", { name: "Add category" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Name").fill("Payroll");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(section.locator("[data-projects-success]")).toContainText(
      "The category was added.",
    );
    expect(
      calls(seen, "POST", /project-categories$/)[0]!.request.postDataJSON(),
    ).toMatchObject({
      name: "Payroll",
    });
    await section
      .locator('[data-setting-row="k1"]')
      .getByRole("button", { name: "Delete" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete category" })
      .click();
    await expect(section.getByRole("alert")).toHaveText(
      "This category is used by 2 projects. Change the category of them first.",
    );
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// BIR Deadlines
// ===========================================================================

test.describe("PB7 the BIR Deadlines page (hermetic)", () => {
  test("T7 from the sidebar: notes, due dates in order with filed of total, forms and periods, status chips", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/all");
    await page.getByRole("link", { name: "BIR Deadlines" }).click();
    await expect(page).toHaveURL(/\/bir-deadlines$/);
    await expect(page.getByText(NOTE)).toBeVisible();
    await expect(page.locator("[data-deadlines-missing]")).toContainText(
      "INVENTED BETA FOODS: INVENTED: no fiscal year start, so the calendar year is assumed.",
    );
    const asked = calls(seen, "GET", /\/bir\/deadlines$/)[0]!;
    expect(asked.search.get("from")).toMatch(/^\d{4}-\d{2}$/);
    expect(asked.search.get("to")).toMatch(/^\d{4}-\d{2}$/);
    const days = page.locator("[data-due-date]");
    await expect(days).toHaveCount(2);
    await expect(days.nth(0)).toContainText("Tuesday, Nov 10, 2026");
    await expect(days.nth(0).locator("[data-due-count]")).toHaveText("1 of 2 filed");
    await expect(days.nth(1).locator("[data-due-count]")).toHaveText("1 of 2 filed");
    await expect(
      days.nth(1).locator('[data-deadline-form="2551Q|2026-Q3"] [data-period]'),
    ).toHaveText("Q3 2026");
    const chip = (due: string, client: string) =>
      page.locator(
        `[data-due-date="${due}"] [data-deadline-client="${client}"] [data-status]`,
      );
    await expect(chip("2026-11-10", CLIENTS[0]!.id)).toHaveText("Filed");
    await expect(chip("2026-11-10", CLIENTS[1]!.id)).toHaveText("Overdue");
    await expect(chip("2026-11-10", CLIENTS[1]!.id)).toHaveClass(/text-danger/);
    await expect(chip("2026-11-25", CLIENTS[0]!.id)).toHaveText(
      "Filed without BIR email",
    );
    await expect(chip("2026-11-25", CLIENTS[1]!.id)).toHaveText("Not started");
    clean(unmocked, dialogs);
  });

  test("T8 filters by form, client and status", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-deadlines");
    await page.getByLabel("Form").selectOption("2551Q");
    await expect(page.locator("[data-due-date]")).toHaveCount(1);
    await page.getByLabel("Form").selectOption("");
    await page.getByLabel("Client").selectOption(CLIENTS[1]!.id);
    await expect(page.locator("[data-deadline-client]")).toHaveCount(2);
    await page.getByLabel("Client").selectOption("");
    await page.getByLabel("Status").selectOption("overdue");
    await expect(page.locator("[data-deadline-client]")).toHaveCount(1);
    await expect(page.locator("[data-due-count]")).toHaveText("0 of 1 filed");
    clean(unmocked, dialogs);
  });

  test("T9 open the return when it exists; otherwise create the draft for that client, form and period, then open it", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w, ALL, [
      ["POST", /^\/api\/v1\/bir-forms$/, (r) => json(r, { id: "f-new" }, 201)],
      // the opened draft: answered so the page settles; its editor is not under test here
      [
        "GET",
        /^\/api\/v1\/bir-forms\/f-new$/,
        (r) => sentence(r, "INVENTED: not loaded in this test.", 404),
      ],
    ]);
    await page.goto("/bir-deadlines");
    const filedRow = page.locator(
      `[data-due-date="2026-11-10"] [data-deadline-client="${CLIENTS[0]!.id}"]`,
    );
    await expect(filedRow.getByRole("link", { name: "Open the return" })).toHaveAttribute(
      "href",
      "/bir-forms/f-1",
    );
    const newRow = page.locator(
      `[data-due-date="2026-11-25"] [data-deadline-client="${CLIENTS[1]!.id}"]`,
    );
    await newRow.getByRole("button", { name: "Create the draft" }).click();
    await expect(page).toHaveURL(/\/bir-forms\/f-new$/);
    const posts = calls(seen, "POST", /\/api\/v1\/bir-forms$/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.request.postDataJSON()).toEqual({
      clientId: CLIENTS[1]!.id,
      form: "2551Q",
      period: "2026-Q3",
      data: {},
    });
    clean(unmocked, dialogs);
  });

  test("T10 without BIRForms:Read there is no BIR Deadlines link", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, [
      "Clients:Read",
      "Projects:Read",
    ]);
    await page.goto("/projects/all");
    await expect(
      page.getByRole("heading", { name: "Projects", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "BIR Deadlines" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

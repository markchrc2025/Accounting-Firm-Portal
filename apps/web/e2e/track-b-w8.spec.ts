// track-b-w8.spec.ts — hermetic browser tests for W8: a screen to give firm
// staff their clients (R1); a filed 2307 always reprints what was issued (R3);
// a VAT client's purchase with no VAT is classified DOMESTIC_NO_INPUT_TAX (R4);
// the dashboard's regime mix makes room for exempt clients (R5).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// The assignment mocks follow Track A's U4-A1 contract (GET /users/:id/clients,
// POST /users/:id/assign-clients replace-all, assignedClientCount on GET /users).
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Invented firm, users and clients
// ---------------------------------------------------------------------------

const FIRM_ID = "22222222-2222-4222-8222-222222222281";

const CLIENT_A = {
  id: "c8000000-0000-4000-8000-00000000000a",
  businessName: "INVENTED ALPHA TRADING",
  tin: "000-101-202-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};
const CLIENT_B = {
  ...CLIENT_A,
  id: "c8000000-0000-4000-8000-00000000000b",
  businessName: "INVENTED BRAVO BAKESHOP",
  tin: "000-303-404-00000",
  taxType: "PERCENTAGE",
};
const CLIENT_C = {
  ...CLIENT_A,
  id: "c8000000-0000-4000-8000-00000000000c",
  businessName: "INVENTED CHARLIE TUTORIAL CENTER",
  tin: "000-505-606-00000",
  taxType: null,
};
const CLIENT_D = {
  ...CLIENT_A,
  id: "c8000000-0000-4000-8000-00000000000d",
  businessName: "INVENTED DELTA HARDWARE",
  tin: "000-707-808-00000",
};
const CLIENTS = [CLIENT_A, CLIENT_B, CLIENT_C, CLIENT_D];

type Role = "Super Admin" | "Manager" | "Accountant" | "Staff" | "Auditor";
function firmUser(
  n: number,
  fullName: string,
  role: Role | null,
  extra: Record<string, unknown> = {},
) {
  return {
    id: `u8000000-0000-4000-8000-00000000000${n}`,
    email: `user${n}@example.test`,
    fullName,
    userType: "FIRM",
    status: "ACTIVE",
    mfaEnabled: true,
    avatarUrl: null,
    lastLoginAt: null,
    createdAt: "2026-01-05T01:00:00.000Z",
    firmProfile: { title: null, employeeId: null },
    userRoles: role ? [{ role: { name: role }, clientScopeId: null }] : [],
    assignedClientCount: 0,
    ...extra,
  };
}

const ADMIN = firmUser(1, "Test Admin Person", "Super Admin");
const MANAGER = firmUser(2, "Test Manager Person", "Manager", { assignedClientCount: 2 });
const STAFF = firmUser(3, "Test Staff Person", "Staff", { assignedClientCount: 1 });
const AUDITOR = firmUser(4, "Test Auditor Person", "Auditor");
/** A client-portal user, should one ever appear in the list. */
const PORTAL = firmUser(5, "Test Portal Person", null, { userType: "CLIENT" });

const EVERYTHING = [
  "Users:Read",
  "Users:Create",
  "Users:Update",
  "Users:Delete",
  "Roles:Assign",
  "Clients:Read",
  "Clients:ViewAll",
  "Expenses:Read",
  "Expenses:Create",
  "Expenses:Update",
  "Expenses:Delete",
  "BirForms:Read",
  "BirForms:Create",
  "BirForms:Update",
];

function me(global: string[] = EVERYTHING, user = ADMIN) {
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: "FIRM",
      firmId: FIRM_ID,
      mfaEnabled: true,
    },
    permissions: {
      global,
      clients: [],
      assignedClientIds: [],
      canViewAllClients: global.includes("Clients:ViewAll"),
    },
  };
}
type Me = ReturnType<typeof me>;

// ---------------------------------------------------------------------------
// One router, a table of handlers
// ---------------------------------------------------------------------------

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

async function mockApi(
  page: Page,
  opts: { me?: Me; extra?: Entry[] } = {},
): Promise<{ seen: Seen[]; unmocked: string[]; quiet: () => Promise<void> }> {
  const who = opts.me ?? me();
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  // Re-armable "nothing in flight": no request pending and none started for
  // 500 ms (W6).
  let inflight = 0;
  let started = 0;
  const own = (url: string) => new URL(url).hostname === "localhost";
  page.on("request", (req) => {
    if (!own(req.url())) return;
    inflight += 1;
    started += 1;
  });
  const settled = (req: Request) => {
    if (own(req.url())) inflight -= 1;
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);
  const quiet = async () => {
    let count = -1;
    let since = 0;
    await expect
      .poll(
        () => {
          const now = Date.now();
          if (inflight > 0 || started !== count) {
            count = started;
            since = now;
            return false;
          }
          return now - since >= 500;
        },
        { intervals: [100], timeout: 15_000 },
      )
      .toBe(true);
  };
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const byId = (path: string) => CLIENTS.find((c) => path.includes(c.id)) ?? CLIENTS[0]!;
  const emptyPage = { data: [], page: 1, pageSize: 50, total: 0 };
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, who)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: who.user.id,
          fullName: who.user.fullName,
          email: who.user.email,
          userType: who.user.userType,
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, CLIENTS)],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r, s) => json(r, byId(s.path))],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/coa\/accounts$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/firm-invitations$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/(purchase|income)-transactions$/,
      (r) => json(r, emptyPage),
    ],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/purchase-transactions\/summary$/,
      (r) =>
        json(r, {
          basis: "management-estimate",
          totalNet: 0,
          totalInputVAT: 0,
          count: 0,
          deductibleNet: 0,
          nonDeductibleNet: 0,
          byInputVATCategory: [],
        }),
    ],
  ];
  const table = [...base, ...(opts.extra ?? [])];
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
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, quiet };
}

const bodyOf = (s: Seen) =>
  JSON.parse(s.request.postData() ?? "{}") as Record<string, unknown>;

// ---------------------------------------------------------------------------
// The U4-A1 assignment server, in memory
// ---------------------------------------------------------------------------

const ASSIGN_PATH = /^\/api\/v1\/users\/([^/]+)\/assign-clients$/;
const USER_CLIENTS_PATH = /^\/api\/v1\/users\/([^/]+)\/clients$/;

/** GET /users, GET /users/:id/clients and POST /users/:id/assign-clients as
 *  U4-A1 serves them, over an in-memory assignment table. `failWith` answers
 *  every POST with that 400 instead. */
function assignmentServer(
  users: Array<ReturnType<typeof firmUser>>,
  assigned: Record<string, string[]>,
  failWith?: string,
): Entry[] {
  const state: Record<string, string[]> = JSON.parse(JSON.stringify(assigned));
  const listOf = (id: string) => ({
    userId: id,
    clients: CLIENTS.filter((c) => (state[id] ?? []).includes(c.id))
      .map((c) => ({ id: c.id, businessName: c.businessName }))
      .sort((a, b) => a.businessName.localeCompare(b.businessName)),
  });
  return [
    [
      "GET",
      /^\/api\/v1\/users$/,
      (r) =>
        json(
          r,
          users.map((u) => ({ ...u, assignedClientCount: (state[u.id] ?? []).length })),
        ),
    ],
    [
      "GET",
      USER_CLIENTS_PATH,
      (r, s) => {
        const id = USER_CLIENTS_PATH.exec(s.path)![1]!;
        return json(r, listOf(id));
      },
    ],
    [
      "POST",
      ASSIGN_PATH,
      (r, s) => {
        if (failWith) return json(r, { message: failWith }, 400);
        const id = ASSIGN_PATH.exec(s.path)![1]!;
        state[id] = (bodyOf(s).clientIds as string[]) ?? [];
        return json(r, listOf(id), 201);
      },
    ],
  ];
}

const USERS = [ADMIN, MANAGER, STAFF, AUDITOR];
const ASSIGNED = { [MANAGER.id]: [CLIENT_A.id, CLIENT_B.id], [STAFF.id]: [CLIENT_C.id] };

const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });
const clientsCell = (page: Page, name: string) =>
  row(page, name).locator("[data-col=clients]");
const posts = (seen: Seen[]) =>
  seen.filter((s) => s.method === "POST" && ASSIGN_PATH.test(s.path));

async function openClientsFor(page: Page, name: string) {
  await row(page, name).getByRole("button", { name: "Clients", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Clients for ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

const box = (dialog: ReturnType<Page["getByRole"]>, c: { businessName: string }) =>
  dialog.getByRole("checkbox", { name: new RegExp(c.businessName) });

// ---------------------------------------------------------------------------
// T1 — Settings → Users gives staff their clients (R1)
// ---------------------------------------------------------------------------

test.describe("T1 a screen to give staff their clients (hermetic)", () => {
  test("T1 the Clients column reads 2 clients for the Manager and All clients for the Super Admin", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED),
    });
    await page.goto("/settings/users");
    await expect(clientsCell(page, MANAGER.fullName)).toHaveText("2 clients");
    await expect(clientsCell(page, ADMIN.fullName)).toHaveText("All clients");
    await expect(clientsCell(page, STAFF.fullName)).toHaveText("1 client");
    await expect(clientsCell(page, AUDITOR.fullName)).toHaveText("No clients");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 Clients for the Manager lists the firm's clients, the two assigned ones ticked", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED),
    });
    await page.goto("/settings/users");
    const dialog = await openClientsFor(page, MANAGER.fullName);
    await expect(
      dialog.getByText(
        "This user sees only the clients ticked here — their sales, expenses, billings, BIR forms, financial statements and COR files.",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("checkbox")).toHaveCount(CLIENTS.length);
    for (const c of CLIENTS) await expect(dialog.getByText(c.tin)).toBeVisible();
    await expect(box(dialog, CLIENT_A)).toBeChecked();
    await expect(box(dialog, CLIENT_B)).toBeChecked();
    await expect(box(dialog, CLIENT_C)).not.toBeChecked();
    await expect(box(dialog, CLIENT_D)).not.toBeChecked();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 unticking one and ticking others, then Save, sends one POST with the whole new list; the row shows the new count", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED),
    });
    await page.goto("/settings/users");
    const dialog = await openClientsFor(page, MANAGER.fullName);
    await expect(box(dialog, CLIENT_A)).toBeChecked();
    await box(dialog, CLIENT_B).uncheck();
    await box(dialog, CLIENT_C).check();
    await box(dialog, CLIENT_D).check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(clientsCell(page, MANAGER.fullName)).toHaveText("3 clients");
    await quiet();
    const sent = posts(seen);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe(`/api/v1/users/${MANAGER.id}/assign-clients`);
    expect([...(bodyOf(sent[0]!).clientIds as string[])].sort()).toEqual(
      [CLIENT_A.id, CLIENT_C.id, CLIENT_D.id].sort(),
    );
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 a 400 shows the server's message in the dialog, and the ticks stay", async ({
    page,
  }) => {
    const message = `Not clients of this firm: ${CLIENT_D.id}`;
    const { unmocked } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED, message),
    });
    await page.goto("/settings/users");
    const dialog = await openClientsFor(page, MANAGER.fullName);
    await expect(box(dialog, CLIENT_A)).toBeChecked();
    await box(dialog, CLIENT_D).check();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog.getByText(message)).toBeVisible();
    await expect(box(dialog, CLIENT_A)).toBeChecked();
    await expect(box(dialog, CLIENT_B)).toBeChecked();
    await expect(box(dialog, CLIENT_C)).not.toBeChecked();
    await expect(box(dialog, CLIENT_D)).toBeChecked();
    await expect(clientsCell(page, MANAGER.fullName)).toHaveText("2 clients");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2 — who sees the action; saving with nothing ticked asks first (R1)
// ---------------------------------------------------------------------------

const clientsButtons = (page: Page) =>
  page.getByRole("button", { name: "Clients", exact: true });

test.describe("T2 the Clients action and the empty save (hermetic)", () => {
  for (const [label, perms] of [
    ["without Roles:Assign", EVERYTHING.filter((p) => p !== "Roles:Assign")],
    ["without Clients:ViewAll", EVERYTHING.filter((p) => p !== "Clients:ViewAll")],
  ] as const) {
    test(`T2 a viewer ${label} sees no Clients action`, async ({ page }) => {
      const { unmocked } = await mockApi(page, {
        me: me([...perms]),
        extra: assignmentServer(USERS, ASSIGNED),
      });
      await page.goto("/settings/users");
      await expect(clientsCell(page, MANAGER.fullName)).toHaveText("2 clients");
      await expect(clientsButtons(page)).toHaveCount(0);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }

  test("T2 the action is on every firm user but the Super Admin, and never on a portal user", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: assignmentServer([...USERS, PORTAL], ASSIGNED),
    });
    await page.goto("/settings/users");
    await expect(clientsCell(page, MANAGER.fullName)).toHaveText("2 clients");
    for (const u of [MANAGER, STAFF, AUDITOR]) {
      await expect(
        row(page, u.fullName).getByRole("button", { name: "Clients", exact: true }),
      ).toHaveCount(1);
    }
    for (const u of [ADMIN, PORTAL]) {
      await expect(
        row(page, u.fullName).getByRole("button", { name: "Clients", exact: true }),
      ).toHaveCount(0);
    }
    await expect(clientsCell(page, PORTAL.fullName)).toHaveText("");
    await expect(clientsButtons(page)).toHaveCount(3);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 saving with nothing ticked asks in the dialog first; Cancel sends nothing", async ({
    page,
  }) => {
    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED),
    });
    await page.goto("/settings/users");
    const dialog = await openClientsFor(page, MANAGER.fullName);
    await expect(box(dialog, CLIENT_A)).toBeChecked();
    await dialog.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    const question = dialog.getByText(
      "Save with no clients? This user will see no clients.",
    );
    await expect(question).toBeVisible();
    await quiet();
    expect(posts(seen)).toEqual([]);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(question).toBeHidden();
    await quiet();
    expect(posts(seen)).toEqual([]);
    expect(dialogs, "no browser confirm").toBe(0);
    await expect(clientsCell(page, MANAGER.fullName)).toHaveText("2 clients");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 confirming the empty save sends one POST with no clients; the row reads No clients", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED),
    });
    await page.goto("/settings/users");
    const dialog = await openClientsFor(page, MANAGER.fullName);
    await expect(box(dialog, CLIENT_A)).toBeChecked();
    await dialog.getByRole("button", { name: "Clear", exact: true }).click();
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Save with no clients", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(clientsCell(page, MANAGER.fullName)).toHaveText("No clients");
    await quiet();
    expect(posts(seen).map((s) => bodyOf(s).clientIds)).toEqual([[]]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 the search narrows the list; Select all shown ticks only what is shown", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: assignmentServer(USERS, ASSIGNED),
    });
    await page.goto("/settings/users");
    const dialog = await openClientsFor(page, STAFF.fullName);
    await expect(box(dialog, CLIENT_C)).toBeChecked();
    await dialog.getByRole("searchbox", { name: "Search clients" }).fill("000-707");
    await expect(dialog.getByRole("checkbox")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Select all shown", exact: true }).click();
    await dialog.getByRole("searchbox", { name: "Search clients" }).fill("");
    await expect(dialog.getByRole("checkbox")).toHaveCount(CLIENTS.length);
    await expect(box(dialog, CLIENT_C)).toBeChecked();
    await expect(box(dialog, CLIENT_D)).toBeChecked();
    await expect(box(dialog, CLIENT_A)).not.toBeChecked();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T4 — a filed 2307 always reprints what was issued (R3)
// ---------------------------------------------------------------------------

const NAME_MISSING =
  "Complete the client's registered name (or last and first name for an individual) before printing this certificate.";

const DATA_2307 = {
  year: "2026",
  quarter: "1",
  payeeName: "INVENTED PAYEE, ALEX",
  payeeTin: "444-555-666",
  payeeAddress: "3 INVENTED ROAD, BARANGAY PAYEE",
  payeeZip: "1200",
  payeeForeignAddress: "",
  payeeBranch: "00000",
  payorSignatoryName: "INVENTED SIGNER",
  payorSignatoryTitle: "Treasurer",
  payorSignatoryTin: "777-888-999-00000",
  payeeSignatoryName: "",
  payeeSignatoryTitle: "",
  payeeSignatoryTin: "",
  rows: [
    {
      atc: "WI010",
      desc: "Professional fees",
      m1: "1000",
      m2: "1000",
      m3: "1000",
      tax: "300",
    },
  ],
};
const COMPUTED_2307 = {
  rows: [{ total: 3000 }],
  totalIncome: 3000,
  totalTax: 300,
  tM1: 1000,
  tM2: 1000,
  tM3: 1000,
};

/** The payor the client record holds today — no name fields filled. */
const PAYOR_NO_NAMES = {
  ...CLIENT_A,
  id: "c8000000-0000-4000-8000-0000000000e1",
  businessName: "INVENTED LIVE DISPLAY NAME",
  kind: "non-individual",
  regName: "",
  branch: "00000",
  address: "8 INVENTED AVENUE",
  city: "SAMPLE CITY",
  zip: "1600",
};
/** The same payor, with its registered name filled in. */
const PAYOR_NAMED = {
  ...PAYOR_NO_NAMES,
  id: "c8000000-0000-4000-8000-0000000000e2",
  regName: "INVENTED LIVE REGISTERED NAME CORP",
};
/** A filing snapshot taken before W7, without the name fields. */
const SNAP_NO_NAMES = {
  businessName: "INVENTED ISSUED DISPLAY NAME",
  tin: "000-121-232",
  branch: "00000",
  address: "9 FILING-DAY ROAD",
  city: "SAMPLE CITY",
  zip: "1700",
  rdo: "049",
};
/** A filing snapshot with the name fields (an individual). */
const SNAP_NAMED = {
  ...SNAP_NO_NAMES,
  kind: "individual",
  regName: null,
  lastName: "TESTFILER",
  firstName: "SAMPLE",
  middleName: "ISSUED",
};

function form2307(
  n: number,
  client: { id: string; businessName: string },
  over: Record<string, unknown>,
) {
  return {
    id: `f8000000-0000-4000-8000-00000000230${n}`,
    clientId: client.id,
    clientName: client.businessName,
    form: "2307",
    status: "filed",
    period: "2026-Q1",
    filedAt: "2026-04-20T02:15:00.000Z",
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-20T02:15:00.000Z",
    data: DATA_2307,
    computed: COMPUTED_2307,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
    ...over,
  };
}

async function open2307(
  page: Page,
  form: ReturnType<typeof form2307>,
  client: Record<string, unknown> & { id: string },
) {
  const api = await mockApi(page, {
    extra: [
      ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2307)],
      ["GET", new RegExp(`^/api/v1/bir-forms/${form.id}$`), (r) => json(r, form)],
      ["GET", new RegExp(`^/api/v1/clients/${client.id}$`), (r) => json(r, client)],
      ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [...CLIENTS, client])],
    ],
  });
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto(`/bir-forms/${form.id}`);
  await expect(page.getByLabel("Payee name")).toHaveValue(DATA_2307.payeeName);
  return api;
}

/** Item 7, "Payor's Name", as the capture copy (the one printed) holds it. */
async function item7(page: Page): Promise<string> {
  return page.evaluate(() => {
    const sheet = document.querySelector('[data-sheet-copy="capture"] .bir-sheet');
    if (!sheet) return "<no sheet>";
    const cells = Array.from(sheet.querySelectorAll<HTMLElement>(".bir-cell.stack"));
    const cell = cells.find((c) => /Payor.s Name/.test(c.textContent ?? ""));
    return cell?.querySelector<HTMLElement>(".bir-val")?.textContent ?? "";
  });
}

const printButton = (page: Page) =>
  page.getByRole("button", { name: /Print certificate \(PDF\)/ });

async function printsWithoutRefusal(page: Page) {
  await expect(printButton(page)).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    printButton(page).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/2307-2026-Q1\.pdf$/);
  await expect(page.getByText(NAME_MISSING)).toHaveCount(0);
}

test.describe("T4 a filed 2307 always reprints what was issued (hermetic)", () => {
  test("T4 a filed 2307 whose snapshot lacks the name fields prints the snapshot's businessName, and is not refused", async ({
    page,
  }) => {
    const form = form2307(1, PAYOR_NO_NAMES, { filedSnapshot: SNAP_NO_NAMES });
    const { unmocked } = await open2307(page, form, PAYOR_NO_NAMES);
    await expect.poll(() => item7(page)).toBe(SNAP_NO_NAMES.businessName);
    await printsWithoutRefusal(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a filed 2307 whose snapshot has the name fields prints W7's name", async ({
    page,
  }) => {
    const form = form2307(2, PAYOR_NO_NAMES, { filedSnapshot: SNAP_NAMED });
    const { unmocked } = await open2307(page, form, PAYOR_NO_NAMES);
    await expect.poll(() => item7(page)).toBe("TESTFILER, SAMPLE ISSUED");
    await printsWithoutRefusal(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a filed 2307 with no snapshot prints the live client's registered name when it is there", async ({
    page,
  }) => {
    const form = form2307(3, PAYOR_NAMED, { filedSnapshot: null });
    const { unmocked } = await open2307(page, form, PAYOR_NAMED);
    await expect.poll(() => item7(page)).toBe(PAYOR_NAMED.regName);
    await printsWithoutRefusal(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a filed 2307 with no snapshot and no name fields prints the live businessName, and is not refused", async ({
    page,
  }) => {
    const form = form2307(4, PAYOR_NO_NAMES, { filedSnapshot: null });
    const { unmocked } = await open2307(page, form, PAYOR_NO_NAMES);
    await expect.poll(() => item7(page)).toBe(PAYOR_NO_NAMES.businessName);
    await printsWithoutRefusal(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a draft 2307 with empty name fields is still refused", async ({ page }) => {
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    const form = form2307(5, PAYOR_NO_NAMES, {
      status: "draft",
      filedAt: null,
      filedSnapshot: null,
    });
    const { unmocked, quiet } = await open2307(page, form, PAYOR_NO_NAMES);
    await expect.poll(() => item7(page)).toBe("");
    await printButton(page).click();
    await expect(page.getByText(NAME_MISSING)).toBeVisible();
    await quiet();
    expect(downloads).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T5 — a VAT client's purchase with no VAT is DOMESTIC_NO_INPUT_TAX (R4)
// ---------------------------------------------------------------------------

const VAT_CLIENT = CLIENT_A;
const CATEGORY = {
  id: "c8100000-0000-4000-8000-000000000001",
  clientId: VAT_CLIENT.id,
  type: "EXPENSE",
  name: "Supplies Expense",
  isDeductible: true,
};

function purchase(n: number, over: Record<string, unknown>) {
  return {
    id: `b8000000-0000-4000-8000-00000000000${n}`,
    txnDate: "2026-08-20",
    referenceNo: `OR-80${n}`,
    vendor: "INVENTED OFFICE SUPPLY",
    description: "Supplies",
    categoryId: CATEGORY.id,
    account: "Supplies Expense",
    netAmount: 1000,
    isCapitalGood: false,
    deductible: true,
    source: "MANUAL",
    status: "posted",
    ...over,
  };
}

async function editAndSave(
  page: Page,
  rec: ReturnType<typeof purchase>,
  vatCode?: string,
) {
  const PATCH = new RegExp(
    `^/api/v1/clients/${VAT_CLIENT.id}/purchase-transactions/${rec.id}$`,
  );
  const api = await mockApi(page, {
    extra: [
      [
        "GET",
        /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
        (r) => json(r, { data: [rec], page: 1, pageSize: 50, total: 1 }),
      ],
      ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [CATEGORY])],
      ["PATCH", PATCH, (r) => json(r, rec)],
    ],
  });
  await page.goto(`/clients/${VAT_CLIENT.id}/expenses`);
  await expect(page.getByText(rec.referenceNo).first()).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  if (vatCode) {
    await page
      .getByRole("dialog")
      .locator("select")
      .filter({ hasText: "No VAT" })
      .selectOption(vatCode);
  }
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await api.quiet();
  const patches = api.seen.filter((s) => s.method === "PATCH" && PATCH.test(s.path));
  expect(patches).toHaveLength(1);
  expect(api.unmocked, `unmocked API calls: ${api.unmocked.join(", ")}`).toEqual([]);
  return bodyOf(patches[0]!);
}

test.describe("T5 a VAT client's purchase with no VAT is classified (hermetic)", () => {
  test("T5 a VAT client's purchase with VAT 0 is sent with DOMESTIC_NO_INPUT_TAX", async ({
    page,
  }) => {
    const body = await editAndSave(
      page,
      purchase(1, { inputVAT: 0, taxAmount: 0, inputVATCategory: "DOMESTIC_PURCHASES" }),
    );
    expect(body.inputVATCategory).toBe("DOMESTIC_NO_INPUT_TAX");
    expect(body.inputVAT ?? 0).toBe(0);
  });

  test("T5 a VAT purchase switched to no VAT is sent with DOMESTIC_NO_INPUT_TAX and input VAT 0", async ({
    page,
  }) => {
    const body = await editAndSave(
      page,
      purchase(2, {
        inputVAT: 120,
        taxAmount: 120,
        inputVATCategory: "DOMESTIC_PURCHASES",
      }),
      "NONE",
    );
    expect(body.inputVATCategory).toBe("DOMESTIC_NO_INPUT_TAX");
    expect(body.inputVAT).toBe(0);
  });

  test("T5 a VAT client's purchase with VAT is sent with DOMESTIC_PURCHASES, as before", async ({
    page,
  }) => {
    const body = await editAndSave(
      page,
      purchase(3, {
        inputVAT: 120,
        taxAmount: 120,
        inputVATCategory: "DOMESTIC_PURCHASES",
      }),
    );
    expect(body.inputVATCategory).toBe("DOMESTIC_PURCHASES");
    expect(body.inputVAT).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// T6 — the dashboard's regime mix makes room for exempt clients (R5)
// ---------------------------------------------------------------------------

function dashboard(regimeMix: Record<string, number>) {
  return {
    kpis: [
      { label: "Active clients", value: 6, isCurrency: false, delta: "" },
      { label: "Revenue", value: 1000, isCurrency: true, delta: "" },
    ],
    incomeVsExpenses: [],
    recentActivity: [],
    upcomingFilings: [],
    regimeMix,
  };
}

test.describe("T6 the dashboard's regime mix (hermetic)", () => {
  test("T6 with regimeMix.exempt the mix shows a third segment, Exempt from business tax", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { unmocked } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/dashboard$/,
          (r) => json(r, dashboard({ vat: 3, percentage: 2, exempt: 1 })),
        ],
      ],
    });
    await page.goto("/");
    const legend = page.locator("[data-regime-legend]");
    await expect(legend).toContainText("Exempt from business tax");
    await expect(legend.locator("[data-regime=exempt]")).toContainText("1");
    await expect(page.locator("[data-regime-bar] > div")).toHaveCount(3);
    expect(errors).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T6 without regimeMix.exempt the mix shows its two segments and no error", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { unmocked } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/dashboard$/,
          (r) => json(r, dashboard({ vat: 3, percentage: 2 })),
        ],
      ],
    });
    await page.goto("/");
    const legend = page.locator("[data-regime-legend]");
    await expect(legend).toContainText("VAT");
    await expect(legend).not.toContainText("Exempt");
    await expect(page.locator("[data-regime-bar] > div")).toHaveCount(2);
    await expect(page.getByText(/something went wrong|could not load/i)).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

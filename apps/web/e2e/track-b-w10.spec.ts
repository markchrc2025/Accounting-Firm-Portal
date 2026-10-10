// track-b-w10.spec.ts — hermetic browser tests for W10: every confirmation in
// the Portal asks in the page (R1). For each of the eleven sites that used a
// browser confirm, the action opens the in-app dialog with its question; Cancel
// (or Escape) sends nothing; the confirm button sends exactly one request; and
// the server's refusal shows in the dialog. ANY browser dialog fails the test.
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222a1";

const CLIENT = {
  id: "c1000000-0000-4000-8000-0000000000a1",
  businessName: "INVENTED TEN TRADING",
  tin: "000-101-010-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const FIRM_PERMISSIONS = [
  "Clients:Read",
  "Expenses:Read",
  "Expenses:Create",
  "Expenses:Update",
  "Expenses:Delete",
  "Sales:Read",
  "Sales:Create",
  "Sales:Update",
  "Sales:Delete",
  "ChartOfAccounts:Manage",
  "IntegrationClient:Create",
  "IntegrationClient:Update",
  "IntegrationClient:Delete",
  "FinancialStatements:Manage",
];

const FIRM_ME = {
  user: {
    id: "u1000000-0000-4000-8000-0000000000a1",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: FIRM_PERMISSIONS,
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
  },
};
const PORTAL_ME = {
  user: {
    id: "u1000000-0000-4000-8000-0000000000a2",
    email: "owner@example.test",
    fullName: "Portal Owner",
    userType: "CLIENT",
    firmId: FIRM_ID,
    clientId: CLIENT.id,
    mfaEnabled: true,
  },
  permissions: {
    global: ["Sales:Read", "Sales:Create", "Sales:Update", "Sales:Delete"],
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: false,
  },
};
type Me = typeof FIRM_ME | typeof PORTAL_ME;

// ---------------------------------------------------------------------------
// One router, a table of handlers
// ---------------------------------------------------------------------------

interface Seen {
  method: string;
  path: string;
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

async function mockApi(page: Page, me: Me, extra: Entry[]) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  // R1: no browser dialog may open, on any page.
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
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
  const emptyPage = { data: [], page: 1, pageSize: 50, total: 0 };
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: me.user.id,
          fullName: me.user.fullName,
          email: me.user.email,
          userType: me.user.userType,
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/portal\/context$/,
      (r) =>
        json(r, {
          id: CLIENT.id,
          businessName: CLIENT.businessName,
          taxType: CLIENT.taxType,
          status: "Active",
          seatLimit: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/coa\/accounts$/, (r) => json(r, [])],
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
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/income-transactions\/summary$/,
      (r) =>
        json(r, {
          basis: "management-estimate",
          totalNet: 0,
          totalOutputVAT: 0,
          count: 0,
          byVatClass: [],
        }),
    ],
  ];
  const table = [...base, ...extra];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const s: Seen = { method: req.method(), path: url.pathname, request: req };
    seen.push(s);
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, h] = table[i]!;
      if (m === s.method && re.test(s.path)) return h(route, s);
    }
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs, quiet };
}

// ---------------------------------------------------------------------------
// Invented records
// ---------------------------------------------------------------------------

const HELD = {
  id: "b1000000-0000-4000-8000-0000000000a1",
  txnDate: "2026-09-02",
  referenceNo: "DR-1001",
  vendor: "INVENTED WATER DELIVERY",
  description: "Water refill",
  categoryId: "c-unassigned",
  account: "Supplies Expense",
  netAmount: 450,
  taxAmount: 0,
  isCapitalGood: false,
  deductible: true,
  source: "IMPORT",
  status: "held",
  needsReview: true,
};
const SALE = {
  id: "s1000000-0000-4000-8000-0000000000a1",
  txnDate: "2026-09-03",
  referenceNo: "SI-1002",
  customer: "INVENTED CAFE CUSTOMER",
  description: "Catering",
  categoryId: "c-sales",
  netAmount: 1000,
  vatClass: "NON_VAT",
  source: "MANUAL",
};
const MAPPING = {
  accountCode: "6001",
  taxCategory: "Supplies",
  accountName: "Invented Office Supplies",
  taxReturnLine: "Supplies",
};
const ACCOUNT = {
  code: "6001",
  name: "Invented Office Supplies",
  class: "Expense",
  accountType: "Operating Expense",
  normalBalance: "Debit",
  currency: "PHP",
  monthlyMovement: true,
  postable: true,
  archived: false,
};
const INTEGRATION = {
  id: "i1000000-0000-4000-8000-0000000000a1",
  name: "Invented Generator",
  clientKey: "ck_test_not_a_secret",
  scopes: ["birforms:read"],
  status: "ACTIVE",
  lastUsedAt: null,
};
const REPORT = {
  id: "f1000000-0000-4000-8000-0000000000a1",
  clientId: null,
  clientName: null,
  entityName: "Sample Company Inc.",
  framework: "PFRS for SEs",
  functionalCurrency: "PHP",
  status: "draft",
  includeNotes: false,
  createdAt: "2026-09-01T01:00:00.000Z",
  updatedAt: "2026-09-01T01:00:00.000Z",
  periods: [],
};

const list = (re: RegExp, rows: unknown[]): Entry => [
  "GET",
  re,
  (r) => json(r, { data: rows, page: 1, pageSize: 50, total: rows.length }),
];
const PURCHASES = /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/;
const INCOME = /^\/api\/v1\/clients\/[^/]+\/income-transactions$/;
const POST_HELD = new RegExp(`^/api/v1/purchase-transactions/${HELD.id}/post$`);
const DELETE_PURCHASE = new RegExp(
  `^/api/v1/clients/${CLIENT.id}/purchase-transactions/${HELD.id}$`,
);
const DELETE_SALE = new RegExp(
  `^/api/v1/clients/${CLIENT.id}/income-transactions/${SALE.id}$`,
);

function connector(enabled: boolean): Entry[] {
  return [
    ["GET", /^\/api\/v1\/integrations$/, (r) => json(r, [INTEGRATION])],
    [
      "GET",
      /^\/api\/v1\/mcp-connector$/,
      (r) =>
        json(r, {
          enabled,
          source: enabled ? "portal" : null,
          secret: enabled ? "test-secret-not-real" : null,
        }),
    ],
    [
      "POST",
      /^\/api\/v1\/mcp-connector\/rotate$/,
      (r) =>
        json(r, { enabled: true, source: "portal", secret: "test-secret-rotated" }, 201),
    ],
    [
      "POST",
      /^\/api\/v1\/mcp-connector\/disable$/,
      (r) => json(r, { enabled: false, source: null, secret: null }, 201),
    ],
    [
      "POST",
      new RegExp(`^/api/v1/integrations/${INTEGRATION.id}/revoke$`),
      (r) => json(r, { ...INTEGRATION, status: "DISABLED" }, 201),
    ],
  ];
}

// ---------------------------------------------------------------------------
// The eleven sites
// ---------------------------------------------------------------------------

interface Site {
  name: string;
  me: Me;
  url: string;
  mocks: Entry[];
  /** Brings the trigger on screen, then clicks it. */
  trigger: (page: Page) => Promise<void>;
  question: string;
  confirm: string;
  request: [method: string, path: RegExp];
}

const POST_QUESTION = `Post DR-1001 · INVENTED WATER DELIVERY? It is held now and counts nowhere. Once posted it counts in the books.`;

const clientExpensesTab = async (page: Page) => {
  await page.getByRole("button", { name: "Expenses / Purchases" }).click();
  await expect(page.getByText("DR-1001").first()).toBeVisible();
};

const SITES: Site[] = [
  {
    name: "Expenses — posting a held record (ExpensesPage.tsx:132)",
    me: FIRM_ME,
    url: `/clients/${CLIENT.id}/expenses`,
    mocks: [
      list(PURCHASES, [HELD]),
      ["POST", POST_HELD, (r) => json(r, { ...HELD, status: "posted" }, 201)],
    ],
    trigger: async (page) => {
      await page.getByRole("button", { name: "Post", exact: true }).click();
    },
    question: POST_QUESTION,
    confirm: "Post",
    request: ["POST", POST_HELD],
  },
  {
    name: "Expenses — deleting a record (ExpensesPage.tsx:150)",
    me: FIRM_ME,
    url: `/clients/${CLIENT.id}/expenses`,
    mocks: [
      list(PURCHASES, [HELD]),
      ["DELETE", DELETE_PURCHASE, (r) => json(r, { deleted: true })],
    ],
    trigger: async (page) => {
      await page.getByRole("button", { name: "Delete", exact: true }).click();
    },
    question: "Delete this record?",
    confirm: "Delete",
    request: ["DELETE", DELETE_PURCHASE],
  },
  {
    name: "Client page — posting a held record (ClientDetailPage.tsx:139)",
    me: FIRM_ME,
    url: `/clients/${CLIENT.id}`,
    mocks: [
      list(PURCHASES, [HELD]),
      ["POST", POST_HELD, (r) => json(r, { ...HELD, status: "posted" }, 201)],
    ],
    trigger: async (page) => {
      await clientExpensesTab(page);
      await page.getByRole("button", { name: "Post", exact: true }).click();
    },
    question: POST_QUESTION,
    confirm: "Post",
    request: ["POST", POST_HELD],
  },
  {
    name: "Client page — deleting a record (ClientDetailPage.tsx:159)",
    me: FIRM_ME,
    url: `/clients/${CLIENT.id}`,
    mocks: [
      list(PURCHASES, [HELD]),
      ["DELETE", DELETE_PURCHASE, (r) => json(r, { deleted: true })],
    ],
    trigger: async (page) => {
      await clientExpensesTab(page);
      await page.getByRole("button", { name: "Delete", exact: true }).click();
    },
    question: "Delete this record?",
    confirm: "Delete",
    request: ["DELETE", DELETE_PURCHASE],
  },
  {
    name: "Sales & Income — deleting a sale (SalesPage.tsx:112)",
    me: FIRM_ME,
    url: `/clients/${CLIENT.id}/sales`,
    mocks: [
      list(INCOME, [SALE]),
      ["DELETE", DELETE_SALE, (r) => json(r, { deleted: true })],
    ],
    trigger: async (page) => {
      await expect(page.getByText("SI-1002").first()).toBeVisible();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
    },
    question: "Delete this sales record?",
    confirm: "Delete",
    request: ["DELETE", DELETE_SALE],
  },
  {
    name: "Client portal Sales — deleting a sale (PortalSalesPage.tsx:104)",
    me: PORTAL_ME,
    url: "/portal/sales",
    mocks: [
      list(INCOME, [SALE]),
      ["DELETE", DELETE_SALE, (r) => json(r, { deleted: true })],
    ],
    trigger: async (page) => {
      await expect(page.getByText("SI-1002").first()).toBeVisible();
      await page.getByRole("button", { name: "Delete", exact: true }).click();
    },
    question: "Delete this sales record?",
    confirm: "Delete",
    request: ["DELETE", DELETE_SALE],
  },
  {
    name: "Chart of Accounts — removing a BIR mapping (ChartOfAccountsPage.tsx:154)",
    me: FIRM_ME,
    url: "/chart-of-accounts",
    mocks: [
      ["GET", /^\/api\/v1\/coa\/accounts$/, (r) => json(r, [ACCOUNT])],
      ["GET", /^\/api\/v1\/coa\/mappings$/, (r) => json(r, [MAPPING])],
      ["DELETE", /^\/api\/v1\/coa\/mappings\/6001$/, (r) => json(r, { ok: true })],
    ],
    trigger: async (page) => {
      await page.getByRole("button", { name: "BIR Mapping", exact: true }).click();
      await page.getByRole("button", { name: "Remove", exact: true }).click();
    },
    question: "Remove the BIR mapping for account 6001?",
    confirm: "Remove",
    request: ["DELETE", /^\/api\/v1\/coa\/mappings\/6001$/],
  },
  {
    name: "Integrations — rotating the Claude connector link (IntegrationsPage.tsx:198)",
    me: FIRM_ME,
    url: "/settings/integrations",
    mocks: connector(true),
    trigger: async (page) => {
      await page.getByRole("button", { name: "Rotate link", exact: true }).click();
    },
    question:
      "This mints a NEW link and the current one stops working immediately — anyone using it (including Claude) must be given the new link. Rotate now?",
    confirm: "Rotate",
    request: ["POST", /^\/api\/v1\/mcp-connector\/rotate$/],
  },
  {
    name: "Integrations — creating the Claude connector link (IntegrationsPage.tsx:198, when off)",
    me: FIRM_ME,
    url: "/settings/integrations",
    mocks: connector(false),
    trigger: async (page) => {
      await page.getByRole("button", { name: "Create link", exact: true }).click();
    },
    question:
      "This creates the connector link. Anyone holding it can read AND write portal data. Create it?",
    confirm: "Create",
    request: ["POST", /^\/api\/v1\/mcp-connector\/rotate$/],
  },
  {
    name: "Integrations — turning the Claude connector off (IntegrationsPage.tsx:202)",
    me: FIRM_ME,
    url: "/settings/integrations",
    mocks: connector(true),
    trigger: async (page) => {
      await page.getByRole("button", { name: "Turn off", exact: true }).click();
    },
    question:
      "Turn the Claude connector OFF? The link stops working immediately. You can re-enable it later by rotating (which mints a new link).",
    confirm: "Turn off",
    request: ["POST", /^\/api\/v1\/mcp-connector\/disable$/],
  },
  {
    name: "Integrations — revoking an integration (IntegrationsPage.tsx:323)",
    me: FIRM_ME,
    url: "/settings/integrations",
    mocks: connector(true),
    trigger: async (page) => {
      await page.getByRole("button", { name: "Revoke access", exact: true }).click();
    },
    question: `Revoke access for "Invented Generator"? Its client key and secret will stop working immediately.`,
    confirm: "Revoke",
    request: ["POST", new RegExp(`^/api/v1/integrations/${INTEGRATION.id}/revoke$`)],
  },
  {
    name: "Financial statements — deleting a report (FsReportPage.tsx:127)",
    me: FIRM_ME,
    url: `/financial-statements/${REPORT.id}`,
    mocks: [
      ["GET", new RegExp(`^/api/v1/fs/reports/${REPORT.id}$`), (r) => json(r, REPORT)],
      [
        "GET",
        new RegExp(`^/api/v1/fs/reports/${REPORT.id}/trial-balance$`),
        (r) => json(r, []),
      ],
      ["GET", /^\/api\/v1\/fs\/reports$/, (r) => json(r, [])],
      [
        "DELETE",
        new RegExp(`^/api/v1/fs/reports/${REPORT.id}$`),
        (r) => json(r, { ok: true }),
      ],
    ],
    trigger: async (page) => {
      await page.getByRole("button", { name: "Delete", exact: true }).click();
    },
    question: "Delete this FS report and all its data?",
    confirm: "Delete",
    request: ["DELETE", new RegExp(`^/api/v1/fs/reports/${REPORT.id}$`)],
  },
];

const requests = (seen: Seen[], [method, re]: [string, RegExp]) =>
  seen.filter((s) => s.method === method && re.test(s.path));

// ---------------------------------------------------------------------------
// T1 — every confirmation asks in the page
// ---------------------------------------------------------------------------

test.describe("T1 every confirmation asks in the page (hermetic)", () => {
  for (const site of SITES) {
    test(`T1 ${site.name}: in-app dialog; Cancel sends nothing; ${site.confirm} sends one request; no browser dialog`, async ({
      page,
    }) => {
      const { seen, unmocked, dialogs, quiet } = await mockApi(page, site.me, site.mocks);
      await page.goto(site.url);
      await site.trigger(page);
      const ask = page.getByRole("dialog", { name: site.question });
      await expect(ask).toBeVisible();
      await ask.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(ask).toBeHidden();
      await quiet();
      expect(requests(seen, site.request), "Cancel sends nothing").toEqual([]);

      await site.trigger(page);
      await expect(ask).toBeVisible();
      await ask.getByRole("button", { name: site.confirm, exact: true }).click();
      await expect(ask).toBeHidden();
      await quiet();
      expect(
        requests(seen, site.request),
        `${site.confirm} sends one request`,
      ).toHaveLength(1);
      expect(dialogs, "no browser dialog may open").toEqual([]);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }

  test("T1 Escape closes the dialog and sends nothing", async ({ page }) => {
    const site = SITES[1]!;
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, site.me, site.mocks);
    await page.goto(site.url);
    await site.trigger(page);
    const ask = page.getByRole("dialog", { name: site.question });
    await expect(ask).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(ask).toBeHidden();
    await quiet();
    expect(requests(seen, site.request)).toEqual([]);
    expect(dialogs).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the server's refusal shows in the dialog, which stays open", async ({
    page,
  }) => {
    const refusal = "This record is locked by a filed return.";
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, FIRM_ME, [
      list(PURCHASES, [HELD]),
      ["DELETE", DELETE_PURCHASE, (r) => json(r, { message: refusal }, 400)],
    ]);
    await page.goto(`/clients/${CLIENT.id}/expenses`);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "Delete this record?" });
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(ask.getByRole("alert")).toHaveText(refusal);
    await expect(ask).toBeVisible();
    await quiet();
    expect(requests(seen, ["DELETE", DELETE_PURCHASE])).toHaveLength(1);
    expect(dialogs).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

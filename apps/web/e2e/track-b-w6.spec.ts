// track-b-w6.spec.ts — hermetic browser tests for W6: an exempt client is
// labelled "Exempt from business tax" (R1); the expense lists filter on the
// server (R2); W5's loose ends (R3); no print asks for an asset that is not in
// the tree (R4).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// The list mock filters like Track A's U6-A1 server (status, needsReview, page,
// pageSize; total counts every match) — this file never reads Track A's branch.
//
// All data is invented. No real name, TIN, address, phone or email.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Invented parties
// ---------------------------------------------------------------------------

/** A client with no tax regime: the client form's "None (exempt from business
 *  tax)". It keeps books (D39). */
const EXEMPT_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000001",
  businessName: "INVENTED EXEMPT SARI-SARI STORE",
  tin: "100-200-302-00000",
  taxType: null,
  currency: "PHP",
  status: "Active",
};

const PCT_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000002",
  businessName: "INVENTED PERCENTAGE BAKERY",
  tin: "100-200-303-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const VAT_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000003",
  businessName: "INVENTED VAT TRADING",
  tin: "100-200-304-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

const CLIENTS = [EXEMPT_CLIENT, PCT_CLIENT, VAT_CLIENT];

const FIRM_ME = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: "22222222-2222-4222-8222-222222222222",
    mfaEnabled: false,
  },
  permissions: {
    global: [
      "Clients:Read",
      "Clients:Update",
      "Expenses:Read",
      "Expenses:Create",
      "Expenses:Update",
      "Expenses:Delete",
      "Sales:Read",
      "Sales:Create",
    ],
    clients: [],
    assignedClientIds: CLIENTS.map((c) => c.id),
    canViewAllClients: true,
  },
};

/** A user of the client portal, belonging to the exempt client. */
const PORTAL_ME = {
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "owner@exempt-store.example.test",
    fullName: "Portal Owner",
    userType: "CLIENT",
    firmId: FIRM_ME.user.firmId,
    clientId: EXEMPT_CLIENT.id,
    mfaEnabled: false,
  },
  permissions: {
    global: ["Expenses:Read", "Sales:Read"],
    clients: [],
    assignedClientIds: [EXEMPT_CLIENT.id],
    canViewAllClients: false,
  },
};

const profileOf = (me: typeof FIRM_ME | typeof PORTAL_ME) => ({
  id: me.user.id,
  fullName: me.user.fullName,
  email: me.user.email,
  userType: me.user.userType,
  mfaEnabled: false,
  avatarUrl: null,
});

const PORTAL_CONTEXT = {
  id: EXEMPT_CLIENT.id,
  businessName: EXEMPT_CLIENT.businessName,
  taxType: EXEMPT_CLIENT.taxType,
  status: "Active",
  seatLimit: null,
};

// ---------------------------------------------------------------------------
// Invented expense records, and a list endpoint that filters like U6-A1's
// ---------------------------------------------------------------------------

/** An invented expense record, `n` days before 2026-09-30. */
function expense(ref: string, n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `dddddddd-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
    txnDate: new Date(Date.UTC(2026, 8, 30 - (n % 200))).toISOString().slice(0, 10),
    referenceNo: ref,
    vendor: "INVENTED OFFICE SUPPLY",
    description: "Supplies",
    categoryId: "c1",
    netAmount: 100,
    isCapitalGood: false,
    deductible: true,
    source: "IMPORT",
    status: "posted",
    ...extra,
  };
}

type Rec = ReturnType<typeof expense>;

/** The list endpoint as Track A's U6-A1 serves it: status=posted|held and
 *  needsReview=true|false filter; page and pageSize (default 50) page; total
 *  counts every match. */
function serverList(records: Rec[]): Handler {
  return (r, s) => {
    const status = s.search.get("status");
    const review = s.search.get("needsReview");
    const matched = records.filter(
      (t) =>
        (status === null || (t.status ?? "posted") === status) &&
        (review === null || (t.needsReview === true) === (review === "true")),
    );
    const page = Number(s.search.get("page") ?? "1");
    const pageSize = Number(s.search.get("pageSize") ?? "50");
    const data = matched.slice((page - 1) * pageSize, page * pageSize);
    return json(r, { data, page, pageSize, total: matched.length });
  };
}

/** 240 posted records, 250 held ones (all needing review) and 20 posted ones
 *  needing review: more held, and more posted, records than one 200-row page
 *  holds, so a list that walks pages asks for a second one. */
function bigLedger(): Rec[] {
  const out: Rec[] = [];
  for (let i = 0; i < 240; i++) out.push(expense(`OR-P${i + 1}`, i));
  for (let i = 0; i < 250; i++)
    out.push(expense(`DR-H${i + 1}`, 240 + i, { status: "held", needsReview: true }));
  for (let i = 0; i < 20; i++)
    out.push(expense(`OR-R${i + 1}`, 490 + i, { needsReview: true }));
  return out;
}

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

const LIST_PATH = /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/;

async function mockApi(
  page: Page,
  opts: { me?: typeof FIRM_ME | typeof PORTAL_ME; extra?: Entry[] } = {},
): Promise<{ seen: Seen[]; unmocked: string[]; quiet: () => Promise<void> }> {
  const me = opts.me ?? FIRM_ME;
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  // Re-armable "nothing in flight": no request pending and none started for
  // 500 ms. waitForLoadState("networkidle") resolves at once once the page has
  // been idle, so it cannot catch a request that comes late (review, W6).
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
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    ["GET", /^\/api\/v1\/profile\/me$/, (r) => json(r, profileOf(me))],
    ["GET", /^\/api\/v1\/portal\/context$/, (r) => json(r, PORTAL_CONTEXT)],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, CLIENTS)],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r, s) => json(r, byId(s.path))],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/coa\/accounts$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/services$/, (r) => json(r, [])],
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

const listCalls = (seen: Seen[]) =>
  seen.filter((s) => s.method === "GET" && LIST_PATH.test(s.path));

/** What a person reads on the page, as rendered (CSS uppercase included). */
const screenText = (page: Page) => page.locator("body").innerText();

// ---------------------------------------------------------------------------
// T1 — an exempt client is labelled "Exempt from business tax" (R1)
// ---------------------------------------------------------------------------

test.describe("T1 an exempt client is labelled right (hermetic)", () => {
  test("T1 an exempt client's Expenses page header reads Exempt from business tax, and nothing reads PERCENTAGE TAX", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page);
    await page.goto(`/clients/${EXEMPT_CLIENT.id}/expenses`);
    await expect(
      page.getByRole("heading", { name: "Expenses", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(EXEMPT_CLIENT.businessName).first()).toBeVisible();
    await expect(page.locator("main .eyebrow").first()).toHaveText(
      "Exempt from business tax",
    );
    const text = await screenText(page);
    expect(text).not.toMatch(/percentage tax/i);
    expect(text).not.toMatch(/not set/i);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2 — the expense lists filter on the server (R2)
// ---------------------------------------------------------------------------

test.describe("T2 the expense lists filter on the server (hermetic)", () => {
  test("T2 Held and Needs review each send one list request to the server, no second page; the footer is the server's total", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [["GET", LIST_PATH, serverList(bigLedger())]],
    });
    await page.goto(`/clients/${PCT_CLIENT.id}/expenses`);
    const body = page.locator("table tbody");
    await expect(page.getByText("510 record(s)", { exact: true })).toBeVisible();
    await expect(body.locator("tr")).toHaveCount(50);
    const status = page.getByLabel("Status");

    await quiet();
    let before = listCalls(seen).length;
    await status.selectOption("held");
    await expect(page.getByText("50 of 250 shown · Held", { exact: true })).toBeVisible();
    await quiet();
    const held = listCalls(seen).slice(before);
    expect(held.map((s) => s.search.toString())).toHaveLength(1);
    expect(held[0]!.search.get("status")).toBe("held");
    expect(held[0]!.search.get("needsReview")).toBeNull();
    expect(held[0]!.search.get("page") ?? "1").toBe("1");
    await expect(body.locator("tr")).toHaveCount(50);
    await expect(body.locator('tr[data-status="posted"]')).toHaveCount(0);

    before = listCalls(seen).length;
    await status.selectOption("review");
    await expect(
      page.getByText("50 of 270 shown · Needs review", { exact: true }),
    ).toBeVisible();
    await quiet();
    const review = listCalls(seen).slice(before);
    expect(review.map((s) => s.search.toString())).toHaveLength(1);
    expect(review[0]!.search.get("needsReview")).toBe("true");
    expect(review[0]!.search.get("status")).toBeNull();
    expect(review[0]!.search.get("page") ?? "1").toBe("1");

    before = listCalls(seen).length;
    await status.selectOption("posted");
    await expect(
      page.getByText("50 of 260 shown · Posted", { exact: true }),
    ).toBeVisible();
    await quiet();
    const posted = listCalls(seen).slice(before);
    expect(posted.map((s) => s.search.toString())).toHaveLength(1);
    expect(posted[0]!.search.get("status")).toBe("posted");
    await expect(body.locator('tr[data-status="held"]')).toHaveCount(0);

    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 the client portal asks the server for posted records once; its count is the server's total", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [["GET", LIST_PATH, serverList(bigLedger())]],
    });
    await page.goto("/portal/expenses");
    await expect(page.getByText("260 record(s)", { exact: true })).toBeVisible();
    await quiet();
    const calls = listCalls(seen);
    expect(calls.map((s) => s.search.toString())).toHaveLength(1);
    expect(calls[0]!.search.get("status")).toBe("posted");
    expect(calls[0]!.search.get("page") ?? "1").toBe("1");
    const body = page.locator("table tbody");
    await expect(body.locator("tr")).toHaveCount(50);
    await expect(page.locator("body")).not.toContainText("DR-H");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 the portal never shows a held record, even one the server sends back", async ({
    page,
  }) => {
    // A server that ignores status=posted: the page it returns carries a held
    // record. The portal keeps it off the screen regardless (W5 R3, W6 R2).
    const leaked = [
      expense("OR-SHOWN-1", 1),
      expense("DR-LEAK-1", 2, { status: "held", needsReview: true }),
      expense("OR-SHOWN-2", 3),
    ];
    const { unmocked } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [
        [
          "GET",
          LIST_PATH,
          (r) => json(r, { data: leaked, page: 1, pageSize: 50, total: 2 }),
        ],
      ],
    });
    await page.goto("/portal/expenses");
    const body = page.locator("table tbody");
    await expect(body.locator("tr")).toHaveCount(2);
    await expect(page.locator("body")).not.toContainText("DR-LEAK-1");
    await expect(page.locator("body")).not.toContainText("Held");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 the Client Detail Expenses tab sends Held to the server; its count is the server's total", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [["GET", LIST_PATH, serverList(bigLedger())]],
    });
    await page.goto(`/clients/${PCT_CLIENT.id}`);
    await page.getByRole("button", { name: "Expenses / Purchases" }).click();
    await expect(page.getByText("510 record(s)", { exact: true })).toBeVisible();
    await quiet();
    const before = listCalls(seen).length;
    await page.getByLabel("Status").selectOption("held");
    await expect(page.getByText("250 record(s)", { exact: true })).toBeVisible();
    await quiet();
    const held = listCalls(seen).slice(before);
    expect(held.map((s) => s.search.toString())).toHaveLength(1);
    expect(held[0]!.search.get("status")).toBe("held");
    const body = page.locator("table tbody");
    await expect(body.locator("tr")).toHaveCount(50);
    await expect(body).not.toContainText("OR-P");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T1 (cont.) — every other place the Portal names an exempt client's regime
// ---------------------------------------------------------------------------

/** No page an exempt client is on may read "percentage tax" or "not set". */
/** W11: U10's estimate for an exempt client — no business tax, in the API's words. */
const EXEMPT_SENTENCE = "No business tax: this client is exempt from business tax.";
const EXEMPT_ESTIMATE: Entry = [
  "GET",
  /^\/api\/v1\/clients\/[^/]+\/tax-estimate$/,
  (r) =>
    json(r, {
      basis: "management-estimate",
      notice: "Management estimate, not the filed figure.",
      client: {
        id: EXEMPT_CLIENT.id,
        businessName: EXEMPT_CLIENT.businessName,
        regime: "EXEMPT",
      },
      period: {
        year: 2026,
        quarter: 3,
        label: "Q3 2026",
        incomeTaxFrom: "2026-01-01",
        incomeTaxTo: "2026-09-30",
        businessTaxFrom: "2026-07-01",
        businessTaxTo: "2026-09-30",
      },
      method: { name: "graduated", source: "default", rate: null },
      incomeTax: { grossIncome: 0, deductibleExpenses: 0, taxableIncome: 0, due: 0 },
      businessTax: {
        kind: "none",
        grossReceipts: 0,
        outputVAT: 0,
        inputVAT: 0,
        rate: null,
        due: 0,
      },
      assumptions: ["Figures come from posted records only.", EXEMPT_SENTENCE],
      filedForms: [],
    }),
];

async function expectNoWrongRegime(page: Page) {
  const text = await screenText(page);
  expect(text, "an exempt client is never 'percentage tax'").not.toMatch(
    /percentage[- ]tax/i,
  );
  expect(text, "an exempt client is never 'not set'").not.toMatch(/not set/i);
  expect(text).not.toMatch(/Set this client.s tax type/i);
  expect(text, "nor the old option text").not.toMatch(/\(Percentage\)/);
  expect(text, "nor the raw enum").not.toMatch(/\bPERCENTAGE\b/);
}

test.describe("T1 an exempt client is labelled right everywhere (hermetic)", () => {
  test("T1 the client page and the client switcher say Exempt from business tax, and an exempt client can record", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page);
    await page.goto(`/clients/${EXEMPT_CLIENT.id}`);
    await expect(
      page.getByRole("heading", { name: EXEMPT_CLIENT.businessName }),
    ).toBeVisible();
    await expect(
      page.locator("main").getByText("Exempt from business tax", { exact: true }),
    ).toBeVisible();
    // The top bar's client switcher names the regime too.
    const switcher = page
      .getByRole("button", { name: new RegExp(EXEMPT_CLIENT.businessName) })
      .first();
    await expect(switcher).toContainText("Exempt from business tax");
    // An exempt client keeps books (D39): recording is open, as on Sales and Expenses.
    await expect(page.getByRole("button", { name: "+ Add income" })).toBeVisible();
    await expectNoWrongRegime(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the client list names all three regimes by their labels", async ({ page }) => {
    const { unmocked } = await mockApi(page);
    await page.goto("/clients");
    await expect(
      page.locator("tbody tr").filter({ hasText: EXEMPT_CLIENT.businessName }),
    ).toBeVisible();
    const headers = await page.locator("thead th").allTextContents();
    const col = headers.findIndex((h) => /regime/i.test(h));
    expect(col, "the client list has a Regime column").toBeGreaterThanOrEqual(0);
    const regimeOf = (name: string) =>
      page.locator("tbody tr").filter({ hasText: name }).locator("td").nth(col);
    await expect(regimeOf(EXEMPT_CLIENT.businessName)).toHaveText(
      "Exempt from business tax",
    );
    await expect(regimeOf(PCT_CLIENT.businessName)).toHaveText("Percentage tax");
    await expect(regimeOf(VAT_CLIENT.businessName)).toHaveText("VAT-registered");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 Sales & Income and its entry form name an exempt client's regime", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page);
    await page.goto(`/clients/${EXEMPT_CLIENT.id}/sales`);
    await expect(page.locator("main .eyebrow").first()).toHaveText(
      "Exempt from business tax",
    );
    await expectNoWrongRegime(page);
    await page
      .getByRole("button", { name: /Add record/ })
      .first()
      .click();
    const modal = page.locator('[aria-modal="true"], [role="dialog"]').last();
    await expect(
      modal.getByText("Exempt from business tax", { exact: true }),
    ).toBeVisible();
    await expect(modal.locator("option", { hasText: "Non-VAT" }).first()).toHaveText(
      "Non-VAT (exempt from business tax)",
    );
    await expectNoWrongRegime(page);
    await modal.getByRole("button", { name: "Close" }).click();
    // The Sales import's note names the regime too.
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await expect(
      page.getByText(/no VAT: this client is exempt from business tax/),
    ).toBeVisible();
    await expectNoWrongRegime(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the Expenses entry form's header names an exempt client's regime", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page);
    await page.goto(`/clients/${EXEMPT_CLIENT.id}/expenses`);
    await page.getByRole("button", { name: "+ Add record" }).first().click();
    const modal = page.locator('[aria-modal="true"], [role="dialog"]').last();
    await expect(
      modal.getByText("Exempt from business tax", { exact: true }),
    ).toBeVisible();
    await expectNoWrongRegime(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the tax estimate shows no business tax for an exempt client", async ({
    page,
  }) => {
    // W11: the page reads the API's estimate; its business-tax card carries the
    // API's own sentence (U10 R3) where the browser used to write one.
    const { unmocked } = await mockApi(page, { extra: [EXEMPT_ESTIMATE] });
    await page.goto(`/clients/${EXEMPT_CLIENT.id}/tax`);
    const main = page.locator("main");
    await expect(
      main.getByText("Business tax (estimate)", { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText("Exempt from business tax", { exact: true }),
    ).toBeVisible();
    await expect(
      main.locator("[data-business-tax=none] [data-business-tax-note]"),
    ).toHaveText(EXEMPT_SENTENCE);
    await expectNoWrongRegime(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the portal's tax estimate shows no business tax for an exempt client", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, { me: PORTAL_ME, extra: [EXEMPT_ESTIMATE] });
    await page.goto("/portal/tax");
    const main = page.locator("main");
    await expect(
      main.getByText("Business tax (estimate)", { exact: true }),
    ).toBeVisible();
    await expect(
      main.getByText("Exempt from business tax", { exact: true }),
    ).toBeVisible();
    await expect(
      main.locator("[data-business-tax=none] [data-business-tax-note]"),
    ).toHaveText(EXEMPT_SENTENCE);
    await expectNoWrongRegime(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the portal's Sales entry form names an exempt client's regime", async ({
    page,
  }) => {
    const portalEntry = {
      ...PORTAL_ME,
      permissions: {
        ...PORTAL_ME.permissions,
        global: ["Expenses:Read", "Sales:Read", "Sales:Create"],
      },
    };
    const { unmocked } = await mockApi(page, { me: portalEntry });
    await page.goto("/portal/sales");
    await page.getByRole("button", { name: "+ Add record" }).first().click();
    const modal = page.locator('[aria-modal="true"], [role="dialog"]').last();
    await expect(
      modal.getByText("Exempt from business tax", { exact: true }),
    ).toBeVisible();
    await expect(modal.locator("option", { hasText: "Non-VAT" }).first()).toHaveText(
      "Non-VAT (exempt from business tax)",
    );
    await expectNoWrongRegime(page);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 the client form offers the three regimes by their labels", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page);
    await page.goto(`/clients/${EXEMPT_CLIENT.id}/edit`);
    const select = page.getByLabel("Tax regime");
    await expect(select).toHaveValue("");
    await expect(select.locator("option:checked")).toHaveText("Exempt from business tax");
    expect(await select.locator("option").allTextContents()).toEqual([
      "Exempt from business tax",
      "VAT-registered",
      "Percentage tax",
    ]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T4 — W5's loose ends (R3) and no missing asset (R4)
// ---------------------------------------------------------------------------

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const IMPORT_PATH = /^\/api\/v1\/purchase-transactions\/import$/;
const importCalls = (seen: Seen[]) =>
  seen.filter((s) => s.method === "POST" && IMPORT_PATH.test(s.path));

/** One row that will post: the dry run's answer, and the import's. */
const CHECK = {
  templateVersion: "1",
  clientId: PCT_CLIENT.id,
  periodFrom: "2026-07-01",
  periodTo: "2026-09-30",
  rows: [
    {
      rowNumber: 2,
      outcome: "posted",
      needsReview: false,
      messages: [],
      records: [
        {
          id: "ffffffff-0000-4000-8000-000000000001",
          classification: "PURCHASE_NON_VAT",
          amount: 1250,
          vatAmount: 0,
          vatClaimable: false,
        },
      ],
    },
  ],
  totals: { rows: 1, posted: 1, held: 0, rejected: 0, grossAmount: 1250 },
};

async function openImport(page: Page) {
  await page.goto(`/clients/${PCT_CLIENT.id}/expenses`);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import expenses" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("T4 W5's loose ends, and no missing asset (hermetic)", () => {
  test("T4 a Post refused with an HTML error page shows a readable message", async ({
    page,
  }) => {
    const held = expense("DR-HTML-1", 1, { status: "held", needsReview: true });
    const { unmocked } = await mockApi(page, {
      extra: [
        ["GET", LIST_PATH, serverList([held])],
        [
          "POST",
          /^\/api\/v1\/purchase-transactions\/[^/]+\/post$/,
          (r) =>
            r.fulfill({
              status: 502,
              contentType: "text/html",
              body: "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>",
            }),
        ],
      ],
    });
    await page.goto(`/clients/${PCT_CLIENT.id}/expenses`);
    await page.getByRole("button", { name: "Post" }).click();
    // W10: the confirmation asks in the page, and the refusal shows in it.
    const ask = page.getByRole("dialog", { name: /^Post / });
    await ask.getByRole("button", { name: "Post", exact: true }).click();
    const alert = ask.getByRole("alert");
    await expect(alert).toHaveText("Could not post this record (502)");
    await expect(alert).not.toContainText(/JSON|Unexpected token|<html/i);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 the import dialog cannot be closed while the import runs", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const released = new Promise<void>((res) => (release = res));
    const { seen, unmocked } = await mockApi(page, {
      extra: [
        [
          "POST",
          IMPORT_PATH,
          async (r, s) => {
            if (s.search.get("dryRun") === "false") await released;
            return json(r, CHECK);
          },
        ],
      ],
    });
    const dialog = await openImport(page);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "july.xlsx",
      mimeType: XLSX_MIME,
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    });
    await dialog.getByRole("button", { name: "Import 1 row" }).click();
    await expect(dialog.getByRole("button", { name: "Importing…" })).toBeVisible();

    const close = dialog.getByRole("button", { name: "Close" });
    await expect(close).toBeDisabled();
    // The backdrop does not close it either.
    await page.mouse.click(5, 5);
    await expect(dialog).toBeVisible();
    await expect(close).toBeDisabled();

    release();
    await expect(dialog.getByText(/Import finished:/)).toBeVisible();
    await expect(close).toBeEnabled();
    expect(importCalls(seen).map((s) => s.search.get("dryRun"))).toEqual([
      "true",
      "false",
    ]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a dropped .csv is refused with the same message the picker gives; nothing is sent", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [["POST", IMPORT_PATH, (r) => json(r, CHECK)]],
    });
    // The server's own words for a file that is not the template
    // (expense-import.parser.ts) — what the picker has always shown.
    const message =
      "The file is not an .xlsx workbook. Upload the template you downloaded, filled in.";
    const drop = async (
      target: ReturnType<Page["getByRole"]>,
      name: string,
      type: string,
    ) => {
      const data = await page.evaluateHandle(
        ([n, t]) => {
          const dt = new DataTransfer();
          dt.items.add(new File(["Date,Amount\n2026-07-01,100\n"], n, { type: t }));
          return dt;
        },
        [name, type] as const,
      );
      await target
        .getByRole("button", { name: /Drop the filled template here/ })
        .dispatchEvent("drop", { dataTransfer: data });
    };

    // Dropped on a fresh dialog, with nothing on screen before it.
    let dialog = await openImport(page);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await drop(dialog, "expenses.csv", "text/csv");
    await expect(dialog.getByRole("alert")).toHaveText(message);

    // Picked through the file chooser on another fresh dialog: the same words.
    dialog = await openImport(page);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "expenses.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Date,Amount\n2026-07-01,100\n"),
    });
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await quiet();
    expect(importCalls(seen)).toHaveLength(0);

    // The drop does reach the dialog: a dropped .xlsx goes for its dry run.
    await drop(dialog, "july.xlsx", XLSX_MIME);
    await expect(
      dialog.getByText(/This is a check\. Nothing has been saved yet\./),
    ).toBeVisible();
    await quiet();
    expect(importCalls(seen).map((s) => s.search.get("dryRun"))).toEqual(["true"]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 the 2307 print asks for no missing asset; its barcode box is present and empty", async ({
    page,
  }) => {
    // A missing file is a 404 — or, behind nginx's and Vite's SPA fallback, an
    // image or font answered with the app's HTML. Either is a missing asset.
    const missing: string[] = [];
    const own = (url: string) => new URL(url).hostname === "localhost";
    page.on("response", (res) => {
      if (!own(res.url())) return;
      const kind = res.request().resourceType();
      const type = res.headers()["content-type"] ?? "";
      const notAnAsset =
        (kind === "image" || kind === "font") &&
        !/^(image|font)\/|octet-stream/.test(type);
      if (res.status() === 404 || notAnAsset)
        missing.push(`${res.url()} → ${res.status()} ${type}`);
    });
    // A request the page itself cancelled (net::ERR_ABORTED — an image whose
    // html2canvas clone was torn down mid-load) is not a missing file when the
    // same URL also loaded as an image; any other failure is.
    const loaded = new Set<string>();
    const failed: Array<{ url: string; text: string }> = [];
    page.on("response", (res) => {
      const type = res.headers()["content-type"] ?? "";
      if (res.status() === 200 && /^(image|font)\//.test(type)) loaded.add(res.url());
    });
    page.on("requestfailed", (req) => {
      if (own(req.url()))
        failed.push({ url: req.url(), text: req.failure()?.errorText ?? "" });
    });
    // Only a SAVED certificate prints, and its payor needs a registered name
    // (W7 R6): the same client, saved, with the name its Item 7 prints.
    const SAVED_ID = "f2307000-0000-4000-8000-0000000000b6";
    const saved = {
      id: SAVED_ID,
      clientId: PCT_CLIENT.id,
      clientName: PCT_CLIENT.businessName,
      form: "2307",
      status: "draft",
      period: "2026-Q1",
      filedAt: null,
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:00:00.000Z",
      data: { year: "2026", quarter: "1" },
      computed: null,
      exports: [],
      amendsId: null,
      sequence: 1,
      filedSnapshot: null,
    };
    const { unmocked, quiet } = await mockApi(page, {
      extra: [
        ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
        ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
        ["GET", new RegExp(`^/api/v1/bir-forms/${SAVED_ID}$`), (r) => json(r, saved)],
        [
          "GET",
          new RegExp(`^/api/v1/clients/${PCT_CLIENT.id}$`),
          (r) =>
            json(r, {
              ...PCT_CLIENT,
              kind: "non-individual",
              regName: "INVENTED BAKERY CORP",
            }),
        ],
      ],
    });
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(`/bir-forms/${SAVED_ID}`);
    await expect(page.getByLabel("Year")).toHaveValue("2026");
    await page.getByRole("button", { name: "Form", exact: true }).click();

    const boxes = page.locator('[data-barcode="empty"]');
    await expect(boxes.first()).toBeAttached();
    for (const box of await boxes.all()) {
      expect(await box.evaluate((el) => el.childElementCount)).toBe(0);
      expect(await box.evaluate((el) => (el.textContent ?? "").trim())).toBe("");
    }
    await expect(page.locator("img.bir-barcode")).toHaveCount(0);

    await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: /Print certificate \(PDF\)/ }).click(),
    ]);
    await quiet();
    for (const f of failed) {
      if (!(f.text === "net::ERR_ABORTED" && loaded.has(f.url)))
        missing.push(`${f.url} (${f.text})`);
    }
    expect(missing, `missing assets: ${missing.join(", ")}`).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T4 (static) — no reference to an asset that is not in the tree (R4). A page
// cannot show what it never requests, so the source itself is checked: every
// root path the web names under /assets, and every file index.html names, is a
// file under public/. Vite and nginx answer a missing file with the app's HTML,
// so a missing reference is otherwise silent.
// ---------------------------------------------------------------------------

test("T4 every asset the web's source names is a file under public/", () => {
  const web = resolve(test.info().project.testDir, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const f = join(dir, n);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
  const sources = walk(join(web, "src")).filter((f) => /\.(tsx?|css)$/.test(f));
  const refs: Array<{ file: string; path: string }> = [];
  for (const file of sources) {
    for (const m of readFileSync(file, "utf8").matchAll(
      /["'`(]\/(assets\/[^"'`)\s?#]+)/g,
    ))
      if (!m[1]!.includes("${")) refs.push({ file: relative(web, file), path: m[1]! });
  }
  for (const m of readFileSync(join(web, "index.html"), "utf8").matchAll(
    /(?:href|src)="\/([^"/][^"]*\.(?:png|svg|ico|js|webmanifest|json))"/g,
  ))
    refs.push({ file: "index.html", path: m[1]! });
  // eslint-disable-next-line no-console
  console.log("T4-ASSET-REFS " + JSON.stringify(refs));
  // Each source must yield references, so a broken pattern cannot pass on the
  // other source's alone.
  expect(
    refs.filter((r) => r.file !== "index.html").length,
    "src references found",
  ).toBeGreaterThan(0);
  expect(
    refs.filter((r) => r.file === "index.html").length,
    "index.html references found",
  ).toBeGreaterThan(5);
  const missing = refs.filter((r) => !existsSync(join(web, "public", r.path)));
  expect(missing, "references to files that are not under public/").toEqual([]);
});

test("T4 the dialog's wrong-file message is the server's own words", () => {
  const web = resolve(test.info().project.testDir, "..");
  const dialog = readFileSync(join(web, "src/components/ExpenseImportModal.tsx"), "utf8");
  const server = readFileSync(
    join(web, "../api/src/purchase-transactions/import/expense-import.parser.ts"),
    "utf8",
  );
  const words =
    "The file is not an .xlsx workbook. Upload the template you downloaded, filled in.";
  expect(dialog, "the dialog says it").toContain(words);
  expect(server, "the server says it (expense-import.parser.ts)").toContain(words);
});

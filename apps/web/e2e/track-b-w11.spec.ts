// track-b-w11.spec.ts — hermetic browser tests for W11: both tax pages read the
// API's estimate for a chosen period and compute nothing (R1); the two-factor
// card says the current code keeps working during a reset (R2); "Rotate secret"
// asks first (R4).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// The browser clock is fixed per test, so "the most recent quarter that has
// ended" is decided by the test, never by the day the suite runs.
//
// The estimate's figures below are invented and deliberately ones no browser
// arithmetic would reach (a 1.5% business-tax rate, an income tax unrelated to
// any bracket): the page can only show them by reading them from the API.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222b1";

const CLIENT = {
  id: "c1100000-0000-4000-8000-0000000000b1",
  businessName: "INVENTED ELEVEN BAKERY",
  tin: "000-111-011-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const FIRM_ME = {
  user: {
    id: "u1100000-0000-4000-8000-0000000000b1",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: [
      "Clients:Read",
      "TaxComputation:Read",
      "BirForms:Read",
      "IntegrationClient:Create",
      "IntegrationClient:Update",
      "IntegrationClient:Delete",
    ],
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
  },
};
const PORTAL_ME = {
  user: {
    id: "u1100000-0000-4000-8000-0000000000b2",
    email: "owner@example.test",
    fullName: "Portal Owner",
    userType: "CLIENT",
    firmId: FIRM_ID,
    clientId: CLIENT.id,
    mfaEnabled: true,
  },
  permissions: {
    global: ["Sales:Read", "Expenses:Read", "TaxComputation:Read"],
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
  opts: { me?: Me; mfa?: { on: boolean }; taxType?: string | null; extra?: Entry[] } = {},
) {
  const me = opts.me ?? FIRM_ME;
  const mfa = opts.mfa ?? { on: true };
  const taxType = opts.taxType === undefined ? CLIENT.taxType : opts.taxType;
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  // W10: no browser dialog may open, on any page.
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
  // Re-armable "nothing in flight": no request pending and none started for 500 ms.
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
  const client = { ...CLIENT, taxType };
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
          mfaEnabled: mfa.on,
          avatarUrl: null,
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/portal\/context$/,
      (r) =>
        json(r, {
          id: client.id,
          businessName: client.businessName,
          taxType: client.taxType,
          status: "Active",
          seatLimit: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [client])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, client)],
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
  return { seen, unmocked, dialogs, quiet };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}

/** Fix the browser's clock at a Manila wall-clock moment, before the page loads. */
async function manilaClock(page: Page, isoManila: string) {
  await page.clock.setFixedTime(new Date(`${isoManila}+08:00`));
}

// ---------------------------------------------------------------------------
// The invented estimate (U10 R1's shape)
// ---------------------------------------------------------------------------

const ESTIMATE_PATH = /^\/api\/v1\/clients\/[^/]+\/tax-estimate$/;
const NOTICE =
  "INVENTED NOTICE: a management estimate for planning, not the filed figure.";
const ASSUMPTIONS = [
  "INVENTED ASSUMPTION ONE: figures come from posted records only.",
  "INVENTED ASSUMPTION TWO: income tax runs from 1 January.",
  "INVENTED ASSUMPTION THREE: business tax covers the quarter alone.",
];
const EXEMPT_SENTENCE = "No business tax: this client is exempt from business tax.";

type Kind = "vat" | "percentage" | "none";

function businessTaxOf(kind: Kind) {
  if (kind === "vat")
    return {
      kind,
      grossReceipts: 210987.65,
      outputVAT: 25318.52,
      inputVAT: 4321.09,
      rate: null,
      due: 20997.43,
    };
  if (kind === "percentage")
    return {
      kind,
      grossReceipts: 210987.65,
      outputVAT: 0,
      inputVAT: 0,
      rate: 1.5,
      due: 3164.81,
    };
  return {
    kind,
    grossReceipts: 210987.65,
    outputVAT: 0,
    inputVAT: 0,
    rate: null,
    due: 0,
  };
}

const FILED_Q3 = {
  id: "f1100000-0000-4000-8000-0000000000b1",
  form: "2551Q",
  period: "2026-Q3",
  filedAt: "2026-10-05T02:00:00.000Z",
  sequence: 1,
  amendsId: null,
  figures: { totalTaxDue: 2950.5, totalPayable: 2950.5 },
  superseded: false,
};

function estimateBody(
  search: URLSearchParams,
  opts: {
    kind?: Kind;
    source?: "saved" | "default";
    regime?: string;
    filed?: unknown[];
    assumptions?: string[];
  } = {},
) {
  const year = Number(search.get("year"));
  const q = search.get("quarter");
  const quarter = q === null ? null : Number(q);
  const kind = opts.kind ?? "percentage";
  return {
    basis: "management-estimate",
    notice: NOTICE,
    client: {
      id: CLIENT.id,
      businessName: CLIENT.businessName,
      regime:
        opts.regime ??
        (kind === "vat" ? "VAT" : kind === "none" ? "EXEMPT" : "PERCENTAGE"),
    },
    period: {
      year,
      quarter,
      label:
        quarter === null
          ? `INVENTED LABEL ${year} year to date`
          : `INVENTED LABEL Q${quarter} ${year}`,
      incomeTaxFrom: `${year}-01-01`,
      incomeTaxTo: `${year}-09-30`,
      businessTaxFrom: `${year}-07-01`,
      businessTaxTo: `${year}-09-30`,
    },
    method: { name: "graduated", source: opts.source ?? "saved", rate: null },
    incomeTax: {
      grossIncome: 654321.09,
      deductibleExpenses: 123456.78,
      taxableIncome: 530864.31,
      due: 9876.54,
    },
    businessTax: businessTaxOf(kind),
    assumptions: opts.assumptions ?? [
      ...ASSUMPTIONS,
      ...(kind === "none" ? [EXEMPT_SENTENCE] : []),
    ],
    filedForms: opts.filed ?? [FILED_Q3],
  };
}

function estimateApi(opts: Parameters<typeof estimateBody>[1] = {}): Entry {
  return ["GET", ESTIMATE_PATH, (r, s) => json(r, estimateBody(s.search, opts))];
}

const estimateCalls = (seen: Seen[]) =>
  seen.filter((s) => s.method === "GET" && ESTIMATE_PATH.test(s.path));
const query = (s: Seen) => s.search.toString();

const FIRM_TAX = `/clients/${CLIENT.id}/tax`;

// ---------------------------------------------------------------------------
// T1 — the firm's tax page reads the API's estimate (R1)
// ---------------------------------------------------------------------------

test.describe("T1 the firm's tax page reads the API's estimate (hermetic)", () => {
  test("T1 it shows the API's income tax, business tax, method with its source, every assumption and the notice", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, { extra: [estimateApi()] });
    await page.goto(FIRM_TAX);
    const main = page.locator("main");
    await expect(main.locator("[data-estimate-notice]")).toHaveText(NOTICE);
    await expect(main.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    await expect(main.locator("[data-method]")).toContainText("Graduated");
    await expect(main.locator("[data-method]")).toContainText("Saved rule");
    await expect(main.locator("[data-income=gross]")).toContainText("₱654,321.09");
    await expect(main.locator("[data-income=deductible]")).toContainText("₱123,456.78");
    await expect(main.locator("[data-income=taxable]")).toContainText("₱530,864.31");
    await expect(main.locator("[data-income=due]")).toContainText("₱9,876.54");
    const bt = main.locator("[data-business-tax=percentage]");
    await expect(bt).toContainText("₱210,987.65");
    await expect(bt).toContainText("1.5%");
    await expect(bt).toContainText("₱3,164.81");
    await expect(main.locator("[data-assumptions] li")).toHaveText(ASSUMPTIONS);
    // Nothing the browser used to compute is left on the page.
    await expect(main.getByText("TRAIN graduated schedule")).toHaveCount(0);
    await expect(main.getByText("× 3%")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T1 it asks for year=2026&quarter=3 by default on 2026-10-10, Manila", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [estimateApi()],
    });
    await page.goto(FIRM_TAX);
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    await quiet();
    expect(estimateCalls(seen).map(query)).toEqual(["year=2026&quarter=3"]);
    await expect(page.getByLabel("Year")).toHaveValue("2026");
    await expect(page.getByLabel("Quarter")).toHaveValue("3");
    clean(unmocked, dialogs);
  });

  test("T1 the default follows the Manila date, not the UTC one, at a quarter's turn", async ({
    page,
  }) => {
    // 00:30 on 1 April in Manila is still 31 March in UTC: Q1 has ended in Manila.
    await manilaClock(page, "2026-04-01T00:30:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [estimateApi()],
    });
    await page.goto(FIRM_TAX);
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q1 2026",
    );
    await quiet();
    expect(estimateCalls(seen).map(query)).toEqual(["year=2026&quarter=1"]);
    clean(unmocked, dialogs);
  });

  test("T1 in early January the default is the last quarter of the year before", async ({
    page,
  }) => {
    await manilaClock(page, "2027-01-05T09:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [estimateApi()],
    });
    await page.goto(FIRM_TAX);
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q4 2026",
    );
    await quiet();
    expect(estimateCalls(seen).map(query)).toEqual(["year=2026&quarter=4"]);
    clean(unmocked, dialogs);
  });

  test("T1 choosing Q2 sends one request with quarter=2", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [estimateApi()],
    });
    await page.goto(FIRM_TAX);
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    await quiet();
    await page.getByLabel("Quarter").selectOption({ label: "Q2" });
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q2 2026",
    );
    await quiet();
    expect(estimateCalls(seen).map(query)).toEqual([
      "year=2026&quarter=3",
      "year=2026&quarter=2",
    ]);
    clean(unmocked, dialogs);
  });

  test("T1 Whole year sends no quarter", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [estimateApi()],
    });
    await page.goto(FIRM_TAX);
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    await page.getByLabel("Quarter").selectOption({ label: "Whole year" });
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL 2026 year to date",
    );
    await page.getByLabel("Year").selectOption("2025");
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL 2025 year to date",
    );
    await quiet();
    const calls = estimateCalls(seen);
    expect(calls.map(query)).toEqual(["year=2026&quarter=3", "year=2026", "year=2025"]);
    expect(calls.slice(1).every((s) => !s.search.has("quarter"))).toBe(true);
    clean(unmocked, dialogs);
  });

  test("T1 filed returns show under their heading, beside the estimate", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const amended = {
      ...FILED_Q3,
      id: "f1100000-0000-4000-8000-0000000000b2",
      form: "1701Q",
      figures: { totalTaxDue: 8000, totalPayable: 7654.32 },
      superseded: true,
    };
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [estimateApi({ filed: [FILED_Q3, amended] })],
    });
    await page.goto(FIRM_TAX);
    const filed = page.locator("[data-filed-returns]");
    await expect(
      filed.getByRole("heading", { name: "Filed returns for this period" }),
    ).toBeVisible();
    const rows = filed.locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("2551Q");
    await expect(rows.nth(0)).toContainText("2026-Q3");
    await expect(rows.nth(0)).toContainText("₱2,950.50");
    await expect(rows.nth(1)).toContainText("1701Q");
    await expect(rows.nth(1)).toContainText("₱7,654.32");
    await expect(rows.nth(1)).toContainText("Superseded");
    await expect(rows.nth(0)).not.toContainText("Superseded");
    await expect(rows.nth(0).getByRole("link", { name: "2551Q" })).toHaveAttribute(
      "href",
      `/bir-forms/${FILED_Q3.id}`,
    );
    clean(unmocked, dialogs);
  });

  test("T1 with no filed return the heading says so", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [estimateApi({ filed: [] })],
    });
    await page.goto(FIRM_TAX);
    const filed = page.locator("[data-filed-returns]");
    await expect(
      filed.getByRole("heading", { name: "Filed returns for this period" }),
    ).toBeVisible();
    await expect(filed).toContainText("No return has been filed for this period.");
    clean(unmocked, dialogs);
  });

  test("T1 a VAT client's card shows the API's output VAT, input VAT and VAT payable; the default rule reads Default (TRAIN)", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      taxType: "VAT",
      extra: [estimateApi({ kind: "vat", source: "default" })],
    });
    await page.goto(FIRM_TAX);
    const bt = page.locator("[data-business-tax=vat]");
    await expect(bt).toContainText("₱25,318.52");
    await expect(bt).toContainText("₱4,321.09");
    await expect(bt).toContainText("₱20,997.43");
    await expect(page.locator("[data-method]")).toContainText("Default (TRAIN)");
    clean(unmocked, dialogs);
  });

  test("T1 an exempt client's card reads the API's own sentence, never a computed zero", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      taxType: null,
      extra: [estimateApi({ kind: "none" })],
    });
    await page.goto(FIRM_TAX);
    const bt = page.locator("[data-business-tax=none]");
    await expect(bt.locator("[data-business-tax-note]")).toHaveText(EXEMPT_SENTENCE);
    await expect(bt.getByText("Exempt from business tax", { exact: true })).toBeVisible();
    await expect(bt).not.toContainText("₱");
    clean(unmocked, dialogs);
  });

  test("T1 a refused estimate shows the error state, and Retry asks again", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    let fail = true;
    const { seen, unmocked, dialogs } = await mockApi(page, {
      extra: [
        [
          "GET",
          ESTIMATE_PATH,
          (r, s) =>
            fail
              ? json(r, { message: "Server error" }, 500)
              : json(r, estimateBody(s.search)),
        ],
      ],
    });
    await page.goto(FIRM_TAX);
    await expect(
      page.getByText("Could not load this client's tax estimate."),
    ).toBeVisible({
      // The app retries a failed query three times (about 7 s) before the error state.
      timeout: 15_000,
    });
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    expect(estimateCalls(seen).length).toBeGreaterThanOrEqual(2);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T2 — the client portal's tax page and home tile read the API's estimate (R1)
// ---------------------------------------------------------------------------

test.describe("T2 the portal's tax page reads the API's estimate (hermetic)", () => {
  test("T2 a client principal sees the API's estimate for its own business, by default for the last quarter that ended", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [estimateApi()],
    });
    await page.goto("/portal/tax");
    const main = page.locator("main");
    await expect(main.locator("[data-estimate-notice]")).toHaveText(NOTICE);
    await expect(main.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    await expect(main.locator("[data-method]")).toContainText("Saved rule");
    await expect(main.locator("[data-income=due]")).toContainText("₱9,876.54");
    await expect(main.locator("[data-business-tax=percentage]")).toContainText(
      "₱3,164.81",
    );
    await expect(main.locator("[data-assumptions] li")).toHaveText(ASSUMPTIONS);
    const filed = main.locator("[data-filed-returns]");
    await expect(
      filed.getByRole("heading", { name: "Filed returns for this period" }),
    ).toBeVisible();
    await expect(filed.locator("li")).toContainText("2551Q");
    await quiet();
    const calls = estimateCalls(seen);
    expect(calls.map(query)).toEqual(["year=2026&quarter=3"]);
    expect(calls[0]!.path).toBe(`/api/v1/clients/${CLIENT.id}/tax-estimate`);
    clean(unmocked, dialogs);
  });

  test("T2 the portal's picker sends quarter=2 once for Q2, and no quarter for Whole year", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [estimateApi()],
    });
    await page.goto("/portal/tax");
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q3 2026",
    );
    await page.getByLabel("Quarter").selectOption({ label: "Q2" });
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL Q2 2026",
    );
    await page.getByLabel("Quarter").selectOption({ label: "Whole year" });
    await expect(page.locator("[data-period-label]")).toHaveText(
      "INVENTED LABEL 2026 year to date",
    );
    await quiet();
    expect(estimateCalls(seen).map(query)).toEqual([
      "year=2026&quarter=3",
      "year=2026&quarter=2",
      "year=2026",
    ]);
    clean(unmocked, dialogs);
  });

  test("T2 an exempt client sees the API's sentence on the business-tax card", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      me: PORTAL_ME,
      taxType: null,
      extra: [estimateApi({ kind: "none" })],
    });
    await page.goto("/portal/tax");
    const bt = page.locator("[data-business-tax=none]");
    await expect(bt.locator("[data-business-tax-note]")).toHaveText(EXEMPT_SENTENCE);
    await expect(bt).not.toContainText("₱");
    clean(unmocked, dialogs);
  });

  test("T2 an error shows the error state", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [["GET", ESTIMATE_PATH, (r) => json(r, { message: "Server error" }, 500)]],
    });
    await page.goto("/portal/tax");
    await expect(page.getByText("Could not load your tax estimate.")).toBeVisible({
      // The app retries a failed query three times (about 7 s) before the error state.
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.locator("[data-income=due]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T2 the portal home's Estimated tax is the API's income tax for the last quarter that ended", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [
        estimateApi(),
        [
          "GET",
          /^\/api\/v1\/clients\/[^/]+\/purchase-transactions\/summary$/,
          (r) =>
            json(r, {
              basis: "management-estimate",
              totalNet: 5000,
              totalInputVAT: 0,
              count: 1,
              deductibleNet: 5000,
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
              totalNet: 900000,
              totalOutputVAT: 0,
              count: 1,
              byVatClass: [],
            }),
        ],
        ["GET", /^\/api\/v1\/clients\/[^/]+\/filings$/, (r) => json(r, [])],
      ],
    });
    await page.goto("/portal");
    const tile = page.locator("[data-estimated-tax]");
    await expect(tile).toContainText("₱9,876.54");
    await expect(tile).toContainText("Q3 2026");
    await quiet();
    expect(estimateCalls(seen).map(query)).toEqual(["year=2026&quarter=3"]);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T4 — two-factor says the current code keeps working (R2); Rotate asks (R4)
// ---------------------------------------------------------------------------

const ENROLL = /^\/api\/v1\/auth\/mfa\/enroll$/;
const CONFIRM = /^\/api\/v1\/auth\/mfa\/confirm$/;
const INVENTED_SECRET = "JBSWY3DPEHPK3PXPTESTELEVEN";
const KEEPS_WORKING = "Your current code keeps working until you confirm the new entry.";

/** U10 R5: enrolling again leaves two-factor on until the new entry is confirmed. */
function mfaServer(state: { on: boolean }): Entry[] {
  return [
    [
      "POST",
      ENROLL,
      (r) =>
        json(
          r,
          {
            secret: INVENTED_SECRET,
            otpauthUrl: `otpauth://totp/MCRC:operator%40example.test?secret=${INVENTED_SECRET}`,
          },
          201,
        ),
    ],
    [
      "POST",
      CONFIRM,
      (r) => {
        state.on = true;
        return json(r, { mfaEnabled: true }, 201);
      },
    ],
  ];
}

const mfaStatus = (page: Page) => page.locator("[data-mfa-status]");

test.describe("T4 two-factor and Rotate secret (hermetic)", () => {
  test("T4 setting two-factor up again says the current code keeps working, and the card stays On", async ({
    page,
  }) => {
    const mfa = { on: true };
    const { unmocked, dialogs, quiet } = await mockApi(page, {
      mfa,
      extra: mfaServer(mfa),
    });
    await page.goto("/profile");
    await expect(mfaStatus(page)).toHaveText("On");
    await page.getByRole("button", { name: "Set up again", exact: true }).click();
    await page.getByLabel("Current code from your authenticator").fill("654321");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(INVENTED_SECRET)).toBeVisible();
    await expect(page.getByText(KEEPS_WORKING)).toBeVisible();
    await expect(page.getByText(/stays off until you confirm/)).toHaveCount(0);
    await quiet();
    await expect(mfaStatus(page)).toHaveText("On");
    clean(unmocked, dialogs);
  });

  test("T4 turning two-factor on for the first time still says it stays off until the first code", async ({
    page,
  }) => {
    const mfa = { on: false };
    const { unmocked, dialogs } = await mockApi(page, { mfa, extra: mfaServer(mfa) });
    await page.goto("/profile");
    await expect(mfaStatus(page)).toHaveText("Off");
    await page.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
    await expect(page.getByText(INVENTED_SECRET)).toBeVisible();
    await expect(page.getByText(/stays off until you confirm/)).toBeVisible();
    await expect(page.getByText(KEEPS_WORKING)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  const INTEGRATION = {
    id: "i1100000-0000-4000-8000-0000000000b1",
    name: "Invented Generator",
    clientKey: "ck_test_not_a_secret",
    scopes: ["birforms:read"],
    status: "ACTIVE",
    lastUsedAt: null,
  };
  const ROTATE = new RegExp(`^/api/v1/integrations/${INTEGRATION.id}/rotate$`);
  const QUESTION = `Rotate the secret for ${INTEGRATION.name}? The current secret stops working immediately.`;
  const integrations = (refuse = false): Entry[] => [
    ["GET", /^\/api\/v1\/integrations$/, (r) => json(r, [INTEGRATION])],
    [
      "GET",
      /^\/api\/v1\/mcp-connector$/,
      (r) => json(r, { enabled: false, source: null, secret: null }),
    ],
    [
      "POST",
      ROTATE,
      (r) =>
        refuse
          ? json(r, { message: "INVENTED REFUSAL: this integration is locked." }, 409)
          : json(
              r,
              { ...INTEGRATION, clientSecret: "cs_test_rotated_not_a_secret" },
              201,
            ),
    ],
  ];
  const rotates = (seen: Seen[]) =>
    seen.filter((s) => s.method === "POST" && ROTATE.test(s.path));

  test("T4 Rotate secret asks first; Cancel and Escape send nothing", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: integrations(),
    });
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Rotate secret" }).click();
    const dialog = page.getByRole("dialog", { name: QUESTION });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Rotate", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "Rotate secret" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await quiet();
    expect(rotates(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T4 Rotate sends one request and shows the new secret", async ({ page }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: integrations(),
    });
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Rotate secret" }).click();
    const dialog = page.getByRole("dialog", { name: QUESTION });
    await dialog.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("cs_test_rotated_not_a_secret")).toBeVisible();
    await quiet();
    expect(rotates(seen)).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T4 a refused rotate shows the server's message in the dialog", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: integrations(true),
    });
    await page.goto("/settings/integrations");
    await page.getByRole("button", { name: "Rotate secret" }).click();
    const dialog = page.getByRole("dialog", { name: QUESTION });
    await dialog.getByRole("button", { name: "Rotate", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      "INVENTED REFUSAL: this integration is locked.",
    );
    await quiet();
    expect(rotates(seen)).toHaveLength(1);
    clean(unmocked, dialogs);
  });
});

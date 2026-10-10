// track-b-expenses-import.spec.ts — hermetic browser tests for the Expenses
// import through the API (W5), the Expenses status filter and Post action, the
// client portal's handling of held rows, and a regression guard on the Sales
// import's browser-side parse.
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// The mocks follow the contract in W5 R1 (Track A, U6) — this file never reads
// Track A's branch.
//
// All data is invented. No real name, TIN, address, phone or email.

import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Invented parties
// ---------------------------------------------------------------------------

const NON_VAT_CLIENT = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  businessName: "SAMPLE BAKESHOP (NON-VAT)",
  tin: "100-200-300-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const VAT_CLIENT = {
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  businessName: "SAMPLE TRADING (VAT)",
  tin: "100-200-301-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

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
      "Expenses:Read",
      "Expenses:Create",
      "Expenses:Update",
      "Expenses:Delete",
      "Sales:Read",
      "Sales:Create",
    ],
    clients: [],
    assignedClientIds: [NON_VAT_CLIENT.id, VAT_CLIENT.id],
    canViewAllClients: true,
  },
};

/** A user of the client portal, belonging to the non-VAT client. */
const PORTAL_ME = {
  user: {
    id: "33333333-3333-4333-8333-333333333333",
    email: "owner@bakeshop.example.test",
    fullName: "Portal Owner",
    userType: "CLIENT",
    firmId: FIRM_ME.user.firmId,
    clientId: NON_VAT_CLIENT.id,
    mfaEnabled: false,
  },
  permissions: {
    global: ["Expenses:Read", "Sales:Read"],
    clients: [],
    assignedClientIds: [NON_VAT_CLIENT.id],
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

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** An .xlsx built in Node, so the upload is a real workbook. The browser must
 *  not read it any more; it only sends the bytes. */
function expenseWorkbook(): Buffer {
  return workbook("EXPENSES", [
    ["Date*", "Vendor TIN*", "Vendor Name*", "Reference Number*", "Amount*"],
    ["2026-07-03", "300-400-500-00000", "INVENTED HARDWARE CO", "OR-0001", 4194.21],
    ["2026-07-04", "", "INVENTED WATER DELIVERY", "DR-0042", 1250],
  ]);
}

function workbook(sheet: string, aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** The first row of the first sheet of an .xlsx on disk. */
function headerRow(path: string): string[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  return (rows[0] ?? []).map(String);
}

// ---------------------------------------------------------------------------
// The A3 mocks — the three worked examples and the two errors. Track A's
// contract (W5 R1) fixes the SHAPE; the figures are invented for these tests.
// ---------------------------------------------------------------------------

/** Non-VAT client: one mixed receipt (VAT-able + VAT-exempt lines) that posts,
 *  and one delivery receipt with no vendor TIN that is held for review. */
function nonVatResult(final: boolean) {
  const id = (s: string) => (final ? s : `dry-${s}`);
  return {
    templateVersion: "1",
    clientId: NON_VAT_CLIENT.id,
    periodFrom: "2026-07-01",
    periodTo: "2026-09-30",
    rows: [
      {
        rowNumber: 2,
        outcome: "posted",
        needsReview: false,
        messages: [
          "Mixed receipt: split into a VAT-able record and a VAT-exempt record.",
          "Non-VAT client: the input VAT is not claimable and stays in the cost.",
        ],
        records: [
          {
            id: id("nv-2-1"),
            classification: "PURCHASE_VATABLE",
            amount: 3306.25,
            vatAmount: 354.24,
            vatClaimable: false,
          },
          {
            id: id("nv-2-2"),
            classification: "PURCHASE_VAT_EXEMPT",
            amount: 887.96,
            vatAmount: 0,
            vatClaimable: false,
          },
        ],
      },
      {
        rowNumber: 3,
        outcome: "held",
        needsReview: true,
        messages: ["Delivery receipt with no vendor TIN: held until a TIN is entered."],
        records: [
          {
            id: id("nv-3-1"),
            classification: "PURCHASE_NO_TIN",
            amount: 1250,
            vatAmount: 0,
            vatClaimable: false,
          },
        ],
      },
    ],
    totals: { rows: 2, posted: 1, held: 1, rejected: 0, grossAmount: 5444.21 },
  };
}

/** VAT client: the same mixed receipt, with the input VAT claimable. */
function vatResult() {
  return {
    templateVersion: "1",
    clientId: VAT_CLIENT.id,
    periodFrom: "2026-07-01",
    periodTo: "2026-09-30",
    rows: [
      {
        rowNumber: 2,
        outcome: "posted",
        needsReview: false,
        messages: [
          "Mixed receipt: split into a VAT-able record and a VAT-exempt record.",
        ],
        records: [
          {
            id: "dry-v-2-1",
            classification: "PURCHASE_VATABLE",
            amount: 2952.01,
            vatAmount: 354.24,
            vatClaimable: true,
          },
          {
            id: "dry-v-2-2",
            classification: "PURCHASE_VAT_EXEMPT",
            amount: 887.96,
            vatAmount: 0,
            vatClaimable: false,
          },
        ],
      },
    ],
    totals: { rows: 1, posted: 1, held: 0, rejected: 0, grossAmount: 4194.21 },
  };
}

const ERROR_CLIENT_MISMATCH = {
  status: 400,
  body: {
    message:
      "This file was downloaded for a different client. Download the template for this client and use that one.",
  },
};
const ERROR_UNKNOWN_VERSION = {
  status: 422,
  body: {
    message:
      'Unknown template version "0.9". Download a fresh template and fill it in again.',
  },
};

// ---------------------------------------------------------------------------
// The router
// ---------------------------------------------------------------------------

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  contentType: string;
  request: Request;
}

type Handler = (route: Route, seen: Seen) => Promise<void> | void;

async function mockApi(
  page: Page,
  opts: {
    me?: typeof FIRM_ME | typeof PORTAL_ME;
    clients?: Array<typeof NON_VAT_CLIENT>;
    extra?: Array<[method: string, pattern: RegExp, handler: Handler]>;
  } = {},
): Promise<{ seen: Seen[]; unmocked: string[] }> {
  const me = opts.me ?? FIRM_ME;
  const clients = opts.clients ?? [NON_VAT_CLIENT, VAT_CLIENT];
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  // Re-armable "nothing in flight": no request pending and none started for
  // 500 ms. waitForLoadState("networkidle") resolves at once once the page has
  // been idle, so it cannot catch a request that comes late (review, W6).
  let inflight = 0;
  let started = 0;
  page.on("request", () => {
    inflight += 1;
    started += 1;
  });
  const settled = () => {
    inflight -= 1;
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

  const byId = (path: string) => clients.find((c) => path.includes(c.id)) ?? clients[0]!;

  const base: Array<[string, RegExp, Handler]> = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    ["GET", /^\/api\/v1\/profile\/me$/, (r) => json(r, profileOf(me))],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, clients)],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r, s) => json(r, byId(s.path))],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/(purchase|income)-transactions$/,
      (r) => json(r, { data: [], page: 1, pageSize: 50, total: 0 }),
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

  // Later entries win, so a test's own handlers override the defaults.
  const table = [...base, ...(opts.extra ?? [])];

  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const s: Seen = {
      method: req.method(),
      path: url.pathname,
      search: url.searchParams,
      contentType: req.headers()["content-type"] ?? "",
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

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const IMPORT = /^\/api\/v1\/purchase-transactions\/import$/;
const isImportPost = (s: Seen) =>
  s.method === "POST" && s.path === "/api/v1/purchase-transactions/import";

async function openExpenseImport(page: Page, clientId: string) {
  await page.goto(`/clients/${clientId}/expenses`);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Import expenses" })).toBeVisible();
}

async function chooseFile(page: Page, name = "expenses-import.xlsx") {
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: XLSX_MIME, buffer: expenseWorkbook() });
}

// ---------------------------------------------------------------------------
// T1 — choosing a file uploads it for a dry run; the browser parses nothing
// ---------------------------------------------------------------------------

test.describe("Expenses import through the API (hermetic)", () => {
  test("T1 choosing a file sends exactly one multipart dry run and no JSON rows", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [
        [
          "POST",
          /^\/api\/v1\/purchase-transactions\/import$/,
          (r) =>
            r.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                templateVersion: "1",
                clientId: NON_VAT_CLIENT.id,
                periodFrom: "2026-07-01",
                periodTo: "2026-07-31",
                rows: [],
                totals: { rows: 0, posted: 0, held: 0, rejected: 0, grossAmount: 0 },
              }),
            }),
        ],
      ],
    });

    await page.goto(`/clients/${NON_VAT_CLIENT.id}/expenses`);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "expenses-import.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: expenseWorkbook(),
    });

    // The dry run has been answered once its check is on screen; then nothing
    // else may be in flight before the requests are counted (W6 R3).
    await expect(
      page.getByText(/This is a check\. Nothing has been saved yet\./),
    ).toBeVisible();
    await quiet();

    const dryRuns = seen.filter(
      (s) => s.method === "POST" && s.path === "/api/v1/purchase-transactions/import",
    );
    const oldJsonRows = seen.filter(
      (s) =>
        s.method === "POST" &&
        /\/clients\/[^/]+\/purchase-transactions\/import$/.test(s.path),
    );
    // eslint-disable-next-line no-console
    console.log(
      "T1-REQUESTS " +
        JSON.stringify({
          dryRuns: dryRuns.map((d) => ({
            query: d.search.toString(),
            contentType: d.contentType.split(";")[0],
          })),
          oldJsonRows: oldJsonRows.length,
        }),
    );

    expect(dryRuns).toHaveLength(1);
    expect(dryRuns[0]!.search.get("dryRun")).toBe("true");
    expect(dryRuns[0]!.search.get("clientId")).toBe(NON_VAT_CLIENT.id);
    expect(dryRuns[0]!.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(
      dryRuns[0]!.request.postDataBuffer()?.includes(Buffer.from('name="file"')),
    ).toBe(true);
    expect(oldJsonRows).toHaveLength(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2 — the dry run's table, the real import, the template download, the errors
// ---------------------------------------------------------------------------

test.describe("T2 Expenses import: dry run, import, template, errors (hermetic)", () => {
  test("T2 the dry run shows the worked examples; Import sends dryRun=false once", async ({
    page,
  }) => {
    const { seen, unmocked } = await mockApi(page, {
      extra: [
        [
          "POST",
          IMPORT,
          (r, s) => json(r, nonVatResult(s.search.get("dryRun") === "false")),
        ],
      ],
    });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await openExpenseImport(page, NON_VAT_CLIENT.id);
    await chooseFile(page, "bakeshop-july.xlsx");

    const check = page.getByRole("table", { name: "Import check" });
    await expect(check).toBeVisible();

    // Row 2 — the mixed receipt: posts, as two records.
    const row2 = check.locator('tr[data-row-number="2"]');
    await expect(row2).toHaveCount(2);
    await expect(row2.first()).toContainText("Will post");
    await expect(row2.first()).toContainText("Mixed receipt: split into");
    await expect(row2.nth(0)).toContainText("PURCHASE_VATABLE");
    await expect(row2.nth(0).locator("[data-amount]")).toHaveText("₱3,306.25");
    await expect(row2.nth(0)).toContainText("(VAT not claimable)");
    await expect(row2.nth(1)).toContainText("PURCHASE_VAT_EXEMPT");
    await expect(row2.nth(1).locator("[data-amount]")).toHaveText("₱887.96");

    // Row 3 — the delivery receipt without a TIN: held, needs review.
    const row3 = check.locator('tr[data-row-number="3"]');
    await expect(row3).toHaveCount(1);
    await expect(row3).toHaveAttribute("data-outcome", "held");
    await expect(row3).toContainText("Will be held");
    await expect(row3).toContainText("Needs review");
    await expect(row3).toContainText("no vendor TIN");
    await expect(row3.locator("[data-amount]")).toHaveText("₱1,250.00");

    const totals = page.getByTestId("import-totals");
    await expect(totals).toContainText("2 rows");
    await expect(totals).toContainText("1 will post");
    await expect(totals).toContainText("1 will be held");
    await expect(totals).toContainText("0 rejected");
    await expect(totals).toContainText("₱5,444.21");
    await expect(
      page.getByText("This is a check. Nothing has been saved yet."),
    ).toBeVisible();

    // The PNG of the dry-run result the report points to.
    await page.getByRole("dialog").screenshot({
      path: "test-results/track-b-expenses-dry-run.png",
    });

    expect(seen.filter(isImportPost).map((s) => s.search.get("dryRun"))).toEqual([
      "true",
    ]);

    await page.getByRole("button", { name: "Import 2 rows" }).click();
    const result = page.getByRole("table", { name: "Import result" });
    await expect(result).toBeVisible();
    await expect(page.getByText("Import finished:")).toContainText(
      "1 posted, 1 held for review, 0 rejected",
    );
    await expect(result.locator('tr[data-row-number="2"]').first()).toContainText(
      "Posted",
    );
    await expect(result.locator('tr[data-row-number="3"]')).toContainText("Held");
    await expect(page.getByTestId("import-totals")).toContainText("1 posted");
    await expect(page.getByTestId("import-totals")).toContainText("1 held");
    await expect(page.getByTestId("import-totals")).toContainText("₱5,444.21");

    const posts = seen.filter(isImportPost);
    // eslint-disable-next-line no-console
    console.log(
      "T2-IMPORT-CALLS " + JSON.stringify(posts.map((s) => s.search.toString())),
    );
    expect(posts.map((s) => s.search.get("dryRun"))).toEqual(["true", "false"]);
    expect(posts.every((s) => s.search.get("clientId") === NON_VAT_CLIENT.id)).toBe(true);
    expect(posts.every((s) => s.contentType.startsWith("multipart/form-data"))).toBe(
      true,
    );
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 the same mixed receipt for a VAT client shows the claimable VAT split", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: [["POST", IMPORT, (r) => json(r, vatResult())]],
    });
    await openExpenseImport(page, VAT_CLIENT.id);
    await chooseFile(page);
    const row2 = page
      .getByRole("table", { name: "Import check" })
      .locator('tr[data-row-number="2"]');
    await expect(row2).toHaveCount(2);
    await expect(row2.nth(0).locator("[data-amount]")).toHaveText("₱2,952.01");
    await expect(row2.nth(0)).toContainText("₱354.24");
    await expect(row2.nth(0)).not.toContainText("VAT not claimable");
    await expect(row2.nth(1).locator("[data-amount]")).toHaveText("₱887.96");
    await expect(page.getByTestId("import-totals")).toContainText("₱4,194.21");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 Download template fetches this client's template under the server's filename", async ({
    page,
  }) => {
    const { seen, unmocked } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/purchase-transactions\/import\/template$/,
          (r) =>
            r.fulfill({
              status: 200,
              contentType: XLSX_MIME,
              // The web calls the API cross-origin, so the browser hides
              // Content-Disposition unless the API exposes it. The real API does
              // (apps/api/src/main.ts:23 enableCors exposedHeaders); the mock
              // sends what the real server sends. Without this header the
              // filename falls back to "expenses-template.xlsx" — seen in W5.
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Expose-Headers": "Content-Disposition,X-Export-Warnings",
                "Content-Disposition":
                  'attachment; filename="expenses-template-SAMPLE-BAKESHOP-v1.xlsx"',
              },
              body: expenseWorkbook(),
            }),
        ],
      ],
    });
    await openExpenseImport(page, NON_VAT_CLIENT.id);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download template" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      "expenses-template-SAMPLE-BAKESHOP-v1.xlsx",
    );
    const gets = seen.filter(
      (s) => s.path === "/api/v1/purchase-transactions/import/template",
    );
    expect(gets).toHaveLength(1);
    expect(gets[0]!.search.get("clientId")).toBe(NON_VAT_CLIENT.id);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  for (const [name, err] of [
    ["a file for another client", ERROR_CLIENT_MISMATCH],
    ["an unknown template version", ERROR_UNKNOWN_VERSION],
  ] as const) {
    test(`T2 ${name} shows the server's message verbatim and imports nothing`, async ({
      page,
    }) => {
      const { seen, unmocked } = await mockApi(page, {
        extra: [["POST", IMPORT, (r) => json(r, err.body, err.status)]],
      });
      await openExpenseImport(page, NON_VAT_CLIENT.id);
      await chooseFile(page);
      await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(
        err.body.message,
      );
      await expect(page.getByRole("button", { name: /^Import \d+ rows?$/ })).toHaveCount(
        0,
      );
      expect(seen.filter(isImportPost).map((s) => s.search.get("dryRun"))).toEqual([
        "true",
      ]);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// T3 — the Expenses status filter, Post, and the client portal
// ---------------------------------------------------------------------------

/** One legacy posted record (no status at all), one held and flagged, one
 *  posted and flagged. Since W6 the list mock filters like Track A's U6-A1
 *  server (pagedList) wherever a filter is chosen, and the firm's pages show
 *  what comes back unfiltered (the portal still drops a held record as a
 *  guard). These assertions check what each page shows for the server's
 *  answer; that each filter is ONE request with the right parameters is
 *  W6's T2 (track-b-w6.spec.ts). */
const LIST = [
  {
    id: "bbbbbbbb-0000-4000-8000-000000000001",
    txnDate: "2026-07-01",
    referenceNo: "OR-LEGACY-1",
    vendor: "INVENTED PAPER SUPPLY",
    description: "Paper",
    categoryId: "c1",
    netAmount: 500,
    isCapitalGood: false,
    deductible: true,
    source: "MANUAL",
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000002",
    txnDate: "2026-07-04",
    referenceNo: "DR-0042",
    vendor: "INVENTED WATER DELIVERY",
    description: "Water",
    categoryId: "c1",
    netAmount: 1250,
    isCapitalGood: false,
    deductible: true,
    source: "IMPORT",
    status: "held",
    needsReview: true,
  },
  {
    id: "bbbbbbbb-0000-4000-8000-000000000003",
    txnDate: "2026-07-03",
    referenceNo: "OR-0001",
    vendor: "INVENTED HARDWARE CO",
    description: "Hardware",
    categoryId: "c1",
    netAmount: 3306.25,
    isCapitalGood: false,
    deductible: true,
    source: "IMPORT",
    status: "posted",
    needsReview: true,
  },
];
const HELD = LIST[1]!;
const listBody = { data: LIST, page: 1, pageSize: 50, total: LIST.length };
const LIST_PATH = /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/;

/** A list endpoint that filters and pages like Track A's U6-A1 server (W6 R2):
 *  status=posted|held and needsReview=true|false filter (a record with no
 *  status is posted), page and pageSize (50 by default) page in the order
 *  given, and total counts every match. */
function pagedList(records: Array<Record<string, unknown>>): Handler {
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

let seq = 0;
/** An invented posted expense, `daysAgo` days before 2026-09-30. */
function expense(ref: string, daysAgo: number, extra: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `dddddddd-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    txnDate: new Date(Date.UTC(2026, 8, 30 - daysAgo)).toISOString().slice(0, 10),
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

const PORTAL_CONTEXT: [string, RegExp, Handler] = [
  "GET",
  /^\/api\/v1\/portal\/context$/,
  (r) =>
    json(r, {
      id: NON_VAT_CLIENT.id,
      businessName: NON_VAT_CLIENT.businessName,
      taxType: NON_VAT_CLIENT.taxType,
      status: "Active",
      seatLimit: null,
    }),
];

/** Every data row of the first sheet, keyed by its header. */
function sheetRows(path: string): Array<Record<string, unknown>> {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]!]!, { defval: "" });
}

test.describe("T3 Expenses status filter, Post, and the portal (hermetic)", () => {
  test("T3 Held shows only held rows, Posted none of them; Post sends one POST", async ({
    page,
  }) => {
    let posted = false;
    const { seen, unmocked } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
          (r, s) =>
            pagedList(
              LIST.map((t) =>
                posted && t.id === HELD.id ? { ...t, status: "posted" } : t,
              ),
            )(r, s),
        ],
        [
          "POST",
          /^\/api\/v1\/purchase-transactions\/[^/]+\/post$/,
          (r) => {
            posted = true;
            return json(r, { ...HELD, status: "posted" });
          },
        ],
      ],
    });
    await page.goto(`/clients/${NON_VAT_CLIENT.id}/expenses`);
    const body = page.locator("table tbody");
    await expect(body.locator("tr")).toHaveCount(3);

    const status = page.getByLabel("Status");
    const refs = async () =>
      (await body.locator("tr td:nth-child(2)").allTextContents()).sort();

    await status.selectOption("held");
    await expect(body.locator("tr")).toHaveCount(1);
    expect(await refs()).toEqual(["DR-0042"]);
    await expect(body.locator("tr").first()).toContainText("Held");
    await expect(body.locator("tr").first()).toContainText("Needs review");

    await status.selectOption("posted");
    await expect(body.locator("tr")).toHaveCount(2);
    expect(await refs()).toEqual(["OR-0001", "OR-LEGACY-1"]);
    await expect(body).not.toContainText("DR-0042");
    await expect(body).not.toContainText("Held");

    await status.selectOption("review");
    await expect(body.locator("tr")).toHaveCount(2);
    expect(await refs()).toEqual(["DR-0042", "OR-0001"]);

    // eslint-disable-next-line no-console
    console.log(
      "T3-LIST-QUERIES " +
        JSON.stringify(
          seen
            .filter(
              (s) => s.method === "GET" && s.path.endsWith("/purchase-transactions"),
            )
            .map((s) => s.search.toString()),
        ),
    );

    // Post the held row, confirming in the page (W10: never a browser dialog).
    await status.selectOption("held");
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await body.locator("tr").first().getByRole("button", { name: "Post" }).click();
    const ask = page.getByRole("dialog", { name: /^Post DR-0042/ });
    await ask.getByRole("button", { name: "Post", exact: true }).click();
    await expect(body.locator("tr")).toHaveCount(0);
    expect(dialogs).toEqual([]);

    const postCalls = seen.filter((s) => s.method === "POST" && s.path.endsWith("/post"));
    expect(postCalls.map((s) => s.path)).toEqual([
      `/api/v1/purchase-transactions/${HELD.id}/post`,
    ]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T3 declining the confirmation posts nothing", async ({ page }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
          (r) => json(r, listBody),
        ],
      ],
    });
    await page.goto(`/clients/${NON_VAT_CLIENT.id}/expenses`);
    let browserDialogs = 0;
    page.on("dialog", (d) => {
      browserDialogs += 1;
      void d.dismiss();
    });
    await page.getByRole("button", { name: "Post" }).click();
    // Declined in the page (W10): the confirmation came and went, and the row
    // is back at rest — still held, its button still "Post" (W6 R3).
    const ask = page.getByRole("dialog", { name: /^Post / });
    await ask.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(ask).toBeHidden();
    expect(browserDialogs).toBe(0);
    await expect(page.getByRole("button", { name: "Post" })).toBeEnabled();
    await quiet();
    expect(seen.filter((s) => s.method === "POST")).toHaveLength(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T3 /portal/expenses never shows a held row", async ({ page }) => {
    const { seen, unmocked } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [
        [
          "GET",
          /^\/api\/v1\/portal\/context$/,
          (r) =>
            json(r, {
              id: NON_VAT_CLIENT.id,
              businessName: NON_VAT_CLIENT.businessName,
              taxType: NON_VAT_CLIENT.taxType,
              status: "Active",
              seatLimit: null,
            }),
        ],
        ["GET", LIST_PATH, pagedList(LIST)],
      ],
    });
    await page.goto("/portal/expenses");
    const body = page.locator("table tbody");
    await expect(body.locator("tr")).toHaveCount(2);
    await expect(page.locator("body")).not.toContainText("DR-0042");
    await expect(page.locator("body")).not.toContainText("INVENTED WATER DELIVERY");
    await expect(page.locator("body")).not.toContainText("Held");
    await expect(page.getByText("2 record(s)")).toBeVisible();
    const q = seen.find((s) => s.path.endsWith("/purchase-transactions"));
    expect(q?.search.get("status")).toBe("posted");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T3 a held row past the server's first page shows under Held; Posted counts exactly", async ({
    page,
  }) => {
    // 55 posted records, newest first, then one held record older than all of
    // them: it would sit on an unfiltered second page. Since W6 the page asks
    // the server for status=held and gets it back on the first.
    const posted = Array.from({ length: 55 }, (_, i) => expense(`OR-P${i + 1}`, i));
    const held = expense("DR-OLD", 80, { status: "held", needsReview: true });
    const { unmocked } = await mockApi(page, {
      extra: [["GET", LIST_PATH, pagedList([...posted, held])]],
    });
    await page.goto(`/clients/${NON_VAT_CLIENT.id}/expenses`);
    const body = page.locator("table tbody");
    const status = page.getByLabel("Status");

    // All shows the server's first page, as before W5.
    await expect(body.locator("tr")).toHaveCount(50);
    await expect(page.getByText("56 record(s)", { exact: true })).toBeVisible();

    await status.selectOption("held");
    await expect(body.locator("tr")).toHaveCount(1);
    await expect(body.locator("tr").first()).toContainText("DR-OLD");
    await expect(
      body.locator("tr").first().getByRole("button", { name: "Post" }),
    ).toBeVisible();
    await expect(page.getByText("1 shown · Held", { exact: true })).toBeVisible();

    await status.selectOption("posted");
    await expect(body.locator("tr")).toHaveCount(50);
    await expect(body).not.toContainText("DR-OLD");
    await expect(
      page.getByText("50 of 55 shown · Posted", { exact: true }),
    ).toBeVisible();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T3 the portal hides held rows on every page and counts only posted ones", async ({
    page,
  }) => {
    // 60 held records newer than the client's 10 posted ones: an unfiltered
    // first page would be all held. Since W6 the portal asks the server for
    // status=posted, and its count is the server's total.
    const held = Array.from({ length: 60 }, (_, i) =>
      expense(`DR-H${i + 1}`, i, { status: "held", needsReview: true }),
    );
    const posted = Array.from({ length: 10 }, (_, i) => expense(`OR-P${i + 1}`, 70 + i));
    const { unmocked } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [PORTAL_CONTEXT, ["GET", LIST_PATH, pagedList([...held, ...posted])]],
    });
    await page.goto("/portal/expenses");
    const body = page.locator("table tbody");
    await expect(body.locator("tr")).toHaveCount(10);
    await expect(page.getByText("10 record(s)", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("DR-H");
    await expect(page.locator("body")).not.toContainText("Held");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T3 Export follows the Status filter and says which rows are held", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: [["GET", LIST_PATH, pagedList(LIST)]],
    });
    await page.goto(`/clients/${NON_VAT_CLIENT.id}/expenses`);
    const body = page.locator("table tbody");
    const status = page.getByLabel("Status");
    const exportRows = async () => {
      const [file] = await Promise.all([
        page.waitForEvent("download"),
        page.getByRole("button", { name: "Export", exact: true }).click(),
      ]);
      const path = (await file.path())!;
      expect(headerRow(path).slice(-2)).toEqual(["Status", "Needs review"]);
      return sheetRows(path).map((r) => [
        r["Reference Number*"],
        r["Status"],
        r["Needs review"],
      ]);
    };

    await status.selectOption("posted");
    await expect(body.locator("tr")).toHaveCount(2);
    expect(await exportRows()).toEqual([
      ["OR-LEGACY-1", "Posted", ""],
      ["OR-0001", "Posted", "Yes"],
    ]);

    await status.selectOption("all");
    await expect(body.locator("tr")).toHaveCount(3);
    expect(await exportRows()).toEqual([
      ["OR-LEGACY-1", "Posted", ""],
      ["DR-0042", "Held", "Yes"],
      ["OR-0001", "Posted", "Yes"],
    ]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T4 — the Sales import is unchanged: it still parses in the browser and posts
// JSON rows to its existing endpoint. Only the header text changed (R4).
// ---------------------------------------------------------------------------

const SALES_ROW_VALUES = [
  "2026-07-05",
  "400-500-600-00000",
  "INVENTED CAFE CUSTOMER",
  "SI-0007",
  "WI010",
  "VT",
  "Consulting",
  "Bookkeeping, July",
  1120,
];
/** What the Sales import posted for SALES_ROW_VALUES before W5 — whichever
 *  spelling of the counterparty columns the file used. */
const SALES_EXPECTED_ROWS = [
  {
    Date: "2026-07-05",
    CustomerTIN: "400-500-600-00000",
    Customer: "INVENTED CAFE CUSTOMER",
    ReferenceNo: "SI-0007",
    ATC: "WI010",
    TaxType: "VT",
    Category: "Consulting",
    Description: "Bookkeeping, July",
    Amount: "1120",
  },
];

test.describe("T4 Sales import regression guard (hermetic)", () => {
  for (const [label, tin, name] of [
    ["the new headers", "Customer TIN*", "Customer Name*"],
    ["the old headers", "Vendor TIN*", "Vendor Name*"],
  ] as const) {
    test(`T4 a Sales file with ${label} parses in the browser and posts JSON rows`, async ({
      page,
    }) => {
      const { seen, unmocked } = await mockApi(page, {
        extra: [
          [
            "POST",
            /^\/api\/v1\/clients\/[^/]+\/income-transactions\/import$/,
            (r) => json(r, { created: 1, failed: 0, errors: [] }),
          ],
        ],
      });
      await page.goto(`/clients/${NON_VAT_CLIENT.id}/sales`);
      await page.getByRole("button", { name: "Import", exact: true }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: "sales.xlsx",
        mimeType: XLSX_MIME,
        buffer: workbook("SALES", [
          [
            "Date*",
            tin,
            name,
            "Invoice Number*",
            "Tax Code*",
            "Tax Type*",
            "Category",
            "Description",
            "Amount*",
          ],
          SALES_ROW_VALUES,
        ]),
      });
      // The browser parsed it: the preview shows the row before anything is sent.
      await expect(page.getByText("1 ready")).toBeVisible();
      await expect(page.getByText("INVENTED CAFE CUSTOMER")).toBeVisible();
      expect(seen.filter((s) => s.method === "POST")).toHaveLength(0);

      await page.getByRole("button", { name: "Import 1 row" }).click();
      await expect(page.getByText("record imported")).toBeVisible();

      const posts = seen.filter((s) => s.method === "POST");
      expect(posts.map((s) => s.path)).toEqual([
        `/api/v1/clients/${NON_VAT_CLIENT.id}/income-transactions/import`,
      ]);
      expect(posts[0]!.contentType).toBe("application/json");
      expect(JSON.parse(posts[0]!.request.postData() ?? "{}")).toEqual({
        rows: SALES_EXPECTED_ROWS,
      });
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }

  test("T4 the Sales template and export carry the customer headers, nothing stray", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/clients\/[^/]+\/income-transactions$/,
          (r) =>
            json(r, {
              data: [
                {
                  id: "cccccccc-0000-4000-8000-000000000001",
                  txnDate: "2026-07-05",
                  referenceNo: "SI-0007",
                  customer: "INVENTED CAFE CUSTOMER",
                  customerTin: "400-500-600-00000",
                  description: "Bookkeeping, July",
                  categoryId: "c1",
                  netAmount: 1000,
                  outputVAT: 120,
                  vatClass: "VATABLE",
                  saleToGovernment: false,
                  source: "MANUAL",
                },
              ],
              page: 1,
              pageSize: 200,
              total: 1,
            }),
        ],
      ],
    });
    const expected = [
      "Date*",
      "Customer TIN*",
      "Customer Name*",
      // W3 F19: these three said "Vendor …" until W3.
      "Customer Lastname",
      "Customer Firstname",
      "Customer Middlename",
      "Address",
      "City",
      "Postal Code*",
      "Invoice Number*",
      "Reference Number*",
      "Tax Code*",
      "Tax Type*",
      "Category",
      "Description",
      "Amount*",
      "COA Code*",
    ];
    await page.goto(`/clients/${NON_VAT_CLIENT.id}/sales`);

    const [exportFile] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export", exact: true }).click(),
    ]);
    expect(headerRow((await exportFile.path())!)).toEqual(expected);

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const [template] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download blank template" }).click(),
    ]);
    expect(template.suggestedFilename()).toBe("sales-template.xlsx");
    expect(headerRow((await template.path())!)).toEqual(expected);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

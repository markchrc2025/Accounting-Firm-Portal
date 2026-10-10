// track-b-w12.spec.ts — hermetic browser tests for W12: scan receipts, part 1.
// Staff send a pile of receipt photos with its cost shown first (R2, R3), see
// their piles (R4), and review each receipt beside its photo, read-only (R5).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks built on Track A U11's contract (as written in the W12 brief); any
// call the table does not cover is recorded and FAILS the test. The signed
// photo URLs point at an invented host the test answers itself. The browser
// clock is fixed per test.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222c1";

const CLIENT = {
  id: "c1200000-0000-4000-8000-0000000000c1",
  businessName: "INVENTED TWELVE HARDWARE",
  tin: "000-121-012-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};
const OTHER_CLIENT = {
  id: "c1200000-0000-4000-8000-0000000000c2",
  businessName: "INVENTED VIEW-ONLY CAFE",
  tin: "000-121-013-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const FIRM_ME = {
  user: {
    id: "u1200000-0000-4000-8000-0000000000c1",
    email: "encoder@example.test",
    fullName: "Test Encoder",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: ["Clients:Read", "Expenses:Read"],
    clients: [
      {
        clientId: CLIENT.id,
        permissions: ["Expenses:Read", "Expenses:Create"],
      },
      { clientId: OTHER_CLIENT.id, permissions: ["Expenses:Read"] },
    ],
    assignedClientIds: [CLIENT.id, OTHER_CLIENT.id],
    canViewAllClients: false,
  },
};
const PORTAL_ME = {
  user: {
    id: "u1200000-0000-4000-8000-0000000000c2",
    email: "owner@example.test",
    fullName: "Portal Owner",
    userType: "CLIENT",
    firmId: FIRM_ID,
    clientId: CLIENT.id,
    mfaEnabled: true,
  },
  permissions: {
    global: ["Expenses:Read", "Expenses:Create", "Sales:Read"],
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

/** A 1×1 PNG, for the photos. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PHOTO_HOST = "https://photos.example.test";

async function mockApi(page: Page, opts: { me?: Me; extra?: Entry[] } = {}) {
  const me = opts.me ?? FIRM_ME;
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
  // Re-armable "nothing in flight": no request pending and none started for
  // 500 ms of the test runner's own (real) time.
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
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT, OTHER_CLIENT])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+$/,
      (r, s) => json(r, s.path.includes(OTHER_CLIENT.id) ? OTHER_CLIENT : CLIENT),
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
  // The signed photo URLs (an invented host).
  await page.route(`${PHOTO_HOST}/**`, (route) =>
    route.request().url().includes(".pdf")
      ? route.fulfill({ status: 200, contentType: "application/pdf", body: PDF })
      : route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
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

const calls = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path));

// ---------------------------------------------------------------------------
// The contract's shapes (U11), invented values
// ---------------------------------------------------------------------------

const STATUS = /^\/api\/v1\/ai\/status$/;
const ESTIMATE = /^\/api\/v1\/ai\/estimate$/;
const SCANS = /^\/api\/v1\/receipt-scans$/;
const SCAN = /^\/api\/v1\/receipt-scans\/[^/]+$/;

function aiStatus(over: Record<string, unknown> = {}) {
  return {
    configured: true,
    enabled: true,
    month: "2026-10",
    budgetUsd: 25,
    spentUsd: 5,
    reservedUsd: 1,
    remainingUsd: 19,
    warning: false,
    usdToPhp: 62.77,
    model: "invented-model",
    ...over,
  };
}
const statusApi = (over: Record<string, unknown> = {}): Entry => [
  "GET",
  STATUS,
  (r) => json(r, aiStatus(over)),
];

const SCAN_ID = "5c120000-0000-4000-8000-0000000000c1";

function summary(over: Record<string, unknown> = {}) {
  return {
    id: SCAN_ID,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    periodFrom: "2026-07-01",
    periodTo: "2026-09-30",
    status: "ready",
    model: "invented-model",
    fileCount: 4,
    rowCount: 3,
    estimatedUsd: 0.4,
    actualUsd: 0.25,
    createdAt: "2026-10-10T01:15:00.000Z",
    createdByName: "Test Encoder",
    readyAt: "2026-10-10T01:45:00.000Z",
    problem: null,
    ...over,
  };
}

const HEADERS = [
  "Date",
  "Document Type",
  "Vendor TIN",
  "Vendor Branch",
  "Vendor Registered Name",
  "Vendor Lastname",
  "Vendor Firstname",
  "Vendor Middlename",
  "Trade Name",
  "Address",
  "City",
  "Province",
  "Postal Code",
  "Reference Number",
  "Vatable Amount",
  "VAT Amount",
  "VAT-Exempt Amount",
  "Zero-rated Amount",
  "Other Non-vatable",
  "Gross Total",
  "Description",
  "COA Code",
  "ATC",
  "Withholding Amount",
  "Source File",
  "Needs Review",
  "Remarks",
] as const;

function cells(over: Partial<Record<(typeof HEADERS)[number], string | number | null>>) {
  const out: Record<string, string | number | null> = {};
  for (const h of HEADERS) out[h] = null;
  return {
    ...out,
    Date: "2026-08-14",
    "Document Type": "OFFICIAL_RECEIPT",
    "Vendor TIN": "000-999-111-00000",
    "Vendor Registered Name": "INVENTED NAILS AND BOLTS SUPPLY",
    Address: "1 Invented Street",
    City: "Invented City",
    "Reference Number": "OR-7781",
    "Vatable Amount": 1000,
    "VAT Amount": 120,
    "Gross Total": 1120,
    Description: "Invented hardware supplies",
    "COA Code": "6001",
    "Source File": "receipt-1.jpg",
    "Needs Review": "N",
    ...over,
  };
}

const DOUBT_REASON = "INVENTED DOUBT: the last digits of the TIN are smudged.";
const HELD_MESSAGE = "INVENTED: no COA code, so the row will be held for a person.";
const REJECTED_MESSAGE = "INVENTED: the Gross Total does not equal the amounts.";
const COPY_PROBLEM = "INVENTED: this photo shows the same receipt as receipt-1.jpg.";
const NOT_RECEIPT_PROBLEM = "INVENTED: this file shows a menu, not a receipt.";

function detail(over: { scan?: Record<string, unknown>; files?: unknown[] } = {}) {
  return {
    scan: summary(over.scan),
    files: over.files ?? [
      {
        id: "f1",
        name: "receipt-1.jpg",
        contentType: "image/jpeg",
        bytes: 120_000,
        imageUrl: `${PHOTO_HOST}/f1.jpg?sig=invented`,
        result: "read",
        problem: null,
        rows: [
          {
            id: "r1",
            cells: cells({}),
            doubts: [{ field: "Vendor TIN", reason: DOUBT_REASON }],
            check: { outcome: "posted", needsReview: false, messages: [] },
          },
        ],
      },
      {
        id: "f2",
        name: "receipt-2.png",
        contentType: "image/png",
        bytes: 98_000,
        imageUrl: `${PHOTO_HOST}/f2.png?sig=invented`,
        result: "read",
        problem: null,
        rows: [
          {
            id: "r2",
            cells: cells({
              "Reference Number": "SI-0042",
              "COA Code": null,
              "Needs Review": "Y",
              "Source File": "receipt-2.png",
            }),
            doubts: [],
            check: { outcome: "held", needsReview: true, messages: [HELD_MESSAGE] },
          },
          {
            id: "r3",
            cells: cells({
              "Reference Number": "SI-0043",
              "Gross Total": 999,
              "Source File": "receipt-2.png",
            }),
            doubts: [],
            check: {
              outcome: "rejected",
              needsReview: false,
              messages: [REJECTED_MESSAGE],
            },
          },
        ],
      },
      {
        id: "f3",
        name: "receipt-3.jpg",
        contentType: "image/jpeg",
        bytes: 120_000,
        imageUrl: `${PHOTO_HOST}/f3.jpg?sig=invented`,
        result: "copy-of-another-file",
        problem: COPY_PROBLEM,
        rows: [],
      },
      {
        id: "f4",
        name: "menu.pdf",
        contentType: "application/pdf",
        bytes: 220_000,
        imageUrl: `${PHOTO_HOST}/f4.pdf?sig=invented`,
        result: "not-a-receipt",
        problem: NOT_RECEIPT_PROBLEM,
        rows: [],
      },
    ],
    totals: { files: 4, rows: 3, posted: 1, held: 1, rejected: 1, grossAmount: 3239 },
  };
}

// ---------------------------------------------------------------------------
// T1 — send a pile with its cost shown first (R1–R3)
// ---------------------------------------------------------------------------

const BUDGET_LINE = "₱1,192.63 left of ₱1,569.25 this month (US$19.00 of US$25.00)";

const images = (n: number, bytes = 2048) =>
  Array.from({ length: n }, (_, i) => ({
    name: `receipt-${i + 1}.jpg`,
    mimeType: "image/jpeg",
    buffer: Buffer.alloc(bytes, i + 1),
  }));

async function chooseClient(page: Page) {
  await page.getByLabel("Client").selectOption(CLIENT.id);
}

test.describe("T1 send a pile with its cost shown first (hermetic)", () => {
  test("T1 the status strip shows what is left this month in pesos and dollars", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [statusApi(), ["GET", SCANS, (r) => json(r, [])]],
    });
    await page.goto("/receipt-scans");
    await expect(page.locator("[data-ai-budget]")).toHaveText(BUDGET_LINE);
    await expect(page.locator("[data-ai-warning]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T1 choosing 3 images asks for the estimate and shows the sentence", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [
        statusApi(),
        ["GET", SCANS, (r) => json(r, [])],
        [
          "GET",
          ESTIMATE,
          (r) => json(r, { estimatedUsd: 0.12, remainingUsd: 19, fits: true }),
        ],
      ],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await page.getByLabel("Receipt photos").setInputFiles(images(3));
    await expect(page.locator("[data-scan-estimate]")).toHaveText(
      "About ₱7.53 (US$0.12) for 3 files. Results usually within the hour; at the latest by tomorrow.",
    );
    await quiet();
    const est = calls(seen, "GET", ESTIMATE);
    expect(est.map((s) => s.search.toString())).toEqual(["images=3&pdfs=0"]);
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
    clean(unmocked, dialogs);
  });

  test("T1 Send posts the pile as multipart with the client and the last quarter that ended, then opens it", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [
        statusApi(),
        ["GET", SCANS, (r) => json(r, [])],
        [
          "GET",
          ESTIMATE,
          (r) => json(r, { estimatedUsd: 0.12, remainingUsd: 19, fits: true }),
        ],
        [
          "POST",
          SCANS,
          (r) =>
            json(r, summary({ status: "reading", fileCount: 3, actualUsd: null }), 201),
        ],
        ["GET", SCAN, (r) => json(r, detail({ scan: { status: "reading" }, files: [] }))],
      ],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-07-01");
    await expect(page.getByLabel("To", { exact: true })).toHaveValue("2026-09-30");
    await page.getByLabel("Receipt photos").setInputFiles(images(3));
    await expect(page.locator("[data-scan-estimate]")).toBeVisible();
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/receipt-scans/${SCAN_ID}$`));
    await quiet();
    const posts = calls(seen, "POST", SCANS);
    expect(posts).toHaveLength(1);
    const post = posts[0]!;
    expect(Object.fromEntries(post.search)).toEqual({
      clientId: CLIENT.id,
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    expect(post.request.headers()["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    const body = post.request.postDataBuffer()!.toString("latin1");
    const parts = body.match(
      /Content-Disposition: form-data; name="files"; filename="[^"]+"/g,
    );
    expect(parts).toEqual([
      'Content-Disposition: form-data; name="files"; filename="receipt-1.jpg"',
      'Content-Disposition: form-data; name="files"; filename="receipt-2.jpg"',
      'Content-Disposition: form-data; name="files"; filename="receipt-3.jpg"',
    ]);
    clean(unmocked, dialogs);
  });

  test("T1 a 409 from the server shows its message word for word", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const MESSAGE =
      "INVENTED: this pile is estimated at US$0.40 (₱25.11) but only US$0.10 (₱6.28) is left this month.";
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [
        statusApi(),
        ["GET", SCANS, (r) => json(r, [])],
        [
          "GET",
          ESTIMATE,
          (r) => json(r, { estimatedUsd: 0.12, remainingUsd: 19, fits: true }),
        ],
        ["POST", SCANS, (r) => json(r, { message: MESSAGE }, 409)],
      ],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await page.getByLabel("Receipt photos").setInputFiles(images(3));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("[data-scan-error]")).toHaveText(MESSAGE);
    await expect(page).toHaveURL(/\/receipt-scans$/);
    await quiet();
    expect(calls(seen, "POST", SCANS)).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T1 a 400 and a 503 show their messages word for word", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    let status = 400;
    const words: Record<number, string> = {
      400: "INVENTED: receipt-2.jpg is not a JPEG, PNG, WebP, PDF or HEIC file.",
      503: "INVENTED: AI reading is not available right now.",
    };
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [
        statusApi(),
        ["GET", SCANS, (r) => json(r, [])],
        [
          "GET",
          ESTIMATE,
          (r) => json(r, { estimatedUsd: 0.12, remainingUsd: 19, fits: true }),
        ],
        ["POST", SCANS, (r) => json(r, { message: words[status] }, status)],
      ],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await page.getByLabel("Receipt photos").setInputFiles(images(3));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("[data-scan-error]")).toHaveText(words[400]!);
    status = 503;
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("[data-scan-error]")).toHaveText(words[503]!);
    clean(unmocked, dialogs);
  });

  test("T1 when the pile does not fit, the panel says what is left and Send stays off", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [
        statusApi({ spentUsd: 24.9, reservedUsd: 0, remainingUsd: 0.1, warning: true }),
        ["GET", SCANS, (r) => json(r, [])],
        [
          "GET",
          ESTIMATE,
          (r) => json(r, { estimatedUsd: 0.4, remainingUsd: 0.1, fits: false }),
        ],
      ],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await page.getByLabel("Receipt photos").setInputFiles(images(3));
    await expect(page.locator("[data-scan-estimate]")).toContainText(
      "About ₱25.11 (US$0.40) for 3 files.",
    );
    await expect(page.locator("[data-scan-nofit]")).toHaveText(
      "This pile does not fit this month's AI budget: only ₱6.28 (US$0.10) is left.",
    );
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await quiet();
    expect(calls(seen, "POST", SCANS)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T1 the sidebar offers Scan receipts right after Expenses, only to a firm user who may add expenses", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [
        statusApi(),
        ["GET", SCANS, (r) => json(r, [])],
        ["GET", /^\/api\/v1\/clients\/[^/]+\/.*$/, (r) => json(r, [])],
      ],
    });
    await page.goto("/receipt-scans");
    await expect(page.getByRole("link", { name: "Scan receipts" })).toBeVisible();
    const nav = page.locator("aside nav a");
    const labels = await nav.allTextContents();
    const at = labels.indexOf("Expenses");
    expect(at).toBeGreaterThan(-1);
    expect(labels[at + 1]).toBe("Scan receipts");
    await expect(page.getByRole("link", { name: "Scan receipts" })).toHaveAttribute(
      "href",
      /^\/receipt-scans/,
    );
    // The picker offers only the clients this user may add expenses to.
    const options = await page.getByLabel("Client").locator("option").allTextContents();
    expect(options).toContain(CLIENT.businessName);
    expect(options).not.toContain(OTHER_CLIENT.businessName);
    clean(unmocked, dialogs);
  });

  test("T1 a client principal never sees Scan receipts, and the route sends it home", async ({
    page,
  }) => {
    // The portal home loads its own figures once the route sends the user there.
    const { unmocked, dialogs } = await mockApi(page, {
      me: PORTAL_ME,
      extra: [
        [
          "GET",
          /^\/api\/v1\/clients\/[^/]+\/(income|purchase)-transactions\/summary$/,
          (r) =>
            json(r, {
              totalNet: 0,
              totalOutputVAT: 0,
              totalInputVAT: 0,
              deductibleNet: 0,
            }),
        ],
        ["GET", /^\/api\/v1\/clients\/[^/]+\/filings$/, (r) => json(r, [])],
        [
          "GET",
          /^\/api\/v1\/clients\/[^/]+\/tax-estimate$/,
          (r) => json(r, { incomeTax: { due: 0 } }),
        ],
      ],
    });
    await page.goto("/receipt-scans");
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByRole("link", { name: "Scan receipts" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T2 — the review screen, read-only (R5)
// ---------------------------------------------------------------------------

const REVIEW = `/receipt-scans/${SCAN_ID}`;

async function openReview(page: Page, body = detail()) {
  await manilaClock(page, "2026-10-10T10:00:00");
  const api = await mockApi(page, {
    extra: [statusApi(), ["GET", SCAN, (r) => json(r, body)]],
  });
  await page.goto(REVIEW);
  await expect(page.locator("[data-file-name]")).toHaveText("receipt-1.jpg");
  return api;
}

test.describe("T2 the review screen (hermetic)", () => {
  test("T2 the photo shows beside its row, in the five groups, with all 27 columns", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await openReview(page);
    const photo = page.getByRole("img", { name: "receipt-1.jpg" });
    await expect(photo).toBeVisible();
    await expect(photo).toHaveAttribute("src", `${PHOTO_HOST}/f1.jpg?sig=invented`);
    await expect
      .poll(() => photo.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBe(1);
    const row = page.locator("[data-scan-row]").first();
    for (const g of ["Receipt", "Vendor", "Amounts", "Booking", "Review"]) {
      await expect(row.getByRole("heading", { name: g, exact: true })).toBeVisible();
    }
    await expect(row.locator("[data-field]")).toHaveCount(27);
    await expect(row.locator('[data-field="Vendor Registered Name"]')).toContainText(
      "INVENTED NAILS AND BOLTS SUPPLY",
    );
    await expect(row.locator('[data-field="Gross Total"]')).toContainText("₱1,120.00");
    await expect(row.locator('[data-field="Trade Name"]')).toContainText("—");
    clean(unmocked, dialogs);
  });

  test("T2 a doubted field is amber, with its reason under it", async ({ page }) => {
    const { unmocked, dialogs } = await openReview(page);
    const tin = page.locator('[data-field="Vendor TIN"]');
    await expect(tin).toHaveAttribute("data-doubt", "true");
    await expect(tin.locator("[data-doubt-reason]")).toHaveText(DOUBT_REASON);
    await expect(page.locator('[data-field][data-doubt="true"]')).toHaveCount(1);
    await expect(page.locator('[data-field="Date"]')).not.toHaveAttribute(
      "data-doubt",
      "true",
    );
    clean(unmocked, dialogs);
  });

  test("T2 the chips read Will post, Will be held and Will be rejected, with their messages", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await openReview(page);
    await expect(page.locator("[data-check]")).toHaveText(["Will post"]);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.locator("[data-file-name]")).toHaveText("receipt-2.png");
    await expect(page.locator("[data-check]")).toHaveText([
      "Will be held",
      "Will be rejected",
    ]);
    const rows = page.locator("[data-scan-row]");
    await expect(rows.nth(0).locator("[data-check-messages] li")).toHaveText([
      HELD_MESSAGE,
    ]);
    await expect(rows.nth(0).getByText("Needs review", { exact: true })).toBeVisible();
    await expect(rows.nth(1).locator("[data-check-messages] li")).toHaveText([
      REJECTED_MESSAGE,
    ]);
    clean(unmocked, dialogs);
  });

  test("T2 the buttons and the arrow keys move between files; problems show instead of rows", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await openReview(page);
    const name = page.locator("[data-file-name]");
    await expect(
      page.getByRole("button", { name: "Previous", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("ArrowRight");
    await expect(name).toHaveText("receipt-2.png");
    await page.keyboard.press("ArrowRight");
    await expect(name).toHaveText("receipt-3.jpg");
    await expect(page.locator("[data-file-problem]")).toHaveText(COPY_PROBLEM);
    await expect(page.locator("[data-scan-row]")).toHaveCount(0);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(name).toHaveText("menu.pdf");
    await expect(page.locator("[data-file-problem]")).toHaveText(NOT_RECEIPT_PROBLEM);
    // A PDF opens in the browser's own viewer from the same URL.
    await expect(page.locator('iframe[title="menu.pdf"]')).toHaveAttribute(
      "src",
      `${PHOTO_HOST}/f4.pdf?sig=invented`,
    );
    await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
    await page.keyboard.press("ArrowLeft");
    await expect(name).toHaveText("receipt-3.jpg");
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(name).toHaveText("receipt-2.png");
    // The file list down the side: each file's result, and a click opens it.
    const list = page.getByRole("navigation", { name: "Files" });
    await expect(list.getByRole("button")).toHaveText([
      /receipt-1\.jpg\s*1 receipt/,
      /receipt-2\.png\s*2 receipts/,
      /receipt-3\.jpg\s*Copy of another file/,
      /menu\.pdf\s*Not a receipt/,
    ]);
    await list.getByRole("button", { name: /menu\.pdf/ }).click();
    await expect(name).toHaveText("menu.pdf");
    clean(unmocked, dialogs);
  });

  test("T2 the totals bar equals the response's totals", async ({ page }) => {
    const { unmocked, dialogs } = await openReview(page);
    const t = page.locator("[data-scan-totals]");
    await expect(t.locator("[data-total=files]")).toHaveText("4");
    await expect(t.locator("[data-total=rows]")).toHaveText("3");
    await expect(t.locator("[data-total=posted]")).toHaveText("1");
    await expect(t.locator("[data-total=held]")).toHaveText("1");
    await expect(t.locator("[data-total=rejected]")).toHaveText("1");
    await expect(t.locator("[data-total=gross]")).toHaveText("₱3,239.00");
    clean(unmocked, dialogs);
  });

  test("T2 the photo zooms, rotates and fits to width", async ({ page }) => {
    const { unmocked, dialogs } = await openReview(page);
    const photo = page.getByRole("img", { name: "receipt-1.jpg" });
    const style = () => photo.getAttribute("style");
    await expect(photo).toHaveAttribute("data-zoom", "1");
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect(photo).toHaveAttribute("data-zoom", "1.25");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect(photo).toHaveAttribute("data-zoom", "0.75");
    await page.getByRole("button", { name: "Rotate" }).click();
    await expect(photo).toHaveAttribute("data-rotation", "90");
    expect(await style()).toContain("rotate(90deg)");
    await page.getByRole("button", { name: "Fit to width" }).click();
    await expect(photo).toHaveAttribute("data-zoom", "1");
    clean(unmocked, dialogs);
  });

  test("T2 the review screen offers no editing, approving or discarding", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await openReview(page);
    for (const verb of ["Approve", "Discard", "Edit", "Save"]) {
      await expect(page.getByRole("button", { name: new RegExp(verb) })).toHaveCount(0);
    }
    await expect(page.locator("main input, main textarea, main select")).toHaveCount(0);
    await quiet();
    expect(seen.filter((s) => s.method !== "GET" && !/auth/.test(s.path))).toEqual([]);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T3 — states (R2–R5)
// ---------------------------------------------------------------------------

test.describe("T3 states (hermetic)", () => {
  test("T3 not set up: the strip says so and the upload panel is disabled", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [statusApi({ configured: false }), ["GET", SCANS, (r) => json(r, [])]],
    });
    await page.goto("/receipt-scans");
    await expect(
      page.getByText(
        "AI reading isn't set up yet. The Super Admin adds the key to the API service.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Receipt photos")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    clean(unmocked, dialogs);
  });

  test("T3 switched off: the strip says so and the upload panel is disabled", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [statusApi({ enabled: false }), ["GET", SCANS, (r) => json(r, [])]],
    });
    await page.goto("/receipt-scans");
    await expect(
      page.getByText("AI reading is switched off in Settings.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Receipt photos")).toBeDisabled();
    await expect(page.getByLabel("Client")).toBeDisabled();
    clean(unmocked, dialogs);
  });

  test("T3 the 80% warning shows in amber on both pages", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [
        statusApi({ spentUsd: 19, reservedUsd: 1.5, remainingUsd: 4.5, warning: true }),
        ["GET", SCANS, (r) => json(r, [])],
        ["GET", SCAN, (r) => json(r, detail())],
      ],
    });
    await page.goto("/receipt-scans");
    const warning = page.locator("[data-ai-warning]");
    await expect(warning).toHaveText("80% of this month's AI budget is used.");
    await expect(warning).toHaveClass(/text-warn/);
    await expect(page.locator("[data-ai-budget]")).toHaveText(
      "₱282.47 left of ₱1,569.25 this month (US$4.50 of US$25.00)",
    );
    await page.goto(REVIEW);
    await expect(page.locator("[data-ai-warning]")).toHaveText(
      "80% of this month's AI budget is used.",
    );
    clean(unmocked, dialogs);
  });

  test("T3 the piles list: client, period, files, status, cost and who sent it", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const piles = [
      summary({
        id: "p1",
        status: "reading",
        actualUsd: null,
        estimatedUsd: 0.4,
        readyAt: null,
      }),
      summary({ id: "p2", status: "ready", actualUsd: 0.25 }),
      summary({
        id: "p3",
        status: "failed",
        actualUsd: 0.05,
        problem: "INVENTED: the AI service did not answer.",
      }),
      summary({ id: "p4", status: "approved" }),
      summary({ id: "p5", status: "discarded" }),
    ];
    const { unmocked, dialogs } = await mockApi(page, {
      extra: [
        statusApi(),
        ["GET", SCANS, (r) => json(r, piles)],
        ["GET", SCAN, (r) => json(r, detail())],
      ],
    });
    await page.goto("/receipt-scans");
    const rows = page.locator("[data-scan-id]");
    await expect(rows).toHaveCount(5);
    await expect(page.locator("[data-scan-status]")).toHaveText([
      "Reading",
      "Ready for review",
      "Failed",
      "Approved",
      "Discarded",
    ]);
    const first = rows.nth(0);
    await expect(first).toContainText(CLIENT.businessName);
    await expect(first).toContainText("2026-07-01 – 2026-09-30");
    await expect(first).toContainText("4");
    await expect(first).toContainText("Test Encoder");
    await expect(first.locator("[data-scan-cost]")).toHaveText(
      "About ₱25.11US$0.40 estimated",
    );
    await expect(rows.nth(1).locator("[data-scan-cost]")).toHaveText("₱15.69US$0.25");
    await expect(rows.nth(2)).toContainText("INVENTED: the AI service did not answer.");
    await rows.nth(1).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/receipt-scans\/p2$/);
    clean(unmocked, dialogs);
  });

  test("T3 a reading pile refetches every 60 seconds and stops once it is ready", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-10T10:00:00+08:00") });
    let listCalls = 0;
    const { unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [
        statusApi(),
        [
          "GET",
          SCANS,
          (r) => {
            listCalls += 1;
            return json(r, [
              summary({
                status: listCalls >= 2 ? "ready" : "reading",
                actualUsd: listCalls >= 2 ? 0.25 : null,
              }),
            ]);
          },
        ],
      ],
    });
    await page.goto("/receipt-scans");
    await expect(page.locator("[data-scan-status]")).toHaveText(["Reading"]);
    await quiet();
    expect(listCalls).toBe(1);
    // install() lets time keep flowing, so a second or two of real time passes
    // between the first fetch and here: nothing by 55 s, a refetch by 65 s.
    await page.clock.runFor(55_000);
    await quiet();
    expect(listCalls).toBe(1);
    await page.clock.runFor(10_000);
    await expect(page.locator("[data-scan-status]")).toHaveText(["Ready for review"]);
    await quiet();
    expect(listCalls).toBe(2);
    await page.clock.runFor(180_000);
    await quiet();
    expect(listCalls).toBe(2);
    clean(unmocked, dialogs);
  });

  test("T3 a null imageUrl shows its sentence, and a pending file says it is still reading", async ({
    page,
  }) => {
    const body = detail({
      scan: { status: "ready" },
      files: [
        {
          id: "f1",
          name: "receipt-1.jpg",
          contentType: "image/jpeg",
          bytes: 120_000,
          imageUrl: null,
          result: "read",
          problem: null,
          rows: [
            {
              id: "r1",
              cells: cells({}),
              doubts: [],
              check: { outcome: "posted", needsReview: false, messages: [] },
            },
          ],
        },
        {
          id: "f2",
          name: "receipt-2.jpg",
          contentType: "image/jpeg",
          bytes: 120_000,
          imageUrl: `${PHOTO_HOST}/f2.jpg?sig=invented`,
          result: "pending",
          problem: null,
          rows: [],
        },
      ],
    });
    const { unmocked, dialogs } = await openReview(page, body);
    await expect(
      page.getByText("The photo is not available.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("img", { name: "receipt-1.jpg" })).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-file-name]")).toHaveText("receipt-2.jpg");
    await expect(page.locator("[data-file-problem]")).toHaveText("Still reading.");
    clean(unmocked, dialogs);
  });

  test("T3 101 files are refused locally, with nothing sent", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [statusApi(), ["GET", SCANS, (r) => json(r, [])]],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await page.getByLabel("Receipt photos").setInputFiles(images(101, 64));
    await expect(page.locator("[data-scan-refusal]")).toHaveText(
      "A pile can hold at most 100 files; you chose 101. Choose 100 or fewer.",
    );
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await quiet();
    expect(calls(seen, "GET", ESTIMATE)).toHaveLength(0);
    expect(calls(seen, "POST", SCANS)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T3 an 11 MB file is refused locally, with nothing sent", async ({ page }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: [statusApi(), ["GET", SCANS, (r) => json(r, [])]],
    });
    await page.goto("/receipt-scans");
    await chooseClient(page);
    await page.getByLabel("Receipt photos").setInputFiles([
      ...images(1),
      {
        name: "huge.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.alloc(11 * 1024 * 1024, 7),
      },
    ]);
    await expect(page.locator("[data-scan-refusal]")).toHaveText(
      "huge.jpg is larger than 10 MB. Each file must be 10 MB or smaller.",
    );
    await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
    await quiet();
    expect(calls(seen, "GET", ESTIMATE)).toHaveLength(0);
    expect(calls(seen, "POST", SCANS)).toHaveLength(0);
    clean(unmocked, dialogs);
  });
});

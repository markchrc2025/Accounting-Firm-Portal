// track-b-w12-a1.spec.ts — hermetic browser tests for W12-A1: the upload
// panel takes any photo or PDF, iPhone HEIC included, and the API decides by
// content (R1, R2); a saved "percentage" rule's method line shows the API's
// own sentence, never "Rate on gross receipts" (R3).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222d1";

const CLIENT = {
  id: "c1210000-0000-4000-8000-0000000000d1",
  businessName: "INVENTED AMENDMENT TRADING",
  tin: "000-121-021-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const FIRM_ME = {
  user: {
    id: "u1210000-0000-4000-8000-0000000000d1",
    email: "encoder@example.test",
    fullName: "Test Encoder",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: ["Clients:Read", "Expenses:Read", "Expenses:Create", "TaxComputation:Read"],
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: false,
  },
};

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

async function mockApi(page: Page, extra: Entry[]) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
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
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, FIRM_ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: FIRM_ME.user.id,
          fullName: FIRM_ME.user.fullName,
          email: FIRM_ME.user.email,
          userType: "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
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
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs, quiet };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}

async function manilaClock(page: Page, isoManila: string) {
  await page.clock.setFixedTime(new Date(`${isoManila}+08:00`));
}

// ---------------------------------------------------------------------------
// T1 — the picker and the drop zone take any photo or PDF (R1, R2)
// ---------------------------------------------------------------------------

const STATUS = /^\/api\/v1\/ai\/status$/;
const ESTIMATE = /^\/api\/v1\/ai\/estimate$/;
const SCANS = /^\/api\/v1\/receipt-scans$/;
const SCAN = /^\/api\/v1\/receipt-scans\/[^/]+$/;
const SCAN_ID = "5c121000-0000-4000-8000-0000000000d1";

const aiStatus = {
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
};
const summary = {
  id: SCAN_ID,
  clientId: CLIENT.id,
  clientName: CLIENT.businessName,
  periodFrom: "2026-07-01",
  periodTo: "2026-09-30",
  status: "reading",
  model: "invented-model",
  fileCount: 2,
  rowCount: 0,
  estimatedUsd: 0.1,
  actualUsd: null,
  createdAt: "2026-10-10T01:15:00.000Z",
  createdByName: "Test Encoder",
  readyAt: null,
  problem: null,
};

const ACCEPT = "image/*,.heic,.heif,.pdf,application/pdf";
const DROP_LINE =
  "Drop receipt photos or PDFs here: any photo format, iPhone photos included. Up to 100 files of 10 MB each.";

/** Drop files on the drop zone, as a person dragging them from a folder would. */
async function dropFiles(
  page: Page,
  files: { name: string; type: string; bytes: number }[],
) {
  await page.locator("[data-drop-zone]").evaluate((zone, list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      dt.items.add(new File([new Uint8Array(f.bytes).fill(7)], f.name, { type: f.type }));
    }
    zone.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, bubbles: true }));
    zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true }));
  }, files);
}

const IPHONE_AND_TIFF = [
  { name: "IMG_0001.HEIC", type: "", bytes: 4096 },
  { name: "scan.tiff", type: "image/tiff", bytes: 4096 },
];

function uploadApi(post: Handler): Entry[] {
  return [
    ["GET", STATUS, (r) => json(r, aiStatus)],
    ["GET", SCANS, (r) => json(r, [])],
    [
      "GET",
      ESTIMATE,
      (r) => json(r, { estimatedUsd: 0.1, remainingUsd: 19, fits: true }),
    ],
    ["POST", SCANS, post],
    [
      "GET",
      SCAN,
      (r) =>
        json(r, {
          scan: summary,
          files: [],
          totals: { files: 2, rows: 0, posted: 0, held: 0, rejected: 0, grossAmount: 0 },
        }),
    ],
  ];
}

test.describe("T1 the picker takes any photo or PDF (hermetic)", () => {
  test("T1 the file input accepts any photo or PDF, and the drop zone says so", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(
      page,
      uploadApi((r) => json(r, summary, 201)),
    );
    await page.goto("/receipt-scans");
    await expect(page.getByLabel("Receipt photos")).toHaveAttribute("accept", ACCEPT);
    await expect(page.locator("[data-drop-zone] [data-drop-line]")).toHaveText(DROP_LINE);
    clean(unmocked, dialogs);
  });

  test("T1 an iPhone HEIC with no type and a TIFF are dropped and sent, with no local refusal", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(
      page,
      uploadApi((r) => json(r, summary, 201)),
    );
    await page.goto("/receipt-scans");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await dropFiles(page, IPHONE_AND_TIFF);
    await expect(page.locator("[data-scan-estimate]")).toContainText("for 2 files.");
    await expect(page.locator("[data-scan-refusal]")).toHaveCount(0);
    const estimates = seen.filter((s) => s.method === "GET" && ESTIMATE.test(s.path));
    expect(estimates.map((s) => s.search.toString())).toEqual(["images=2&pdfs=0"]);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/receipt-scans/${SCAN_ID}$`));
    await quiet();
    const posts = seen.filter((s) => s.method === "POST" && SCANS.test(s.path));
    expect(posts).toHaveLength(1);
    const body = posts[0]!.request.postDataBuffer()!.toString("latin1");
    expect(body.match(/name="files"; filename="[^"]+"/g)).toEqual([
      'name="files"; filename="IMG_0001.HEIC"',
      'name="files"; filename="scan.tiff"',
    ]);
    clean(unmocked, dialogs);
  });

  test("T1 the picker sends them too, and the server's 400 for one shows word for word", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const MESSAGE = "INVENTED: scan.tiff could not be read as a photo or a PDF.";
    const { seen, unmocked, dialogs, quiet } = await mockApi(
      page,
      uploadApi((r) => json(r, { message: MESSAGE }, 400)),
    );
    await page.goto("/receipt-scans");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await page.getByLabel("Receipt photos").setInputFiles(
      IPHONE_AND_TIFF.map((f) => ({
        name: f.name,
        mimeType: f.type || "application/octet-stream",
        buffer: Buffer.alloc(f.bytes, 7),
      })),
    );
    await expect(page.locator("[data-scan-refusal]")).toHaveCount(0);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.locator("[data-scan-error]")).toHaveText(MESSAGE);
    await expect(page).toHaveURL(/\/receipt-scans$/);
    await quiet();
    expect(seen.filter((s) => s.method === "POST" && SCANS.test(s.path))).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T1 the count and size checks stay: 101 dropped files are refused, nothing sent", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(
      page,
      uploadApi((r) => json(r, summary, 201)),
    );
    await page.goto("/receipt-scans");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await dropFiles(
      page,
      Array.from({ length: 101 }, (_, i) => ({
        name: `IMG_${i}.HEIC`,
        type: "",
        bytes: 16,
      })),
    );
    await expect(page.locator("[data-scan-refusal]")).toHaveText(
      "A pile can hold at most 100 files; you chose 101. Choose 100 or fewer.",
    );
    await quiet();
    expect(
      seen.filter(
        (s) => ESTIMATE.test(s.path) || (s.method === "POST" && SCANS.test(s.path)),
      ),
    ).toEqual([]);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T2 — a saved "percentage" rule's method line (R3)
// ---------------------------------------------------------------------------

/** U10-A1's sentence for a saved "percentage" rule (compute.ts PERCENTAGE_RULE_NOTE). */
const PERCENTAGE_RULE_NOTE =
  "This client's saved rule is 'Percentage', which describes percentage tax (a business " +
  "tax), not an income-tax method; income tax is shown on the graduated TRAIN rates. " +
  "Choose the income-tax method on Tax Rules.";

function estimate(search: URLSearchParams) {
  const year = Number(search.get("year"));
  const quarter = search.get("quarter") === null ? null : Number(search.get("quarter"));
  return {
    basis: "management-estimate",
    notice: "INVENTED NOTICE: a management estimate, not the filed figure.",
    client: { id: CLIENT.id, businessName: CLIENT.businessName, regime: "PERCENTAGE" },
    period: {
      year,
      quarter,
      label: `INVENTED LABEL Q${quarter} ${year}`,
      incomeTaxFrom: `${year}-01-01`,
      incomeTaxTo: `${year}-09-30`,
      businessTaxFrom: `${year}-07-01`,
      businessTaxTo: `${year}-09-30`,
    },
    method: { name: "percentage", source: "saved", rate: null },
    incomeTax: {
      grossIncome: 654321.09,
      deductibleExpenses: 123456.78,
      taxableIncome: 530864.31,
      due: 9876.54,
    },
    businessTax: {
      kind: "percentage",
      grossReceipts: 210987.65,
      outputVAT: 0,
      inputVAT: 0,
      rate: 1.5,
      due: 3164.81,
    },
    assumptions: [
      "INVENTED ASSUMPTION ONE: figures come from posted records only.",
      PERCENTAGE_RULE_NOTE,
      "INVENTED ASSUMPTION TWO: graduated rates on gross income less deductible expenses.",
    ],
    filedForms: [],
  };
}

test.describe("T2 a saved percentage rule's method line (hermetic)", () => {
  test("T2 the method line shows no 'Rate on gross receipts', and shows the API's sentence word for word", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-10T10:00:00");
    const { unmocked, dialogs } = await mockApi(page, [
      [
        "GET",
        /^\/api\/v1\/clients\/[^/]+\/tax-estimate$/,
        (r, s) => json(r, estimate(s.search)),
      ],
    ]);
    await page.goto(`/clients/${CLIENT.id}/tax`);
    const method = page.locator("[data-method]");
    await expect(method).toContainText("Percentage");
    await expect(method).toContainText("Saved rule");
    await expect(method).not.toContainText("Rate on gross receipts");
    await expect(page.locator("[data-method-note]")).toHaveText(PERCENTAGE_RULE_NOTE);
    await expect(page.getByText("Rate on gross receipts")).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

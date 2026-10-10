// track-b-f19-f23.spec.ts — T10 (W3 R6): two follow-ups from W5.
//
// F19: the Sales template and export call the three name columns "Customer
// Lastname / Firstname / Middlename" (they said "Vendor"); a file made from the
// old template still parses the same way.
// F23: the Client Detail page's Expenses tab shows a held row's Held and Needs
// review badges, and refreshes after the row is posted.
//
// HERMETIC: one router, a table of handlers (the last matching entry wins), a
// catch-all that records anything unmocked. All fixture data is invented.

import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import * as XLSX from "xlsx";

const CLIENT = {
  id: "77777777-7777-4777-8777-777777777777",
  businessName: "INVENTED NOODLE HOUSE",
  tin: "300-400-500-00000",
  branch: "00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const ME = {
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
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
  },
};
const PROFILE = {
  id: ME.user.id,
  fullName: ME.user.fullName,
  email: ME.user.email,
  userType: "FIRM",
  mfaEnabled: false,
  avatarUrl: null,
};

interface Seen {
  method: string;
  path: string;
  contentType: string;
  request: Request;
}
type Handler = (route: Route, seen: Seen) => Promise<void> | void;
type Entry = [method: string, pattern: RegExp, handler: Handler];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const EMPTY_PAGE = { data: [], page: 1, pageSize: 50, total: 0 };

async function mockApi(page: Page, extra: Entry[] = []) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const table: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    ["GET", /^\/api\/v1\/profile\/me$/, (r) => json(r, PROFILE)],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/(purchase|income)-transactions$/,
      (r) => json(r, EMPTY_PAGE),
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
    ...extra,
  ];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const s: Seen = {
      method: req.method(),
      path: url.pathname,
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
  return { seen, unmocked };
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function workbook(sheet: string, aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function headerRow(path: string): string[] {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  return (rows[0] ?? []).map(String);
}

// ---------------------------------------------------------------------------
// F19 — the Sales name columns say Customer
// ---------------------------------------------------------------------------

const SALES_HEADERS_NOW = [
  "Date*",
  "Customer TIN*",
  "Customer Name*",
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

test.describe("T10 F19 and F23 (hermetic)", () => {
  test("T10 F19 the Sales template and export carry Customer Lastname / Firstname / Middlename", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, [
      [
        "GET",
        /^\/api\/v1\/clients\/[^/]+\/income-transactions$/,
        (r) =>
          json(r, {
            data: [
              {
                id: "cccccccc-0000-4000-8000-000000000009",
                txnDate: "2026-07-05",
                referenceNo: "SI-0009",
                customer: "INVENTED DINER CUSTOMER",
                customerTin: "500-600-700-00000",
                description: "Catering, July",
                categoryId: "c1",
                netAmount: 1000,
                outputVAT: 0,
                vatClass: "NON_VAT",
                saleToGovernment: false,
                source: "MANUAL",
              },
            ],
            page: 1,
            pageSize: 200,
            total: 1,
          }),
      ],
    ]);
    await page.goto(`/clients/${CLIENT.id}/sales`);

    const [exportFile] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export", exact: true }).click(),
    ]);
    const exported = headerRow((await exportFile.path())!);

    await page.getByRole("button", { name: "Import", exact: true }).click();
    const [template] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Download blank template" }).click(),
    ]);
    const blank = headerRow((await template.path())!);

    // eslint-disable-next-line no-console
    console.log("T10-F19-HEADERS " + JSON.stringify({ exported, blank }));
    expect(blank).toEqual(SALES_HEADERS_NOW);
    expect(exported).toEqual(SALES_HEADERS_NOW);
    expect([...blank, ...exported].filter((h) => h.startsWith("Vendor"))).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T10 F19 a Sales file with every old Vendor header still parses and posts the same rows", async ({
    page,
  }) => {
    const { seen, unmocked } = await mockApi(page, [
      [
        "POST",
        /^\/api\/v1\/clients\/[^/]+\/income-transactions\/import$/,
        (r) => json(r, { created: 1, failed: 0, errors: [] }),
      ],
    ]);
    await page.goto(`/clients/${CLIENT.id}/sales`);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "old-sales.xlsx",
      mimeType: XLSX_MIME,
      buffer: workbook("SALES", [
        [
          "Date*",
          "Vendor TIN*",
          "Vendor Name*",
          "Vendor Lastname",
          "Vendor Firstname",
          "Vendor Middlename",
          "Invoice Number*",
          "Tax Code*",
          "Tax Type*",
          "Category",
          "Description",
          "Amount*",
        ],
        [
          "2026-07-06",
          "500-600-700-00000",
          "INVENTED DINER CUSTOMER",
          "",
          "",
          "",
          "SI-0010",
          "PT010",
          "PT",
          "Catering",
          "Catering, July",
          1500,
        ],
      ]),
    });
    await expect(page.getByText("1 ready")).toBeVisible();
    await page.getByRole("button", { name: "Import 1 row" }).click();
    await expect(page.getByText("record imported")).toBeVisible();

    const posts = seen.filter((s) => s.method === "POST");
    expect(posts.map((s) => s.path)).toEqual([
      `/api/v1/clients/${CLIENT.id}/income-transactions/import`,
    ]);
    expect(JSON.parse(posts[0]!.request.postData() ?? "{}")).toEqual({
      rows: [
        {
          Date: "2026-07-06",
          CustomerTIN: "500-600-700-00000",
          Customer: "INVENTED DINER CUSTOMER",
          ReferenceNo: "SI-0010",
          ATC: "PT010",
          TaxType: "PT",
          Category: "Catering",
          Description: "Catering, July",
          Amount: "1500",
        },
      ],
    });
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // F23 — the Client Detail Expenses tab knows a held row, and refreshes on Post
  // -------------------------------------------------------------------------

  test("T10 F23 a held row on the Client Detail Expenses tab shows its badges; the tab refreshes after Post", async ({
    page,
  }) => {
    const HELD_ID = "bbbbbbbb-0000-4000-8000-0000000000f2";
    let posted = false;
    const held = {
      id: HELD_ID,
      txnDate: "2026-07-04",
      referenceNo: "DR-0777",
      vendor: "INVENTED ICE SUPPLIER",
      description: "Ice",
      categoryId: "c1",
      netAmount: 640,
      isCapitalGood: false,
      deductible: true,
      source: "IMPORT",
      status: "held",
      needsReview: true,
    };
    const { seen, unmocked } = await mockApi(page, [
      [
        "GET",
        /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
        (r) =>
          json(r, {
            data: [posted ? { ...held, status: "posted", needsReview: false } : held],
            page: 1,
            pageSize: 50,
            total: 1,
          }),
      ],
      [
        "POST",
        /^\/api\/v1\/purchase-transactions\/[^/]+\/post$/,
        (r) => {
          posted = true;
          return json(r, { ...held, status: "posted", needsReview: false });
        },
      ],
    ]);
    await page.goto(`/clients/${CLIENT.id}`);
    await page.getByRole("button", { name: "Expenses / Purchases" }).click();

    const row = page.locator("tbody tr", { hasText: "DR-0777" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Held");
    await expect(row).toContainText("Needs review");

    const listReads = () =>
      seen.filter((s) => s.method === "GET" && s.path.endsWith("/purchase-transactions"))
        .length;
    const before = listReads();
    const dialogs: string[] = [];
    page.on("dialog", (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await row.getByRole("button", { name: "Post" }).click();
    // W10: the confirmation asks in the page.
    await page
      .getByRole("dialog", { name: /^Post DR-0777/ })
      .getByRole("button", { name: "Post", exact: true })
      .click();

    // The tab reads the list again and the row no longer says Held.
    await expect(row).not.toContainText("Held");
    await expect(row).not.toContainText("Needs review");
    expect(listReads()).toBeGreaterThan(before);
    expect(dialogs).toEqual([]);
    expect(seen.filter((s) => s.method === "POST").map((s) => s.path)).toEqual([
      `/api/v1/purchase-transactions/${HELD_ID}/post`,
    ]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T10 F23 a client user sees the badges but never Post", async ({ page }) => {
    const held = {
      id: "bbbbbbbb-0000-4000-8000-0000000000f3",
      txnDate: "2026-07-05",
      referenceNo: "DR-0778",
      vendor: "INVENTED ICE SUPPLIER",
      description: "Ice",
      categoryId: "c1",
      netAmount: 320,
      isCapitalGood: false,
      deductible: true,
      source: "IMPORT",
      status: "held",
      needsReview: true,
    };
    const { unmocked } = await mockApi(page, [
      [
        "GET",
        /^\/api\/v1\/auth\/me$/,
        (r) =>
          // A client user: a client role's permissions, Expenses:Update included
          // (permissions.constants.ts gives client roles that one too).
          json(r, {
            user: { ...ME.user, userType: "CLIENT", clientId: CLIENT.id },
            permissions: {
              global: ["Clients:Read", "Expenses:Read", "Expenses:Update", "Sales:Read"],
              clients: [],
              assignedClientIds: [CLIENT.id],
              canViewAllClients: false,
            },
          }),
      ],
      [
        "GET",
        /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
        (r) => json(r, { data: [held], page: 1, pageSize: 50, total: 1 }),
      ],
    ]);
    await page.goto(`/clients/${CLIENT.id}`);
    await page.getByRole("button", { name: "Expenses / Purchases" }).click();
    const row = page.locator("tbody tr", { hasText: "DR-0778" });
    await expect(row).toContainText("Held");
    // Client roles hold Expenses:Update too; posting stays the firm's (W5).
    await expect(row.getByRole("button", { name: "Post" })).toHaveCount(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// track-b-w7.spec.ts — hermetic browser tests for W7: a client's tax regime is
// chosen, never defaulted (R1); the 2550Q / 2551Q warn on a regime mismatch
// (R2); the Expenses page's total and export (R3); the entry form keeps a held
// record's account (R4); Edit and Post follow the server's permissions (R5);
// the 2307 prints only what is saved, and names the payor right (R6).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// A COR is read by the app's own self-hosted OCR (public/tesseract), from an
// image this file renders — nothing leaves the machine.
//
// All data is invented. No real name, TIN, address, phone or email.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as XLSX from "xlsx";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

// ---------------------------------------------------------------------------
// Invented parties
// ---------------------------------------------------------------------------

/** No tax regime: exempt from business tax (D39). */
const EXEMPT_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000071",
  businessName: "INVENTED EXEMPT TUTORIAL CENTER",
  kind: "non-individual",
  regName: "INVENTED EXEMPT TUTORIAL CENTER INC",
  tin: "100-200-371-00000",
  branch: "00000",
  taxType: null,
  currency: "PHP",
  status: "Active",
};

const PCT_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000072",
  businessName: "INVENTED PERCENTAGE BAKESHOP",
  kind: "non-individual",
  regName: "INVENTED PERCENTAGE BAKESHOP CORP",
  tin: "100-200-372-00000",
  branch: "00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const VAT_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000073",
  businessName: "INVENTED VAT HARDWARE",
  kind: "non-individual",
  regName: "INVENTED VAT HARDWARE CORPORATION",
  tin: "100-200-373-00000",
  branch: "00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

/** An individual payor: Item 7 prints "LAST, FIRST MIDDLE", never the trade
 *  name or the display name. */
const IND_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000074",
  businessName: "INVENTED DISPLAY NAME STORE",
  tradeName: "INVENTED TRADE NAME",
  kind: "individual",
  regName: null,
  lastName: "TESTPAYOR",
  firstName: "SAMPLE",
  middleName: "INVENTED",
  tin: "100-200-374-00000",
  branch: "00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
  address: "5 INVENTED STREET, BARANGAY SAMPLE",
  city: "SAMPLE CITY",
  zip: "1600",
};

/** A company whose registered name was never filled in. */
const NAMELESS_CLIENT = {
  id: "eeeeeeee-0000-4000-8000-000000000075",
  businessName: "INVENTED NAMELESS TRADING",
  tradeName: "INVENTED NAMELESS",
  kind: "non-individual",
  regName: "",
  tin: "100-200-375-00000",
  branch: "00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

const CLIENTS = [EXEMPT_CLIENT, PCT_CLIENT, VAT_CLIENT, IND_CLIENT, NAMELESS_CLIENT];

const ALL_PERMISSIONS = [
  "Clients:Read",
  "Clients:Create",
  "Clients:Update",
  "Expenses:Read",
  "Expenses:Create",
  "Expenses:Update",
  "Expenses:Delete",
  "Sales:Read",
  "Sales:Create",
  "Sales:Update",
  "Sales:Delete",
  "BirForms:Read",
  "BirForms:Create",
  "BirForms:Update",
];

function firmMe(global: string[] = ALL_PERMISSIONS, clients: unknown[] = []) {
  return {
    user: {
      id: "11111111-1111-4111-8111-111111111171",
      email: "operator@example.test",
      fullName: "Test Operator",
      userType: "FIRM",
      firmId: "22222222-2222-4222-8222-222222222271",
      mfaEnabled: false,
    },
    permissions: {
      global,
      clients,
      assignedClientIds: CLIENTS.map((c) => c.id),
      canViewAllClients: true,
    },
  };
}
type Me = ReturnType<typeof firmMe>;

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

const emptySummary = {
  basis: "management-estimate",
  totalNet: 0,
  totalInputVAT: 0,
  count: 0,
  deductibleNet: 0,
  nonDeductibleNet: 0,
  byInputVATCategory: [],
};

async function mockApi(
  page: Page,
  opts: { me?: Me; extra?: Entry[] } = {},
): Promise<{ seen: Seen[]; unmocked: string[]; quiet: () => Promise<void> }> {
  const me = opts.me ?? firmMe();
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
          mfaEnabled: false,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, CLIENTS)],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r, s) => json(r, byId(s.path))],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/coa\/accounts$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/services$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/users$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/(purchase|income)-transactions$/,
      (r) => json(r, emptyPage),
    ],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/purchase-transactions\/summary$/,
      (r) => json(r, emptySummary),
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

const writes = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path));
const bodyOf = (s: Seen) =>
  JSON.parse(s.request.postData() ?? "{}") as Record<string, unknown>;

// ---------------------------------------------------------------------------
// T1 — a client's regime is chosen, never defaulted (R1)
// ---------------------------------------------------------------------------

const CHOOSE_REGIME =
  "Choose the client's tax regime: VAT-registered, Percentage tax, or Exempt from business tax.";
const FROM_COR = "From the COR — confirm before saving.";
const CREATE_PATH = /^\/api\/v1\/clients$/;

/** An invented COR, rendered as a clean image for the app's own OCR. */
async function corImage(page: Page, taxTypeRows: string[]): Promise<Buffer> {
  const lines = [
    "CERTIFICATE OF REGISTRATION",
    "TIN & BRANCH CODE | NAME OF TAXPAYER",
    "999-999-999-00000 SAMPLE TEST TRADING CORPORATION",
    "TAX TYPES FORM TYPE FILING START DATE FILING FREQUENCY",
    ...taxTypeRows,
  ];
  const p = await page.context().newPage();
  await p.setContent(
    `<pre style="margin:0;padding:48px;background:#fff;color:#000;font:26px/1.7 'DejaVu Sans Mono',monospace">${lines.join("\n")}</pre>`,
  );
  const png = await p.locator("pre").screenshot();
  await p.close();
  return png;
}

async function readCor(page: Page, rows: string[]) {
  const png = await corImage(page, rows);
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: "invented-cor.png", mimeType: "image/png", buffer: png });
  await expect(page.getByText("Review extracted details")).toBeVisible({
    timeout: 120_000,
  });
  await page.getByRole("button", { name: "Apply to form" }).click();
}

test.describe("T1 a client's regime is chosen, never defaulted (hermetic)", () => {
  test("T1 a new client with no regime chosen is refused with R1's message; no create request is sent", async ({
    page,
  }) => {
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [["POST", CREATE_PATH, (r) => json(r, { ...VAT_CLIENT, id: "x" }, 201)]],
    });
    await page.goto("/clients/new");
    await page.getByLabel("Business / display name").fill("INVENTED NEW CLIENT");
    await page.getByRole("button", { name: "Create client" }).click();
    await quiet();
    expect(writes(seen, "POST", CREATE_PATH), "no create request").toEqual([]);
    await expect(page.getByText(CHOOSE_REGIME).first()).toBeVisible();
    const select = page.getByLabel("Tax regime");
    await expect(select.locator("option:checked")).toHaveText("Choose…");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 a COR with Value-Added Tax pre-selects VAT-registered, with the note", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { unmocked } = await mockApi(page);
    await page.goto("/clients/new");
    await readCor(page, [
      "INCOME TAX 1702Q January 1, 2026 QUARTERLY",
      "VALUE-ADDED TAX 2550Q January 1, 2026 QUARTERLY",
    ]);
    const select = page.getByLabel("Tax regime");
    await expect(select.locator("option:checked")).toHaveText("VAT-registered");
    await expect(page.getByText(FROM_COR)).toBeVisible();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 a COR with income tax only pre-selects Exempt from business tax, with the note", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { unmocked } = await mockApi(page);
    await page.goto("/clients/new");
    await readCor(page, ["INCOME TAX 1702Q January 1, 2026 QUARTERLY"]);
    const select = page.getByLabel("Tax regime");
    await expect(select.locator("option:checked")).toHaveText("Exempt from business tax");
    await expect(page.getByText(FROM_COR)).toBeVisible();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T1 editing an existing exempt client shows Exempt and saves it unchanged", async ({
    page,
  }) => {
    const PATCH_PATH = new RegExp(`^/api/v1/clients/${EXEMPT_CLIENT.id}$`);
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [["PATCH", PATCH_PATH, (r) => json(r, EXEMPT_CLIENT)]],
    });
    await page.goto(`/clients/${EXEMPT_CLIENT.id}/edit`);
    const select = page.getByLabel("Tax regime");
    await expect(select.locator("option:checked")).toHaveText("Exempt from business tax");
    await expect(page.getByText(FROM_COR)).toHaveCount(0);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${EXEMPT_CLIENT.id}$`));
    await quiet();
    const patches = writes(seen, "PATCH", PATCH_PATH);
    expect(patches).toHaveLength(1);
    // An exempt client is stored with no regime; the edit sends it as it is.
    expect(bodyOf(patches[0]!).taxType).toBe("");
    await expect(page.getByText(CHOOSE_REGIME)).toHaveCount(0);
    expect(
      unmocked.filter((u) => !u.startsWith("GET ")),
      "unmocked writes",
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2 — the Expenses export, for a client that is not VAT-registered (R3, D23)
// ---------------------------------------------------------------------------

/** U8's mixed receipt, as the importer books it. For a client that is not
 *  VAT-registered the VAT stays in the cost (D23): the VAT-able part's net is
 *  3,306.25 with 354.24 of non-claimable VAT inside it, and the exempt part is
 *  887.96. A VAT client's same receipt books the VAT-able part net of VAT. */
function mixedReceipt(vat: boolean) {
  const common = {
    txnDate: "2026-08-14",
    referenceNo: "OR-7701",
    vendor: "INVENTED GROCERY SUPPLY",
    vendorTin: "300-400-500-00000",
    categoryId: "c-supplies",
    isCapitalGood: false,
    deductible: true,
    source: "IMPORT",
    status: "posted",
    account: "Supplies Expense",
  };
  return [
    {
      ...common,
      id: "a7000000-0000-4000-8000-000000000001",
      description: "VAT-able goods",
      ...(vat
        ? {
            netAmount: 2952.01,
            inputVAT: 354.24,
            taxAmount: 354.24,
            inputVATCategory: "DOMESTIC_PURCHASES",
          }
        : { netAmount: 3306.25, taxAmount: 354.24 }),
    },
    {
      ...common,
      id: "a7000000-0000-4000-8000-000000000002",
      description: "VAT-exempt goods",
      netAmount: 887.96,
      ...(vat
        ? { inputVAT: 0, taxAmount: 0, inputVATCategory: "DOMESTIC_NO_INPUT_TAX" }
        : { taxAmount: 0 }),
    },
  ];
}

const LIST_PATH = /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/;
const listOf = (records: unknown[]): Entry => [
  "GET",
  LIST_PATH,
  (r) => json(r, { data: records, page: 1, pageSize: 200, total: records.length }),
];

/** Every data row of the first sheet, keyed by its header, and the headers. */
function readSheet(path: string) {
  const wb = XLSX.read(readFileSync(path), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  return { headers: (aoa[0] ?? []).map(String), rows };
}

async function exportExpenses(page: Page, clientId: string) {
  await page.goto(`/clients/${clientId}/expenses`);
  await expect(page.getByText("OR-7701").first()).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  return readSheet((await download.path())!);
}

const VAT_HEADERS_BEFORE = [
  "Date*",
  "Vendor TIN*",
  "Vendor Name*",
  "Vendor Lastname",
  "Vendor Firstname",
  "Vendor Middlename",
  "Address",
  "City",
  "Postal Code*",
  "Reference Number*",
  "Tax Code*",
  "Tax Type*",
  "Category",
  "Description",
  "Amount*",
  "COA Code*",
  "Status",
  "Needs review",
];

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

test.describe("T2 the Expenses export (hermetic)", () => {
  for (const client of [PCT_CLIENT, EXEMPT_CLIENT]) {
    test(`T2 a ${client.taxType ?? "exempt"} client's mixed receipt exports 4,194.21, with the VAT once in its own column`, async ({
      page,
    }) => {
      const { unmocked } = await mockApi(page, { extra: [listOf(mixedReceipt(false))] });
      const { headers, rows } = await exportExpenses(page, client.id);
      const amounts = rows.map((r) => Number(r["Amount*"]));
      expect(amounts).toEqual([3306.25, 887.96]);
      expect(sum(amounts)).toBe(4194.21);
      expect(headers).toContain("VAT (non-claimable)");
      expect(rows.map((r) => r["VAT (non-claimable)"])).toEqual([354.24, 0]);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }

  test("T2 a VAT client's export is unchanged: amounts carry their input VAT, no extra column", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, { extra: [listOf(mixedReceipt(true))] });
    const { headers, rows } = await exportExpenses(page, VAT_CLIENT.id);
    expect(headers).toEqual(VAT_HEADERS_BEFORE);
    const amounts = rows.map((r) => Number(r["Amount*"]));
    expect(amounts).toEqual([3306.25, 887.96]);
    expect(sum(amounts)).toBe(4194.21);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T3 — editing a held imported record keeps its account (R4)
// ---------------------------------------------------------------------------

const UNASSIGNED = {
  id: "c7000000-0000-4000-8000-0000000000aa",
  clientId: PCT_CLIENT.id,
  type: "EXPENSE",
  name: "Unassigned (held import)",
  isDeductible: true,
};

function heldImport(account: string | null) {
  return {
    id: "b7000000-0000-4000-8000-000000000001",
    txnDate: "2026-08-20",
    referenceNo: "DR-7702",
    vendor: "INVENTED WATER DELIVERY",
    description: "Water refill",
    categoryId: UNASSIGNED.id,
    netAmount: 450,
    taxAmount: 0,
    isCapitalGood: false,
    deductible: true,
    source: "IMPORT",
    status: "held",
    needsReview: true,
    account,
  };
}

test.describe("T3 editing a held import keeps its account (hermetic)", () => {
  for (const account of [null, "Office Supplies Expense"]) {
    test(`T3 a held import with account ${account === null ? "none" : `"${account}"`} is saved with that account unchanged`, async ({
      page,
    }) => {
      const rec = heldImport(account);
      const PATCH_PATH = new RegExp(
        `^/api/v1/clients/${PCT_CLIENT.id}/purchase-transactions/${rec.id}$`,
      );
      const { seen, unmocked, quiet } = await mockApi(page, {
        extra: [
          listOf([rec]),
          [
            "GET",
            /^\/api\/v1\/clients\/[^/]+\/categories$/,
            (r) => json(r, [UNASSIGNED]),
          ],
          ["PATCH", PATCH_PATH, (r) => json(r, rec)],
        ],
      });
      await page.goto(`/clients/${PCT_CLIENT.id}/expenses`);
      await expect(page.getByText("DR-7702").first()).toBeVisible();
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByRole("button", { name: "Save", exact: true }).click();
      await quiet();
      const patches = writes(seen, "PATCH", PATCH_PATH);
      expect(patches).toHaveLength(1);
      const body = bodyOf(patches[0]!);
      if (account === null) {
        expect(body).not.toHaveProperty("account");
      } else {
        expect(body.account).toBe(account);
      }
      expect(JSON.stringify(body)).not.toContain(UNASSIGNED.name);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// T4 — a business-tax return warns on a regime mismatch, never blocks (R2)
// ---------------------------------------------------------------------------

const WARN_2550Q =
  "This client is not VAT-registered. A 2550Q is normally filed only by VAT-registered taxpayers.";
const WARN_2551Q_EXEMPT =
  "This client is exempt from business tax. A 2551Q is not normally filed for it.";
const WARN_2551Q_VAT =
  "This client is VAT-registered. A 2551Q is normally filed by taxpayers under percentage tax.";
const ALL_WARNINGS = [WARN_2550Q, WARN_2551Q_EXEMPT, WARN_2551Q_VAT];

const COMPUTE: Entry = ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})];

async function expectOnlyWarning(page: Page, expected: string | null) {
  for (const w of ALL_WARNINGS) {
    await expect(page.getByText(w)).toHaveCount(w === expected ? 1 : 0);
  }
}

const DRAFT_2551Q_ID = "f7000000-0000-4000-8000-000000002551";
const FILED_2551Q_ID = "f7000000-0000-4000-8000-000000012551";
function form2551Q(over: Record<string, unknown>) {
  return {
    id: DRAFT_2551Q_ID,
    clientId: VAT_CLIENT.id,
    clientName: VAT_CLIENT.businessName,
    form: "2551Q",
    status: "draft",
    period: "2026-Q1",
    filedAt: null,
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:00:00.000Z",
    data: {
      year: "2026",
      periodType: "calendar",
      amended: "no",
      taxRelief: "no",
      itRate: "graduated",
      i15: "",
      i20: "",
      i21: "",
      i22: "",
      rows: [{ atc: "PT010", taxable: "150000", rate: "3" }],
    },
    computed: { rows: [{ due: 4500 }], i14: 4500, i18: 0, i19: 4500, i23: 0, i24: 4500 },
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
    ...over,
  };
}

test.describe("T4 a business-tax return warns on a regime mismatch (hermetic)", () => {
  test("T4 a new 2550Q warns for a percentage and an exempt client, not for a VAT client; Save draft stays enabled", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, { extra: [COMPUTE] });
    await page.goto("/bir-forms/new?form=2550Q");
    const client = page.getByRole("combobox", { name: "Client", exact: true });
    const save = page.getByRole("button", { name: "Save draft" });
    for (const [c, warning] of [
      [PCT_CLIENT, WARN_2550Q],
      [EXEMPT_CLIENT, WARN_2550Q],
      [VAT_CLIENT, null],
    ] as const) {
      await client.selectOption(c.id);
      await expectOnlyWarning(page, warning);
      await expect(save).toBeEnabled();
    }
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a new 2551Q warns for an exempt and a VAT client, not for a percentage client; Save draft stays enabled", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, { extra: [COMPUTE] });
    await page.goto("/bir-forms/new?form=2551Q");
    const client = page.getByRole("combobox", { name: "Client", exact: true });
    const save = page.getByRole("button", { name: "Save draft" });
    for (const [c, warning] of [
      [EXEMPT_CLIENT, WARN_2551Q_EXEMPT],
      [VAT_CLIENT, WARN_2551Q_VAT],
      [PCT_CLIENT, null],
    ] as const) {
      await client.selectOption(c.id);
      await expectOnlyWarning(page, warning);
      await expect(save).toBeEnabled();
    }
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a draft 2551Q for a VAT client warns, and Save changes and Mark as filed stay enabled", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: [
        COMPUTE,
        [
          "GET",
          new RegExp(`^/api/v1/bir-forms/${DRAFT_2551Q_ID}$`),
          (r) => json(r, form2551Q({})),
        ],
      ],
    });
    await page.goto(`/bir-forms/${DRAFT_2551Q_ID}`);
    await expectOnlyWarning(page, WARN_2551Q_VAT);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeEnabled();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 a filed 2551Q for a VAT client shows no warning: nothing changes for a filed form", async ({
    page,
  }) => {
    const filed = form2551Q({
      id: FILED_2551Q_ID,
      status: "filed",
      filedAt: "2026-04-20T02:15:00.000Z",
    });
    const { unmocked } = await mockApi(page, {
      extra: [
        COMPUTE,
        [
          "GET",
          new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}$`),
          (r) => json(r, filed),
        ],
      ],
    });
    await page.goto(`/bir-forms/${FILED_2551Q_ID}`);
    await expect(page.getByText("Apr 20, 2026").first()).toBeVisible();
    await expectOnlyWarning(page, null);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T5 — the 2307 prints only what is saved, and names the payor right (R6)
// ---------------------------------------------------------------------------

const SAVE_FIRST = "Save the certificate before printing.";
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

function draft2307(client: { id: string; businessName: string }, n: number) {
  return {
    id: `f7000000-0000-4000-8000-00000000230${n}`,
    clientId: client.id,
    clientName: client.businessName,
    form: "2307",
    status: "draft",
    period: "2026-Q1",
    filedAt: null,
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:00:00.000Z",
    data: DATA_2307,
    computed: COMPUTED_2307,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
  };
}

/** Mocks for a saved draft 2307 of `client`, opened at its own URL. */
async function openSaved2307(
  page: Page,
  client: { id: string; businessName: string },
  n: number,
) {
  const form = draft2307(client, n);
  const api = await mockApi(page, {
    extra: [
      ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2307)],
      ["GET", new RegExp(`^/api/v1/bir-forms/${form.id}$`), (r) => json(r, form)],
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
    const sheet = document.querySelector('[data-sheet-copy="capture"] .bir-sheet')!;
    const cells = Array.from(sheet.querySelectorAll<HTMLElement>(".bir-cell.stack"));
    const cell = cells.find((c) => /Payor.s Name/.test(c.textContent ?? ""))!;
    return cell.querySelector<HTMLElement>(".bir-val")?.textContent ?? "";
  });
}

const printButton = (page: Page) =>
  page.getByRole("button", { name: /Print certificate \(PDF\)/ });

test.describe("T5 the 2307 prints only what is saved, named right (hermetic)", () => {
  test("T5 Item 7 reads LAST, FIRST MIDDLE for an individual, never the trade or display name; it prints", async ({
    page,
  }) => {
    const { unmocked } = await openSaved2307(page, IND_CLIENT, 1);
    await expect.poll(() => item7(page)).toBe("TESTPAYOR, SAMPLE INVENTED");
    const name = await item7(page);
    expect(name).not.toContain(IND_CLIENT.tradeName);
    expect(name).not.toContain(IND_CLIENT.businessName);
    await expect(printButton(page)).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      printButton(page).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/2307-2026-Q1\.pdf$/);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T5 Item 7 reads the registered name for a company, not its display name", async ({
    page,
  }) => {
    const { unmocked } = await openSaved2307(page, VAT_CLIENT, 2);
    await expect.poll(() => item7(page)).toBe(VAT_CLIENT.regName);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T5 a payor with no registered name is refused Print with R6's message; nothing is downloaded", async ({
    page,
  }) => {
    const downloads: string[] = [];
    page.on("download", (d) => downloads.push(d.suggestedFilename()));
    const { unmocked, quiet } = await openSaved2307(page, NAMELESS_CLIENT, 3);
    await expect.poll(() => item7(page)).toBe("");
    await printButton(page).click();
    await expect(page.getByText(NAME_MISSING)).toBeVisible();
    await quiet();
    expect(downloads).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T5 an unsaved certificate cannot be printed: new, or saved and then edited", async ({
    page,
  }) => {
    const { unmocked } = await openSaved2307(page, IND_CLIENT, 4);
    await expect(printButton(page)).toBeEnabled();
    await page.getByLabel("Payee name").fill("INVENTED PAYEE, EDITED");
    await expect(printButton(page)).toBeDisabled();
    await expect(printButton(page)).toHaveAttribute("title", SAVE_FIRST);
    await page.getByLabel("Payee name").fill(DATA_2307.payeeName);
    await expect(printButton(page)).toBeEnabled();

    await page.goto("/bir-forms/new?form=2307");
    await page.getByLabel("Withholding agent (client)").selectOption(IND_CLIENT.id);
    await expect(printButton(page)).toBeDisabled();
    await expect(printButton(page)).toHaveAttribute("title", SAVE_FIRST);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T5 the Form view's PDF preview hides its own download and print until the certificate is saved", async ({
    page,
  }) => {
    const { unmocked } = await openSaved2307(page, IND_CLIENT, 6);
    const preview = page.locator('iframe[title="Form PDF preview"]');
    await page.getByRole("button", { name: "Form", exact: true }).click();
    // The preview is an html2canvas render: seconds, not milliseconds, under load.
    await expect(preview).toHaveAttribute("src", /#view=FitH$/, { timeout: 30_000 });
    await page.getByRole("button", { name: "Guided", exact: true }).click();
    await page.getByLabel("Payee name").fill("INVENTED PAYEE, EDITED");
    await page.getByRole("button", { name: "Form", exact: true }).click();
    await expect(preview).toHaveAttribute("src", /#view=FitH&toolbar=0$/, {
      timeout: 30_000,
    });
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T5 no control reaches the legacy 2307 print, and no legacy sheet is rendered", async ({
    page,
  }) => {
    const { unmocked } = await openSaved2307(page, IND_CLIENT, 5);
    await expect(page.getByRole("button", { name: /legacy/i })).toHaveCount(0);
    await expect(page.getByText(/legacy/i)).toHaveCount(0);
    await expect(page.locator(".bir-sheet-stage > .bir-sheet")).toHaveCount(0);
    await page.goto("/bir-forms/new?form=2307");
    await page.getByLabel("Withholding agent (client)").selectOption(IND_CLIENT.id);
    await expect(page.getByRole("button", { name: /legacy/i })).toHaveCount(0);
    await expect(page.locator(".bir-sheet-stage > .bir-sheet")).toHaveCount(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

test("T5 no source file renders the retired legacy 2307 sheet, and no route names it", () => {
  const web = resolve(test.info().project.testDir, "..");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const full = join(dir, f);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const sources = walk(join(web, "src")).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );
  const renders = sources.filter((f) => /<Sheet2307\b/.test(readFileSync(f, "utf8")));
  expect(renders, "files rendering <Sheet2307>").toEqual([]);
  const app = readFileSync(join(web, "src", "App.tsx"), "utf8");
  expect(app).not.toMatch(/legacy/i);
  const editor = readFileSync(join(web, "src", "pages", "BirForm2307Editor.tsx"), "utf8");
  expect(editor).not.toMatch(/Print \(legacy\)|printLegacy|legacySheetRef/);
});

// ---------------------------------------------------------------------------
// T6 — Edit and Post follow the server's permissions, per client (R5)
// ---------------------------------------------------------------------------

const OTHER_CLIENT_ID = "eeeeeeee-0000-4000-8000-0000000000ff";
const READ_ONLY = ["Clients:Read", "Expenses:Read", "Sales:Read"];

function heldAndPosted() {
  const posted = {
    ...heldImport("Supplies Expense"),
    id: "b7000000-0000-4000-8000-000000000002",
    referenceNo: "OR-7703",
    status: "posted",
    needsReview: false,
  };
  return [heldImport("Supplies Expense"), posted];
}

const INCOME = {
  id: "c7100000-0000-4000-8000-000000000001",
  txnDate: "2026-08-21",
  referenceNo: "SI-7704",
  customer: "INVENTED CAFE CUSTOMER",
  description: "Catering",
  categoryId: "c-sales",
  netAmount: 1000,
  vatClass: "NON_VAT",
  source: "MANUAL",
};
const INCOME_LIST: Entry = [
  "GET",
  /^\/api\/v1\/clients\/[^/]+\/income-transactions$/,
  (r) => json(r, { data: [INCOME], page: 1, pageSize: 50, total: 1 }),
];

const editButtons = (page: Page) =>
  page.getByRole("button", { name: "Edit", exact: true });
const postButtons = (page: Page) =>
  page.getByRole("button", { name: "Post", exact: true });

test.describe("T6 Edit and Post follow the server's permissions (hermetic)", () => {
  for (const [label, me, edit, post] of [
    ["read only", firmMe(READ_ONLY), 0, 0],
    [
      "Update and Create on ANOTHER client only",
      firmMe(READ_ONLY, [
        {
          clientId: OTHER_CLIENT_ID,
          permissions: ["Expenses:Update", "Expenses:Create", "Sales:Update"],
        },
      ]),
      0,
      0,
    ],
    [
      "Expenses:Update without Expenses:Create",
      firmMe([...READ_ONLY, "Expenses:Update"]),
      2,
      0,
    ],
    [
      "Update and Create on THIS client",
      firmMe(READ_ONLY, [
        {
          clientId: PCT_CLIENT.id,
          permissions: ["Expenses:Update", "Expenses:Create", "Sales:Update"],
        },
      ]),
      2,
      1,
    ],
    ["every permission", firmMe(), 2, 1],
  ] as const) {
    test(`T6 Expenses and its client page — ${label}: ${edit ? "Edit" : "no Edit"}, ${post ? "Post" : "no Post"}`, async ({
      page,
    }) => {
      const { unmocked } = await mockApi(page, { me, extra: [listOf(heldAndPosted())] });
      await page.goto(`/clients/${PCT_CLIENT.id}/expenses`);
      await expect(page.getByText("OR-7703").first()).toBeVisible();
      await expect(editButtons(page)).toHaveCount(edit);
      await expect(postButtons(page)).toHaveCount(post);

      await page.goto(`/clients/${PCT_CLIENT.id}`);
      await page.getByRole("button", { name: "Expenses / Purchases" }).click();
      await expect(page.getByText("OR-7703").first()).toBeVisible();
      await expect(editButtons(page)).toHaveCount(edit);
      await expect(postButtons(page)).toHaveCount(post);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }

  for (const [label, me, edit] of [
    ["read only", firmMe(READ_ONLY), 0],
    [
      "Sales:Update on ANOTHER client only",
      firmMe(READ_ONLY, [{ clientId: OTHER_CLIENT_ID, permissions: ["Sales:Update"] }]),
      0,
    ],
    [
      "Sales:Update on THIS client",
      firmMe(READ_ONLY, [{ clientId: PCT_CLIENT.id, permissions: ["Sales:Update"] }]),
      1,
    ],
  ] as const) {
    test(`T6 Sales & Income — ${label}: ${edit ? "Edit" : "no Edit"}`, async ({
      page,
    }) => {
      const { unmocked } = await mockApi(page, { me, extra: [INCOME_LIST] });
      await page.goto(`/clients/${PCT_CLIENT.id}/sales`);
      await expect(page.getByText("SI-7704").first()).toBeVisible();
      await expect(editButtons(page)).toHaveCount(edit);
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// T7 — "Posted total for the quarter" (R3)
// ---------------------------------------------------------------------------

/** The current calendar quarter on the Manila calendar, computed here
 *  independently of the app's helper. */
function thisQuarter() {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(
    new Date(),
  );
  const [y, m] = ymd.split("-").map(Number) as [number, number];
  const q0 = Math.floor((m - 1) / 3) * 3; // 0-based first month
  const last = new Date(Date.UTC(y, q0 + 3, 0));
  return {
    from: `${y}-${String(q0 + 1).padStart(2, "0")}-01`,
    to: last.toISOString().slice(0, 10),
    lastYear: `${y - 1}-${String(q0 + 1).padStart(2, "0")}-15`,
  };
}

/** The summary as the server computes it: posted records only (held ones count
 *  nowhere), within dateFrom..dateTo when sent. */
function serverSummary(
  records: Array<{ txnDate: string; netAmount: number; status?: string }>,
): Handler {
  return (r, s) => {
    const from = s.search.get("dateFrom");
    const to = s.search.get("dateTo");
    const hit = records.filter(
      (t) =>
        (t.status ?? "posted") === "posted" &&
        (!from || t.txnDate >= from) &&
        (!to || t.txnDate <= to),
    );
    const total = Math.round(hit.reduce((a, t) => a + t.netAmount, 0) * 100) / 100;
    return json(r, {
      ...emptySummary,
      totalNet: total,
      deductibleNet: total,
      count: hit.length,
    });
  };
}

test.describe("T7 the posted total for the quarter (hermetic)", () => {
  test("T7 the label reads Posted total for the quarter; it asks for this quarter's dates; held and out-of-quarter records do not change it", async ({
    page,
  }) => {
    const q = thisQuarter();
    const base = {
      ...heldImport("Supplies Expense"),
      status: "posted",
      needsReview: false,
    };
    const posted = {
      ...base,
      id: "b7000000-0000-4000-8000-000000000011",
      referenceNo: "OR-7711",
      txnDate: q.from,
      netAmount: 1200.5,
    };
    const held = {
      ...base,
      id: "b7000000-0000-4000-8000-000000000012",
      referenceNo: "DR-7712",
      txnDate: q.to,
      netAmount: 999,
      status: "held",
    };
    const old = {
      ...base,
      id: "b7000000-0000-4000-8000-000000000013",
      referenceNo: "OR-7713",
      txnDate: q.lastYear,
      netAmount: 5000,
    };
    const records = [posted, held, old];
    const SUMMARY = /^\/api\/v1\/clients\/[^/]+\/purchase-transactions\/summary$/;
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: [listOf(records), ["GET", SUMMARY, serverSummary(records)]],
    });
    await page.goto(`/clients/${PCT_CLIENT.id}/expenses`);
    const block = page
      .getByText("Posted total for the quarter", { exact: true })
      .locator("..");
    await expect(block).toBeVisible();
    await expect(block).toContainText("₱1,200.50");
    await quiet();
    const asked = seen.filter((s) => s.method === "GET" && SUMMARY.test(s.path));
    expect(asked.length).toBeGreaterThan(0);
    for (const s of asked) {
      expect(s.search.get("dateFrom")).toBe(q.from);
      expect(s.search.get("dateTo")).toBe(q.to);
    }
    await expect(page.getByText("Quarter total", { exact: true })).toHaveCount(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

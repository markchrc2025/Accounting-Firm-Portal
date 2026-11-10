// track-b-w19.spec.ts — hermetic browser tests for W19: the 1601-EQ alphalist (Track A
// U19): payee details on expenses, the TIN prefill, the Alphalist panel and download, and
// the alphalist step of Mark as filed. One router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// All data is invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222j1";
const CLIENT = {
  id: "c1900000-0000-4000-8000-0000000000j1",
  businessName: "INVENTED NINETEEN TRADING",
  tin: "000-111-222-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
  rdo: "044",
};
const PERMS = [
  "BIRForms:Read",
  "BIRForms:Create",
  "BIRForms:Update",
  "BIRForms:File",
  "Clients:Read",
  "Expenses:Read",
  "Expenses:Create",
  "Expenses:Update",
];
const ME = {
  user: {
    id: "u1900000-0000-4000-8000-0000000000j1",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: PERMS,
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
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

// --- the alphalist --------------------------------------------------------------------

const FILE_NAME = "00011122200000920261601EQ.DAT";
const VALIDATE =
  "Before eSubmission, open this file in the BIR Alphalist Validation program and validate it. Submit the validated file, not this one.";
const PROBLEMS =
  "The alphalist has problems. If you file now, no alphalist will be stored and it cannot be made later.";
const WILL_STORE = "The alphalist will be stored with the filed return.";
const WARNING_MESSAGE =
  "The alphalist could not be made when this return was filed, so none was stored. A filed return's alphalist cannot be made later.";

const REFUSALS = [
  "INVENTED REFUSAL ONE: the supplier on expense OR-0007 has no last name.",
  "INVENTED REFUSAL TWO: the supplier TIN on expense OR-0009 is not 9 digits.",
  "INVENTED REFUSAL THREE: the client has no RDO.",
];
const OK_CHECK = {
  ok: true,
  source: "books",
  fileName: FILE_NAME,
  refusals: [],
  notes: ["INVENTED NOTE: one expense had no ATC and is not in the file."],
  schedule1: { rows: 3, income: "120000.00", tax: "2400.00" },
  schedule2: { rows: 0, income: "0.00" },
  returnTotal: "2650.00",
};
const BAD_CHECK = {
  ...OK_CHECK,
  ok: false,
  fileName: null,
  refusals: REFUSALS,
};
const NONE_CHECK = {
  ok: false,
  source: "none",
  fileName: null,
  refusals: [
    "INVENTED: this return was filed before the alphalist existed, so it has none.",
  ],
  notes: [],
  schedule1: { rows: 0, income: "0.00", tax: "0.00" },
  schedule2: { rows: 0, income: "0.00" },
  returnTotal: "0.00",
};

const CHECK_IDS = [
  "bir-email",
  "file-name",
  "taxpayer",
  "form",
  "period",
  "received",
  "duplicate",
  "timing",
  "upload",
];

interface World {
  store: Map<string, Record<string, unknown>>;
  check: Record<string, unknown>;
  /** What the prefill answers, by 9-digit TIN. */
  payees: Record<string, unknown>;
  /** The file the download answers with. */
  file: string;
}
const idOf = (k: number) => `f1900000-0000-4000-8000-${String(k).padStart(12, "0")}`;

function detail(over: Record<string, unknown> & { id: string }) {
  return {
    form: "1601EQ",
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    status: "draft",
    period: "2026-Q3",
    filedAt: null,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-01T01:00:00.000Z",
    amendsId: null,
    sequence: 1,
    exports: [],
    filedSnapshot: null,
    clearCopyAvailable: false,
    previewAvailable: false,
    canDelete: false,
    computed: null,
    confirmation: null,
    confirmationRequired: true,
    alphalist: { stored: false, warning: null },
    data: { year: "2026", quarter: "3rd", amended: "no", anyWithheld: "no", rows: [] },
    ...over,
  };
}

async function mockApi(page: Page, w: World, extra: Entry[] = []) {
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
          return now - since >= 600;
        },
        { intervals: [100], timeout: 15_000 },
      )
      .toBe(true);
  };
  await page.clock.setFixedTime(new Date("2026-10-12T10:00:00+08:00"));
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
    // W23: the live Preview pane is not what this spec is about: it stays hidden for every
    // user, so it asks the API for nothing (track-b-w23.spec.ts is the one that shows it).
    const readItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      return String(key).startsWith("portal:bir-preview-pane:")
        ? "hidden"
        : readItem.call(this, key);
    };
  });
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: "u",
          fullName: "Test Operator",
          email: "operator@example.test",
          userType: "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, { rowCount: 0 })],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/[^/]+$/,
      (r, s) => {
        const found = w.store.get(s.path.split("/").pop()!);
        return found ? json(r, found) : json(r, { message: "Not found" }, 404);
      },
    ],
    ["GET", /^\/api\/v1\/bir-forms\/[^/]+\/alphalist\/check$/, (r) => json(r, w.check)],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/[^/]+\/alphalist$/,
      (r) =>
        r.fulfill({
          status: 200,
          contentType: "text/plain",
          headers: {
            "Content-Disposition": `attachment; filename="${FILE_NAME}"`,
            "Access-Control-Expose-Headers": "Content-Disposition",
          },
          body: w.file,
        }),
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/[^/]+\/confirmation\/check$/,
      (r) =>
        json(r, {
          ok: true,
          checks: CHECK_IDS.map((id, i) => ({
            n: i + 1,
            id,
            status: "ok",
            message: null,
          })),
          errors: [],
          warnings: [],
          parsed: null,
          filedOn: "2026-10-12",
          sha256: "d".repeat(64),
        }),
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/[^/]+\/mark-filed$/,
      (r, s) => {
        const id = s.path.split("/")[4]!;
        const next = {
          ...w.store.get(id)!,
          status: "filed",
          filedAt: "2026-10-12T02:00:00.000Z",
          alphalist: (w.check as { ok: boolean }).ok
            ? { stored: true, warning: null }
            : {
                stored: false,
                warning: { message: WARNING_MESSAGE, refusals: REFUSALS },
              },
        };
        w.store.set(id, next);
        return json(r, next);
      },
    ],
    // The expense side.
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/coa\/accounts$/,
      (r) =>
        json(r, [
          {
            code: "6001",
            name: "Office Supplies",
            class: "Expense",
            accountType: "Operating Expense",
            normalBalance: "debit",
            currency: "PHP",
            monthlyMovement: false,
          },
        ]),
    ],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
      (r) => json(r, { data: [LISTED], page: 1, pageSize: 50, total: 1 }),
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
      /^\/api\/v1\/clients\/[^/]+\/purchase-transactions\/payee-details$/,
      (r, s) => {
        const tin = s.search.get("tin") ?? "";
        if (!/^\d{9}$/.test(tin))
          return json(r, { message: "The TIN must be 9 digits." }, 400);
        return json(r, w.payees[tin] ?? { found: false });
      },
    ],
    [
      "POST",
      /^\/api\/v1\/clients\/[^/]+\/purchase-transactions$/,
      (r) => json(r, { ...LISTED, id: "new" }, 201),
    ],
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

/** An expense already in the books, with payee details (for the list). */
const LISTED = {
  id: "e1900000-0000-4000-8000-000000000001",
  txnDate: "2026-09-10",
  referenceNo: "OR-0007",
  vendor: "INVENTED CONSULTANT",
  vendorTin: "111-222-333-00000",
  vendorBranch: "00000",
  payeeKind: "individual",
  payeeLastName: "Santos",
  payeeFirstName: "Maria",
  payeeMiddleName: "Reyes",
  description: "Consulting",
  categoryId: "c1",
  netAmount: 1000,
  isCapitalGood: false,
  deductible: true,
  source: "MANUAL",
  status: "posted",
};

const world = (over: Partial<World> = {}): World => ({
  store: new Map(),
  check: OK_CHECK,
  payees: {},
  file: "INVENTED,DAT,CONTENT\n",
  ...over,
});
function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const addDraft = (w: World, k = 1, over: Record<string, unknown> = {}) => {
  const id = idOf(k);
  w.store.set(id, detail({ id, ...over }));
  return id;
};
const panelOf = (page: Page) => page.locator("[data-alphalist-panel]");
const BIR_EMAIL = {
  name: "good.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 invented"),
};
const downloadBtn = (page: Page) =>
  page.getByRole("button", { name: "Download alphalist (.DAT)" });

// ===========================================================================

test.describe("W19 payee details on an expense (hermetic)", () => {
  async function openAdd(page: Page) {
    await page.goto(`/clients/${CLIENT.id}/expenses`);
    await page.getByRole("button", { name: "+ Add record" }).first().click();
    await expect(page.locator("[data-payee-details]")).toBeVisible();
  }
  async function fillLine(page: Page) {
    const acct = page.getByPlaceholder("Select account…");
    await acct.focus();
    await page.getByText("Office Supplies").click();
    await page.getByPlaceholder("Enter name or description").fill("Paper");
  }

  test("the list shows the payee kind, name parts and branch under the supplier", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/clients/${CLIENT.id}/expenses`);
    await expect(page.locator("[data-payee-line]")).toHaveText(
      "Individual · Santos, Maria Reyes · branch 00000",
    );
    clean(unmocked, dialogs);
  });

  test("an individual payee is entered and saved: the POST carries the payee fields", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await openAdd(page);
    await page.getByLabel("Individual", { exact: true }).check();
    await page.getByLabel("Branch").fill("00012");
    await page.getByLabel("Last name").fill("Cruz");
    await page.getByLabel("First name").fill("Ana");
    await fillLine(page);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(
        () =>
          seen.filter(
            (s) => s.method === "POST" && s.path.endsWith("/purchase-transactions"),
          ).length,
      )
      .toBe(1);
    const post = seen.find(
      (s) => s.method === "POST" && s.path.endsWith("/purchase-transactions"),
    )!;
    expect(post.request.postDataJSON()).toMatchObject({
      vendorBranch: "00012",
      payeeKind: "individual",
      payeeLastName: "Cruz",
      payeeFirstName: "Ana",
    });
    expect(post.request.postDataJSON()).not.toHaveProperty("payeeMiddleName");
    clean(unmocked, dialogs);
  });

  test("a TIN of 9 digits fills the blank payee boxes once, with the note; typed boxes stay", async ({
    page,
  }) => {
    const w = world({
      payees: {
        "111222333": {
          found: true,
          tin: "111222333",
          branch: "00000",
          payeeKind: "individual",
          registeredName: "",
          lastName: "Santos",
          firstName: "Maria",
          middleName: "Reyes",
          vendor: "Maria Santos",
        },
      },
    });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await openAdd(page);
    await page.getByPlaceholder("000-000-000-00000").fill("111-222-33");
    await quiet();
    expect(seen.filter((s) => s.path.endsWith("/payee-details"))).toHaveLength(0);
    await page.getByPlaceholder("000-000-000-00000").fill("111-222-333");
    await expect(page.getByLabel("Last name")).toHaveValue("Santos");
    await expect(page.getByLabel("First name")).toHaveValue("Maria");
    await expect(page.getByLabel("Middle name")).toHaveValue("Reyes");
    await expect(page.getByLabel("Branch")).toHaveValue("00000");
    await expect(page.locator("[data-payee-prefilled]")).toHaveText(
      "Filled from the latest expense with this TIN.",
    );
    // Editing the TIN afterwards asks nothing more for the same digits, and overwrites nothing.
    await page.getByLabel("Last name").fill("Santos-Cruz");
    await page.getByPlaceholder("000-000-000-00000").fill("111222333");
    await quiet();
    const asks = seen.filter((s) => s.path.endsWith("/payee-details"));
    expect(asks).toHaveLength(1);
    expect(asks[0]!.search.get("tin")).toBe("111222333");
    await expect(page.getByLabel("Last name")).toHaveValue("Santos-Cruz");
    clean(unmocked, dialogs);
  });

  test("a TIN nobody has used shows nothing", async ({ page }) => {
    const w = world();
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await openAdd(page);
    await page.getByPlaceholder("000-000-000-00000").fill("999-888-777");
    await quiet();
    // The same nine digits typed another way ask nothing more (the boxes are still blank).
    await page.getByPlaceholder("000-000-000-00000").fill("999888777");
    await quiet();
    await page.getByPlaceholder("000-000-000-00000").fill("999-888-777");
    await quiet();
    expect(seen.filter((s) => s.path.endsWith("/payee-details"))).toHaveLength(1);
    await expect(page.locator("[data-payee-prefilled]")).toHaveCount(0);
    await expect(page.getByLabel("Branch")).toHaveValue("");
    clean(unmocked, dialogs);
  });
});

test.describe("W19 the Alphalist panel (hermetic)", () => {
  test("ok: Schedule 1, Item 19, the note, a working download under the API's exact file name", async ({
    page,
  }) => {
    const w = world();
    const id = addDraft(w);
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    const panel = panelOf(page);
    await expect(panel.locator("[data-schedule1]")).toHaveText(
      "3 rows · income ₱120,000.00 · tax ₱2,400.00",
    );
    await expect(panel.locator("[data-item19]")).toHaveText("₱2,650.00");
    await expect(panel.locator("[data-schedule2]")).toHaveCount(0);
    await expect(panel.locator("[data-alphalist-notes] li")).toHaveText([
      OK_CHECK.notes[0]!,
    ]);
    await expect(panel.locator("[data-validate-note]")).toHaveText(VALIDATE);
    await expect(downloadBtn(page)).toBeEnabled();
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      downloadBtn(page).click(),
    ]);
    expect(dl.suggestedFilename()).toBe(FILE_NAME);
    clean(unmocked, dialogs);
  });

  test("not ok: every refusal word for word, the button disabled, the note still there; Refresh asks again", async ({
    page,
  }) => {
    const w = world({ check: BAD_CHECK });
    const id = addDraft(w);
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    const panel = panelOf(page);
    await expect(panel.locator("[data-alphalist-refusals] li")).toHaveText(REFUSALS);
    await expect(downloadBtn(page)).toBeDisabled();
    await expect(panel.locator("[data-validate-note]")).toHaveText(VALIDATE);
    // The owner fixes the expenses; Refresh asks again and the panel turns ok.
    w.check = OK_CHECK;
    const asked = () => seen.filter((s) => s.path.endsWith("/alphalist/check")).length;
    await quiet();
    const before = asked();
    await panel.getByRole("button", { name: "Refresh" }).click();
    await expect.poll(asked).toBeGreaterThan(before);
    await expect(downloadBtn(page)).toBeEnabled();
    await expect(panel.locator("[data-alphalist-refusals]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("Schedule 2 shows (rows and income) only when it has rows", async ({ page }) => {
    const w = world({
      check: { ...OK_CHECK, schedule2: { rows: 2, income: "5000.00" } },
    });
    const id = addDraft(w);
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(panelOf(page).locator("[data-schedule2]")).toHaveText(
      "2 rows · income ₱5,000.00",
    );
    clean(unmocked, dialogs);
  });

  test("a filed return with source none: the refusal sentence, no button", async ({
    page,
  }) => {
    const w = world({ check: NONE_CHECK });
    const id = addDraft(w, 2, { status: "filed", filedAt: "2026-10-05T02:00:00.000Z" });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(panelOf(page).locator("[data-alphalist-refusals] li")).toHaveText(
      NONE_CHECK.refusals,
    );
    await expect(downloadBtn(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("a filed return with a stored alphalist: the panel with the download", async ({
    page,
  }) => {
    const w = world({ check: { ...OK_CHECK, source: "stored" } });
    const id = addDraft(w, 3, {
      status: "filed",
      filedAt: "2026-10-05T02:00:00.000Z",
      alphalist: { stored: true, warning: null },
    });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(downloadBtn(page)).toBeEnabled();
    clean(unmocked, dialogs);
  });
});

test.describe("W19 Mark as filed on a 1601-EQ (hermetic)", () => {
  const dialogOf = (page: Page) => page.locator("[data-confirmation-dialog]");

  test("a failing check: the sentence and refusals in the dialog, the file button waits for the tick, then no alphalist is stored and the warning shows", async ({
    page,
  }) => {
    const w = world({ check: BAD_CHECK });
    const id = addDraft(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const step = dialogOf(page).locator('[data-alphalist-step="problems"]');
    await expect(step).toContainText(PROBLEMS);
    await expect(step.locator("li")).toHaveText(REFUSALS);
    const fileBtn = dialogOf(page).getByRole("button", { name: "Mark as filed" });
    await expect(fileBtn).toBeDisabled();
    expect(seen.filter((s) => s.path.endsWith("/mark-filed"))).toHaveLength(0);
    // The BIR email is checked as for any return; the tick is on top of it.
    await dialogOf(page).locator('input[type="file"]').setInputFiles(BIR_EMAIL);
    await dialogOf(page).getByRole("button", { name: "Check", exact: true }).click();
    await expect(dialogOf(page).locator('[data-check-result="ok"]')).toBeVisible();
    await expect(fileBtn).toBeDisabled();
    await dialogOf(page).getByLabel("I understand").check();
    await expect(fileBtn).toBeEnabled();
    await fileBtn.click();
    await expect
      .poll(() => seen.filter((s) => s.path.endsWith("/mark-filed")).length)
      .toBe(1);
    const warn = page.locator("[data-alphalist-warning]");
    await expect(warn.locator("p")).toHaveText(WARNING_MESSAGE);
    await expect(warn.locator("li")).toHaveText(REFUSALS);
    clean(unmocked, dialogs);
  });

  test("a passing check: says the alphalist will be stored, asks for no tick, files, shows no warning", async ({
    page,
  }) => {
    const w = world();
    const id = addDraft(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialogOf(page).locator('[data-alphalist-step="ok"]')).toHaveText(
      WILL_STORE,
    );
    await expect(dialogOf(page).getByLabel("I understand")).toHaveCount(0);
    const fileBtn = dialogOf(page).getByRole("button", { name: "Mark as filed" });
    await dialogOf(page).locator('input[type="file"]').setInputFiles(BIR_EMAIL);
    await dialogOf(page).getByRole("button", { name: "Check", exact: true }).click();
    await expect(dialogOf(page).locator('[data-check-result="ok"]')).toBeVisible();
    await expect(fileBtn).toBeEnabled();
    await fileBtn.click();
    await expect
      .poll(() => seen.filter((s) => s.path.endsWith("/mark-filed")).length)
      .toBe(1);
    await expect(page.locator("[data-alphalist-warning]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

// track-b-w14.spec.ts — hermetic browser tests for W14: "Download clear copy"
// on every filed return whose form has a print map (R1), and the export list
// naming both kinds (R2). Built against Track A U13's contract as written in
// the W14 brief: GET /bir-forms/:id gains clearCopyAvailable; POST
// /bir-forms/:id/clear-copy returns the export; the existing
// GET /bir-forms/:id/exports/:exportId/url signs it.
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// The signed URL points at an invented host the test answers itself.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222e1";

const CLIENT = {
  id: "c1400000-0000-4000-8000-0000000000e1",
  businessName: "INVENTED FOURTEEN GROCERY",
  tin: "000-141-014-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};

const ME = {
  user: {
    id: "u1400000-0000-4000-8000-0000000000e1",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: [
      "BIRForms:Read",
      "BIRForms:Create",
      "BIRForms:Update",
      "BIRForms:File",
      "Clients:Read",
    ],
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
  },
};

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

const SIGNED_HOST = "https://files.example.test";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

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
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: ME.user.id,
          fullName: ME.user.fullName,
          email: ME.user.email,
          userType: "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/.+$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2551Q)],
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
  // The signed download URL (an invented host): the PDF, as an attachment.
  await page.context().route(`${SIGNED_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: {
        "Content-Disposition": 'attachment; filename="2551Q-2026-Q3-clear-copy.pdf"',
      },
      body: PDF,
    }),
  );
  return { seen, unmocked, dialogs, quiet };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// Invented returns
// ---------------------------------------------------------------------------

const F2551Q = "f1400000-0000-4000-8000-000000002551";
const F2551Q_DRAFT = "f1400000-0000-4000-8000-000000002552";
const F1701 = "f1400000-0000-4000-8000-000000001701";
const EXPORT_PDF = "e1400000-0000-4000-8000-0000000000e1";

const COMPUTED_2551Q = {
  rows: [{ due: 4500 }],
  i14: 4500,
  i18: 0,
  i19: 4500,
  i23: 0,
  i24: 4500,
};

function form(over: Record<string, unknown>) {
  return {
    id: F2551Q,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    form: "2551Q",
    status: "filed",
    period: "2026-Q3",
    filedAt: "2026-10-09T02:00:00.000Z",
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-09T02:00:00.000Z",
    amendsId: null,
    sequence: 1,
    data: {
      year: "2026",
      periodType: "calendar",
      amended: "no",
      taxRelief: "no",
      itRate: "graduated",
      rows: [{ atc: "PT010", taxable: "150000", rate: "3" }],
    },
    computed: COMPUTED_2551Q,
    exports: [],
    filedSnapshot: null,
    clearCopyAvailable: true,
    ...over,
  };
}

const filed2551Q = (over: Record<string, unknown> = {}) => form(over);
const draft2551Q = () =>
  form({ id: F2551Q_DRAFT, status: "draft", filedAt: null, clearCopyAvailable: false });
const filed1701 = () =>
  form({
    id: F1701,
    form: "1701",
    period: "2025",
    data: {},
    computed: null,
    clearCopyAvailable: false,
  });

/** The list rows: summaries. W15: they carry clearCopyAvailable (U14). */
const summaryOf = (d: ReturnType<typeof form>) => {
  const { data: _d, computed: _c, exports: _e, filedSnapshot: _s, ...s } = d;
  return s;
};

const DETAIL = (id: string) => new RegExp(`^/api/v1/bir-forms/${id}$`);
const CLEAR_COPY = new RegExp(`^/api/v1/bir-forms/${F2551Q}/clear-copy$`);
const EXPORT_URL = new RegExp(`^/api/v1/bir-forms/${F2551Q}/exports/${EXPORT_PDF}/url$`);

const PDF_EXPORT = {
  id: EXPORT_PDF,
  kind: "pdf",
  filename: "2551Q-2026-Q3-clear-copy.pdf",
  createdAt: "2026-10-10T03:00:00.000Z",
};

function clearCopyApi(post: Handler = (r) => json(r, PDF_EXPORT, 201)): Entry[] {
  return [
    ["GET", DETAIL(F2551Q), (r) => json(r, filed2551Q())],
    ["GET", DETAIL(F2551Q_DRAFT), (r) => json(r, draft2551Q())],
    ["GET", DETAIL(F1701), (r) => json(r, filed1701())],
    ["POST", CLEAR_COPY, post],
    [
      "GET",
      EXPORT_URL,
      (r) => json(r, { url: `${SIGNED_HOST}/clear-copy.pdf?sig=invented` }),
    ],
  ];
}

const listApi = (): Entry => [
  "GET",
  /^\/api\/v1\/bir-forms$/,
  (r) => json(r, [filed2551Q(), draft2551Q(), filed1701()].map(summaryOf)),
];

const BUTTON = "Download clear copy";
const count = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path)).length;

// ---------------------------------------------------------------------------
// T1 — "Download clear copy" (R1)
// ---------------------------------------------------------------------------

test.describe("T1 Download clear copy (hermetic)", () => {
  test("T1 a filed 2551Q with a clear copy shows the button on its own page", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await mockApi(page, clearCopyApi());
    await page.goto(`/bir-forms/${F2551Q}`);
    await expect(page.getByRole("button", { name: BUTTON })).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T1 a click sends one POST, then one URL GET, and the PDF downloads", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const { seen, unmocked, dialogs, quiet } = await mockApi(
      page,
      clearCopyApi(async (r) => {
        await held;
        return json(r, PDF_EXPORT, 201);
      }),
    );
    await page.goto(`/bir-forms/${F2551Q}`);
    // W15 R2: the attachment downloads in the page itself, with no new tab.
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: BUTTON }).click();
    await expect(page.getByRole("button", { name: "Preparing…" })).toBeDisabled();
    release();
    const download = await downloading;
    expect(download.url()).toBe(`${SIGNED_HOST}/clear-copy.pdf?sig=invented`);
    expect(download.suggestedFilename()).toBe("2551Q-2026-Q3-clear-copy.pdf");
    await expect(page.getByRole("button", { name: BUTTON })).toBeEnabled();
    await quiet();
    expect(count(seen, "POST", CLEAR_COPY)).toBe(1);
    expect(count(seen, "GET", EXPORT_URL)).toBe(1);
    const post = seen.findIndex((s) => s.method === "POST" && CLEAR_COPY.test(s.path));
    const url = seen.findIndex((s) => s.method === "GET" && EXPORT_URL.test(s.path));
    expect(post).toBeLessThan(url);
    clean(unmocked, dialogs);
  });

  test("T1 a draft, and a filed 1701 without a clear copy, show no button", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await mockApi(page, clearCopyApi());
    await page.goto(`/bir-forms/${F2551Q_DRAFT}`);
    await expect(page.getByRole("button", { name: /Save changes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
    await page.goto(`/bir-forms/${F1701}`);
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T1 a 409 shows its message word for word, and no URL is asked for", async ({
    page,
  }) => {
    const MESSAGE =
      "INVENTED: the print engine could not place Item 14 (taxable amount).";
    const { seen, unmocked, dialogs, quiet } = await mockApi(
      page,
      clearCopyApi((r) => json(r, { message: MESSAGE }, 409)),
    );
    await page.goto(`/bir-forms/${F2551Q}`);
    await page.getByRole("button", { name: BUTTON }).click();
    await expect(page.locator("[data-clear-copy-error]")).toHaveText(MESSAGE);
    await expect(page.getByRole("button", { name: BUTTON })).toBeEnabled();
    await quiet();
    expect(count(seen, "POST", CLEAR_COPY)).toBe(1);
    expect(count(seen, "GET", EXPORT_URL)).toBe(0);
    clean(unmocked, dialogs);
  });

  test("T1 the BIR Forms page shows the button on the filed 2551Q only, and it downloads", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, [
      ...clearCopyApi(),
      listApi(),
    ]);
    await page.goto("/bir-forms");
    const row = (id: string) => page.locator(`[data-form-id="${id}"]`);
    await expect(row(F2551Q).getByRole("button", { name: BUTTON })).toBeVisible();
    await quiet();
    await expect(row(F2551Q_DRAFT).getByRole("button", { name: BUTTON })).toHaveCount(0);
    await expect(row(F1701).getByRole("button", { name: BUTTON })).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await row(F2551Q).getByRole("button", { name: BUTTON }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("2551Q-2026-Q3-clear-copy.pdf");
    // The click downloads; it does not open the form.
    await expect(page).toHaveURL(/\/bir-forms$/);
    await quiet();
    expect(count(seen, "POST", CLEAR_COPY)).toBe(1);
    expect(count(seen, "GET", EXPORT_URL)).toBe(1);
    // A draft needs no clear-copy check: its detail is never asked for here.
    expect(count(seen, "GET", DETAIL(F2551Q_DRAFT))).toBe(0);
    clean(unmocked, dialogs);
  });

  test("T1 on the BIR Forms page a 409 shows its message in the row", async ({
    page,
  }) => {
    const MESSAGE = "INVENTED: this return has no print map yet.";
    const { unmocked, dialogs } = await mockApi(page, [
      ...clearCopyApi((r) => json(r, { message: MESSAGE }, 409)),
      listApi(),
    ]);
    await page.goto("/bir-forms");
    const row = page.locator(`[data-form-id="${F2551Q}"]`);
    await row.getByRole("button", { name: BUTTON }).click();
    await expect(row.locator("[data-clear-copy-error]")).toHaveText(MESSAGE);
    await expect(page).toHaveURL(/\/bir-forms$/);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T2 — the export list names both kinds (R2)
// ---------------------------------------------------------------------------

test.describe("T2 the export list (hermetic)", () => {
  test("T2 the export list shows the PDF beside the XML, by kind", async ({ page }) => {
    const exports = [
      PDF_EXPORT,
      {
        id: "e1400000-0000-4000-8000-0000000000e2",
        kind: "xml",
        filename: "000141014000-2551Q-092026.xml",
        createdAt: "2026-10-09T02:30:00.000Z",
      },
    ];
    const { unmocked, dialogs } = await mockApi(page, [
      ...clearCopyApi(),
      ["GET", DETAIL(F2551Q), (r) => json(r, filed2551Q({ exports }))],
    ]);
    await page.goto(`/bir-forms/${F2551Q}`);
    const items = page.locator("[data-export-kind]");
    await expect(items).toHaveCount(2);
    await expect(page.locator('[data-export-kind="pdf"]')).toContainText(
      "Clear copy (PDF)",
    );
    await expect(page.locator('[data-export-kind="pdf"]')).toContainText(
      "2551Q-2026-Q3-clear-copy.pdf",
    );
    await expect(page.locator('[data-export-kind="xml"]')).toContainText(
      "eBIRForms file (XML)",
    );
    await expect(page.locator('[data-export-kind="xml"]')).toContainText(
      "000141014000-2551Q-092026.xml",
    );
    clean(unmocked, dialogs);
  });

  test("T2 a new clear copy appears in the export list after the download", async ({
    page,
  }) => {
    let made = false;
    const { unmocked, dialogs } = await mockApi(page, [
      ...clearCopyApi((r) => {
        made = true;
        return json(r, PDF_EXPORT, 201);
      }),
      [
        "GET",
        DETAIL(F2551Q),
        (r) => json(r, filed2551Q({ exports: made ? [PDF_EXPORT] : [] })),
      ],
    ]);
    await page.goto(`/bir-forms/${F2551Q}`);
    await expect(page.locator("[data-export-kind]")).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: BUTTON }).click();
    await downloading;
    await expect(page.locator('[data-export-kind="pdf"]')).toContainText(
      "Clear copy (PDF)",
    );
    clean(unmocked, dialogs);
  });
});

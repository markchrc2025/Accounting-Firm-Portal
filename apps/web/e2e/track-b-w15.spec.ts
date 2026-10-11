// track-b-w15.spec.ts — hermetic browser tests for W15: "Delete draft" (R1);
// clear copies and the eBIRForms XML download as files, and the BIR Forms list
// reads clearCopyAvailable from its own rows (R2); the Google Drive card in
// Settings (R3); a client's Drive folder (R4); the "From Google Drive" tab
// (R5); every pile prepares first (R6); a Drive file on the review page (R7).
//
// Built against Track A U14's contract as written in the W15 brief.
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// Signed links point at an invented host the test answers itself.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222f1";
const ROBOT = "portal-robot@invented-project.iam.gserviceaccount.test";

const CLIENT = {
  id: "c1500000-0000-4000-8000-0000000000f1",
  businessName: "INVENTED FIFTEEN BAKERY",
  tin: "000-151-015-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
  driveFolder: null as null | { id: string; name: string; link: string },
};

const ME = {
  user: {
    id: "u1500000-0000-4000-8000-0000000000f1",
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
      "Clients:Update",
      "Expenses:Read",
      "Expenses:Create",
      "Users:Read",
    ],
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

const SIGNED = "https://files.example.test";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function mockApi(page: Page, extra: Entry[], client = CLIENT) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  const dialogs: string[] = [];
  const popups: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  page.on("popup", (p) => popups.push(p.url()));
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
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [client])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, client)],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2551Q)],
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
  // The signed links (an invented host): downloads come back as attachments,
  // a gone Drive photo as 404, every other photo as a 1×1 PNG.
  await page.context().route(`${SIGNED}/**`, (route) => {
    const url = route.request().url();
    if (url.includes("/download/")) {
      const name = decodeURIComponent(url.split("/download/")[1]!.split("?")[0]!);
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        headers: { "Content-Disposition": `attachment; filename="${name}"` },
        body: Buffer.from("INVENTED FILE"),
      });
    }
    if (url.includes("/gone/")) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  return { seen, unmocked, dialogs, popups, quiet };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}

const count = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path)).length;

async function manilaClock(page: Page, isoManila: string) {
  await page.clock.setFixedTime(new Date(`${isoManila}+08:00`));
}

// ---------------------------------------------------------------------------
// Invented returns
// ---------------------------------------------------------------------------

const DRAFT = "f1500000-0000-4000-8000-000000002551";
const DRAFT_LOCKED = "f1500000-0000-4000-8000-000000002552";
const FILED = "f1500000-0000-4000-8000-000000002553";
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
    id: DRAFT,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    form: "2551Q",
    status: "draft",
    period: "2026-Q3",
    filedAt: null,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-01T01:00:00.000Z",
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
    clearCopyAvailable: false,
    canDelete: true,
    ...over,
  };
}
const draft = () => form({});
const lockedDraft = () => form({ id: DRAFT_LOCKED, canDelete: false });
const filed = (over: Record<string, unknown> = {}) =>
  form({
    id: FILED,
    status: "filed",
    filedAt: "2026-10-09T02:00:00.000Z",
    clearCopyAvailable: true,
    canDelete: false,
    ...over,
  });

const DETAIL = (id: string) => new RegExp(`^/api/v1/bir-forms/${id}$`);
const LIST = /^\/api\/v1\/bir-forms$/;
const summaryOf = (d: ReturnType<typeof form>) => {
  const { data: _d, computed: _c, exports: _e, filedSnapshot: _s, ...s } = d;
  return s;
};
const formsApi = (): Entry[] => [
  ["GET", DETAIL(DRAFT), (r) => json(r, draft())],
  ["GET", DETAIL(DRAFT_LOCKED), (r) => json(r, lockedDraft())],
  ["GET", DETAIL(FILED), (r) => json(r, filed())],
  ["GET", LIST, (r) => json(r, [draft(), lockedDraft(), filed()].map(summaryOf))],
];

// ---------------------------------------------------------------------------
// Invented Drive folder and piles
// ---------------------------------------------------------------------------

const FOLDER = {
  id: "drv-folder-0001",
  name: "INVENTED Receipts 2026",
  link: "https://drive.google.com/drive/folders/drv-folder-0001",
};
const LINKED = { ...CLIENT, driveFolder: FOLDER };

const driveFile = (over: Record<string, unknown>) => ({
  driveFileId: "drv-file-x",
  name: "x.jpg",
  path: "",
  mimeType: "image/jpeg",
  bytes: 250_000,
  modifiedTime: "2026-09-20T03:00:00.000Z",
  alreadyRead: false,
  problem: null,
  ...over,
});
const DRIVE_FILES = [
  driveFile({ driveFileId: "drv-new-1", name: "IMG_0101.HEIC", mimeType: "image/heic" }),
  driveFile({
    driveFileId: "drv-new-2",
    name: "supplier-bill.pdf",
    path: "September/Suppliers",
    mimeType: "application/pdf",
    bytes: 1_400_000,
  }),
  driveFile({
    driveFileId: "drv-bad",
    name: "Notes about receipts",
    mimeType: "application/vnd.google-apps.document",
    bytes: null,
    problem: "A Google Docs file, not a photo or PDF.",
  }),
  driveFile({ driveFileId: "drv-old-1", name: "IMG_0001.JPG", alreadyRead: true }),
];

const STATUS = /^\/api\/v1\/ai\/status$/;
const ESTIMATE = /^\/api\/v1\/ai\/estimate$/;
const SCANS = /^\/api\/v1\/receipt-scans$/;
const SCAN = /^\/api\/v1\/receipt-scans\/(?!drive)[^/]+$/;
const DRIVE_LIST = /^\/api\/v1\/receipt-scans\/drive$/;
const DRIVE_STATUS = /^\/api\/v1\/drive\/status$/;
const FOLDER_ROUTE = /^\/api\/v1\/clients\/[^/]+\/drive-folder$/;
const PILE_ID = "5c150000-0000-4000-8000-0000000000f1";

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

function pile(over: Record<string, unknown> = {}) {
  return {
    id: PILE_ID,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    periodFrom: "2026-07-01",
    periodTo: "2026-09-30",
    status: "preparing",
    model: "invented-model",
    fileCount: 2,
    rowCount: 0,
    estimatedUsd: 0.1,
    actualUsd: null,
    createdAt: "2026-10-11T01:15:00.000Z",
    createdByName: "Test Operator",
    readyAt: null,
    problem: null,
    ...over,
  };
}
const pileDetail = (over: Record<string, unknown> = {}, files: unknown[] = []) => ({
  scan: pile(over),
  files,
  totals: {
    files: files.length,
    rows: 0,
    posted: 0,
    held: 0,
    rejected: 0,
    grossAmount: 0,
  },
});

const driveConnected = { configured: true, robotEmail: ROBOT, problem: null };

function scanApi(
  over: { drive?: unknown; files?: unknown[]; truncated?: boolean } = {},
): Entry[] {
  return [
    ["GET", STATUS, (r) => json(r, aiStatus)],
    ["GET", SCANS, (r) => json(r, [])],
    ["GET", DRIVE_STATUS, (r) => json(r, over.drive ?? driveConnected)],
    [
      "GET",
      DRIVE_LIST,
      (r) =>
        json(r, {
          folder: FOLDER,
          files: over.files ?? DRIVE_FILES,
          truncated: over.truncated ?? false,
        }),
    ],
    [
      "GET",
      ESTIMATE,
      (r) => json(r, { estimatedUsd: 0.1, remainingUsd: 19, fits: true }),
    ],
    ["GET", SCAN, (r) => json(r, pileDetail())],
  ];
}

// ---------------------------------------------------------------------------
// T1 — "Delete draft" (R1) and the "From Google Drive" tab (R5, R6)
// ---------------------------------------------------------------------------

const DIALOG_BODY = `The draft 2551Q for 2026-Q3 for ${CLIENT.businessName} will be removed. This can't be undone. Filed returns are never affected.`;

test.describe("T1 Delete draft (hermetic)", () => {
  test("T1 a deletable draft shows Delete draft; Keep it sends nothing", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, formsApi());
    await page.goto(`/bir-forms/${DRAFT}`);
    await page.getByRole("button", { name: "Delete draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this draft?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(DIALOG_BODY);
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toHaveCount(0);
    await quiet();
    expect(count(seen, "DELETE", DETAIL(DRAFT))).toBe(0);
    clean(unmocked, dialogs);
  });

  test("T1 Delete draft sends one DELETE and lands on BIR Forms with Draft deleted.", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, [
      ...formsApi(),
      ["DELETE", DETAIL(DRAFT), (r) => json(r, { deleted: true, id: DRAFT })],
    ]);
    await page.goto(`/bir-forms/${DRAFT}`);
    await page.getByRole("button", { name: "Delete draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this draft?" });
    await dialog.getByRole("button", { name: "Delete draft" }).click();
    await expect(page).toHaveURL(/\/bir-forms$/);
    await expect(page.getByText("Draft deleted.", { exact: true })).toBeVisible();
    await quiet();
    expect(count(seen, "DELETE", DETAIL(DRAFT))).toBe(1);
    clean(unmocked, dialogs);
  });

  test("T1 a filed return, and a draft that cannot be deleted, show no button", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await mockApi(page, formsApi());
    await page.goto(`/bir-forms/${FILED}`);
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);
    await page.goto(`/bir-forms/${DRAFT_LOCKED}`);
    await expect(page.getByRole("button", { name: /Save changes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T1 a 409 and a 403 show their messages in the dialog", async ({ page }) => {
    let status = 409;
    const words: Record<number, string> = {
      409: "A filed return can't be deleted; it is the record of what was filed.",
      403: "INVENTED: you may not delete this client's returns.",
    };
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, [
      ...formsApi(),
      ["DELETE", DETAIL(DRAFT), (r) => json(r, { message: words[status] }, status)],
    ]);
    await page.goto(`/bir-forms/${DRAFT}`);
    await page.getByRole("button", { name: "Delete draft" }).click();
    const dialog = page.getByRole("dialog", { name: "Delete this draft?" });
    await dialog.getByRole("button", { name: "Delete draft" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(words[409]!);
    status = 403;
    await dialog.getByRole("button", { name: "Delete draft" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(words[403]!);
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${DRAFT}$`));
    await quiet();
    expect(count(seen, "DELETE", DETAIL(DRAFT))).toBe(2);
    clean(unmocked, dialogs);
  });
});

test.describe("T1 the From Google Drive tab (hermetic)", () => {
  test("T1 the tab ticks the new files, holds back the problem file, folds away the read ones, and sends exactly the ticked ids", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-11T10:00:00");
    const { seen, unmocked, dialogs, quiet } = await mockApi(
      page,
      [
        ...scanApi(),
        [
          "POST",
          DRIVE_LIST,
          (r) => json(r, { id: PILE_ID, status: "preparing", files: 2 }, 202),
        ],
      ],
      LINKED,
    );
    await page.goto(`/receipt-scans?clientId=${CLIENT.id}`);
    await page.getByRole("tab", { name: "From Google Drive" }).click();
    const tab = page.locator("[data-drive-tab]");
    await expect(tab.locator("[data-drive-header]")).toHaveText(
      `3 new files in ${FOLDER.name}`,
    );
    const box = (name: string) => tab.getByRole("checkbox", { name });
    await expect(box("IMG_0101.HEIC")).toBeChecked();
    await expect(box("supplier-bill.pdf")).toBeChecked();
    await expect(box("Notes about receipts")).not.toBeChecked();
    await expect(box("Notes about receipts")).toBeDisabled();
    await expect(tab.getByText("A Google Docs file, not a photo or PDF.")).toBeVisible();
    // Drive gives a Google Docs file no size: none is shown.
    await expect(
      tab.locator("li", { hasText: "Notes about receipts" }),
    ).not.toContainText("KB");
    await expect(tab.getByText("September/Suppliers")).toBeVisible();
    // Already read: folded away, and not ticked.
    const read = tab.locator("details[data-already-read]");
    await expect(read.locator("summary")).toHaveText("Already read (1)");
    await expect(read).not.toHaveAttribute("open", "");
    await expect(box("IMG_0001.JPG")).toBeHidden();
    await read.locator("summary").click();
    await expect(box("IMG_0001.JPG")).not.toBeChecked();
    // The estimate counts the ticked files: one photo, one PDF (by mimeType).
    await expect(tab.locator("[data-scan-estimate]")).toContainText("for 2 files.");
    expect(
      seen
        .filter((s) => s.method === "GET" && ESTIMATE.test(s.path))
        .map((s) => s.search.toString()),
    ).toContain("images=1&pdfs=1");
    await tab.getByRole("button", { name: "Send 2 files" }).click();
    await expect(page).toHaveURL(new RegExp(`/receipt-scans/${PILE_ID}$`));
    await expect(page.locator("[data-scan-status]").first()).toHaveText("Preparing…");
    await quiet();
    const posts = seen.filter((s) => s.method === "POST" && DRIVE_LIST.test(s.path));
    expect(posts).toHaveLength(1);
    expect(Object.fromEntries(posts[0]!.search)).toEqual({
      clientId: CLIENT.id,
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    expect(posts[0]!.request.postDataJSON()).toEqual({
      driveFileIds: ["drv-new-1", "drv-new-2"],
    });
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T2 — downloads as files; the list reads its own rows (R2)
// ---------------------------------------------------------------------------

test.describe("T2 downloads as files (hermetic)", () => {
  test("T2 the eBIRForms XML downloads with the server's filename, and no popup opens", async ({
    page,
  }) => {
    const NAME = "000151015000-2551Q-092026.xml";
    const { unmocked, dialogs, popups } = await mockApi(page, [
      ...formsApi(),
      [
        "POST",
        new RegExp(`^/api/v1/bir-forms/${DRAFT}/export$`),
        (r) =>
          json(
            r,
            {
              id: "x1",
              kind: "xml",
              filename: NAME,
              url: `${SIGNED}/download/${NAME}?sig=i`,
            },
            201,
          ),
      ],
    ]);
    await page.goto(`/bir-forms/${DRAFT}`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export eBIRForms XML" }).click();
    expect((await download).suggestedFilename()).toBe(NAME);
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${DRAFT}$`));
    expect(popups).toEqual([]);
    clean(unmocked, dialogs);
  });

  test("T2 the clear copy downloads with the server's filename, and no popup opens", async ({
    page,
  }) => {
    const NAME = "2551Q-2026-Q3-clear-copy.pdf";
    const { seen, unmocked, dialogs, popups, quiet } = await mockApi(page, [
      ...formsApi(),
      [
        "POST",
        new RegExp(`^/api/v1/bir-forms/${FILED}/clear-copy$`),
        (r) =>
          json(
            r,
            { id: "e1", kind: "pdf", filename: NAME, createdAt: "2026-10-11T01:00:00Z" },
            201,
          ),
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED}/exports/e1/url$`),
        (r) => json(r, { url: `${SIGNED}/download/${NAME}?sig=i` }),
      ],
    ]);
    await page.goto(`/bir-forms/${FILED}`);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download clear copy" }).click();
    expect((await download).suggestedFilename()).toBe(NAME);
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${FILED}$`));
    await quiet();
    expect(popups).toEqual([]);
    expect(count(seen, "POST", new RegExp(`/bir-forms/${FILED}/clear-copy$`))).toBe(1);
    clean(unmocked, dialogs);
  });

  test("T2 the BIR Forms list reads clearCopyAvailable from its rows and asks no detail", async ({
    page,
  }) => {
    // A row from an older API carries no flag: the list asks nothing for it
    // either, and shows no button.
    const OLDER = "f1500000-0000-4000-8000-000000002554";
    const { clearCopyAvailable: _flag, ...olderRow } = summaryOf(filed({ id: OLDER }));
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, [
      ...formsApi(),
      [
        "GET",
        LIST,
        (r) => json(r, [...[draft(), lockedDraft(), filed()].map(summaryOf), olderRow]),
      ],
      ["GET", DETAIL(OLDER), (r) => json(r, filed({ id: OLDER }))],
    ]);
    await page.goto("/bir-forms");
    const row = (id: string) => page.locator(`[data-form-id="${id}"]`);
    await expect(row(OLDER)).toBeVisible();
    await expect(
      row(FILED).getByRole("button", { name: "Download clear copy" }),
    ).toBeVisible();
    await expect(
      row(DRAFT).getByRole("button", { name: "Download clear copy" }),
    ).toHaveCount(0);
    await quiet();
    await expect(
      row(OLDER).getByRole("button", { name: "Download clear copy" }),
    ).toHaveCount(0);
    for (const id of [DRAFT, DRAFT_LOCKED, FILED, OLDER]) {
      expect(count(seen, "GET", DETAIL(id)), id).toBe(0);
    }
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// T3 — Settings, the folder link, piles that prepare, the review page (R3–R7)
// ---------------------------------------------------------------------------

const integrationsApi = (drive: unknown): Entry[] => [
  ["GET", /^\/api\/v1\/integrations$/, (r) => json(r, [])],
  ["GET", DRIVE_STATUS, (r) => json(r, drive)],
];

test.describe("T3 the Google Drive card in Settings (hermetic)", () => {
  test("T3 connected: the robot's address, and Copy address copies it", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const { unmocked, dialogs } = await mockApi(page, integrationsApi(driveConnected));
    await page.goto("/settings/integrations");
    const card = page.locator("[data-drive-card]");
    await expect(card.locator("[data-drive-state]")).toHaveText(
      `Connected as ${ROBOT}. Share each client's receipts folder with this address as Viewer.`,
    );
    await card.getByRole("button", { name: "Copy address" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ROBOT);
    clean(unmocked, dialogs);
  });

  test("T3 absent: not set up yet", async ({ page }) => {
    const { unmocked, dialogs } = await mockApi(
      page,
      integrationsApi({ configured: false, robotEmail: null, problem: null }),
    );
    await page.goto("/settings/integrations");
    await expect(page.locator("[data-drive-card] [data-drive-state]")).toHaveText(
      "Not set up yet. The owner adds GOOGLE_SERVICE_ACCOUNT_JSON to the API service in Sliplane.",
    );
    await expect(page.getByRole("button", { name: "Copy address" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 broken: the problem sentence word for word", async ({ page }) => {
    const PROBLEM =
      "Turn on the Google Drive API for the robot's project (Google Cloud → APIs & Services → Library).";
    const { unmocked, dialogs } = await mockApi(
      page,
      integrationsApi({ configured: false, robotEmail: null, problem: PROBLEM }),
    );
    await page.goto("/settings/integrations");
    await expect(page.locator("[data-drive-card] [data-drive-state]")).toHaveText(
      PROBLEM,
    );
    clean(unmocked, dialogs);
  });
});

test.describe("T3 a client's Drive folder (hermetic)", () => {
  test("T3 Link a Drive folder: paste, Save, then the folder's name, Open in Drive, Change and Unlink", async ({
    page,
  }) => {
    let linked: typeof FOLDER | null = null;
    const PASTED = "https://drive.google.com/drive/folders/drv-folder-0001?usp=sharing";
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, [
      ...scanApi(),
      [
        "GET",
        /^\/api\/v1\/clients\/[^/]+$/,
        (r) => json(r, { ...CLIENT, driveFolder: linked }),
      ],
      [
        "PUT",
        FOLDER_ROUTE,
        (r) => {
          linked = FOLDER;
          return json(r, FOLDER);
        },
      ],
      [
        "DELETE",
        FOLDER_ROUTE,
        (r) => {
          linked = null;
          return json(r, { driveFolder: null });
        },
      ],
    ]);
    await page.goto(`/receipt-scans?clientId=${CLIENT.id}`);
    await page.getByRole("tab", { name: "From Google Drive" }).click();
    const panel = page.locator("[data-drive-folder]");
    await panel.getByRole("button", { name: "Link a Drive folder" }).click();
    await panel.getByLabel("Paste the folder's link").fill(PASTED);
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel).toContainText(FOLDER.name);
    await expect(panel.getByRole("link", { name: "Open in Drive" })).toHaveAttribute(
      "href",
      FOLDER.link,
    );
    await expect(panel.getByRole("link", { name: "Open in Drive" })).toHaveAttribute(
      "target",
      "_blank",
    );
    const puts = seen.filter((s) => s.method === "PUT" && FOLDER_ROUTE.test(s.path));
    expect(puts.map((s) => s.request.postDataJSON())).toEqual([{ link: PASTED }]);
    // Change: the field again, and a second PUT.
    await panel.getByRole("button", { name: "Change" }).click();
    await panel.getByLabel("Paste the folder's link").fill(FOLDER.link);
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Unlink" })).toBeVisible();
    // Unlink: one DELETE, and back to Link a Drive folder.
    await panel.getByRole("button", { name: "Unlink" }).click();
    await expect(
      panel.getByRole("button", { name: "Link a Drive folder" }),
    ).toBeVisible();
    await quiet();
    expect(count(seen, "PUT", FOLDER_ROUTE)).toBe(2);
    expect(count(seen, "DELETE", FOLDER_ROUTE)).toBe(1);
    clean(unmocked, dialogs);
  });

  test("T3 the folder link's errors show word for word", async ({ page }) => {
    let answer: [number, string] = [400, "That isn't a Google Drive folder link."];
    const { unmocked, dialogs } = await mockApi(page, [
      ...scanApi(),
      ["PUT", FOLDER_ROUTE, (r) => json(r, { message: answer[1] }, answer[0])],
    ]);
    await page.goto(`/receipt-scans?clientId=${CLIENT.id}`);
    await page.getByRole("tab", { name: "From Google Drive" }).click();
    const panel = page.locator("[data-drive-folder]");
    await panel.getByRole("button", { name: "Link a Drive folder" }).click();
    const errors: [number, string][] = [
      [400, "That isn't a Google Drive folder link."],
      [409, "That link is a file, not a folder."],
      [
        409,
        `The Portal's robot can't see that folder. Share it with ${ROBOT} as Viewer, then try again.`,
      ],
      [503, "Google Drive isn't set up yet."],
    ];
    for (const e of errors) {
      answer = e;
      await panel
        .getByLabel("Paste the folder's link")
        .fill("https://example.test/not-a-folder");
      await panel.getByRole("button", { name: "Save", exact: true }).click();
      await expect(panel.getByRole("alert")).toHaveText(e[1]);
    }
    clean(unmocked, dialogs);
  });

  test("T3 when Drive is not set up, the page says so in one line", async ({ page }) => {
    const { unmocked, dialogs } = await mockApi(page, [
      ...scanApi({ drive: { configured: false, robotEmail: null, problem: null } }),
    ]);
    await page.goto(`/receipt-scans?clientId=${CLIENT.id}`);
    await page.getByRole("tab", { name: "From Google Drive" }).click();
    const panel = page.locator("[data-drive-folder]");
    await expect(panel).toHaveText("Google Drive isn't set up yet. See Settings.");
    await expect(panel.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/integrations",
    );
    await expect(page.getByRole("button", { name: "Link a Drive folder" })).toHaveCount(
      0,
    );
    clean(unmocked, dialogs);
  });
});

test.describe("T3 more of the Drive tab (hermetic)", () => {
  test("T3 more than 100 ticked: the send button is off and says why; truncated says so", async ({
    page,
  }) => {
    await manilaClock(page, "2026-10-11T10:00:00");
    const many = Array.from({ length: 101 }, (_, i) =>
      driveFile({ driveFileId: `drv-${i}`, name: `IMG_${1000 + i}.JPG` }),
    );
    const { unmocked, dialogs } = await mockApi(
      page,
      scanApi({ files: many, truncated: true }),
      LINKED,
    );
    await page.goto(`/receipt-scans?clientId=${CLIENT.id}`);
    await page.getByRole("tab", { name: "From Google Drive" }).click();
    const tab = page.locator("[data-drive-tab]");
    await expect(
      tab.getByText("Showing the newest 500 files.", { exact: true }),
    ).toBeVisible();
    const send = tab.locator("[data-drive-send]");
    await expect(send).toHaveText("Up to 100 files per pile.");
    await expect(send).toBeDisabled();
    await tab.getByRole("checkbox", { name: "IMG_1000.JPG" }).uncheck();
    await expect(send).toHaveText("Send 100 files");
    clean(unmocked, dialogs);
  });
});

test.describe("T3 every pile prepares first (hermetic)", () => {
  test("T3 an upload answers 202 preparing; the pile page and the list say Preparing… until it moves on", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-10-11T10:00:00+08:00") });
    let status = "preparing";
    const { unmocked, dialogs } = await mockApi(page, [
      ...scanApi(),
      ["GET", SCANS, (r) => json(r, [pile({ status })])],
      [
        "POST",
        SCANS,
        (r) => json(r, { id: PILE_ID, status: "preparing", files: 1 }, 202),
      ],
      ["GET", SCAN, (r) => json(r, pileDetail({ status }))],
    ]);
    await page.goto(`/receipt-scans?clientId=${CLIENT.id}`);
    await expect(page.locator("[data-scan-status]")).toHaveText(["Preparing…"]);
    await page
      .getByLabel("Receipt photos")
      .setInputFiles([
        { name: "r.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(64, 1) },
      ]);
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/receipt-scans/${PILE_ID}$`));
    await expect(page.locator("main [data-scan-status]").first()).toHaveText(
      "Preparing…",
    );
    status = "failed";
    await page.clock.runFor(65_000);
    await expect(page.locator("main [data-scan-status]").first()).toHaveText("Failed");
    clean(unmocked, dialogs);
  });

  test("T3 a failed pile shows its problem word for word", async ({ page }) => {
    const PROBLEM =
      "INVENTED: two of the Drive files were no longer shared with the robot.";
    const { unmocked, dialogs } = await mockApi(page, [
      ...scanApi(),
      ["GET", SCAN, (r) => json(r, pileDetail({ status: "failed", problem: PROBLEM }))],
    ]);
    await page.goto(`/receipt-scans/${PILE_ID}`);
    await expect(page.getByRole("alert").filter({ hasText: PROBLEM })).toHaveText(
      PROBLEM,
    );
    clean(unmocked, dialogs);
  });
});

test.describe("T3 a Drive file on the review page (hermetic)", () => {
  const driveScanFile = (over: Record<string, unknown>) => ({
    id: "sf1",
    name: "IMG_0101.HEIC",
    contentType: "image/jpeg",
    bytes: 250_000,
    imageUrl: `${SIGNED}/photo/sf1.jpg?sig=i`,
    result: "pending",
    problem: null,
    rows: [],
    source: "drive",
    driveLink: "https://drive.google.com/file/d/drv-new-1/view",
    ...over,
  });

  test("T3 the photo loads, and Open in Google Drive is always there", async ({
    page,
  }) => {
    const { unmocked, dialogs } = await mockApi(page, [
      ...scanApi(),
      ["GET", SCAN, (r) => json(r, pileDetail({ status: "ready" }, [driveScanFile({})]))],
    ]);
    await page.goto(`/receipt-scans/${PILE_ID}`);
    await expect(page.getByRole("img", { name: "IMG_0101.HEIC" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open in Google Drive" }),
    ).toHaveAttribute("href", "https://drive.google.com/file/d/drv-new-1/view");
    clean(unmocked, dialogs);
  });

  test("T3 a Drive photo that no longer loads says why", async ({ page }) => {
    const { unmocked, dialogs } = await mockApi(page, [
      ...scanApi(),
      [
        "GET",
        SCAN,
        (r) =>
          json(
            r,
            pileDetail({ status: "ready" }, [
              driveScanFile({ imageUrl: `${SIGNED}/gone/sf1.jpg?sig=i` }),
            ]),
          ),
      ],
    ]);
    await page.goto(`/receipt-scans/${PILE_ID}`);
    await expect(
      page.getByText(
        "This photo is no longer in Google Drive, or the robot can no longer see it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Open in Google Drive" })).toBeVisible();
    clean(unmocked, dialogs);
  });
});

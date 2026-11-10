// track-b-w18.spec.ts — hermetic browser tests for W18: Mark as filed with the BIR's
// confirmation email (Track A U18). One router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
//
// The mock server decides what a PDF "says" from its FILE NAME (good.pdf, wrong-form.pdf,
// …): the web must send the file and show the answer, and read nothing of the PDF. The PDFs
// themselves are built here with invented values; no real TIN, name or email address.
//
// All data is invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222i1";
const CLIENT = {
  id: "c1800000-0000-4000-8000-0000000000i1",
  businessName: "INVENTED EIGHTEEN TRADING",
  tin: "000-111-222-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

const BASE_PERMS = [
  "BIRForms:Read",
  "BIRForms:Create",
  "BIRForms:Update",
  "BIRForms:File",
  "Clients:Read",
];
const me = (extra: string[] = []) => ({
  user: {
    id: "u1800000-0000-4000-8000-0000000000i1",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: [...BASE_PERMS, ...extra],
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
  },
});
const SUPER = ["IntegrationClient:Update", "Users:Read"];

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

// ---------------------------------------------------------------------------
// The PDFs, built with invented values
// ---------------------------------------------------------------------------

/** A tiny PDF that "prints" an invented BIR confirmation email. The mock server never
 *  reads it: it goes by the file name. The bytes are real, so the browser sends a file. */
function inventedPdf(marker: string): Buffer {
  const lines = [
    "From: ebirforms-noreply@bir.example.test",
    "Tax Return Receipt Confirmation",
    "File name: 000111222333-2550Q-032026.xml",
    "This confirms receipt of your submission",
    `Invented marker: ${marker}`,
  ];
  const text = lines
    .map((l, i) => `BT /F1 12 Tf 50 ${700 - i * 20} Td (${l}) Tj ET`)
    .join("\n");
  return Buffer.from(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
      `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n` +
      `4 0 obj<</Length ${text.length}>>stream\n${text}\nendstream endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}
const upload = (name: string) => ({
  name,
  mimeType: "application/pdf",
  buffer: inventedPdf(name),
});

// ---------------------------------------------------------------------------
// The mock server
// ---------------------------------------------------------------------------

const IDS = [
  "bir-email",
  "file-name",
  "taxpayer",
  "form",
  "period",
  "received",
  "duplicate",
  "timing",
  "upload",
] as const;
type CheckId = (typeof IDS)[number];
const checksOf = (over: Partial<Record<CheckId, [string, string | null]>> = {}) =>
  IDS.map((id, i) => ({
    n: i + 1,
    id,
    status: over[id]?.[0] ?? "ok",
    message: over[id]?.[1] ?? null,
  }));

const PARSED = {
  birFileName: "000111222333-2550Q-032026.xml",
  tin: "000111222",
  branch: "000",
  form: "2550Q",
  version: null,
  fyEndMonth: null,
  taxYear: 2026,
  quarter: 1,
  month: null,
  amendment: null,
  shape: "verified",
  receivedAt: "2026-04-25T07:42:00.000Z",
};
const WRONG_FORM = "The confirmation is for form 1701Q, not 2550Q.";
const LATE = "INVENTED WARNING: this return was received after its due date.";
const ALREADY =
  "This confirmation is already attached to 2550Q, Invented Trading Co, 2026-Q1.";

/** What the mock server says of a file, by its name. */
function assess(name: string) {
  if (name.startsWith("wrong-form")) {
    return {
      ok: false,
      checks: checksOf({ form: ["error", WRONG_FORM] }),
      errors: [WRONG_FORM],
      warnings: [],
      parsed: { ...PARSED, form: "1701Q" },
      filedOn: "2026-04-25",
      sha256: "a".repeat(64),
    };
  }
  if (name.startsWith("late")) {
    return {
      ok: true,
      checks: checksOf({ timing: ["warning", LATE] }),
      errors: [],
      warnings: [LATE],
      parsed: PARSED,
      filedOn: "2026-04-25",
      sha256: "b".repeat(64),
    };
  }
  if (name.startsWith("duplicate")) {
    return {
      ok: false,
      checks: checksOf({ duplicate: ["error", ALREADY] }),
      errors: [ALREADY],
      warnings: [],
      parsed: PARSED,
      filedOn: "2026-04-25",
      sha256: "c".repeat(64),
    };
  }
  return {
    ok: true,
    checks: checksOf(),
    errors: [],
    warnings: [],
    parsed: PARSED,
    filedOn: "2026-04-25",
    sha256: "d".repeat(64),
  };
}

interface World {
  store: Map<string, Record<string, unknown>>;
  /** The Super Admin override is accepted (the mock's account holds the role). */
  superAdmin: boolean;
}

const idOf = (k: number) => `f1800000-0000-4000-8000-${String(k).padStart(12, "0")}`;

function detail(over: Record<string, unknown> & { id: string; form: string }) {
  return {
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    status: "draft",
    period: "2026-Q1",
    filedAt: null,
    createdAt: "2026-04-01T01:00:00.000Z",
    updatedAt: "2026-04-01T01:00:00.000Z",
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
    data: { year: "2026", periodType: "calendar", amended: "no" },
    ...over,
  };
}

const confirmationOf = (
  kind: "bir_email" | "override",
  over: Record<string, unknown> = {},
) => ({
  id: "k1800000-0000-4000-8000-000000000001",
  kind,
  birFileName: kind === "override" ? null : PARSED.birFileName,
  receivedAt: kind === "override" ? null : PARSED.receivedAt,
  filedOn: kind === "override" ? null : "2026-04-25",
  originalFilename: kind === "override" ? null : "email.pdf",
  hasFile: kind !== "override",
  warnings: [],
  overrideReason: null,
  filedWithoutConfirmation: kind === "override",
  uploadedByUserId: "u1800000-0000-4000-8000-0000000000i1",
  uploadedAt: "2026-04-26T01:00:00.000Z",
  ...over,
});

/** The text fields and the file name of a multipart body. */
function multipart(req: Request) {
  const body = req.postDataBuffer()?.toString("latin1") ?? "";
  const file = /name="file"; filename="([^"]*)"/.exec(body)?.[1] ?? null;
  const reason = /name="overrideReason"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? null;
  const replace = /name="replace"\r\n\r\n([\s\S]*?)\r\n--/.exec(body)?.[1] ?? null;
  return { file, reason, replace, body };
}

async function mockApi(
  page: Page,
  w: World,
  extraPerms: string[] = [],
  extra: Entry[] = [],
) {
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
  const get = (s: Seen) => w.store.get(s.path.split("/")[4]!)!;
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me(extraPerms))],
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
    [
      "GET",
      /^\/api\/v1\/users$/,
      (r) =>
        json(r, [
          {
            id: "u1800000-0000-4000-8000-0000000000i1",
            fullName: "Test Operator",
            email: "operator@example.test",
            status: "ACTIVE",
            mfaEnabled: true,
            userRoles: [],
          },
        ]),
    ],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    // W22: the card of a return filed without the email asks the client's list of returns
    // whether an amendment names it (for Undo filing). These tests are not about that.
    ["GET", /^\/api\/v1\/bir-forms$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/([^/]+)$/,
      (r, s) => {
        const found = w.store.get(s.path.split("/").pop()!);
        return found ? json(r, found) : json(r, { message: "Not found" }, 404);
      },
    ],
    // The old route: PATCH status filed (the 1601-C, 2307 and 2316 still file this way).
    [
      "PATCH",
      /^\/api\/v1\/bir-forms\/([^/]+)$/,
      (r, s) => {
        const id = s.path.split("/").pop()!;
        const cur = w.store.get(id)! as { confirmationRequired: boolean };
        const body = s.request.postDataJSON() as { status?: string; data?: unknown };
        if (body.status === "filed" && cur.confirmationRequired) {
          return json(
            r,
            {
              message:
                "Marking this return as filed needs the BIR confirmation email. Upload it with Mark as filed.",
            },
            409,
          );
        }
        const next = {
          ...cur,
          ...(body.status === "filed"
            ? { status: "filed", filedAt: "2026-10-12T02:00:00.000Z" }
            : {}),
          ...(body.data ? { data: body.data } : {}),
        };
        w.store.set(id, next);
        return json(r, next);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/([^/]+)\/confirmation\/check$/,
      (r, s) => {
        const { file } = multipart(s.request);
        if (!file)
          return json(
            r,
            {
              message:
                'Attach the BIR confirmation as a PDF in the multipart field "file".',
            },
            400,
          );
        return json(r, assess(file));
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/([^/]+)\/mark-filed$/,
      (r, s) => {
        const cur = get(s) as Record<string, unknown>;
        const { file, reason } = multipart(s.request);
        if (cur.status === "filed")
          return json(r, { message: "This 2550Q has been filed and is sealed." }, 409);
        if (reason !== null) {
          if (!w.superAdmin)
            return json(
              r,
              {
                message:
                  "Only a Super Admin can file a return without the BIR confirmation.",
              },
              403,
            );
          if (reason.trim().length < 10)
            return json(
              r,
              { message: "Give the reason in at least 10 characters." },
              400,
            );
          const next = {
            ...cur,
            status: "filed",
            filedAt: "2026-10-12T02:00:00.000Z",
            confirmation: confirmationOf("override", { overrideReason: reason }),
          };
          w.store.set(cur.id as string, next);
          return json(r, next);
        }
        if (!file)
          return json(
            r,
            {
              message:
                'Attach the BIR confirmation as a PDF in the multipart field "file".',
            },
            400,
          );
        const a = assess(file);
        if (!a.ok) return json(r, { message: a.errors[0], ...a }, 409);
        const next = {
          ...cur,
          status: "filed",
          filedAt: a.parsed!.receivedAt,
          confirmation: confirmationOf("bir_email", {
            warnings: a.warnings,
            originalFilename: file,
          }),
        };
        w.store.set(cur.id as string, next);
        return json(r, next);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/([^/]+)\/confirmation$/,
      (r, s) => {
        const cur = get(s) as Record<string, unknown>;
        const { file, replace } = multipart(s.request);
        if (cur.status !== "filed")
          return json(r, { message: "This return is not filed yet." }, 409);
        if (cur.confirmation && replace !== "true")
          return json(r, { message: "This return already has a BIR confirmation." }, 409);
        if (!file)
          return json(
            r,
            {
              message:
                'Attach the BIR confirmation as a PDF in the multipart field "file".',
            },
            400,
          );
        const a = assess(file);
        if (!a.ok) return json(r, { message: a.errors[0], ...a }, 409);
        const next = {
          ...cur,
          confirmation: confirmationOf("bir_email", {
            warnings: a.warnings,
            originalFilename: file,
          }),
        };
        w.store.set(cur.id as string, next);
        return json(r, next);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/([^/]+)\/confirmation\/url$/,
      (r, s) => {
        const cur = get(s) as { confirmation: { hasFile: boolean } | null };
        if (!cur.confirmation?.hasFile)
          return json(r, { message: "This return has no BIR confirmation file." }, 404);
        return json(r, { url: `${SIGNED}/confirmation.pdf?sig=i` });
      },
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
  await page.context().route(`${SIGNED}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: {
        "Content-Disposition":
          'attachment; filename="000111222333-2550Q-032026-BIR-confirmation.pdf"',
      },
      body: Buffer.from("%PDF-1.4 invented"),
    }),
  );
  return { seen, unmocked, dialogs, quiet };
}

const world = (over: Partial<World> = {}): World => ({
  store: new Map(),
  superAdmin: false,
  ...over,
});
function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const LONG_REASON =
  "The BIR email never arrived; the eBIRForms receipt was checked on screen.";
const dialogOf = (page: Page) => page.locator("[data-confirmation-dialog]");
const chooseFile = (page: Page, name: string) =>
  dialogOf(page).locator('input[type="file"]').setInputFiles(upload(name));
const posts = (seen: Seen[], tail: string) =>
  seen.filter((s) => s.method === "POST" && s.path.endsWith(tail));

/** A 2550Q draft that needs the BIR confirmation to be filed. */
function draft2550(w: World, k = 1, over: Record<string, unknown> = {}) {
  const id = idOf(k);
  w.store.set(id, detail({ id, form: "2550Q", ...over }));
  return id;
}

// ===========================================================================

test.describe("W18 Mark as filed with the BIR confirmation (hermetic)", () => {
  test("T1 check, then mark filed: the read-back, the ticks, the same file again, and the BIR's received date", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w);
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const dialog = dialogOf(page);
    await expect(dialog).toBeVisible();
    // Before the check: nothing sent, the filing held back.
    await expect(dialog.getByRole("button", { name: "Check" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Mark as filed" })).toBeDisabled();
    expect(seen.filter((s) => s.method === "PATCH")).toHaveLength(0);
    await chooseFile(page, "good.pdf");
    await dialog.getByRole("button", { name: "Check" }).click();
    await expect(dialog.locator('[data-read="file-name"]')).toHaveText(
      "000111222333-2550Q-032026.xml",
    );
    await expect(dialog.locator('[data-read="form"]')).toHaveText("2550Q");
    await expect(dialog.locator('[data-read="period"]')).toHaveText("2026 Q1");
    await expect(dialog.locator('[data-read="received"]')).toHaveText(
      "Apr 25, 2026, 3:42 PM",
    );
    await expect(dialog.locator('[data-status="ok"]')).toHaveCount(9);
    expect(posts(seen, "/confirmation/check")).toHaveLength(1);
    expect(posts(seen, "/mark-filed")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Mark as filed" }).click();
    // The same file went to the check and to Mark as filed; never a PATCH.
    await expect(dialog).toHaveCount(0);
    await quiet();
    const mark = posts(seen, "/mark-filed");
    expect(mark).toHaveLength(1);
    const first = multipart(posts(seen, "/confirmation/check")[0]!.request);
    const second = multipart(mark[0]!.request);
    expect(second.file).toBe("good.pdf");
    expect(second.file).toBe(first.file);
    expect(second.body).toContain("Invented marker: good.pdf");
    expect(second.reason).toBeNull();
    expect(seen.filter((s) => s.method === "PATCH")).toHaveLength(0);
    // The filed date is the date the BIR received it, from the response; the card says so.
    await expect(page.getByText("Filed on Apr 25, 2026")).toBeVisible();
    const card = page.locator('[data-confirmation-card="bir_email"]');
    await expect(card.locator("[data-received]")).toHaveText("Apr 25, 2026, 3:42 PM");
    await expect(card.locator("[data-bir-file-name]")).toHaveText(
      "000111222333-2550Q-032026.xml",
    );
    clean(unmocked, dialogs);
  });

  test("T1 a wrong-form email is refused with the server's sentence and cannot be filed", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const dialog = dialogOf(page);
    await chooseFile(page, "wrong-form.pdf");
    await dialog.getByRole("button", { name: "Check" }).click();
    const row = dialog.locator('[data-check="form"]');
    await expect(row).toHaveAttribute("data-status", "error");
    await expect(row.locator("[data-check-message]")).toHaveText(WRONG_FORM);
    await expect(dialog.getByRole("button", { name: "Mark as filed" })).toBeDisabled();
    expect(posts(seen, "/mark-filed")).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T1 a warning is shown with its sentence and does not stop the filing", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w);
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const dialog = dialogOf(page);
    await chooseFile(page, "late.pdf");
    await dialog.getByRole("button", { name: "Check" }).click();
    const row = dialog.locator('[data-check="timing"]');
    await expect(row).toHaveAttribute("data-status", "warning");
    await expect(row.locator("[data-check-message]")).toHaveText(LATE);
    await dialog.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialog).toHaveCount(0);
    await quiet();
    expect(posts(seen, "/mark-filed")).toHaveLength(1);
    // The card lists the warning the API kept.
    await expect(page.locator("[data-confirmation-warnings] li")).toHaveText([LATE]);
    clean(unmocked, dialogs);
  });

  test("T1 a 409 from Mark as filed shows the server's message, word for word", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w);
    // The check passes, but Mark as filed finds the file attached elsewhere meanwhile.
    const { unmocked, dialogs } = await mockApi(
      page,
      w,
      [],
      [
        [
          "POST",
          /^\/api\/v1\/bir-forms\/[^/]+\/mark-filed$/,
          (r) => json(r, { message: ALREADY, ...assess("duplicate.pdf") }, 409),
        ],
      ],
    );
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const dialog = dialogOf(page);
    await chooseFile(page, "good.pdf");
    await dialog.getByRole("button", { name: "Check" }).click();
    await dialog.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialog.locator("[data-confirmation-error]")).toHaveText(ALREADY);
    await expect(dialog.locator('[data-check="duplicate"]')).toHaveAttribute(
      "data-status",
      "error",
    );
    clean(unmocked, dialogs);
  });
});

test.describe("W18 the Super Admin override (hermetic)", () => {
  test("T2 a Super Admin files without the email: a short reason is refused in the server's words, a long one is accepted", async ({
    page,
  }) => {
    const w = world({ superAdmin: true });
    const id = draft2550(w);
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w, SUPER);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const dialog = dialogOf(page);
    await dialog.getByText("File without the BIR email").click();
    await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
    const reason = dialog.getByLabel("Reason for filing without the BIR email");
    await reason.fill("too short");
    await expect(dialog.locator("[data-reason-counter]")).toHaveText("9 / 10");
    await dialog.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialog.locator("[data-confirmation-error]")).toHaveText(
      "Give the reason in at least 10 characters.",
    );
    await reason.fill(
      "The BIR email never arrived; the eBIRForms receipt was checked on screen.",
    );
    await expect(dialog.locator("[data-reason-counter]")).toHaveText(
      `${LONG_REASON.length} / 10`,
    );
    await dialog.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialog).toHaveCount(0);
    await quiet();
    const mark = posts(seen, "/mark-filed");
    expect(mark).toHaveLength(2);
    expect(multipart(mark[1]!.request).file).toBeNull();
    expect(multipart(mark[1]!.request).reason).toBe(LONG_REASON);
    const card = page.locator('[data-confirmation-card="override"]');
    await expect(card.getByText("Filed without BIR confirmation")).toBeVisible();
    await expect(card.locator("[data-override-reason]")).toHaveText(LONG_REASON);
    clean(unmocked, dialogs);
  });

  test("T2 anyone else does not see the override link", async ({ page }) => {
    const w = world();
    const id = draft2550(w);
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialogOf(page)).toBeVisible();
    await expect(page.getByText("File without the BIR email")).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

test.describe("W18 the card on a filed return (hermetic)", () => {
  test("T3 an email's card: when received, the file name, who uploaded it and when, its warnings, and View PDF", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w, 1, {
      status: "filed",
      filedAt: "2026-04-25T07:42:00.000Z",
      confirmation: confirmationOf("bir_email", {
        warnings: [LATE, "INVENTED SECOND WARNING"],
      }),
    });
    const { seen, unmocked, dialogs } = await mockApi(page, w, ["Users:Read"]);
    await page.goto(`/bir-forms/${id}`);
    const card = page.locator('[data-confirmation-card="bir_email"]');
    await expect(card.locator("[data-received]")).toHaveText("Apr 25, 2026, 3:42 PM");
    await expect(card.locator("[data-bir-file-name]")).toHaveText(
      "000111222333-2550Q-032026.xml",
    );
    await expect(card.locator("[data-uploaded]")).toHaveText(
      "Uploaded by Test Operator on Apr 26, 2026",
    );
    await expect(card.locator("[data-confirmation-warnings] li")).toHaveText([
      LATE,
      "INVENTED SECOND WARNING",
    ]);
    await expect(card.getByRole("button", { name: "Replace" })).toHaveCount(0);
    const downloading = page.waitForEvent("download");
    await card.getByRole("button", { name: "View PDF" }).click();
    expect((await downloading).suggestedFilename()).toBe(
      "000111222333-2550Q-032026-BIR-confirmation.pdf",
    );
    expect(seen.filter((s) => /\/confirmation\/url$/.test(s.path))).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T3 an override's card: the badge, the reason, who and when; no PDF", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w, 1, {
      status: "filed",
      filedAt: "2026-10-09T02:00:00.000Z",
      confirmation: confirmationOf("override", {
        overrideReason: "INVENTED REASON: the email never came.",
      }),
    });
    const { unmocked, dialogs } = await mockApi(page, w, ["Users:Read"]);
    await page.goto(`/bir-forms/${id}`);
    const card = page.locator('[data-confirmation-card="override"]');
    await expect(card.getByText("Filed without BIR confirmation")).toBeVisible();
    await expect(card.locator("[data-override-reason]")).toHaveText(
      "INVENTED REASON: the email never came.",
    );
    await expect(card.locator("[data-uploaded]")).toHaveText(
      "Uploaded by Test Operator on Apr 26, 2026",
    );
    await expect(card.getByRole("button", { name: "View PDF" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 a Super Admin can replace the confirmation with the same check", async ({
    page,
  }) => {
    const w = world({ superAdmin: true });
    const id = draft2550(w, 1, {
      status: "filed",
      filedAt: "2026-04-25T07:42:00.000Z",
      confirmation: confirmationOf("bir_email"),
    });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w, SUPER);
    await page.goto(`/bir-forms/${id}`);
    await page
      .locator("[data-confirmation-card]")
      .getByRole("button", { name: "Replace" })
      .click();
    const dialog = dialogOf(page);
    await chooseFile(page, "good.pdf");
    await dialog.getByRole("button", { name: "Check" }).click();
    await dialog.getByRole("button", { name: "Replace" }).click();
    await expect(dialog).toHaveCount(0);
    await quiet();
    const sent = posts(seen, "/confirmation").filter((s) => !s.path.endsWith("/check"));
    expect(sent).toHaveLength(1);
    expect(multipart(sent[0]!.request).replace).toBe("true");
    expect(multipart(sent[0]!.request).file).toBe("good.pdf");
    clean(unmocked, dialogs);
  });

  test("T3 a return filed before shows No BIR confirmation attached, and Attach confirmation attaches one", async ({
    page,
  }) => {
    const w = world();
    const id = draft2550(w, 1, {
      status: "filed",
      filedAt: "2026-04-20T02:00:00.000Z",
      confirmation: null,
    });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    const card = page.locator('[data-confirmation-card="none"]');
    await expect(card.locator("[data-no-confirmation]")).toHaveText(
      "No BIR confirmation attached",
    );
    await card.getByRole("button", { name: "Attach confirmation" }).click();
    const dialog = dialogOf(page);
    await chooseFile(page, "good.pdf");
    await dialog.getByRole("button", { name: "Check" }).click();
    await expect(dialog.locator('[data-status="ok"]')).toHaveCount(9);
    await dialog.getByRole("button", { name: "Attach confirmation" }).click();
    await expect(dialog).toHaveCount(0);
    await quiet();
    const sent = posts(seen, "/confirmation").filter((s) => !s.path.endsWith("/check"));
    expect(sent).toHaveLength(1);
    expect(multipart(sent[0]!.request).replace).toBeNull();
    await expect(page.locator('[data-confirmation-card="bir_email"]')).toBeVisible();
    // The filed date was not touched by attaching.
    await expect(page.getByText("Filed on Apr 20, 2026")).toBeVisible();
    clean(unmocked, dialogs);
  });
});

test.describe("W18 the forms that still file the old way (hermetic)", () => {
  test("T4 the 1601-C files through PATCH with no dialog and no card", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(7);
    w.store.set(
      id,
      detail({
        id,
        form: "1601C",
        period: "2026-03",
        confirmationRequired: false,
        data: { year: "2026", month: "03", amended: "no", anyWithheld: "no" },
      }),
    );
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await quiet();
    expect(page.locator("[data-confirmation-dialog]")).toHaveCount(0);
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect((patches[0]!.request.postDataJSON() as { status: string }).status).toBe(
      "filed",
    );
    expect(posts(seen, "/mark-filed")).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
    await expect(page.locator("[data-confirmation-card]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

// track-b-w16.spec.ts — hermetic browser tests for W16: the "Portal books |
// Manual" switch on the 2551Q and the 2550Q editors (R1–R7). Every case runs
// against both forms.
//
// Built against Track A U15's contract as written in the W16 brief:
// GET /bir-forms/book-figures?clientId&form&period, and the draft's optional
// _source key { mode, asOf, fed, edited }.
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
//
// All data is invented. No real name, TIN, address, phone or email.

import {
  expect,
  test,
  type Locator,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222g1";

const CLIENT = {
  id: "c1600000-0000-4000-8000-0000000000g1",
  businessName: "INVENTED SIXTEEN TRADING",
  tin: "000-161-016-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

const ME = {
  user: {
    id: "u1600000-0000-4000-8000-0000000000g1",
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
// The two forms, side by side
// ---------------------------------------------------------------------------

type Figures = Record<string, unknown>;
type FormCode = "2551Q" | "2550Q";

interface Cfg {
  form: FormCode;
  newUrl: string;
  /** The first and the second fed field: their badge ids. */
  first: string;
  second: string;
  /** What the books say, now (A) and after they changed (B). */
  a: Figures;
  b: Figures;
  /** The books' amounts for the first and second field, in A and in B. */
  firstA: number;
  firstB: number;
  secondA: number;
  secondB: number;
  /** The API's own labels for the two lines. */
  firstLabel: string;
  secondLabel: string;
  /** The data key a typed-over first field lands under in _source.edited. */
  editedKey: string;
  lines: (f: Figures, records?: Record<string, number>) => unknown[];
  /** The line key whose record count a test may override. */
  recordKey: string;
  /** A saved draft's data holding these figures as the editor saves them. */
  data: (f: Figures, extra?: Record<string, unknown>) => Record<string, unknown>;
  input: (page: Page, id: string) => Locator;
}

const range = { from: "2026-07-01", to: "2026-09-30" };

const KEYS_2550 = [
  "i31a",
  "i32a",
  "i33a",
  "i35b",
  "i36b",
  "i38",
  "i39",
  "i40",
  "i41",
  "i42",
  "i44a",
  "i44b",
  "i45a",
  "i45b",
  "i46a",
  "i46b",
  "i47a",
  "i47b",
  "i48a",
  "i49a",
  "i52",
  "i53",
  "i54",
  "i55",
  "i56",
  "i58",
  "i16",
  "i17",
  "i18",
  "i19",
  "i22",
  "i23",
  "i24",
];
const LABEL_2550: Record<string, string> = {
  i31a: "VATable sales (net) — Item 31A",
  i33a: "VAT-exempt sales — Item 33A",
  // As U15 words them (the API still says "Domestic — services").
  i45a: "Domestic — services (Item 45): purchases",
  i45b: "Domestic — services (Item 45): input tax",
};

const CFG: Record<FormCode, Cfg> = {
  "2551Q": {
    form: "2551Q",
    newUrl: "/bir-forms/new?form=2551Q",
    first: "rows.PT010",
    second: "rows.PT040",
    a: {
      rows: [
        { atc: "PT010", taxable: "120000", rate: "3" },
        { atc: "PT040", taxable: "45000", rate: "3" },
      ],
    },
    b: {
      rows: [
        { atc: "PT010", taxable: "130000", rate: "3" },
        { atc: "PT040", taxable: "50000", rate: "3" },
      ],
    },
    firstA: 120000,
    firstB: 130000,
    secondA: 45000,
    secondB: 50000,
    firstLabel: "Schedule 1 · PT010",
    secondLabel: "Schedule 1 · PT040",
    editedKey: "rows.PT010",
    recordKey: "PT010",
    lines: (f, records) =>
      (f.rows as { atc: string; taxable: number }[]).map((r, i) => ({
        key: `rows.${r.atc}`,
        label: `Schedule 1 · ${r.atc}`,
        amount: Number(r.taxable),
        records: records?.[r.atc] ?? (i === 0 ? 14 : 5),
        filter: { kind: "income", ...range, atc: r.atc },
      })),
    data: (f, extra = {}) => ({
      year: "2026",
      periodType: "calendar",
      amended: "no",
      taxRelief: "no",
      itRate: "graduated",
      i15: "",
      i20: "",
      i21: "",
      i22: "",
      rows: (f.rows as { atc: string; taxable: number; rate: number }[]).map((r) => ({
        atc: r.atc,
        taxable: String(r.taxable),
        rate: String(r.rate),
      })),
      ...extra,
    }),
    input: (page, id) =>
      page
        .locator("tbody tr")
        .nth(id === "rows.PT040" ? 1 : 0)
        .locator('input[type="number"]')
        .first(),
  },
  "2550Q": {
    form: "2550Q",
    newUrl: "/bir-forms/new?form=2550Q",
    first: "i31a",
    second: "i33a",
    a: { i31a: "250000", i32a: "0", i33a: "12000", i44a: "80000", i44b: "9600" },
    b: { i31a: "260000", i32a: "0", i33a: "15000", i44a: "80000", i44b: "9600" },
    firstA: 250000,
    firstB: 260000,
    secondA: 12000,
    secondB: 15000,
    firstLabel: "VATable sales (net) — Item 31A",
    secondLabel: "VAT-exempt sales — Item 33A",
    editedKey: "i31a",
    recordKey: "i31a",
    lines: (f, records) =>
      Object.entries(f).map(([key, amount]) => ({
        key,
        label: LABEL_2550[key] ?? `INVENTED LINE ${key}`,
        amount: Number(amount),
        records: records?.[key] ?? (key === "i31a" ? 14 : key === "i33a" ? 2 : 0),
        filter: key.startsWith("i4")
          ? { kind: "purchases", ...range, inputVATCategory: "DOMESTIC_PURCHASES" }
          : { kind: "income", ...range, vatClass: "VATABLE_12" },
      })),
    data: (f, extra = {}) => ({
      year: "2026",
      periodType: "calendar",
      amended: "no",
      ...Object.fromEntries(KEYS_2550.map((k) => [k, ""])),
      ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, String(v)])),
      ...extra,
    }),
    input: (page, id) => page.getByLabel(LABEL_2550[id]!, { exact: true }),
  },
};

const peso = (n: number) =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// One router, a table of handlers
// ---------------------------------------------------------------------------

interface World {
  /** What the books say right now; a test may change it. */
  books: Figures;
  /** The books' own warnings. */
  warnings: string[];
  /** When set, the books answer with this refusal. */
  refuse: { status: number; message: string } | null;
  /** Record counts to say instead of the defaults, by line key. */
  records?: Record<string, number>;
  /** The saved forms, by id. */
  store: Map<string, Record<string, unknown>>;
}

const PNG_ID = "f1600000-0000-4000-8000-000000000001";
const NEW_ID = "f1600000-0000-4000-8000-0000000000ff";
const ASOF_A = "2026-10-10T02:00:00.000Z";
const ASOF_NOW = "2026-10-12T01:00:00.000Z";

function detail(cfg: Cfg, over: Record<string, unknown> = {}) {
  return {
    id: PNG_ID,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    form: cfg.form,
    status: "draft",
    period: "2026-Q3",
    filedAt: null,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-01T01:00:00.000Z",
    amendsId: null,
    sequence: 1,
    data: cfg.data(cfg.a),
    computed: null,
    exports: [],
    filedSnapshot: null,
    clearCopyAvailable: false,
    previewAvailable: false,
    canDelete: false,
    ...over,
  };
}

const source = (cfg: Cfg, over: Record<string, unknown> = {}) => ({
  mode: "books",
  asOf: ASOF_A,
  fed: cfg.a,
  edited: [] as string[],
  ...over,
});

async function mockApi(page: Page, cfg: Cfg, world: World, extra: Entry[] = []) {
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
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/([^/]+)$/,
      (r, s) => {
        const id = s.path.split("/").pop()!;
        const found = world.store.get(id);
        return found ? json(r, found) : json(r, { message: "Not found" }, 404);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms$/,
      (r, s) => {
        const body = s.request.postDataJSON() as {
          clientId: string;
          form: string;
          period: string;
          data: unknown;
        };
        const made = detail(cfg, { id: NEW_ID, period: body.period, data: body.data });
        world.store.set(NEW_ID, made);
        return json(r, made, 201);
      },
    ],
    [
      "PATCH",
      /^\/api\/v1\/bir-forms\/([^/]+)$/,
      (r, s) => {
        const id = s.path.split("/").pop()!;
        const body = s.request.postDataJSON() as { period?: string; data?: unknown };
        const next = {
          ...world.store.get(id)!,
          ...(body.period ? { period: body.period } : {}),
          ...(body.data ? { data: body.data } : {}),
        };
        world.store.set(id, next);
        return json(r, next);
      },
    ],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/book-figures$/,
      (r, s) => {
        if (world.refuse)
          return json(r, { message: world.refuse.message }, world.refuse.status);
        return json(r, {
          form: s.search.get("form"),
          period: s.search.get("period"),
          asOf: ASOF_NOW,
          recordCount: Object.keys(world.books).length === 0 ? 0 : 21,
          figures: world.books,
          lines:
            Object.keys(world.books).length === 0
              ? []
              : cfg.lines(world.books, world.records),
          warnings: world.warnings,
        });
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
      contentType: "application/octet-stream",
      headers: { "Content-Disposition": 'attachment; filename="export.xml"' },
      body: Buffer.from("INVENTED"),
    }),
  );
  return { seen, unmocked, dialogs, quiet };
}

function world(cfg: Cfg, over: Partial<World> = {}): World {
  return { books: cfg.a, warnings: [], refuse: null, store: new Map(), ...over };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}

const BOOKS = /^\/api\/v1\/bir-forms\/book-figures$/;
const bookCalls = (seen: Seen[]) =>
  seen.filter((s) => s.method === "GET" && BOOKS.test(s.path));
const radio = (page: Page, name: "Portal books" | "Manual") =>
  page.getByRole("radio", { name, exact: true });
const badge = (page: Page, id: string) => page.locator(`[data-book-badge="${id}"]`);
const dialogOf = (page: Page) =>
  page.getByRole("dialog", { name: "Fill from the Portal's books?" });

/** Open a saved draft. */
async function openDraft(
  page: Page,
  cfg: Cfg,
  w: World,
  over: Record<string, unknown> = {},
  extra: Entry[] = [],
) {
  w.store.set(PNG_ID, detail(cfg, over));
  const api = await mockApi(page, cfg, w, extra);
  await page.goto(`/bir-forms/${PNG_ID}`);
  await expect(
    page.getByRole("button", { name: /Save changes|Amend/ }).first(),
  ).toBeVisible();
  return api;
}

/** A saved draft in "Portal books" mode, its figures as the books gave them. */
const booksDraft = (
  cfg: Cfg,
  srcOver: Record<string, unknown> = {},
  dataOver: Figures = cfg.a,
) => ({
  data: cfg.data(dataOver, { _source: source(cfg, srcOver) }),
});

for (const code of ["2551Q", "2550Q"] as const) {
  const cfg = CFG[code];

  // -------------------------------------------------------------------------
  // T1 — the switch (R1–R5)
  // -------------------------------------------------------------------------

  test.describe(`T1 ${code}: Portal books | Manual (hermetic)`, () => {
    test(`T1 ${code} a new draft opens in Portal books, fetches once and fills the fields with From books badges`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
      await expect(radio(page, "Manual")).toHaveAttribute("aria-checked", "false");
      await page.getByLabel(/^Quarter/).selectOption("Q3");
      expect(bookCalls(seen)).toHaveLength(0);
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstA));
      await expect(cfg.input(page, cfg.second)).toHaveValue(String(cfg.secondA));
      await expect(badge(page, cfg.first)).toContainText("From books · 14 records");
      await quiet();
      const calls = bookCalls(seen);
      expect(calls).toHaveLength(1);
      expect(Object.fromEntries(calls[0]!.search)).toEqual({
        clientId: CLIENT.id,
        form: code,
        period: "2026-Q3",
      });
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a client with no records opens in Manual and fills nothing`, async ({
      page,
    }) => {
      const w = world(cfg, { books: {} });
      const { unmocked, dialogs, quiet } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(radio(page, "Manual")).toHaveAttribute("aria-checked", "true");
      await quiet();
      await expect(page.locator("[data-book-badge]")).toHaveCount(0);
      await expect(cfg.input(page, cfg.first)).toHaveValue("");
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} typing over a fed field shows Edited with the books' amount; Reset puts it back; the key lands in _source.edited on save`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel(/^Quarter/).selectOption("Q3");
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(badge(page, cfg.first)).toContainText("From books");
      const input = cfg.input(page, cfg.first);
      await input.fill("1000");
      await expect(badge(page, cfg.first)).toContainText(
        `Edited · books say ${peso(cfg.firstA)}`,
      );
      await badge(page, cfg.first).getByRole("button", { name: "Reset" }).click();
      await expect(input).toHaveValue(String(cfg.firstA));
      await expect(badge(page, cfg.first)).toContainText("From books · 14 records");
      await input.fill("1000");
      await expect(badge(page, cfg.first)).toContainText("Edited");
      await page.getByRole("button", { name: "Save draft" }).click();
      await expect(page).toHaveURL(new RegExp(`/bir-forms/${NEW_ID}$`));
      await quiet();
      const posts = seen.filter(
        (s) => s.method === "POST" && /\/bir-forms$/.test(s.path),
      );
      expect(posts).toHaveLength(1);
      const sent = posts[0]!.request.postDataJSON() as {
        data: { _source: Record<string, unknown> };
      };
      expect(sent.data._source).toEqual({
        mode: "books",
        asOf: ASOF_NOW,
        fed: cfg.a,
        edited: [cfg.editedKey],
      });
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} Books to Manual keeps the values and drops the badges; Manual to Books asks before it changes a number`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg),
      );
      await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
      await expect(badge(page, cfg.first)).toBeVisible();
      const input = cfg.input(page, cfg.first);
      await input.fill("1");
      await radio(page, "Manual").click();
      await expect(radio(page, "Manual")).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-book-badge]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refresh from books" })).toHaveCount(
        0,
      );
      await expect(input).toHaveValue("1");
      await quiet();
      const before = bookCalls(seen).length;
      // Back to Portal books: one fetch, then the dialog; it lists the typed field.
      await radio(page, "Portal books").click();
      const dialog = dialogOf(page);
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("[data-book-item]")).toHaveText([
        `${cfg.firstLabel}: ${peso(1)} becomes ${peso(cfg.firstA)}`,
      ]);
      await expect(dialog.getByRole("checkbox")).toHaveCount(0);
      expect(bookCalls(seen).length).toBe(before + 1);
      // Keep my numbers: nothing changes, and the figure now shows as edited.
      await dialog.getByRole("button", { name: "Keep my numbers" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(input).toHaveValue("1");
      await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
      await expect(badge(page, cfg.first)).toContainText(
        `Edited · books say ${peso(cfg.firstA)}`,
      );
      // Again, and this time fill from the books.
      await radio(page, "Manual").click();
      await radio(page, "Portal books").click();
      await dialogOf(page).getByRole("button", { name: "Fill from books" }).click();
      await expect(input).toHaveValue(String(cfg.firstA));
      await expect(badge(page, cfg.first)).toContainText("From books");
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} Manual to Books with nothing to change switches without a question`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { unmocked, dialogs } = await openDraft(page, cfg, w, booksDraft(cfg));
      await radio(page, "Manual").click();
      await radio(page, "Portal books").click();
      await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
      await expect(badge(page, cfg.first)).toContainText("From books");
      await expect(dialogOf(page)).toHaveCount(0);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} Refresh from books lists only the figures that differ, and an edited one is unticked`, async ({
      page,
    }) => {
      const w = world(cfg, { books: cfg.b });
      const { unmocked, dialogs, quiet } = await openDraft(page, cfg, w, booksDraft(cfg));
      await quiet();
      // The user typed over the second figure before refreshing.
      const second = cfg.input(page, cfg.second);
      await second.fill("7");
      await page.getByRole("button", { name: "Refresh from books" }).click();
      const dialog = dialogOf(page);
      await expect(dialog).toBeVisible();
      const items = dialog.locator("[data-book-item]");
      await expect(items).toHaveText([
        `${cfg.firstLabel}: ${peso(cfg.firstA)} becomes ${peso(cfg.firstB)}`,
        `${cfg.secondLabel}: ${peso(7)} becomes ${peso(cfg.secondB)}`,
      ]);
      await expect(items.nth(0).getByRole("checkbox")).toBeChecked();
      await expect(items.nth(1).getByRole("checkbox")).not.toBeChecked();
      // Leave the edited one unticked: it keeps what was typed.
      await dialog.getByRole("button", { name: "Fill from books" }).click();
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstB));
      await expect(second).toHaveValue("7");
      await expect(badge(page, cfg.second)).toContainText(
        `Edited · books say ${peso(cfg.secondB)}`,
      );
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} ticking an edited figure lets the refresh replace it`, async ({
      page,
    }) => {
      const w = world(cfg, { books: cfg.b });
      const { unmocked, dialogs, quiet } = await openDraft(page, cfg, w, booksDraft(cfg));
      await quiet();
      await cfg.input(page, cfg.second).fill("7");
      await page.getByRole("button", { name: "Refresh from books" }).click();
      const dialog = dialogOf(page);
      await dialog.locator("[data-book-item]").nth(1).getByRole("checkbox").check();
      await dialog.getByRole("button", { name: "Fill from books" }).click();
      await expect(cfg.input(page, cfg.second)).toHaveValue(String(cfg.secondB));
      await expect(badge(page, cfg.second)).toContainText("From books");
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} Keep my numbers on a refresh changes no number`, async ({
      page,
    }) => {
      const w = world(cfg, { books: cfg.b });
      const { unmocked, dialogs, quiet } = await openDraft(page, cfg, w, booksDraft(cfg));
      await quiet();
      await page.getByRole("button", { name: "Refresh from books" }).click();
      await dialogOf(page).getByRole("button", { name: "Keep my numbers" }).click();
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstA));
      await expect(cfg.input(page, cfg.second)).toHaveValue(String(cfg.secondA));
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} an old draft without _source opens in Manual, with no fetch`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(page, cfg, w);
      await expect(radio(page, "Manual")).toHaveAttribute("aria-checked", "true");
      await quiet();
      expect(bookCalls(seen)).toHaveLength(0);
      await expect(page.locator("[data-book-badge]")).toHaveCount(0);
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstA));
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a draft saved in Manual with a _source opens in Manual, with no fetch`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg, { mode: "manual" }),
      );
      await expect(radio(page, "Manual")).toHaveAttribute("aria-checked", "true");
      await quiet();
      expect(bookCalls(seen)).toHaveLength(0);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a draft saved in Portal books opens in it and does one background fetch; a differing figure shows the staleness note`, async ({
      page,
    }) => {
      const w = world(cfg, { books: cfg.b });
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg),
      );
      await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
      await expect(page.locator("[data-book-stale]")).toContainText(
        "The books changed after this draft was filled: 2 figures differ.",
      );
      // Nothing was refreshed by itself.
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstA));
      await page.getByRole("button", { name: "Review and refresh" }).click();
      await expect(dialogOf(page).locator("[data-book-item]")).toHaveCount(2);
      await dialogOf(page).getByRole("button", { name: "Fill from books" }).click();
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstB));
      await expect(page.locator("[data-book-stale]")).toHaveCount(0);
      await quiet();
      expect(bookCalls(seen)).toHaveLength(1);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a draft whose books have not changed shows no staleness note`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg),
      );
      await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
      await quiet();
      expect(bookCalls(seen)).toHaveLength(1);
      await expect(page.locator("[data-book-stale]")).toHaveCount(0);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a filed return shows no switch; with a _source it says when the books filled it`, async ({
      page,
    }) => {
      const w = world(cfg);
      const filed = {
        status: "filed",
        filedAt: "2026-10-09T02:00:00.000Z",
        ...booksDraft(cfg, { asOf: "2026-10-11T17:30:00.000Z" }),
      };
      const { seen, unmocked, dialogs, quiet } = await openDraft(page, cfg, w, filed);
      await expect(
        page.getByRole("button", { name: "Amend", exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-book-switch]")).toHaveCount(0);
      await expect(page.locator("[data-book-filed-line]")).toHaveText(
        "Figures were filled from the Portal's books on October 12, 2026.",
      );
      await quiet();
      expect(bookCalls(seen)).toHaveLength(0);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a filed return without a _source shows neither the switch nor the line`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { unmocked, dialogs } = await openDraft(page, cfg, w, {
        status: "filed",
        filedAt: "2026-10-09T02:00:00.000Z",
      });
      await expect(
        page.getByRole("button", { name: "Amend", exact: true }),
      ).toBeVisible();
      await expect(page.locator("[data-book-switch]")).toHaveCount(0);
      await expect(page.locator("[data-book-filed-line]")).toHaveCount(0);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a failed fetch shows its message and leaves the form as it was`, async ({
      page,
    }) => {
      const MESSAGE = `Books can't fill the ${code} yet.`;
      const w = world(cfg, { refuse: { status: 400, message: MESSAGE } });
      const { unmocked, dialogs } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(page.locator("[data-book-error]")).toHaveText(MESSAGE);
      await expect(cfg.input(page, cfg.first)).toHaveValue("");
      await expect(page.locator("[data-book-badge]")).toHaveCount(0);
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} a failed fetch on Manual to Books keeps Manual and the typed numbers`, async ({
      page,
    }) => {
      const MESSAGE = "INVENTED: the books could not be read just now.";
      const w = world(cfg, { refuse: { status: 403, message: MESSAGE } });
      const { unmocked, dialogs } = await openDraft(page, cfg, w);
      await cfg.input(page, cfg.first).fill("42");
      await radio(page, "Portal books").click();
      await expect(page.locator("[data-book-error]")).toHaveText(MESSAGE);
      await expect(radio(page, "Manual")).toHaveAttribute("aria-checked", "true");
      await expect(cfg.input(page, cfg.first)).toHaveValue("42");
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} choosing another quarter asks the books again and asks before it changes a number`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel(/^Quarter/).selectOption("Q3");
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(badge(page, cfg.first)).toContainText("From books");
      await quiet();
      w.books = cfg.b;
      await page.getByLabel(/^Quarter/).selectOption("Q2");
      const dialog = dialogOf(page);
      await expect(dialog.locator("[data-book-item]")).toHaveCount(2);
      expect(bookCalls(seen)).toHaveLength(2);
      expect(bookCalls(seen)[1]!.search.get("period")).toBe("2026-Q2");
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstA));
      await dialog.getByRole("button", { name: "Fill from books" }).click();
      await expect(cfg.input(page, cfg.first)).toHaveValue(String(cfg.firstB));
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} numbers typed before the client is chosen are asked about, not overwritten`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { unmocked, dialogs } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel(/^Quarter/).selectOption("Q3");
      await cfg.input(page, cfg.first).fill("5");
      await page.getByLabel("Client").selectOption(CLIENT.id);
      const dialog = dialogOf(page);
      await expect(dialog.locator("[data-book-item]").first()).toHaveText(
        `${cfg.firstLabel}: ${peso(5)} becomes ${peso(cfg.firstA)}`,
      );
      await expect(cfg.input(page, cfg.first)).toHaveValue("5");
      await dialog.getByRole("button", { name: "Keep my numbers" }).click();
      await expect(cfg.input(page, cfg.first)).toHaveValue("5");
      await expect(badge(page, cfg.first)).toContainText("Edited");
      clean(unmocked, dialogs);
    });

    test(`T1 ${code} View records opens the books' page for the figure in a new tab`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { unmocked, dialogs } = await openDraft(page, cfg, w, booksDraft(cfg));
      const link = badge(page, cfg.first).getByRole("link", { name: "View records" });
      await expect(link).toHaveAttribute("href", `/clients/${CLIENT.id}/sales`);
      await expect(link).toHaveAttribute("target", "_blank");
      clean(unmocked, dialogs);
    });
  });

  // -------------------------------------------------------------------------
  // T2 — Save carries _source; Preview PDF and the XML export are unchanged
  // -------------------------------------------------------------------------

  test.describe(`T2 ${code}: save, preview, export (hermetic)`, () => {
    test(`T2 ${code} Save changes sends _source with the data, and the compute never sees it`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg),
      );
      await quiet();
      await cfg.input(page, cfg.first).fill("1234");
      await page.getByRole("button", { name: "Save changes" }).click();
      await quiet();
      const patches = seen.filter(
        (s) => s.method === "PATCH" && /\/bir-forms\/[^/]+$/.test(s.path),
      );
      expect(patches).toHaveLength(1);
      const sent = patches[0]!.request.postDataJSON() as {
        data: Record<string, unknown>;
      };
      expect(sent.data._source).toEqual({
        mode: "books",
        asOf: ASOF_A,
        fed: cfg.a,
        edited: [cfg.editedKey],
      });
      expect(sent.data.year).toBe("2026");
      const computes = seen.filter(
        (s) => s.method === "POST" && /\/bir-forms\/compute$/.test(s.path),
      );
      expect(computes.length).toBeGreaterThan(0);
      for (const c of computes) {
        const body = c.request.postDataJSON() as { data: Record<string, unknown> };
        expect(body.data).not.toHaveProperty("_source");
      }
      clean(unmocked, dialogs);
    });

    test(`T2 ${code} an old draft saved by hand carries no _source`, async ({ page }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(page, cfg, w);
      await cfg.input(page, cfg.first).fill("1234");
      await page.getByRole("button", { name: "Save changes" }).click();
      await quiet();
      const patches = seen.filter(
        (s) => s.method === "PATCH" && /\/bir-forms\/[^/]+$/.test(s.path),
      );
      expect(patches).toHaveLength(1);
      expect(patches[0]!.request.postDataJSON().data).not.toHaveProperty("_source");
      clean(unmocked, dialogs);
    });

    test(`T2 ${code} a draft saved in Manual after leaving Portal books keeps its _source in Manual`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg),
      );
      await quiet();
      await radio(page, "Manual").click();
      await page.getByRole("button", { name: "Save changes" }).click();
      await quiet();
      const patches = seen.filter(
        (s) => s.method === "PATCH" && /\/bir-forms\/[^/]+$/.test(s.path),
      );
      expect(patches).toHaveLength(1);
      expect(patches[0]!.request.postDataJSON().data._source).toEqual({
        mode: "manual",
        asOf: ASOF_A,
        fed: cfg.a,
        edited: [],
      });
      clean(unmocked, dialogs);
    });

    test(`T2 ${code} Preview PDF on a clean book-filled draft saves nothing first, and downloads`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        { ...booksDraft(cfg), previewAvailable: true },
        [
          [
            "POST",
            new RegExp(`^/api/v1/bir-forms/${PNG_ID}/preview-pdf$`),
            (r) =>
              r.fulfill({
                status: 200,
                contentType: "application/pdf",
                headers: {
                  "Content-Disposition": 'attachment; filename="preview-DRAFT.pdf"',
                },
                body: Buffer.from("%PDF-1.4\n%%EOF\n"),
              }),
          ],
        ],
      );
      await quiet();
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "Preview PDF" }).click();
      expect((await downloading).suggestedFilename()).toBe("preview-DRAFT.pdf");
      await quiet();
      expect(seen.filter((s) => s.method === "PATCH")).toHaveLength(0);
      expect(
        seen.filter((s) => s.method === "POST" && /preview-pdf$/.test(s.path)),
      ).toHaveLength(1);
      clean(unmocked, dialogs);
    });

    test(`T2 ${code} Export eBIRForms XML works on a book-filled draft as it does on a typed one`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { seen, unmocked, dialogs, quiet } = await openDraft(
        page,
        cfg,
        w,
        booksDraft(cfg),
        [
          [
            "POST",
            new RegExp(`^/api/v1/bir-forms/${PNG_ID}/export$`),
            (r) =>
              json(
                r,
                {
                  id: "x1",
                  kind: "xml",
                  filename: "export.xml",
                  url: `${SIGNED}/export.xml?sig=i`,
                },
                201,
              ),
          ],
        ],
      );
      await quiet();
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export eBIRForms XML" }).click();
      expect((await downloading).suggestedFilename()).toBe("export.xml");
      expect(
        seen.filter((s) => s.method === "POST" && /\/export$/.test(s.path)),
      ).toHaveLength(1);
      clean(unmocked, dialogs);
    });
  });

  // -------------------------------------------------------------------------
  // T3 — warnings word for word (R3)
  // -------------------------------------------------------------------------

  test.describe(`T3 ${code}: warnings (hermetic)`, () => {
    test(`T3 ${code} the books' warnings show word for word above the card`, async ({
      page,
    }) => {
      const WARNINGS = [
        "INVENTED WARNING ONE: two sales have no VAT class and were left out.",
        "INVENTED WARNING TWO: one purchase is dated outside the quarter.",
      ];
      const w = world(cfg, { warnings: WARNINGS });
      const { unmocked, dialogs } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(page.locator("[data-book-warnings] li")).toHaveText(WARNINGS);
      clean(unmocked, dialogs);
    });

    test(`T3 ${code} no warnings, no note`, async ({ page }) => {
      const w = world(cfg);
      const { unmocked, dialogs } = await mockApi(page, cfg, w);
      await page.goto(cfg.newUrl);
      await page.getByLabel("Client").selectOption(CLIENT.id);
      await expect(badge(page, cfg.first)).toBeVisible();
      await expect(page.locator("[data-book-warnings]")).toHaveCount(0);
      clean(unmocked, dialogs);
    });
  });
}

test("T1 2550Q a purchases figure's View records goes to Expenses", async ({ page }) => {
  const cfg = CFG["2550Q"];
  const w = world(cfg);
  const { unmocked, dialogs } = await openDraft(page, cfg, w, booksDraft(cfg));
  const link = badge(page, "i44a").getByRole("link", { name: "View records" });
  await expect(link).toHaveAttribute("href", `/clients/${CLIENT.id}/expenses`);
  await expect(link).toHaveAttribute("target", "_blank");
  clean(unmocked, dialogs);
});

// ---------------------------------------------------------------------------
// W16-A1 — T1: the 2551Q's books rows are matched by ATC, never by position
// ---------------------------------------------------------------------------

const R = (atc: string, taxable: string, rate = "3") => ({ atc, taxable, rate });
const tableRow = (page: Page, i: number) => page.locator("tbody tr").nth(i);
const rowAtc = (page: Page, i: number) => tableRow(page, i).locator("select");
const rowAmount = (page: Page, i: number) =>
  tableRow(page, i).locator('input[type="number"]').first();

test.describe("W16-A1 T1 2551Q: rows by ATC (hermetic)", () => {
  const cfg = CFG["2551Q"];

  test("T1 2551Q the draft's PT060 is compared with the books' PT060, and PT010 is added", async ({
    page,
  }) => {
    const w = world(cfg, {
      books: { rows: [R("PT010", "120000"), R("PT060", "45000")] },
    });
    const { unmocked, dialogs } = await openDraft(page, cfg, w, {
      data: cfg.data({ rows: [R("PT060", "5")] }),
    });
    await radio(page, "Portal books").click();
    const dialog = dialogOf(page);
    await expect(dialog.locator("[data-book-item]")).toHaveText([
      `Schedule 1 · PT010: added ${peso(120000)}`,
      `Schedule 1 · PT060: ${peso(5)} becomes ${peso(45000)}`,
    ]);
    await expect(dialog).not.toContainText(`${peso(5)} becomes ${peso(120000)}`);
    await dialog.getByRole("button", { name: "Fill from books" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(rowAtc(page, 0)).toHaveValue("PT060");
    await expect(rowAmount(page, 0)).toHaveValue("45000");
    await expect(rowAtc(page, 1)).toHaveValue("PT010");
    await expect(rowAmount(page, 1)).toHaveValue("120000");
    clean(unmocked, dialogs);
  });

  test("T1 2551Q a draft row with an ATC the books lack is untouched and unlisted", async ({
    page,
  }) => {
    const w = world(cfg, { books: { rows: [R("PT060", "45000")] } });
    const { unmocked, dialogs } = await openDraft(page, cfg, w, {
      data: cfg.data({ rows: [R("PT090", "777"), R("PT060", "5")] }),
    });
    await radio(page, "Portal books").click();
    const dialog = dialogOf(page);
    await expect(dialog.locator("[data-book-item]")).toHaveText([
      `Schedule 1 · PT060: ${peso(5)} becomes ${peso(45000)}`,
    ]);
    await dialog.getByRole("button", { name: "Fill from books" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(rowAtc(page, 0)).toHaveValue("PT090");
    await expect(rowAmount(page, 0)).toHaveValue("777");
    await expect(rowAmount(page, 1)).toHaveValue("45000");
    await expect(badge(page, "rows.PT060")).toContainText("From books");
    clean(unmocked, dialogs);
  });

  test("T1 2551Q reordering the draft's rows changes nothing about which figures the books touch; the edited marker follows the ATC", async ({
    page,
  }) => {
    // The draft was filled in the order PT010, PT040; it now holds PT040 first.
    // The books answer in the other order, with the same amounts.
    const w = world(cfg, {
      books: { rows: [R("PT040", "45000"), R("PT010", "120000")] },
    });
    const { seen, unmocked, dialogs, quiet } = await openDraft(page, cfg, w, {
      data: cfg.data(
        { rows: [R("PT040", "45000"), R("PT010", "120000")] },
        {
          _source: source(cfg, {
            fed: { rows: [R("PT010", "120000"), R("PT040", "45000")] },
          }),
        },
      ),
    });
    await quiet();
    // Nothing moved: no staleness note, and each badge sits on its own ATC's row.
    await expect(page.locator("[data-book-stale]")).toHaveCount(0);
    await expect(rowAtc(page, 1)).toHaveValue("PT010");
    await expect(tableRow(page, 1).locator("[data-book-badge]")).toHaveAttribute(
      "data-book-badge",
      "rows.PT010",
    );
    await expect(tableRow(page, 0).locator("[data-book-badge]")).toHaveAttribute(
      "data-book-badge",
      "rows.PT040",
    );
    await rowAmount(page, 1).fill("1");
    await expect(badge(page, "rows.PT010")).toContainText(
      `Edited · books say ${peso(120000)}`,
    );
    await expect(badge(page, "rows.PT040")).toContainText("From books");
    await page.getByRole("button", { name: "Save changes" }).click();
    await quiet();
    const patches = seen.filter(
      (s) => s.method === "PATCH" && /\/bir-forms\/[^/]+$/.test(s.path),
    );
    expect(patches).toHaveLength(1);
    const sent = patches[0]!.request.postDataJSON() as {
      data: { _source: { edited: string[] } };
    };
    expect(sent.data._source.edited).toEqual(["rows.PT010"]);
    clean(unmocked, dialogs);
  });

  test("T1 2551Q with no room for a new row nothing is added, and the API's warning shows", async ({
    page,
  }) => {
    const ROOM =
      "The books have 7 ATCs, but Schedule 1 has room for 6 rows. Combine or move some before exporting.";
    const full = ["PT010", "PT040", "PT041", "PT060", "PT070", "PT090"].map((a) =>
      R(a, ""),
    );
    const w = world(cfg, {
      books: { rows: [R("PT120", "100")] },
      warnings: [ROOM],
    });
    const { unmocked, dialogs } = await openDraft(page, cfg, w, {
      data: cfg.data({ rows: full }),
    });
    await radio(page, "Portal books").click();
    await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
    await expect(dialogOf(page)).toHaveCount(0);
    await expect(page.locator("tbody tr")).toHaveCount(6);
    await expect(page.locator("[data-book-warnings] li")).toHaveText([ROOM]);
    await expect(page.locator("[data-book-badge]")).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

// ---------------------------------------------------------------------------
// W16-A1 — T2: one record, one figure differs (R2)
// ---------------------------------------------------------------------------

for (const code of ["2551Q", "2550Q"] as const) {
  const cfg = CFG[code];
  // The books give the first figure a new amount and every other figure as before.
  const changedFirst: Figures =
    code === "2551Q"
      ? { rows: [R("PT010", String(cfg.firstB)), R("PT040", String(cfg.secondA))] }
      : { ...cfg.a, i31a: String(cfg.firstB) };

  test.describe(`W16-A1 T2 ${code}: singular and plural (hermetic)`, () => {
    test(`T2 ${code} one record reads 1 record, and one stale figure reads 1 figure differs`, async ({
      page,
    }) => {
      const w = world(cfg, { books: changedFirst, records: { [cfg.recordKey]: 1 } });
      const { unmocked, dialogs } = await openDraft(page, cfg, w, booksDraft(cfg));
      await expect(page.locator("[data-book-stale]")).toContainText(
        "The books changed after this draft was filled: 1 figure differs.",
      );
      await expect(badge(page, cfg.first)).toContainText("From books · 1 record");
      await expect(badge(page, cfg.first)).not.toContainText("1 records");
      await expect(badge(page, cfg.second)).toContainText(/From books · \d+ records/);
      clean(unmocked, dialogs);
    });

    test(`T2 ${code} two figures read 2 figures differ`, async ({ page }) => {
      const w = world(cfg, { books: cfg.b });
      const { unmocked, dialogs } = await openDraft(page, cfg, w, booksDraft(cfg));
      await expect(page.locator("[data-book-stale]")).toContainText("2 figures differ.");
      clean(unmocked, dialogs);
    });
  });

  // -------------------------------------------------------------------------
  // W16-A1 — T3: "Refresh from books" with nothing to change says so (R3)
  // -------------------------------------------------------------------------

  test.describe(`W16-A1 T3 ${code}: nothing to refresh (hermetic)`, () => {
    test(`T3 ${code} Refresh from books with nothing to change shows the note, and no question`, async ({
      page,
    }) => {
      const w = world(cfg);
      const { unmocked, dialogs, quiet } = await openDraft(page, cfg, w, booksDraft(cfg));
      await quiet();
      await expect(page.locator("[data-book-match]")).toHaveCount(0);
      await page.getByRole("button", { name: "Refresh from books" }).click();
      await expect(page.locator("[data-book-match]")).toHaveText(
        "The books match this draft. Nothing to refresh.",
      );
      await expect(dialogOf(page)).toHaveCount(0);
      // The note is about what the draft held then: typing takes it away.
      await cfg.input(page, cfg.first).fill("1");
      await expect(page.locator("[data-book-match]")).toHaveCount(0);
      clean(unmocked, dialogs);
    });

    test(`T3 ${code} Refresh from books with something to change shows no such note`, async ({
      page,
    }) => {
      const w = world(cfg, { books: cfg.b });
      const { unmocked, dialogs, quiet } = await openDraft(page, cfg, w, booksDraft(cfg));
      await quiet();
      await page.getByRole("button", { name: "Refresh from books" }).click();
      await expect(dialogOf(page)).toBeVisible();
      await expect(page.locator("[data-book-match]")).toHaveCount(0);
      clean(unmocked, dialogs);
    });
  });
}

// ---------------------------------------------------------------------------
// W16-A1 — T3: the 2550Q's Item 45 as the form prints it (R4)
// ---------------------------------------------------------------------------

test.describe("W16-A1 T3 2550Q: Item 45 label (hermetic)", () => {
  const cfg = CFG["2550Q"];
  const OLD = "Domestic — services (Item 45)";
  const NEW = "Services Rendered by Non-Residents (Item 45)";

  test("T3 2550Q the editor names Item 45 as the form prints it", async ({ page }) => {
    const w = world(cfg);
    const { unmocked, dialogs } = await openDraft(page, cfg, w);
    await expect(page.getByText(NEW, { exact: true })).toBeVisible();
    await expect(page.getByText(OLD)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 2550Q the question names Item 45 the same way", async ({ page }) => {
    const w = world(cfg, { books: { ...cfg.a, i45a: "3000", i45b: "360" } });
    const { unmocked, dialogs } = await openDraft(page, cfg, w);
    await radio(page, "Portal books").click();
    await expect(dialogOf(page).locator("[data-book-item]")).toHaveText([
      `${NEW}: purchases: ${peso(0)} becomes ${peso(3000)}`,
      `${NEW}: input tax: ${peso(0)} becomes ${peso(360)}`,
    ]);
    await expect(dialogOf(page)).not.toContainText(OLD);
    clean(unmocked, dialogs);
  });
});

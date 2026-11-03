// track-b-w17.spec.ts — hermetic browser tests for W17: the 0619-E, 1601-EQ and
// 1601-C editors (Track A U17). One router answers every /api/v1 call from a table of
// mocks; any call the table does not cover is recorded and FAILS the test.
//
// The mock server computes the way the real one is documented to (Item 16 = 14 less
// 15, and so on) so a live read-out can be seen to follow what is typed; it is a
// stand-in, not the rule: the web adds nothing up.
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222h1";

const CLIENT = {
  id: "c1700000-0000-4000-8000-0000000000h1",
  businessName: "INVENTED SEVENTEEN WITHHOLDING CO",
  tin: "000-171-017-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};

const ME = {
  user: {
    id: "u1700000-0000-4000-8000-0000000000h1",
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

// ---------------------------------------------------------------------------
// The mock server's own arithmetic (a stand-in for U17's compute)
// ---------------------------------------------------------------------------

type Data = Record<string, unknown>;
const c2 = (x: number) => Math.round(x * 100) / 100;
const n = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(v));

function compute0619E(d: Data) {
  const i14 = n(d.remittance);
  const i15 = n(d.previouslyRemitted);
  const i16 = c2(i14 - i15);
  const pen = c2(n(d.surcharge) + n(d.interest) + n(d.compromise));
  const month = String(d.month ?? "");
  const next = Number(month) === 12 ? "01" : String(Number(month) + 1).padStart(2, "0");
  return {
    i14,
    i15,
    i16,
    i17a: n(d.surcharge),
    i17b: n(d.interest),
    i17c: n(d.compromise),
    i17d: pen,
    i18: c2(i16 + pen),
    // The mock's own default: the 10th of the next month.
    defaultDueDate: month ? `${d.year}-${next}-10` : "",
  };
}

function compute1601EQ(d: Data) {
  const rows = (Array.isArray(d.rows) ? d.rows : []) as Data[];
  const rowCount = rows.filter(
    (r) => String(r.atc ?? "").trim() !== "" || n(r.base) !== 0 || n(r.withheld) !== 0,
  ).length;
  const i19 = c2(rows.reduce((a, r) => a + n(r.withheld), 0));
  const i25 = c2(
    n(d.remittance1) +
      n(d.remittance2) +
      n(d.previouslyRemitted) +
      n(d.overRemittancePrior) +
      n(d.otherPayments),
  );
  const i26 = c2(i19 - i25);
  const i30 = c2(n(d.surcharge) + n(d.interest) + n(d.compromise));
  const i31 = c2(i26 + i30);
  const over = i31 < 0;
  const picked = String(d.overRemittanceChoice ?? "");
  const q = String(d.quarter ?? "").replace(/\D/g, "");
  const choice =
    over &&
    ["refunded", "tcc", "carried"].includes(picked) &&
    !(picked === "carried" && q === "4")
      ? picked
      : "";
  return {
    rows: rows.map((r) => ({ withheld: n(r.withheld) })),
    rowCount,
    i19,
    i20: n(d.remittance1),
    i21: n(d.remittance2),
    i22: n(d.previouslyRemitted),
    i23: n(d.overRemittancePrior),
    i24: n(d.otherPayments),
    i25,
    i26,
    i27: n(d.surcharge),
    i28: n(d.interest),
    i29: n(d.compromise),
    i30,
    i31,
    overRemittance: over,
    overRemittanceAmount: over ? c2(-i31) : 0,
    overRemittanceChoice: choice,
  };
}

function compute1601C(d: Data) {
  const i14 = n(d.compensation);
  const i21 = c2(
    n(d.mwe) +
      n(d.holiday) +
      n(d.thirteenth) +
      n(d.deMinimis) +
      n(d.contributions) +
      n(d.otherNonTaxable),
  );
  const i22 = c2(i14 - i21);
  const i23 = n(d.notSubjectToWithholding);
  const i24 = c2(i22 - i23);
  const i25 = n(d.taxesWithheld);
  const sched = (Array.isArray(d.scheduleRows) ? d.scheduleRows : []) as Data[];
  const adj = [0, 1, 2].map((i) => c2(n(sched[i]?.shouldBe) - n(sched[i]?.taxPaid)));
  const total = c2(adj[0]! + adj[1]! + adj[2]!);
  const i27 = c2(i25 + total);
  const i30 = c2(n(d.previouslyRemitted) + n(d.otherRemittances));
  const i31 = c2(i27 - i30);
  const i35 = c2(n(d.surcharge) + n(d.interest) + n(d.compromise));
  return {
    i14,
    i21,
    i22,
    i23,
    i24,
    i25,
    adjustments: adj,
    scheduleTotal: total,
    i26: total,
    i27,
    i28: n(d.previouslyRemitted),
    i29: n(d.otherRemittances),
    i30,
    i31,
    i32: n(d.surcharge),
    i33: n(d.interest),
    i34: n(d.compromise),
    i35,
    i36: c2(i31 + i35),
  };
}

type FormCode = "0619E" | "1601EQ" | "1601C";
const COMPUTE: Record<FormCode, (d: Data) => unknown> = {
  "0619E": compute0619E,
  "1601EQ": compute1601EQ,
  "1601C": compute1601C,
};

// The server's sentences, as U17 words them.
const THIRD_MONTH =
  "The third month of a quarter is reported on the 1601-EQ, not on a 0619-E.";
const notValid = (form: string) => `That isn't a valid period for the ${form}.`;
const sixRows = (k: number) => `${k} ATCs; the form has six rows.`;
const previewNo = (form: string) => `A preview of the ${form} is not available yet.`;
const clearCopyNo = (form: string) => `A clear copy of the ${form} is not available yet.`;
const PRINTED_NOT_XML = "This form is printed; eBIRForms XML is not available for it.";

// ---------------------------------------------------------------------------
// World and router
// ---------------------------------------------------------------------------

interface Books {
  figures: Data;
  lines: unknown[];
  warnings: string[];
  recordCount: number;
}
interface World {
  books: Partial<Record<FormCode, Books>>;
  store: Map<string, Record<string, unknown>>;
  nextId: number;
}
const world = (over: Partial<World> = {}): World => ({
  books: {},
  store: new Map(),
  nextId: 1,
  ...over,
});

const idOf = (k: number) => `f1700000-0000-4000-8000-${String(k).padStart(12, "0")}`;

function detailOf(
  w: World,
  over: { id: string; form: FormCode; period: string; data: Data } & Record<
    string,
    unknown
  >,
) {
  return {
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    status: "draft",
    filedAt: null,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-01T01:00:00.000Z",
    amendsId: null,
    sequence: 1,
    exports: [],
    filedSnapshot: null,
    // Until Track C's C9 the print maps are not there: both are false.
    clearCopyAvailable: false,
    previewAvailable: false,
    canDelete: false,
    computed: COMPUTE[over.form](over.data),
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
    [
      "POST",
      /^\/api\/v1\/bir-forms\/compute$/,
      (r, s) => {
        const body = s.request.postDataJSON() as { form: FormCode; data: Data };
        return json(r, COMPUTE[body.form]?.(body.data) ?? {});
      },
    ],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/([^/]+)$/,
      (r, s) => {
        const found = w.store.get(s.path.split("/").pop()!);
        return found ? json(r, found) : json(r, { message: "Not found" }, 404);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms$/,
      (r, s) => {
        const body = s.request.postDataJSON() as {
          form: FormCode;
          period: string;
          data: Data;
        };
        const bad = periodRefusal(body.form, body.period);
        if (bad) return json(r, { message: bad }, 400);
        const id = idOf(w.nextId++);
        const made = detailOf(w, {
          id,
          form: body.form,
          period: body.period,
          data: body.data,
        });
        w.store.set(id, made);
        return json(r, made, 201);
      },
    ],
    [
      "PATCH",
      /^\/api\/v1\/bir-forms\/([^/]+)$/,
      (r, s) => {
        const id = s.path.split("/").pop()!;
        const cur = w.store.get(id)! as {
          form: FormCode;
          period: string;
          data: Data;
          status: string;
        };
        const body = s.request.postDataJSON() as {
          period?: string;
          data?: Data;
          status?: string;
        };
        if (body.period !== undefined) {
          const bad = periodRefusal(cur.form, body.period);
          if (bad) return json(r, { message: bad }, 400);
        }
        const data = body.data ?? cur.data;
        if (body.status === "filed" && cur.form === "1601EQ") {
          const k = (compute1601EQ(data) as { rowCount: number }).rowCount;
          if (k > 6) return json(r, { message: sixRows(k) }, 409);
        }
        const next = {
          ...cur,
          ...(body.period ? { period: body.period } : {}),
          data,
          ...(body.status === "filed"
            ? { status: "filed", filedAt: "2026-10-12T02:00:00.000Z" }
            : {}),
          computed: COMPUTE[cur.form](data),
        };
        w.store.set(id, next);
        return json(r, next);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/([^/]+)\/preview-pdf$/,
      (r, s) => {
        const cur = w.store.get(s.path.split("/")[4]!) as { form: string };
        return json(r, { message: previewNo(cur.form) }, 409);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/([^/]+)\/clear-copy$/,
      (r, s) => {
        const cur = w.store.get(s.path.split("/")[4]!) as { form: string };
        return json(r, { message: clearCopyNo(cur.form) }, 409);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/bir-forms\/([^/]+)\/export$/,
      (r) => json(r, { message: PRINTED_NOT_XML }, 409),
    ],
    [
      "GET",
      /^\/api\/v1\/bir-forms\/book-figures$/,
      (r, s) => {
        const form = s.search.get("form") as FormCode;
        const b = w.books[form];
        if (form === "1601C") {
          return json(
            r,
            {
              message: "1601-C figures are typed; the Portal has no payroll records yet.",
            },
            400,
          );
        }
        const period = s.search.get("period");
        const bad = periodRefusal(form, period ?? "");
        if (bad) return json(r, { message: bad }, 400);
        return json(r, {
          form,
          period,
          asOf: "2026-10-12T01:00:00.000Z",
          recordCount: b?.recordCount ?? 0,
          figures: b?.figures ?? {},
          lines: b?.lines ?? [],
          warnings: b?.warnings ?? [],
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
  return { seen, unmocked, dialogs, quiet };
}

/** The server's period rule (U17): months for the 0619-E (not the 3rd of a quarter) and
 *  1601-C, quarters for the 1601-EQ. */
function periodRefusal(form: string, period: string): string | null {
  if (form === "1601EQ") return /^\d{4}-Q[1-4]$/.test(period) ? null : notValid(form);
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!m) return notValid(form);
  if (form === "0619E" && Number(m[2]) % 3 === 0) return THIRD_MONTH;
  return null;
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
const group = (page: Page, name: string) => page.getByRole("radiogroup", { name });
const badge = (page: Page, id: string) => page.locator(`[data-book-badge="${id}"]`);
const readout = (page: Page, label: string) => page.locator(`[data-readout="${label}"]`);

/** Save a draft the way a person does, and wait for the editor to be on its own page. */
async function saveNew(page: Page) {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/bir-forms\/f1700000-/);
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
}

const NO_EXPORT = (page: Page) =>
  page.getByRole("button", { name: /Export eBIRForms XML/ });

// ===========================================================================
// 0619-E
// ===========================================================================

const BOOKS_0619E: Books = {
  figures: { anyWithheld: "yes", remittance: "12345.67" },
  lines: [
    {
      key: "atc.WC160",
      label: "ATC WC160",
      amount: 6000,
      records: 3,
      filter: { kind: "purchases", from: "2026-08-01", to: "2026-08-31", atc: "WC160" },
    },
    {
      key: "remittance",
      label: "Amount of remittance — Item 14",
      amount: 12345.67,
      records: 5,
      filter: { kind: "purchases", from: "2026-08-01", to: "2026-08-31" },
    },
  ],
  warnings: [
    "2 purchases (₱1,500.00) have an amount withheld but no ATC and were left out.",
    "3 purchases (₱800.00) have an amount withheld under an ATC that is not an expanded-withholding code (WI161, WI162) and were left out.",
  ],
  recordCount: 5,
};

test.describe("W17 T1 0619-E (hermetic)", () => {
  test("T1 the New form picker offers months 1 and 2 of a quarter only", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=0619E");
    await expect(page.getByLabel(/^Month/).locator("option")).toHaveText([
      "January",
      "February",
      "April",
      "May",
      "July",
      "August",
      "October",
      "November",
    ]);
    await expect(page.getByRole("heading", { name: "New 0619-E" })).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T1 a new 0619-E fills Items 4 and 14 from the books, shows the books' warnings word for word, and the server's due date", async ({
    page,
  }) => {
    const w = world({ books: { "0619E": BOOKS_0619E } });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=0619E");
    await page.getByLabel(/^Month/).selectOption("08");
    await expect(radio(page, "Portal books")).toHaveAttribute("aria-checked", "true");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await expect(page.getByLabel("Amount of remittance (Item 14)")).toHaveValue(
      "12345.67",
    );
    await expect(badge(page, "remittance")).toContainText("From books · 5 records");
    await expect(
      group(page, "Any taxes withheld? (Item 4)").getByRole("radio", { name: "Yes" }),
    ).toBeChecked();
    await expect(page.locator("[data-book-warnings] li")).toHaveText(
      BOOKS_0619E.warnings,
    );
    await quiet();
    const calls = bookCalls(seen);
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0]!.search)).toEqual({
      clientId: CLIENT.id,
      form: "0619E",
      period: "2026-08",
    });
    // Item 2 shows the server's default for the month, and says what it ignores.
    await expect(page.getByLabel("Due date (Item 2)")).toHaveValue("2026-09-10");
    await expect(
      page.getByText(
        "A due date on a weekend moves to the Monday. Holidays are not considered.",
      ),
    ).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T1 create, edit, save, reload and mark filed; the figures are live; no Export XML anywhere", async ({
    page,
  }) => {
    const w = world({ books: { "0619E": BOOKS_0619E } });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=0619E");
    await page.getByLabel(/^Month/).selectOption("08");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await expect(page.getByLabel("Amount of remittance (Item 14)")).toHaveValue(
      "12345.67",
    );
    await expect(NO_EXPORT(page)).toHaveCount(0);
    // Live: the server's totals follow what is typed.
    await page
      .getByLabel(
        "Less: amount remitted from previously filed form, if this is an amended form (Item 15)",
      )
      .fill("345.67");
    await page.getByLabel("Surcharge (Item 17A)").fill("100");
    await expect(readout(page, "Net amount of remittance (Item 16)")).toHaveText(
      "₱12,000.00",
    );
    await expect(readout(page, "Total amount of remittance (Item 18)")).toHaveText(
      "₱12,100.00",
    );
    await page.getByLabel("Contact number (Item 11)").fill("0917 000 0000");
    await page.getByLabel("Signatory: printed name").fill("INVENTED SIGNER");
    await page.getByLabel("Check: number").fill("000123");
    await saveNew(page);
    await quiet();
    const posts = seen.filter((s) => s.method === "POST" && /\/bir-forms$/.test(s.path));
    expect(posts).toHaveLength(1);
    const sent = posts[0]!.request.postDataJSON() as {
      clientId: string;
      form: string;
      period: string;
      data: Data;
    };
    expect(sent).toMatchObject({ clientId: CLIENT.id, form: "0619E", period: "2026-08" });
    expect(sent.data).toMatchObject({
      year: "2026",
      month: "08",
      amended: "no",
      anyWithheld: "yes",
      remittance: "12345.67",
      previouslyRemitted: "345.67",
      surcharge: "100",
      contact: "0917 000 0000",
      signatoryName: "INVENTED SIGNER",
      payCheckNumber: "000123",
      // Item 2 is the server's default unless the person typed one.
      dueDate: "2026-09-10",
      category: "private",
    });
    expect((sent.data._source as { mode: string }).mode).toBe("books");
    // Reload: the saved draft opens as it was saved.
    await page.reload();
    await expect(page.getByLabel("Amount of remittance (Item 14)")).toHaveValue(
      "12345.67",
    );
    await expect(page.getByLabel("Signatory: printed name")).toHaveValue(
      "INVENTED SIGNER",
    );
    await expect(page.getByLabel(/^Month/)).toHaveValue("08");
    // Edit and save.
    await page.getByLabel("Amount of remittance (Item 14)").fill("20000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await quiet();
    const patches = seen.filter((s) => s.method === "PATCH");
    expect(patches).toHaveLength(1);
    expect((patches[0]!.request.postDataJSON() as { data: Data }).data.remittance).toBe(
      "20000",
    );
    // Mark as filed: sealed; a clear copy and an amendment, never an XML.
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download clear copy" })).toBeVisible();
    await expect(page.locator("[data-book-switch]")).toHaveCount(0);
    await expect(NO_EXPORT(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T1 a draft's Preview PDF and a filed return's clear copy show the server's sentence, never a code", async ({
    page,
  }) => {
    const w = world();
    const data = {
      year: "2026",
      month: "08",
      amended: "no",
      remittance: "100",
      anyWithheld: "yes",
    };
    w.store.set(
      idOf(90),
      detailOf(w, { id: idOf(90), form: "0619E", period: "2026-08", data }),
    );
    w.store.set(
      idOf(91),
      detailOf(w, {
        id: idOf(91),
        form: "0619E",
        period: "2026-08",
        data,
        status: "filed",
        filedAt: "2026-10-09T02:00:00.000Z",
      }),
    );
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${idOf(90)}`);
    await page.getByRole("button", { name: "Preview PDF" }).click();
    await expect(page.locator("[data-preview-error]")).toHaveText(previewNo("0619E"));
    await page.goto(`/bir-forms/${idOf(91)}`);
    await page.getByRole("button", { name: "Download clear copy" }).click();
    await expect(page.locator("[data-clear-copy-error]")).toHaveText(
      clearCopyNo("0619E"),
    );
    clean(unmocked, dialogs);
  });

  test("T1 the third month of a quarter is refused with the server's sentence", async ({
    page,
  }) => {
    const w = world();
    const data = {
      year: "2026",
      month: "09",
      amended: "no",
      remittance: "100",
      anyWithheld: "yes",
    };
    w.store.set(
      idOf(92),
      detailOf(w, { id: idOf(92), form: "0619E", period: "2026-09", data }),
    );
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${idOf(92)}`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("[data-form-error]")).toHaveText(THIRD_MONTH);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// 1601-EQ
// ===========================================================================

const row = (atc: string, base: string, rate: string, withheld: string) => ({
  atc,
  base,
  rate,
  withheld,
});
const eqLine = (atc: string, amount: number, records: number) => ({
  key: `rows.${atc}`,
  label: `ATC ${atc}`,
  amount,
  records,
  filter: { kind: "purchases", from: "2026-07-01", to: "2026-09-30", atc },
});
const BOOKS_1601EQ: Books = {
  figures: {
    anyWithheld: "yes",
    rows: [
      row("WC160", "50000.00", "2", "1000.00"),
      row("WI998", "10000.00", "", "250.00"),
    ],
    remittance1: "400.00",
    remittance2: "",
    overRemittancePrior: "",
  },
  lines: [eqLine("WC160", 1000, 4), eqLine("WI998", 250, 1)],
  warnings: [
    "1 purchase under WC160 has an amount withheld that differs from the tax base times the rate (2%) by more than one centavo.",
    "The rate of WI998 is not in the table; enter it by hand.",
    "No filed 0619-E for August 2026.",
  ],
  recordCount: 5,
};
const rowInput = (
  page: Page,
  i: number,
  col: "ATC" | "tax base" | "tax rate" | "tax withheld",
) => page.getByLabel(`Row ${i + 1}: ${col}`);

test.describe("W17 T2 1601-EQ (hermetic)", () => {
  test("T2 the New form picker offers the four quarters", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601EQ");
    await expect(page.getByLabel(/^Quarter/).locator("option")).toHaveText([
      "Q1",
      "Q2",
      "Q3",
      "Q4",
    ]);
    clean(unmocked, dialogs);
  });

  test("T2 the books fill the rows by ATC and Items 20 and 21; the feeder's warnings show word for word above the rows; a missing rate is empty and editable", async ({
    page,
  }) => {
    const w = world({ books: { "1601EQ": BOOKS_1601EQ } });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601EQ");
    await page.getByLabel(/^Quarter/).selectOption("Q3");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await expect(rowInput(page, 0, "ATC")).toHaveValue("WC160");
    await expect(rowInput(page, 0, "tax base")).toHaveValue("50000.00");
    await expect(rowInput(page, 0, "tax rate")).toHaveValue("2");
    await expect(rowInput(page, 0, "tax withheld")).toHaveValue("1000.00");
    await expect(badge(page, "rows.WC160")).toContainText("From books · 4 records");
    await expect(rowInput(page, 1, "ATC")).toHaveValue("WI998");
    await expect(rowInput(page, 1, "tax rate")).toHaveValue("");
    await expect(rowInput(page, 1, "tax rate")).toBeEditable();
    await rowInput(page, 1, "tax rate").fill("0.5");
    await expect(rowInput(page, 1, "tax rate")).toHaveValue("0.5");
    await expect(
      page.getByLabel("Remittances made: 1st month of the quarter (Item 20)"),
    ).toHaveValue("400.00");
    // Nothing for the 2nd month: the box stays empty for the person to type.
    await expect(
      page.getByLabel("Remittances made: 2nd month of the quarter (Item 21)"),
    ).toHaveValue("");
    await expect(page.locator("[data-book-warnings] li")).toHaveText(
      BOOKS_1601EQ.warnings,
    );
    await quiet();
    expect(Object.fromEntries(bookCalls(seen)[0]!.search)).toEqual({
      clientId: CLIENT.id,
      form: "1601EQ",
      period: "2026-Q3",
    });
    // The server's totals follow the rows.
    await expect(
      readout(page, "Total taxes withheld for the quarter (Item 19)"),
    ).toHaveText("₱1,250.00");
    clean(unmocked, dialogs);
  });

  test("T2 create, edit, save, reload and mark filed; the quarter is written from the period", async ({
    page,
  }) => {
    const w = world({ books: { "1601EQ": BOOKS_1601EQ } });
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601EQ");
    await page.getByLabel(/^Quarter/).selectOption("Q3");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await expect(rowInput(page, 1, "ATC")).toHaveValue("WI998");
    await rowInput(page, 1, "tax rate").fill("0.5");
    await page.getByLabel("Number of sheets attached (Item 5)").fill("1");
    await saveNew(page);
    await quiet();
    const posts = seen.filter((s) => s.method === "POST" && /\/bir-forms$/.test(s.path));
    const sent = posts[0]!.request.postDataJSON() as { period: string; data: Data };
    expect(sent.period).toBe("2026-Q3");
    expect(sent.data).toMatchObject({
      year: "2026",
      quarter: "3rd",
      amended: "no",
      sheetsAttached: "1",
      remittance1: "400.00",
    });
    expect(sent.data.rows).toEqual([
      row("WC160", "50000.00", "2", "1000.00"),
      row("WI998", "10000.00", "0.5", "250.00"),
    ]);
    expect(sent.data).not.toHaveProperty("month");
    await page.reload();
    await expect(rowInput(page, 1, "tax rate")).toHaveValue("0.5");
    await rowInput(page, 0, "tax withheld").fill("1200.00");
    await page.getByRole("button", { name: "Save changes" }).click();
    await quiet();
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await expect(page.getByRole("button", { name: "Download clear copy" })).toBeVisible();
    await expect(NO_EXPORT(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T2 seven ATCs show all seven rows and the sentence, and hold back Mark as filed and Preview PDF", async ({
    page,
  }) => {
    const w = world();
    const seven = ["WC010", "WC020", "WC030", "WC040", "WC050", "WC060", "WC070"].map(
      (a) => row(a, "100.00", "2", "2.00"),
    );
    const data = {
      year: "2026",
      quarter: "3rd",
      amended: "no",
      anyWithheld: "yes",
      rows: seven,
    };
    w.store.set(
      idOf(80),
      detailOf(w, { id: idOf(80), form: "1601EQ", period: "2026-Q3", data }),
    );
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${idOf(80)}`);
    await expect(page.locator("[data-eq-row]")).toHaveCount(7);
    await expect(page.locator("[data-six-rows]")).toHaveText(sixRows(7));
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Preview PDF" })).toBeDisabled();
    // Taking one off brings the buttons back.
    await page.getByRole("button", { name: "Remove row 7" }).click();
    await expect(page.locator("[data-six-rows]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeEnabled();
    clean(unmocked, dialogs);
  });

  test("T2 a filed return of seven ATCs has its clear copy held back too", async ({
    page,
  }) => {
    const w = world();
    const seven = ["WC010", "WC020", "WC030", "WC040", "WC050", "WC060", "WC070"].map(
      (a) => row(a, "100.00", "2", "2.00"),
    );
    const data = {
      year: "2026",
      quarter: "3rd",
      amended: "no",
      anyWithheld: "yes",
      rows: seven,
    };
    w.store.set(
      idOf(81),
      detailOf(w, {
        id: idOf(81),
        form: "1601EQ",
        period: "2026-Q3",
        data,
        status: "filed",
        filedAt: "2026-10-09T02:00:00.000Z",
      }),
    );
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${idOf(81)}`);
    await expect(page.locator("[data-eq-row]")).toHaveCount(7);
    await expect(
      page.getByRole("button", { name: "Download clear copy" }),
    ).toBeDisabled();
    clean(unmocked, dialogs);
  });

  test("T2 the 4th quarter does not offer carried; the others do", async ({ page }) => {
    const w = world();
    const over = {
      year: "2026",
      quarter: "3rd",
      amended: "no",
      anyWithheld: "yes",
      rows: [row("WC010", "100.00", "2", "2.00")],
      otherPayments: "50.00",
      overRemittanceChoice: "carried",
    };
    w.store.set(
      idOf(82),
      detailOf(w, { id: idOf(82), form: "1601EQ", period: "2026-Q3", data: over }),
    );
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto(`/bir-forms/${idOf(82)}`);
    const choice = group(page, "If over-remittance, mark one (1) box only");
    await expect(choice.getByRole("radio")).toHaveCount(3);
    await expect(choice.getByRole("radio", { name: /To be carried over/ })).toBeChecked();
    await page.getByLabel(/^Quarter/).selectOption("Q4");
    await expect(choice.getByRole("radio")).toHaveCount(2);
    await expect(choice.getByRole("radio", { name: /carried/ })).toHaveCount(0);
    // A carried box chosen before the quarter became the 4th is let go, not sent.
    await expect(choice.getByRole("radio", { checked: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Save changes" }).click();
    await quiet();
    const patches = seen.filter((x) => x.method === "PATCH");
    expect(patches).toHaveLength(1);
    const body = patches[0]!.request.postDataJSON() as { period: string; data: Data };
    expect(body.period).toBe("2026-Q4");
    expect(body.data).toMatchObject({ quarter: "4th", overRemittanceChoice: "" });
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// 1601-C
// ===========================================================================

test.describe("W17 T3 1601-C (hermetic)", () => {
  test("T3 the New form picker offers every month", async ({ page }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601C");
    const months = page.getByLabel(/^Month/).locator("option");
    await expect(months).toHaveCount(12);
    await expect(months.nth(2)).toHaveText("March");
    clean(unmocked, dialogs);
  });

  test("T3 it has no books switch, says why in the server's words' place, and asks the books nothing", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601C");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await expect(page.locator("[data-no-payroll]")).toHaveText(
      "The Portal has no payroll records yet. Type the figures from your payroll.",
    );
    await expect(page.locator("[data-book-switch]")).toHaveCount(0);
    await expect(radio(page, "Portal books")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Refresh from books" })).toHaveCount(0);
    await quiet();
    expect(bookCalls(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T3 create, edit, save, reload and mark filed; a negative figure shows its minus sign", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601C");
    await page.getByLabel(/^Month/).selectOption("03");
    await page.getByLabel("Client").selectOption(CLIENT.id);
    await page.getByLabel("Total amount of compensation (Item 14)").fill("100000");
    await page.getByLabel("13th month pay and other benefits (Item 17)").fill("20000");
    await page
      .getByLabel("Taxable compensation not subject to withholding tax (Item 23)")
      .fill("10000");
    await page.getByLabel("Total taxes withheld (Item 25)").fill("500");
    // Schedule I: the month before was over-withheld by 800 (should be 200, paid 1,000).
    await page.getByLabel("Row 1: previous month").fill("2026-02");
    await page.getByLabel("Row 1: tax paid").fill("1000");
    await page.getByLabel("Row 1: should be tax due for the month").fill("200");
    await expect(page.locator("[data-adjustment='0']")).toHaveText("-₱800.00");
    await expect(readout(page, "Total non-taxable compensation (Item 21)")).toHaveText(
      "₱20,000.00",
    );
    await expect(readout(page, "Total taxable compensation (Item 22)")).toHaveText(
      "₱80,000.00",
    );
    await expect(readout(page, "Net taxable compensation (Item 24)")).toHaveText(
      "₱70,000.00",
    );
    // Item 27 is below zero and is shown as it is, never clamped.
    await expect(readout(page, "Taxes withheld for remittance (Item 27)")).toHaveText(
      "-₱300.00",
    );
    await expect(
      readout(page, "Total amount still due or (over-remittance) (Item 36)"),
    ).toHaveText("-₱300.00");
    await saveNew(page);
    await quiet();
    const posts = seen.filter((s) => s.method === "POST" && /\/bir-forms$/.test(s.path));
    const sent = posts[0]!.request.postDataJSON() as { period: string; data: Data };
    expect(sent.period).toBe("2026-03");
    expect(sent.data).toMatchObject({
      year: "2026",
      month: "03",
      amended: "no",
      compensation: "100000",
      taxesWithheld: "500",
    });
    expect(sent.data).not.toHaveProperty("_source");
    expect(sent.data.scheduleRows).toEqual([
      {
        month: "2026-02",
        datePaid: "",
        bank: "",
        number: "",
        taxPaid: "1000",
        shouldBe: "200",
      },
      { month: "", datePaid: "", bank: "", number: "", taxPaid: "", shouldBe: "" },
      { month: "", datePaid: "", bank: "", number: "", taxPaid: "", shouldBe: "" },
    ]);
    await page.reload();
    await expect(page.getByLabel("Total amount of compensation (Item 14)")).toHaveValue(
      "100000",
    );
    await expect(page.getByLabel("Row 1: previous month")).toHaveValue("2026-02");
    await expect(readout(page, "Taxes withheld for remittance (Item 27)")).toHaveText(
      "-₱300.00",
    );
    await page.getByLabel("Total taxes withheld (Item 25)").fill("2000");
    await page.getByRole("button", { name: "Save changes" }).click();
    await quiet();
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await expect(page.getByRole("button", { name: "Download clear copy" })).toBeVisible();
    await expect(NO_EXPORT(page)).toHaveCount(0);
    await expect(page.locator("[data-no-payroll]")).toBeVisible();
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// W17 T4 — everything around the editors
// ===========================================================================

const CATALOG = (planned: string[] = []) =>
  [
    ["2550Q", true],
    ["2551Q", true],
    ["1701Q", true],
    ["1701A", true],
    ["1701", true],
    ["1702Q", true],
    ["1702RT", true],
    ["2307", false],
    ["2316", false],
    ["0619E", false],
    ["1601EQ", false],
    ["1601C", false],
  ].map(([code, xml]) => ({
    code,
    title: `INVENTED TITLE ${code}`,
    frequency: "Quarterly",
    category: "Business Tax",
    description: "INVENTED",
    status: planned.includes(code as string) ? "planned" : "available",
    xmlExport: xml,
  }));

test.describe("W17 T4 the pages around the editors (hermetic)", () => {
  test("T4 a code the web has no editor for is never opened as some other form", async ({
    page,
  }) => {
    const w = world();
    w.store.set(
      idOf(70),
      detailOf(w, { id: idOf(70), form: "1601EQ", period: "2026-Q3", data: {} }),
    );
    (w.store.get(idOf(70)) as { form: string }).form = "1601FQ";
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=1601FQ");
    await expect(
      page.getByText("The Portal has no editor for the form 1601FQ."),
    ).toBeVisible();
    await expect(page.getByText("Schedule 1 — Percentage tax")).toHaveCount(0);
    await page.goto(`/bir-forms/${idOf(70)}`);
    await expect(
      page.getByText("The Portal has no editor for the form 1601FQ."),
    ).toBeVisible();
    await expect(page.getByText("Schedule 1 — Percentage tax")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T4 the forms page counts the live forms from the catalogue, never from a number typed in the page", async ({
    page,
  }) => {
    for (const planned of [[], ["0619E", "1601EQ", "1601C"]]) {
      const w = world();
      const { unmocked, dialogs } = await mockApi(page, w, [
        ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, CATALOG(planned))],
        ["GET", /^\/api\/v1\/bir-forms$/, (r) => json(r, [])],
      ]);
      await page.goto("/bir-forms");
      await expect(page.locator("[data-live-count]")).toHaveText(
        planned.length === 0 ? "All 12 forms are live." : "9 of 12 forms are live.",
      );
      clean(unmocked, dialogs);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("T4 the New form picker lists the three when the catalogue says they are available, and not when planned", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, [
      ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, CATALOG(["1601C"]))],
      ["GET", /^\/api\/v1\/bir-forms$/, (r) => json(r, [])],
    ]);
    await page.goto("/bir-forms");
    const picker = page
      .locator("select")
      .filter({ has: page.locator("option", { hasText: "+ New form…" }) });
    await expect(picker.locator("option", { hasText: "0619E" })).toBeAttached();
    await expect(picker.locator("option", { hasText: /^1601EQ/ })).toHaveCount(1);
    await expect(picker.locator("option", { hasText: /^1601C/ })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T4 Services lists the three withholding returns the way it lists the others", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, [
      ["GET", /^\/api\/v1\/services$/, (r) => json(r, [])],
    ]);
    await page.goto("/services");
    await page.getByRole("button", { name: "+ Add service" }).first().click();
    await expect(page.getByLabel("Linked BIR form").locator("option")).toHaveText([
      "None",
      "2550Q",
      "2551Q",
      "1701Q",
      "1701",
      "0619E",
      "1601EQ",
      "1601C",
    ]);
    clean(unmocked, dialogs);
  });

  test("T4 the client's tax view shows a dash, not a zero, for a filed return that has no key figures", async ({
    page,
  }) => {
    const w = world();
    const filed = {
      id: idOf(60),
      form: "0619E",
      period: "2026-08",
      filedAt: "2026-10-09T02:00:00.000Z",
      sequence: 1,
      amendsId: null,
      figures: null,
      superseded: false,
    };
    const estimate = {
      basis: "management-estimate",
      notice: "INVENTED NOTICE",
      client: { id: CLIENT.id, businessName: CLIENT.businessName, regime: "VAT" },
      period: {
        year: 2026,
        quarter: 3,
        label: "INVENTED LABEL Q3 2026",
        incomeTaxFrom: "2026-01-01",
        incomeTaxTo: "2026-09-30",
        businessTaxFrom: "2026-07-01",
        businessTaxTo: "2026-09-30",
      },
      method: { name: "graduated", source: "saved", rate: null },
      incomeTax: { grossIncome: 1, deductibleExpenses: 1, taxableIncome: 1, due: 1 },
      businessTax: {
        kind: "vat",
        grossReceipts: 1,
        outputVAT: 1,
        inputVAT: 1,
        rate: null,
        due: 1,
      },
      assumptions: [],
      filedForms: [filed],
    };
    const { unmocked, dialogs } = await mockApi(page, w, [
      ["GET", /^\/api\/v1\/clients\/[^/]+\/tax-estimate$/, (r) => json(r, estimate)],
    ]);
    await page.goto(`/clients/${CLIENT.id}/tax`);
    const card = page.locator("[data-filed-returns]");
    await expect(card).toContainText("0619E");
    await expect(card).toContainText("—");
    await expect(card).not.toContainText("₱0.00");
    clean(unmocked, dialogs);
  });

  test("T4 the dashboard shows the server's calendar labels and due dates word for word", async ({
    page,
  }) => {
    const w = world();
    const upcoming = [
      {
        id: "a",
        form: "0619E",
        client: "INVENTED A",
        period: "Oct 2026 · Expanded withholding",
        due: "DUE NOV 10",
        urgency: "normal",
      },
      {
        id: "b",
        form: "1601EQ",
        client: "INVENTED A",
        period: "Q3 2026 · Expanded withholding",
        due: "DUE OCT 31",
        urgency: "normal",
      },
      {
        id: "c",
        form: "1601C",
        client: "INVENTED B",
        period: "Sep 2026 · Compensation withholding",
        due: "DUE JAN 15",
        urgency: "normal",
      },
    ];
    const { unmocked, dialogs } = await mockApi(page, w, [
      [
        "GET",
        /^\/api\/v1\/dashboard$/,
        (r) =>
          json(r, {
            kpis: [{ label: "Active clients", value: 1, isCurrency: false, delta: "" }],
            incomeVsExpenses: [],
            recentActivity: [],
            upcomingFilings: upcoming,
            regimeMix: { vat: 1, percentage: 0 },
          }),
      ],
    ]);
    await page.goto("/");
    for (const u of upcoming) {
      await expect(page.getByText(u.period, { exact: true })).toBeVisible();
      await expect(page.getByText(u.due, { exact: true })).toBeVisible();
    }
    clean(unmocked, dialogs);
  });
});

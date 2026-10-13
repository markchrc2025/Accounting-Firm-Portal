// track-b-filed-lifecycle.spec.ts — hermetic browser tests for W3: a filed
// form is read-only, the returns get Amend, the certificates get "Issue a
// corrected certificate", and a filed certificate prints from its filing
// snapshot.
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of handlers (the last matching entry wins); anything the table does not cover
// is recorded as unmocked, answered with 599, and asserted empty at the end.
// The contract mocked here is Track A's U3 (W3 R1–R3); this file never reads
// Track A's branch.
//
// All fixture data is invented. No real name, TIN, address, phone or email.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";
import { certificateFileName } from "../src/lib/sheetPdf";

// ---------------------------------------------------------------------------
// Invented parties
// ---------------------------------------------------------------------------

const FIRM_ID = "22222222-2222-4222-8222-222222222222";

const ME = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: false,
  },
  permissions: {
    global: [
      "BIRForms:Read",
      "BIRForms:Create",
      "BIRForms:Update",
      "BIRForms:File",
      "Clients:Read",
      "Clients:Update",
      "Users:Read",
    ],
    clients: [],
    assignedClientIds: ["44444444-4444-4444-8444-444444444444"],
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

/** The client as the client query returns it TODAY (after a rename). */
const CLIENT = {
  id: "44444444-4444-4444-8444-444444444444",
  businessName: "INVENTED RENAMED HOLDINGS INC",
  // The 2307's Item 7 prints the registered name, never businessName (W7 R6).
  kind: "non-individual",
  regName: "INVENTED RENAMED HOLDINGS CORPORATION",
  // Every printed field differs from SNAPSHOT, so a print shows which it read.
  // Nine-digit TINs: the branch is the separate field, and it differs too.
  tin: "555-666-777",
  branch: "00001",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
  address: "9 PRESENT-DAY STREET, BARANGAY NOW",
  city: "OTHER CITY",
  province: "SAMPLE PROVINCE",
  region: "REGION 0",
  zip: "1799",
  rdo: "049",
};

/** What the client looked like when the forms below were filed (U3 R3). */
const SNAPSHOT = {
  businessName: "INVENTED ORIGINAL TRADING",
  kind: "non-individual",
  regName: "INVENTED ORIGINAL TRADING CORPORATION",
  tin: "111-222-333",
  branch: "00000",
  address: "1 FILING-DAY ROAD, BARANGAY THEN",
  city: "SAMPLE CITY",
  zip: "1700",
  rdo: "049",
  // A key the web does not read (R3: "plus other keys you do not read").
  lineOfBusiness: "INVENTED RETAIL",
};

const FILED_AT = "2026-04-20T02:15:00.000Z"; // Apr 20, 2026 in Manila
const FILED_ON = "Apr 20, 2026";

// ---------------------------------------------------------------------------
// The forms (A3)
// ---------------------------------------------------------------------------

const FILED_2551Q_ID = "f2551000-0000-4000-8000-000000000001";
const AMEND_2551Q_ID = "f2551000-0000-4000-8000-000000000002";

const DATA_2551Q = {
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
};
const COMPUTED_2551Q = {
  rows: [{ due: 4500 }],
  i14: 4500,
  i18: 0,
  i19: 4500,
  i23: 0,
  i24: 4500,
};

function form2551Q(over: Record<string, unknown> = {}) {
  return {
    id: FILED_2551Q_ID,
    clientId: CLIENT.id,
    clientName: SNAPSHOT.businessName,
    form: "2551Q",
    status: "filed",
    period: "2026-Q1",
    filedAt: FILED_AT,
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: FILED_AT,
    data: DATA_2551Q,
    computed: COMPUTED_2551Q,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: SNAPSHOT,
    ...over,
  };
}

/** U3's answer to any change on a filed form (R1). */
const SEALED_409 = {
  message: "This form is filed and sealed. Amend it to make a correction.",
};

/** The draft U3 opens when the filed 2551Q is amended (R2): a copy of its data. */
function amendmentDraft(data: typeof DATA_2551Q = DATA_2551Q) {
  return form2551Q({
    data,
    id: AMEND_2551Q_ID,
    status: "draft",
    filedAt: null,
    updatedAt: "2026-05-02T03:00:00.000Z",
    amendsId: FILED_2551Q_ID,
    sequence: 2,
    filedSnapshot: null,
  });
}

const FILED_2307_ID = "f2307000-0000-4000-8000-000000000001";
const NEW_2307_ID = "f2307000-0000-4000-8000-000000000002";
const DATA_2307 = {
  year: "2026",
  quarter: "1",
  payeeName: "INVENTED PAYEE, ALEX",
  // Nine digits: the branch is the separate, confirmed payeeBranch (R4).
  payeeTin: "444-555-666",
  payeeAddress: "3 INVENTED ROAD, BARANGAY PAYEE",
  payeeZip: "1200",
  payeeForeignAddress: "",
  // A branch other than head office, so a print shows the CONFIRMED branch.
  payeeBranch: "00002",
  payorSignatoryName: "INVENTED SIGNER",
  payorSignatoryTitle: "Treasurer",
  payorSignatoryTin: "777-888-999-00000",
  // As the editor saves them: present, and empty when the payee signs as itself.
  payeeSignatoryName: "",
  payeeSignatoryTitle: "",
  payeeSignatoryTin: "",
  rows: [
    {
      atc: "WI010",
      desc: "Professional fees",
      m1: "10000",
      m2: "10000",
      m3: "10000",
      tax: "3000",
    },
  ],
};
const COMPUTED_2307 = {
  rows: [{ total: 30000 }],
  totalIncome: 30000,
  totalTax: 3000,
  tM1: 10000,
  tM2: 10000,
  tM3: 10000,
};

function form2307(over: Record<string, unknown> = {}) {
  return {
    id: FILED_2307_ID,
    clientId: CLIENT.id,
    clientName: SNAPSHOT.businessName,
    form: "2307",
    status: "filed",
    period: "2026-Q1",
    filedAt: FILED_AT,
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: FILED_AT,
    data: DATA_2307,
    computed: COMPUTED_2307,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: SNAPSHOT,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// One router, a table of handlers
// ---------------------------------------------------------------------------

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  body: unknown;
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

async function mockApi(
  page: Page,
  extra: Entry[] = [],
): Promise<{ seen: Seen[]; unmocked: string[] }> {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });

  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    ["GET", /^\/api\/v1\/profile\/me$/, (r) => json(r, PROFILE)],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2551Q)],
    // Any change to a filed form is refused (R1).
    ["PATCH", /^\/api\/v1\/bir-forms\/[^/]+$/, (r) => json(r, SEALED_409, 409)],
  ];
  const table = [...base, ...extra];

  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    let body: unknown = undefined;
    try {
      body = req.postDataJSON();
    } catch {
      body = req.postData();
    }
    const s: Seen = {
      method: req.method(),
      path: url.pathname,
      search: url.searchParams,
      body,
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

const writesTo = (seen: Seen[], path: RegExp) =>
  seen.filter(
    (s) => s.method !== "GET" && path.test(s.path) && !/\/compute$/.test(s.path),
  );

// ---------------------------------------------------------------------------
// T1 — a filed 2551Q is read-only and offers Amend, not "Reopen to draft"
// ---------------------------------------------------------------------------

test.describe("W3 filed forms (hermetic)", () => {
  test("T1 a filed 2551Q has no Reopen, no Save, every input disabled, and Amend", async ({
    page,
  }) => {
    const { seen, unmocked } = await mockApi(page, [
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}$`),
        (r) => json(r, form2551Q()),
      ],
    ]);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`/bir-forms/${FILED_2551Q_ID}`);

    // Loaded and hydrated: the stored taxable amount is in its input.
    await page.getByRole("heading", { name: "2551Q", exact: true }).waitFor();
    await page.locator('input[value="150000"]').waitFor();

    await expect(page.getByRole("button", { name: "Reopen to draft" })).toHaveCount(0);

    const controls = page.locator("main input, main select, main textarea");
    const total = await controls.count();
    const states = await controls.evaluateAll((els) =>
      els.map((el) => ({
        tag: el.tagName.toLowerCase(),
        disabled: el.matches(":disabled"),
      })),
    );
    // eslint-disable-next-line no-console
    console.log(
      "T1-CONTROLS " +
        JSON.stringify({ total, enabled: states.filter((s) => !s.disabled) }),
    );
    expect(total).toBeGreaterThan(0);
    expect(states.filter((s) => !s.disabled)).toEqual([]);

    await expect(page.getByRole("button", { name: /^Save/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toBeVisible();
    await expect(page.getByText(`Filed on ${FILED_ON}`)).toBeVisible();

    await page.screenshot({
      path: "test-results/track-b-filed-2551q.png",
      fullPage: true,
    });

    expect(writesTo(seen, /\/bir-forms/)).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2 — Amend on a return; a corrected certificate on a 2307
// ---------------------------------------------------------------------------

test.describe("W3 Amend and corrected certificates (hermetic)", () => {
  test("T2 Amend opens the amendment draft: one POST, its header, inputs enabled", async ({
    page,
  }) => {
    // The server copies the filed data into the draft, "amended: no" included.
    let saved: typeof DATA_2551Q = DATA_2551Q;
    const { seen, unmocked } = await mockApi(page, [
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}$`),
        (r) => json(r, form2551Q()),
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${AMEND_2551Q_ID}$`),
        (r) => json(r, amendmentDraft(saved)),
      ],
      [
        "PATCH",
        new RegExp(`^/api/v1/bir-forms/${AMEND_2551Q_ID}$`),
        (r, s) => {
          saved = (s.body as { data: typeof DATA_2551Q }).data;
          return json(r, amendmentDraft(saved));
        },
      ],
      [
        "POST",
        new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}/amend$`),
        (r) =>
          json(
            r,
            {
              id: AMEND_2551Q_ID,
              status: "draft",
              sequence: 2,
              amendsId: FILED_2551Q_ID,
            },
            201,
          ),
      ],
    ]);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto(`/bir-forms/${FILED_2551Q_ID}`);
    await page.getByRole("button", { name: "Amend", exact: true }).click();

    await expect(page).toHaveURL(new RegExp(`/bir-forms/${AMEND_2551Q_ID}$`));
    await expect(
      page.getByText(`Amendment 2 of the 2551Q filed on ${FILED_ON}`, { exact: true }),
    ).toBeVisible();
    await page.locator('input[value="150000"]').waitFor();
    const enabled = await page
      .locator("main input, main select, main textarea")
      .evaluateAll((els) => els.filter((el) => !el.matches(":disabled")).length);
    // Every control but the client select (fixed once a form exists) is open.
    const total = await page.locator("main input, main select, main textarea").count();
    // eslint-disable-next-line no-console
    console.log("T2-AMEND-CONTROLS " + JSON.stringify({ total, enabled }));
    expect(enabled).toBe(total - 1);
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toHaveCount(0);
    // Until it is saved as an amended return, it is neither exported nor filed.
    await expect(page.getByText(/Save this amendment first/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Export eBIRForms XML" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeDisabled();

    const amends = seen.filter((s) => s.method === "POST" && s.path.endsWith("/amend"));
    expect(amends.map((s) => s.path)).toEqual([
      `/api/v1/bir-forms/${FILED_2551Q_ID}/amend`,
    ]);
    expect(seen.filter((s) => s.method === "PATCH")).toEqual([]);

    // Saving the amendment says it is an amended return (F26): the XML's
    // "Amended Return?" box is printed from data.amended.
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => seen.filter((s) => s.method === "PATCH").length).toBe(1);
    const patch = seen.find((s) => s.method === "PATCH")!;
    expect(patch.path).toBe(`/api/v1/bir-forms/${AMEND_2551Q_ID}`);
    expect((patch.body as { data: { amended: string } }).data.amended).toBe("yes");
    // Saved as an amended return: Export and filing are open.
    await expect(page.getByText(/Save this amendment first/)).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export eBIRForms XML" }),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeEnabled();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 a Save the seal refuses (409) shows the server's message verbatim", async ({
    page,
  }) => {
    // A draft on screen that was filed elsewhere in the meantime: the save hits
    // the seal and the editor shows U3's message as sent.
    const { seen, unmocked } = await mockApi(page, [
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}$`),
        (r) =>
          json(r, form2551Q({ status: "draft", filedAt: null, filedSnapshot: null })),
      ],
    ]);
    await page.goto(`/bir-forms/${FILED_2551Q_ID}`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(SEALED_409.message, { exact: true })).toBeVisible();
    expect(seen.filter((s) => s.method === "PATCH")).toHaveLength(1);
    // An original return is not an amended one.
    const sent = seen.find((s) => s.method === "PATCH")!.body as {
      data: { amended: string };
    };
    expect(sent.data.amended).toBe("no");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 a filed 2307 has no Amend; a corrected certificate is new, pre-filled, unlinked", async ({
    page,
  }) => {
    const created: unknown[] = [];
    const { seen, unmocked } = await mockApi(page, [
      ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2307)],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2307_ID}$`),
        (r) => json(r, form2307()),
      ],
      [
        "POST",
        /^\/api\/v1\/bir-forms$/,
        (r, s) => {
          created.push(s.body);
          return json(
            r,
            form2307({
              id: NEW_2307_ID,
              status: "draft",
              filedAt: null,
              filedSnapshot: null,
              data: (s.body as { data: unknown }).data,
            }),
            201,
          );
        },
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${NEW_2307_ID}$`),
        (r) =>
          json(
            r,
            form2307({
              id: NEW_2307_ID,
              status: "draft",
              filedAt: null,
              filedSnapshot: null,
              data: (created[0] as { data: unknown }).data,
            }),
          ),
      ],
    ]);
    await page.setViewportSize({ width: 1500, height: 1100 });
    await page.goto(`/bir-forms/${FILED_2307_ID}`);
    await expect(page.getByText(`Issued on ${FILED_ON}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen to draft" })).toHaveCount(0);
    await page.screenshot({
      path: "test-results/track-b-filed-2307.png",
      fullPage: true,
    });

    await page.getByRole("button", { name: "Issue a corrected certificate" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/bir-forms/new\\?form=2307&correctFrom=${FILED_2307_ID}$`),
    );
    await expect(
      page.getByRole("heading", { name: "New 2307", exact: true }),
    ).toBeVisible();
    // Pre-filled from the issued certificate, for the same client.
    await expect(page.getByLabel("Payee name")).toHaveValue(DATA_2307.payeeName);
    await expect(page.getByLabel("Payee TIN")).toHaveValue(DATA_2307.payeeTin);
    await expect(page.getByLabel("Income payment, row 1")).toHaveValue(
      "Professional fees",
    );
    await expect(page.getByLabel("ATC, row 1")).toHaveValue("WI010");
    await expect(page.getByLabel("Withholding agent (client)")).toHaveValue(CLIENT.id);
    await expect(page.getByLabel("Withholding agent (client)")).toBeDisabled();

    // The same again on a fresh load of that address. (The editor remounts per
    // address, so the click-through above already read the issued certificate;
    // the reload proves it once more with nothing cached in the page.)
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "New 2307", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Payee name")).toHaveValue(DATA_2307.payeeName);
    await expect(page.getByLabel("Payee TIN")).toHaveValue(DATA_2307.payeeTin);
    await expect(page.getByLabel("Income payment, row 1")).toHaveValue(
      "Professional fees",
    );
    await expect(page.getByLabel("ATC, row 1")).toHaveValue("WI010");
    await expect(page.getByLabel(/Payee branch code/)).toHaveValue("other");
    await expect(page.getByLabel("Branch code (5 digits)")).toHaveValue("00002");
    await expect(page.getByLabel("Withholding agent (client)")).toHaveValue(CLIENT.id);
    await expect(page.getByLabel("Withholding agent (client)")).toBeDisabled();

    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${NEW_2307_ID}$`));

    expect(created).toHaveLength(1);
    const body = created[0] as Record<string, unknown>;
    // eslint-disable-next-line no-console
    console.log("T2-CORRECTED-CREATE " + JSON.stringify(body));
    expect(body.clientId).toBe(CLIENT.id);
    expect(body.form).toBe("2307");
    expect(body.period).toBe("2026-Q1");
    expect(JSON.stringify(body)).not.toContain("amendsId");
    expect(JSON.stringify(body)).not.toContain(FILED_2307_ID);
    expect((body.data as Record<string, unknown>).payeeName).toBe(DATA_2307.payeeName);
    // The issued certificate is never written to, and nothing is amended.
    expect(writesTo(seen, new RegExp(FILED_2307_ID))).toEqual([]);
    expect(seen.filter((s) => s.path.endsWith("/amend"))).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

test.describe("W3 after the review: no state crosses between forms (hermetic)", () => {
  test("T2 Back from an unsaved corrected certificate shows the issued one as issued", async ({
    page,
  }) => {
    const { seen, unmocked } = await mockApi(page, [
      ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2307)],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2307_ID}$`),
        (r) => json(r, form2307()),
      ],
    ]);
    await page.setViewportSize({ width: 1500, height: 1100 });
    await page.goto(`/bir-forms/${FILED_2307_ID}`);
    await expect(page.getByText(`Issued on ${FILED_ON}`)).toBeVisible();
    await page.getByRole("button", { name: "Issue a corrected certificate" }).click();
    await expect(
      page.getByRole("heading", { name: "New 2307", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Payee name").fill("UNSAVED EDIT, NOT ISSUED");
    await page.getByLabel("Income payment, row 1").fill("Unsaved description");

    await page.goBack();
    await expect(page.getByText(`Issued on ${FILED_ON}`)).toBeVisible();
    await expect(page.getByLabel("Payee name")).toHaveValue(DATA_2307.payeeName);
    await expect(page.getByLabel("Income payment, row 1")).toHaveValue(
      "Professional fees",
    );
    await page.getByRole("button", { name: "Form", exact: true }).click();
    const sheet = page.locator('[data-sheet-copy="capture"] .bir-sheet');
    await expect(sheet).toContainText(DATA_2307.payeeName);
    await expect(sheet).not.toContainText("UNSAVED EDIT");
    expect(
      seen.filter((s) => s.method !== "GET" && !s.path.endsWith("/compute")),
    ).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 once marked filed, the sealed screen shows what was filed, not unsaved edits", async ({
    page,
  }) => {
    // A 1701Q draft; "CWT this quarter" is not in its saved data. The edit made
    // on screen is never saved, and "Mark as filed" files the saved data.
    const ID = "f1701000-0000-4000-8000-000000000001";
    let filed = false;
    const detail = () => ({
      id: ID,
      clientId: CLIENT.id,
      clientName: CLIENT.businessName,
      form: "1701Q",
      status: filed ? "filed" : "draft",
      period: "2026-Q1",
      filedAt: filed ? FILED_AT : null,
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:00:00.000Z",
      data: { year: "2026", amended: "no", filerType: "single", salesA: "100000" },
      computed: null,
      exports: [],
      amendsId: null,
      sequence: 1,
      filedSnapshot: filed ? SNAPSHOT : null,
    });
    const { unmocked } = await mockApi(page, [
      ["GET", new RegExp(`^/api/v1/bir-forms/${ID}$`), (r) => json(r, detail())],
      [
        "PATCH",
        new RegExp(`^/api/v1/bir-forms/${ID}$`),
        (r, s) => {
          if ((s.body as { status?: string }).status === "filed") filed = true;
          return json(r, detail());
        },
      ],
    ]);
    await page.goto(`/bir-forms/${ID}`);
    const cwt = page.getByLabel("CWT this quarter — 2307 (Item 58)");
    await cwt.fill("5000");
    await page.getByRole("button", { name: "Mark as filed" }).click();
    await expect(page.getByText(`Filed on ${FILED_ON}`)).toBeVisible();
    await expect(page.getByLabel("CWT this quarter — 2307 (Item 58)")).toHaveValue("");
    await expect(page.getByLabel("CWT this quarter — 2307 (Item 58)")).toBeDisabled();
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 Amend clicked twice at once sends one POST", async ({ page }) => {
    const { seen, unmocked } = await mockApi(page, [
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}$`),
        (r) => json(r, form2551Q()),
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${AMEND_2551Q_ID}$`),
        (r) => json(r, amendmentDraft()),
      ],
      [
        "POST",
        new RegExp(`^/api/v1/bir-forms/${FILED_2551Q_ID}/amend$`),
        async (r) => {
          await new Promise((res) => setTimeout(res, 400));
          return json(
            r,
            {
              id: AMEND_2551Q_ID,
              status: "draft",
              sequence: 2,
              amendsId: FILED_2551Q_ID,
            },
            201,
          );
        },
      ],
    ]);
    await page.goto(`/bir-forms/${FILED_2551Q_ID}`);
    const amend = page.getByRole("button", { name: "Amend", exact: true });
    await amend.waitFor();
    // Two clicks in the same task, before React can re-render the button.
    await amend.evaluate((b) => {
      (b as HTMLButtonElement).click();
      (b as HTMLButtonElement).click();
    });
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${AMEND_2551Q_ID}$`));
    expect(
      seen.filter((s) => s.method === "POST" && s.path.endsWith("/amend")),
    ).toHaveLength(1);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  for (const [label, source] of [
    ["a 2551Q, not a 2307", () => form2551Q({ period: "2025-Q3" })],
    [
      "a 2307 still in draft, never issued",
      () => form2307({ status: "draft", filedAt: null, period: "2025-Q3" }),
    ],
  ] as const) {
    test(`T2 a corrected certificate made from ${label} says so and pre-fills nothing`, async ({
      page,
    }) => {
      const SOURCE_ID = "f0000000-0000-4000-8000-0000000000c0";
      const { unmocked } = await mockApi(page, [
        ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2307)],
        [
          "GET",
          new RegExp(`^/api/v1/bir-forms/${SOURCE_ID}$`),
          (r) => json(r, { ...source(), id: SOURCE_ID }),
        ],
      ]);
      await page.goto(`/bir-forms/new?form=2307&correctFrom=${SOURCE_ID}`);
      await expect(
        page.getByText(
          "The certificate to correct could not be loaded, so nothing is pre-filled.",
        ),
      ).toBeVisible();
      await expect(page.getByText("A corrected certificate.")).toHaveCount(0);
      // Nothing came across: not the client, not the 2025 period, not the payee.
      await expect(page.getByLabel("Withholding agent (client)")).toHaveValue("");
      await expect(page.getByLabel("Withholding agent (client)")).toBeEnabled();
      await expect(page.getByLabel("Year")).not.toHaveValue("2025");
      await expect(page.getByLabel("Payee name")).toHaveValue("");
      expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
    });
  }
});

test.describe("W3 after the second review (hermetic)", () => {
  const F2316_ID = "f2316000-0000-4000-8000-0000000000b1";
  const NEW_2316_ID = "f2316000-0000-4000-8000-0000000000b2";
  const DATA_2316 = {
    year: "2025",
    empName: "INVENTED EMPLOYEE, SAM",
    empTin: "121-212-121",
    empAddress: "8 INVENTED LANE",
    i39: "480000",
  };
  const form2316 = (over: Record<string, unknown> = {}) => ({
    id: F2316_ID,
    clientId: CLIENT.id,
    clientName: SNAPSHOT.businessName,
    form: "2316",
    status: "filed",
    period: "2025",
    filedAt: FILED_AT,
    createdAt: "2026-01-10T01:00:00.000Z",
    updatedAt: FILED_AT,
    data: DATA_2316,
    computed: null,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: SNAPSHOT,
    ...over,
  });

  test("T2 a filed 2316 offers a corrected certificate: new, pre-filled, unlinked", async ({
    page,
  }) => {
    const created: unknown[] = [];
    const { seen, unmocked } = await mockApi(page, [
      ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
      ["GET", new RegExp(`^/api/v1/bir-forms/${F2316_ID}$`), (r) => json(r, form2316())],
      [
        "POST",
        /^\/api\/v1\/bir-forms$/,
        (r, s) => {
          created.push(s.body);
          return json(
            r,
            form2316({ id: NEW_2316_ID, status: "draft", filedAt: null }),
            201,
          );
        },
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${NEW_2316_ID}$`),
        (r) => json(r, form2316({ id: NEW_2316_ID, status: "draft", filedAt: null })),
      ],
    ]);
    await page.goto(`/bir-forms/${F2316_ID}`);
    await expect(page.getByRole("button", { name: "Amend", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Issue a corrected certificate" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/bir-forms/new\\?form=2316&correctFrom=${F2316_ID}$`),
    );
    await expect(page.getByText("A corrected certificate.")).toBeVisible();
    await expect(page.getByLabel("Employer (client)")).toHaveValue(CLIENT.id);
    await expect(page.getByLabel("Employer (client)")).toBeDisabled();
    await expect(page.locator(`input[value="${DATA_2316.empName}"]`)).toHaveCount(1);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${NEW_2316_ID}$`));
    const body = created[0] as Record<string, unknown>;
    expect(body.form).toBe("2316");
    expect(body.clientId).toBe(CLIENT.id);
    expect(JSON.stringify(body)).not.toContain("amendsId");
    expect(JSON.stringify(body)).not.toContain(F2316_ID);
    expect(writesTo(seen, new RegExp(F2316_ID))).toEqual([]);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T2 Back from an amendment shows the filed return as filed, not the draft's edits", async ({
    page,
  }) => {
    // A 1701Q merges what it loads into what it holds, so a reused editor
    // would keep the draft's "CWT this quarter" on the filed return.
    const FILED = "f1701000-0000-4000-8000-0000000000a1";
    const DRAFT = "f1701000-0000-4000-8000-0000000000a2";
    const base = {
      clientId: CLIENT.id,
      clientName: CLIENT.businessName,
      form: "1701Q",
      period: "2026-Q1",
      createdAt: "2026-04-10T01:00:00.000Z",
      updatedAt: "2026-04-10T01:00:00.000Z",
      data: { year: "2026", amended: "no", filerType: "single", salesA: "100000" },
      computed: null,
      exports: [],
    };
    const { unmocked } = await mockApi(page, [
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED}$`),
        (r) =>
          json(r, {
            ...base,
            id: FILED,
            status: "filed",
            filedAt: FILED_AT,
            amendsId: null,
            sequence: 1,
            filedSnapshot: SNAPSHOT,
          }),
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${DRAFT}$`),
        (r) =>
          json(r, {
            ...base,
            id: DRAFT,
            status: "draft",
            filedAt: null,
            amendsId: FILED,
            sequence: 2,
            filedSnapshot: null,
          }),
      ],
      [
        "POST",
        new RegExp(`^/api/v1/bir-forms/${FILED}/amend$`),
        (r) => json(r, { id: DRAFT, status: "draft", sequence: 2, amendsId: FILED }, 201),
      ],
    ]);
    await page.goto(`/bir-forms/${FILED}`);
    await page.getByRole("button", { name: "Amend", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${DRAFT}$`));
    await page.getByLabel("CWT this quarter — 2307 (Item 58)").fill("5000");

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/bir-forms/${FILED}$`));
    await expect(page.getByText(`Filed on ${FILED_ON}`)).toBeVisible();
    await expect(page.getByLabel("CWT this quarter — 2307 (Item 58)")).toHaveValue("");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

test("T2 the forms list marks an amendment with its sequence", async ({ page }) => {
  // The list as U3 returns it (R3): sequence and amendsId on every row.
  const summary = (f: ReturnType<typeof form2551Q>) => ({
    id: f.id,
    clientId: f.clientId,
    clientName: f.clientName,
    form: f.form,
    status: f.status,
    period: f.period,
    filedAt: f.filedAt,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    amendsId: f.amendsId,
    sequence: f.sequence,
  });
  const { unmocked } = await mockApi(page, [
    [
      "GET",
      /^\/api\/v1\/bir-forms$/,
      (r) => json(r, [summary(amendmentDraft()), summary(form2551Q())]),
    ],
  ]);
  await page.goto("/bir-forms");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Amendment 2");
  await expect(rows.nth(1)).not.toContainText("Amendment");
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// T3 — a filed certificate prints the payor from its filing snapshot
// ---------------------------------------------------------------------------

interface Raster {
  w: number;
  h: number;
  rgb: Uint8Array;
}

/** The page raster inside a jsPDF PDF: the PNG it embeds, as a FlateDecode
 *  stream with PNG row predictors. Inflate and undo the row filters. (The same
 *  decoder W2 pass 2 wrote for the 2307; no new dependency.) */
function pdfRaster(pdf: Buffer): Raster {
  const s = pdf.toString("latin1");
  const re =
    /\/Width (\d+)[\s\S]*?\/Height (\d+)[\s\S]*?\/ColorSpace \/DeviceRGB[\s\S]*?\/Length (\d+)[\s\S]*?stream\r?\n/g;
  let m: RegExpExecArray | null;
  let best: { w: number; h: number; len: number; start: number } | null = null;
  while ((m = re.exec(s))) {
    const w = +m[1]!;
    const h = +m[2]!;
    if (!best || w * h > best.w * best.h)
      best = { w, h, len: +m[3]!, start: re.lastIndex };
  }
  if (!best) throw new Error("no RGB FlateDecode image in the PDF");
  const raw = inflateSync(pdf.subarray(best.start, best.start + best.len));
  const { w, h } = best;
  const stride = w * 3;
  const rgb = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 3 ? rgb[dst + x - 3]! : 0;
      const b = y > 0 ? rgb[dst - stride + x]! : 0;
      const c = x >= 3 && y > 0 ? rgb[dst - stride + x - 3]! : 0;
      const v = raw[src + x]!;
      let out: number;
      if (f === 0) out = v;
      else if (f === 1) out = v + a;
      else if (f === 2) out = v + b;
      else if (f === 3) out = v + ((a + b) >> 1);
      else {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      rgb[dst + x] = out & 0xff;
    }
  }
  return { w, h, rgb };
}

/** T4's measure on a PNG raster: where the dark ink in a box sits. */
function inkIn(r: Raster, box: { x: number; y: number; w: number; h: number }) {
  let sum = 0;
  let n = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let y = Math.ceil(box.y); y < Math.floor(box.y + box.h); y++) {
    for (let x = Math.ceil(box.x); x < Math.floor(box.x + box.w); x++) {
      const i = (y * r.w + x) * 3;
      const lum = 0.299 * r.rgb[i]! + 0.587 * r.rgb[i + 1]! + 0.114 * r.rgb[i + 2]!;
      if (lum < 110) {
        sum += y;
        n++;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
  }
  return { centre: n ? (sum / n - box.y) / box.h : NaN, minX, maxX, pixels: n };
}

/** The payor name's box and text run on the CAPTURE copy of the sheet. */
async function payorNameBox(page: Page) {
  return page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>(
      '[data-sheet-copy="capture"] .bir-sheet',
    )!;
    // Item 7, "Payor's Name": the first stacked cell after Part II.
    const caps = Array.from(sheet.querySelectorAll<HTMLElement>(".bir-cell.stack"));
    const cell = caps.find((c) => /Payor.s Name/.test(c.textContent ?? ""))!;
    const val = cell.querySelector<HTMLElement>(".bir-val")!;
    const a = sheet.getBoundingClientRect();
    const b = val.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(val);
    const t = range.getBoundingClientRect();
    return {
      text: val.textContent ?? "",
      box: { x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height },
      runLeft: t.left - a.left,
      runRight: t.right - a.left,
    };
  });
}

for (const [label, snapshot, expectedName] of [
  ["its filing snapshot", SNAPSHOT, SNAPSHOT.regName],
  ["the client record when the snapshot is null", null, CLIENT.regName],
] as const) {
  test(`T3 a filed 2307 prints the payor from ${label}`, async ({ page }) => {
    const { seen, unmocked } = await mockApi(page, [
      ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2307)],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${FILED_2307_ID}$`),
        (r) => json(r, form2307({ filedSnapshot: snapshot })),
      ],
    ]);
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(`/bir-forms/${FILED_2307_ID}`);
    await page.getByRole("button", { name: "Form", exact: true }).click();

    // In the Form view DOM: the view copy and the capture copy both show it.
    const view = page.locator('[data-sheet-copy="view"] .bir-sheet');
    await expect(view).toContainText(expectedName);
    const other = snapshot ? CLIENT.regName : SNAPSHOT.regName;
    await expect(view).not.toContainText(other);
    const name = await payorNameBox(page);
    expect(name.text).toBe(expectedName);
    // The payee's CONFORME line carries the confirmed branch, as Part I does.
    await expect(view).toContainText("TIN 444-555-666-00002");
    // Every printed payor field comes from the same source (R3).
    const src = snapshot ?? CLIENT;
    const boxes = (kind: string, i: number) =>
      view
        .locator(`[data-box-group="${kind}"]`)
        .nth(i)
        .locator(".bir-box")
        .allTextContents()
        .then((t) => t.join(""));
    expect(await boxes("tin", 1)).toBe(src.tin.replace(/\D/g, "") + src.branch);
    expect(await boxes("zip", 1)).toBe(src.zip);
    await expect(view).toContainText(`${src.address}, ${src.city}`);

    // In the PDF: the ink in the payor-name box is that text's own run.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: /Print certificate \(PDF\)/ }).click(),
    ]);
    // The file is named for the TIN that was printed.
    expect(download.suggestedFilename()).toBe(
      certificateFileName("2307", "2026-Q1", src.tin),
    );
    const raster = pdfRaster(readFileSync((await download.path())!));
    const box = {
      x: name.box.x * 2 + 1,
      y: name.box.y * 2 + 1,
      w: name.box.w * 2 - 2,
      h: name.box.h * 2 - 2,
    };
    const ink = inkIn(raster, box);
    // eslint-disable-next-line no-console
    console.log(
      `T3-PAYOR ${JSON.stringify({ label, expectedName, box, run: [name.runLeft * 2, name.runRight * 2], ink })}`,
    );
    expect(ink.centre).toBeGreaterThan(0.25);
    expect(ink.centre).toBeLessThan(0.75);
    expect(Math.abs(ink.minX - name.runLeft * 2)).toBeLessThanOrEqual(6);
    expect(Math.abs(ink.maxX - name.runRight * 2)).toBeLessThanOrEqual(6);

    // With a snapshot, the client record is not even read (R3).
    const clientReads = seen.filter((s) => s.path === `/api/v1/clients/${CLIENT.id}`);
    expect(clientReads.length > 0).toBe(snapshot === null);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
}

for (const [label, snapshot] of [
  ["its filing snapshot", SNAPSHOT],
  ["the client record when the snapshot is null", null],
] as const) {
  test(`T3 a filed 2316 prints the employer from ${label}`, async ({ page }) => {
    const ID = "f2316000-0000-4000-8000-000000000001";
    const { seen, unmocked } = await mockApi(page, [
      [
        "POST",
        /^\/api\/v1\/bir-forms\/compute$/,
        (r) => json(r, { i19: 0, i20: 0, i21: 0, i22: 0, i23: 0, i24: 0, i25: 0 }),
      ],
      [
        "GET",
        new RegExp(`^/api/v1/bir-forms/${ID}$`),
        (r) =>
          json(r, {
            id: ID,
            clientId: CLIENT.id,
            clientName: SNAPSHOT.businessName,
            form: "2316",
            status: "filed",
            period: "2025",
            filedAt: FILED_AT,
            createdAt: "2026-01-10T01:00:00.000Z",
            updatedAt: FILED_AT,
            data: {
              year: "2025",
              empName: "INVENTED EMPLOYEE, SAM",
              empTin: "121-212-121",
            },
            computed: null,
            exports: [],
            amendsId: null,
            sequence: 1,
            filedSnapshot: snapshot,
          }),
      ],
    ]);
    await page.goto(`/bir-forms/${ID}`);
    await expect(page.getByText(`Issued on ${FILED_ON}`)).toBeVisible();
    const src = snapshot ?? CLIENT;
    const other = snapshot ? CLIENT.businessName : SNAPSHOT.businessName;
    const sheet = page.locator(".bir-sheet-stage > .bir-sheet");
    await expect(sheet).toContainText(src.businessName);
    await expect(sheet).toContainText(src.tin);
    await expect(sheet).toContainText(`${src.address}, ${src.city}`);
    await expect(sheet).not.toContainText(other);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: /Print certificate \(PDF\)/ }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      certificateFileName("2316", "2025", src.tin),
    );
    const clientReads = seen.filter((s) => s.path === `/api/v1/clients/${CLIENT.id}`);
    expect(clientReads.length > 0).toBe(snapshot === null);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
}

// track-b-w23.spec.ts - hermetic browser tests for the BIR form editor's Form details | Preview
// tabs (W25, replacing the W23 side pane; Track A U23) and the W25 contact and email prefill.
// One router answers every /api/v1 call from a table of mocks; any call the table does not
// cover is recorded and FAILS the test. All data is invented.

import { answerBell } from "./helpers/bell";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222m1";
const CLIENT = {
  id: "c2300000-0000-4000-8000-0000000000m1",
  businessName: "INVENTED TWENTY-THREE TRADING",
  tin: "000-111-222-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};
const USER_ID = "u2300000-0000-4000-8000-0000000000m1";
const ME = {
  user: {
    id: USER_ID,
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
const SIGNED = "https://files.example.test";

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
const PDF = (tag: string) => Buffer.from(`%PDF-1.4 invented ${tag}`);

interface World {
  store: Map<string, Record<string, unknown>>;
  /** How the live route answers the Nth call (1-based); the last entry repeats. */
  replies: Array<
    (call: number, data: Record<string, unknown>) => Parameters<Route["fulfill"]>[0]
  >;
  /**
   * Holds the answer to every live call from `fromCall` on (1-based) until `release()` is called,
   * so a test can look at the "Updating…" state for as long as it needs instead of racing a
   * timer. Calls before `fromCall` are answered at once.
   */
  gate?: { fromCall: number; open: Promise<void>; release: () => void };
}
function makeGate(fromCall: number): NonNullable<World["gate"]> {
  let release = () => {};
  const open = new Promise<void>((res) => {
    release = res;
  });
  return { fromCall, open, release };
}
const idOf = (k: number) => `f2300000-0000-4000-8000-${String(k).padStart(12, "0")}`;

function detail(over: Record<string, unknown> & { id: string }) {
  return {
    form: "2551Q",
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
    previewAvailable: true,
    canDelete: false,
    computed: null,
    confirmation: null,
    confirmationRequired: false,
    filingUndos: [],
    data: {
      year: "2026",
      periodType: "calendar",
      amended: "no",
      i15: "",
      i20: "",
      i21: "",
      i22: "",
      rows: [],
    },
    ...over,
  };
}

const OK_REPLY = (call: number) => ({
  status: 200,
  contentType: "application/pdf",
  headers: {
    "Content-Disposition": 'inline; filename="x-DRAFT.pdf"',
    "Cache-Control": "no-store",
  },
  body: PDF(`live-${call}`),
});

async function mockApi(page: Page, w: World, extra: Entry[] = []) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  let liveCalls = 0;
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: USER_ID,
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
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
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
      /^\/api\/v1\/bir-forms\/([^/]+)\/preview$/,
      async (r, s) => {
        liveCalls += 1;
        const call = liveCalls;
        const body = s.request.postDataJSON() as { data: Record<string, unknown> };
        if (w.gate && call >= w.gate.fromCall) await w.gate.open;
        const reply = w.replies[Math.min(call, w.replies.length) - 1]!;
        return r.fulfill(reply(call, body.data));
      },
    ],
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
    if (await answerBell(route)) return; // PB2: the header bell
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  await page.context().route(`${SIGNED}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: PDF("clear-copy"),
    }),
  );
  return { seen, unmocked, dialogs };
}

const world = (over: Partial<World> = {}): World => ({
  store: new Map(),
  replies: [OK_REPLY],
  ...over,
});
function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const lives = (seen: Seen[]) =>
  seen.filter((s) => s.method === "POST" && /\/bir-forms\/[^/]+\/preview$/.test(s.path));
const frame = (page: Page) => page.locator("[data-preview-frame]");
const ITEM15 = "Creditable percentage tax withheld (Item 15)";

// ===========================================================================

const tab = (page: Page, name: "Form details" | "Preview") =>
  page.getByRole("tab", { name, exact: true });
const ITEM15_BOX = (page: Page) => page.getByLabel(ITEM15);

test.describe("W25 the Form details | Preview tabs (hermetic)", () => {
  test("T1 a 2551Q opens on Form details and asks nothing; Preview asks once with the whole data; back, type, Preview again asks once more", async ({
    page,
  }) => {
    // The second request (after the edit) is held until the test lets it go, so "Updating…"
    // and the previous PDF can be looked at for as long as needed.
    const gate = makeGate(2);
    const w = world({ gate });
    const id = idOf(1);
    w.store.set(id, detail({ id }));
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(tab(page, "Form details")).toHaveAttribute("aria-selected", "true");
    await expect(ITEM15_BOX(page)).toBeVisible();
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(0);

    await tab(page, "Preview").click();
    await expect(frame(page)).toHaveAttribute("src", /^blob:/);
    expect(lives(seen)).toHaveLength(1);
    expect(lives(seen)[0]!.request.postDataJSON()).toEqual({
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
        // The editor's own default row for a saved draft with none.
        rows: [{ atc: "PT010", rate: "3", taxable: "" }],
      },
    });
    const firstSrc = await frame(page).getAttribute("src");
    await expect(page.locator("[data-preview-open]")).toHaveAttribute("href", firstSrc!);
    await expect(ITEM15_BOX(page)).toBeHidden(); // hidden, not gone

    // back to the form: type; nothing is asked while typing
    await tab(page, "Form details").click();
    await ITEM15_BOX(page).fill("123");
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(1);

    // Preview again: one more request, held; the previous PDF stays with Updating…
    await tab(page, "Preview").click();
    await expect(page.locator("[data-preview-updating]")).toHaveText("Updating…");
    await expect.poll(() => lives(seen).length).toBe(2);
    expect(
      (lives(seen)[1]!.request.postDataJSON() as { data: { i15: string } }).data.i15,
    ).toBe("123");
    await expect(frame(page)).toHaveAttribute("src", firstSrc!);
    gate.release();
    await expect(frame(page)).not.toHaveAttribute("src", firstSrc!);
    await expect(page.locator("[data-preview-updating]")).toHaveCount(0);

    // no change since: back and forth asks nothing, and the typed value is still there
    await tab(page, "Form details").click();
    await expect(ITEM15_BOX(page)).toHaveValue("123");
    await tab(page, "Preview").click();
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(2);
    clean(unmocked, dialogs);
  });

  test("T2 a refusal is shown in the Preview tab, word for word, in place of the PDF; after a fix the next Preview shows the PDF", async ({
    page,
  }) => {
    const R = [
      "INVENTED: the client's contact number is blank.",
      "INVENTED: 7 ATCs; the form has six rows.",
    ];
    const w = world({
      replies: [
        (_c, data) =>
          data.i15 === "9"
            ? {
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({
                  statusCode: 409,
                  error: "Conflict",
                  message: R[0],
                  refusals: R,
                }),
              }
            : OK_REPLY(2),
      ],
    });
    const id = idOf(2);
    w.store.set(id, detail({ id }));
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await ITEM15_BOX(page).fill("9");
    await tab(page, "Preview").click();
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText(R);
    await expect(frame(page)).toHaveCount(0);
    await tab(page, "Form details").click();
    await ITEM15_BOX(page).fill("8");
    await tab(page, "Preview").click();
    await expect(frame(page)).toBeVisible();
    await expect(page.locator("[data-preview-problem]")).toHaveCount(0);
    expect(lives(seen)).toHaveLength(2);
    clean(unmocked, dialogs);
  });

  test("T2 a 400 shows the validation messages word for word", async ({ page }) => {
    const w = world({
      replies: [
        (_c, data) =>
          data.i15 === "5"
            ? {
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                  message: "Validation failed",
                  errors: [
                    { path: "i15", message: "INVENTED: Item 15 must be an amount." },
                  ],
                }),
              }
            : OK_REPLY(1),
      ],
    });
    const id = idOf(3);
    w.store.set(id, detail({ id }));
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await ITEM15_BOX(page).fill("5");
    await tab(page, "Preview").click();
    await expect(page.locator("[data-preview-problem='invalid'] li")).toHaveText([
      "INVENTED: Item 15 must be an amount.",
    ]);
    clean(unmocked, dialogs);
  });

  test("T3 a filed return has the same tabs; Preview shows its clear copy, never the live route, and no Save", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(4);
    w.store.set(
      id,
      detail({
        id,
        status: "filed",
        filedAt: "2026-10-05T02:00:00.000Z",
        clearCopyAvailable: true,
      }),
    );
    const { seen, unmocked, dialogs } = await mockApi(page, w, [
      [
        "POST",
        /^\/api\/v1\/bir-forms\/[^/]+\/clear-copy$/,
        (r) =>
          json(r, {
            id: "e2300000-0000-4000-8000-000000000001",
            kind: "pdf",
            filename: "x.pdf",
            createdAt: "2026-10-12T02:00:00.000Z",
          }),
      ],
      [
        "GET",
        /^\/api\/v1\/bir-forms\/[^/]+\/exports\/[^/]+\/url$/,
        (r) => json(r, { url: `${SIGNED}/x.pdf?sig=m` }),
      ],
    ]);
    await page.goto(`/bir-forms/${id}`);
    await expect(tab(page, "Form details")).toHaveAttribute("aria-selected", "true");
    await page.waitForTimeout(800);
    expect(seen.filter((s) => s.path.endsWith("/clear-copy"))).toHaveLength(0);
    await tab(page, "Preview").click();
    await expect(frame(page)).toHaveAttribute("src", /^blob:/);
    expect(lives(seen)).toHaveLength(0);
    expect(seen.filter((s) => s.path.endsWith("/clear-copy"))).toHaveLength(1);
    await expect(page.locator("[data-preview-open]")).toBeVisible();
    await expect(page.locator("[data-preview-save]")).toHaveCount(0);
    // reopening shows the same copy without asking again
    await tab(page, "Form details").click();
    await tab(page, "Preview").click();
    await expect(frame(page)).toBeVisible();
    expect(seen.filter((s) => s.path.endsWith("/clear-copy"))).toHaveLength(1);
    clean(unmocked, dialogs);
  });

  test("T3 a filed return whose clear copy is not available shows the API's sentence", async ({
    page,
  }) => {
    const S = "A clear copy of the 2551Q is not available yet.";
    const w = world();
    const id = idOf(5);
    w.store.set(id, detail({ id, status: "filed", filedAt: "2026-10-05T02:00:00.000Z" }));
    const { seen, unmocked, dialogs } = await mockApi(page, w, [
      [
        "POST",
        /^\/api\/v1\/bir-forms\/[^/]+\/clear-copy$/,
        (r) => json(r, { message: S }, 409),
      ],
    ]);
    await page.goto(`/bir-forms/${id}`);
    await tab(page, "Preview").click();
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([S]);
    expect(lives(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T4 the tabs sit directly under the title; the PDF area is full width and tall; no side pane, no Show or Hide", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(6);
    w.store.set(id, detail({ id }));
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/bir-forms/${id}`);
    const title = page.getByRole("heading", { level: 1, name: "2551Q" });
    const tabs = page.getByRole("tablist", { name: "Form" });
    await expect(tabs).toBeVisible();
    const t = (await title.boundingBox())!;
    const b = (await tabs.boundingBox())!;
    const form = (await ITEM15_BOX(page).boundingBox())!;
    expect(b.y).toBeGreaterThan(t.y + t.height - 1);
    expect(form.y).toBeGreaterThan(b.y + b.height - 1);
    await expect(
      page.getByRole("button", { name: /Show preview|Hide preview/ }),
    ).toHaveCount(0);
    await tab(page, "Preview").click();
    const pane = page.locator("[data-preview-pane]");
    await expect(frame(page)).toBeVisible();
    const p = (await pane.boundingBox())!;
    expect(p.height).toBeGreaterThanOrEqual(600);
    expect(p.width).toBeGreaterThanOrEqual(b.width - 2); // the panel's full width
    // the keyboard moves between the tabs
    await tab(page, "Preview").focus();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Form details")).toHaveAttribute("aria-selected", "true");
    await expect(ITEM15_BOX(page)).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T5 the 2316: the Preview tab shows the API's sentence and does not ask again", async ({
    page,
  }) => {
    const S = "A preview of the 2316 is not available yet.";
    const w = world({
      replies: [
        () => ({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            statusCode: 409,
            error: "Conflict",
            message: S,
            refusals: [S],
          }),
        }),
      ],
    });
    const id = idOf(7);
    w.store.set(
      id,
      detail({ id, form: "2316", period: "2026", data: { year: "2026", amended: "no" } }),
    );
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await tab(page, "Preview").click();
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([S]);
    await tab(page, "Form details").click();
    await page.getByLabel("Year").fill("2025");
    await tab(page, "Preview").click();
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(1);
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([S]);
    clean(unmocked, dialogs);
  });

  test("T6 a draft never saved: the Preview tab asks nothing and says to save", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=2551Q");
    await ITEM15_BOX(page).fill("1");
    await tab(page, "Preview").click();
    await expect(page.locator("[data-preview-save-first]")).toHaveText(
      "Save the draft to see the preview.",
    );
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T7 a narrow screen has the same tabs", async ({ page }) => {
    const w = world();
    const id = idOf(8);
    w.store.set(id, detail({ id }));
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.setViewportSize({ width: 600, height: 900 });
    await page.goto(`/bir-forms/${id}`);
    await expect(page.getByRole("tablist", { name: "Form" })).toBeVisible();
    await tab(page, "Preview").click();
    await expect(frame(page)).toBeVisible();
    await expect(ITEM15_BOX(page)).toBeHidden();
    expect(lives(seen)).toHaveLength(1);
    clean(unmocked, dialogs);
  });
  // Every editor has the tabs under its title and tells the shared page what it would save:
  // a saved draft of each of the twelve forms asks for a preview once Preview is opened (the
  // 2316 gets its sentence).
  const FORMS: Array<[string, string]> = [
    ["2551Q", "2026-Q3"],
    ["2550Q", "2026-Q3"],
    ["1701", "2026"],
    ["1701A", "2026"],
    ["1701Q", "2026-Q3"],
    ["1702Q", "2026-Q3"],
    ["1702RT", "2026"],
    ["0619E", "2026-08"],
    ["1601EQ", "2026-Q3"],
    ["1601C", "2026-08"],
    ["2307", "2026-Q3"],
    ["2316", "2026"],
  ];
  FORMS.forEach(([form, period], k) => {
    test(`T8 the ${form} editor has the tabs and feeds the Preview tab`, async ({
      page,
    }) => {
      const w = world({
        replies: [
          form === "2316"
            ? () => ({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({
                  message: "INVENTED: no preview yet.",
                  refusals: ["INVENTED: no preview yet."],
                }),
              })
            : OK_REPLY,
        ],
      });
      const id = idOf(20 + k);
      w.store.set(
        id,
        detail({ id, form, period, data: { year: "2026", amended: "no" } }),
      );
      const { seen, unmocked, dialogs } = await mockApi(page, w, [
        ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
        [
          "GET",
          /^\/api\/v1\/bir-forms\/[^/]+\/alphalist\/check$/,
          (r) =>
            json(r, {
              ok: false,
              source: "books",
              fileName: null,
              refusals: [],
              notes: [],
              schedule1: { rows: 0, income: "0.00", tax: "0.00" },
              schedule2: { rows: 0, income: "0.00" },
              returnTotal: "0.00",
            }),
        ],
      ]);
      await page.goto(`/bir-forms/${id}`);
      const title = page.getByRole("heading", { level: 1 });
      const tabs = page.getByRole("tablist", { name: "Form" });
      await expect(tabs).toBeVisible();
      expect((await tabs.boundingBox())!.y).toBeGreaterThan(
        (await title.boundingBox())!.y,
      );
      await page.waitForTimeout(500);
      expect(lives(seen)).toHaveLength(0);
      await tab(page, "Preview").click();
      if (form === "2316") {
        await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([
          "INVENTED: no preview yet.",
        ]);
      } else {
        await expect(frame(page)).toHaveAttribute("src", /^blob:/);
      }
      expect(lives(seen)).toHaveLength(1);
      clean(unmocked, dialogs);
    });
  });
});

// ===========================================================================
// W25: the contact number and email from the client record
// ===========================================================================

test.describe("W25 contact and email from the client record (hermetic)", () => {
  test("P1 a saved 0619-E: both filled with the hint, Preview once, type, Preview once more, then Save stores them", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(40);
    const saved = detail({
      id,
      form: "0619E",
      period: "2026-10",
      data: { year: "2026", month: "10", amended: "no", contact: "", email: "" },
    });
    w.store.set(id, saved);
    const CLIENT_WITH = {
      ...CLIENT,
      phone: "+63 917 800 5122",
      email: "owner@twenty-three.example",
    };
    const { seen, unmocked, dialogs } = await mockApi(page, w, [
      ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT_WITH)],
      [
        "PATCH",
        /^\/api\/v1\/bir-forms\/[^/]+$/,
        (r, s) => {
          const b = s.request.postDataJSON() as Record<string, unknown>;
          const next = { ...saved, ...b, updatedAt: "2026-11-12T01:00:00.000Z" };
          w.store.set(id, next);
          return json(r, next);
        },
      ],
    ]);
    await page.goto(`/bir-forms/${id}`);
    const contact = page.getByLabel(/^Contact number \(Item 11\)/);
    const email = page.getByLabel(/^Email address \(Item 13\)/);
    await expect(contact).toHaveValue("09178005122");
    await expect(email).toHaveValue("owner@twenty-three.example");
    await expect(page.getByText("Filled from the client record.")).toHaveCount(2);
    expect(
      seen.filter((s) => s.method === "GET" && /\/clients\/[^/]+$/.test(s.path)),
    ).toHaveLength(1);
    expect(lives(seen)).toHaveLength(0);

    await tab(page, "Preview").click();
    await expect(frame(page)).toHaveAttribute("src", /^blob:/);
    expect(lives(seen)).toHaveLength(1);
    const first = (
      lives(seen)[0]!.request.postDataJSON() as { data: Record<string, unknown> }
    ).data;
    expect(first.contact).toBe("09178005122");
    expect(first.email).toBe("owner@twenty-three.example");

    await tab(page, "Form details").click();
    await contact.fill("09170000000");
    await expect(page.getByText("Filled from the client record.")).toHaveCount(1);
    await tab(page, "Preview").click();
    await expect.poll(() => lives(seen).length).toBe(2);
    expect(
      (lives(seen)[1]!.request.postDataJSON() as { data: Record<string, unknown> }).data
        .contact,
    ).toBe("09170000000");

    // Save from the Preview tab (the editor's own Save button, offered there too)
    await page.locator("[data-preview-save]").click();
    await expect.poll(() => seen.filter((s) => s.method === "PATCH").length).toBe(1);
    const patch = seen.find((s) => s.method === "PATCH")!.request.postDataJSON() as {
      data: Record<string, unknown>;
    };
    expect(patch.data.contact).toBe("09170000000");
    expect(patch.data.email).toBe("owner@twenty-three.example");
    clean(unmocked, dialogs);
  });

  test("P2 a filed 0619-E is left as stored: nothing filled, nothing read", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(41);
    w.store.set(
      id,
      detail({
        id,
        form: "0619E",
        period: "2026-10",
        status: "filed",
        filedAt: "2026-11-05T02:00:00.000Z",
        data: { year: "2026", month: "10", amended: "no", contact: "", email: "" },
      }),
    );
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.getByLabel(/^Contact number/)).toHaveValue("");
    await page.waitForTimeout(800);
    await expect(page.getByLabel(/^Email address/)).toHaveValue("");
    await expect(page.getByText("Filled from the client record.")).toHaveCount(0);
    expect(
      seen.filter((s) => s.method === "GET" && /\/clients\/[^/]+$/.test(s.path)),
    ).toHaveLength(0);
    clean(unmocked, dialogs);
  });
});

// track-b-w23.spec.ts — hermetic browser tests for W23: the live Preview pane beside every
// BIR form editor (Track A U23). One router answers every /api/v1 call from a table of
// mocks; any call the table does not cover is recorded and FAILS the test. The pane is
// shown here (the other specs keep it hidden). All data is invented.

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

test.describe("W23 the live Preview pane (hermetic)", () => {
  test("T1 typing in a 2551Q: one request after the pause with the whole data, and the PDF shown inline", async ({
    page,
  }) => {
    // The second request (the one after the edit) is held until the test lets it go, so the
    // "Updating…" label stays on screen as long as we need to look at it.
    const gate = makeGate(2);
    const w = world({ gate });
    const id = idOf(1);
    w.store.set(id, detail({ id }));
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    // When the page opens: one request, with the editor's whole data.
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
    // An edit: nothing is asked at once (the pause is 1000 ms; rapid edits are in the unit
    // tests), then ONE request.
    await page.getByLabel(ITEM15).fill("123");
    await page.waitForTimeout(300);
    expect(lives(seen)).toHaveLength(1);
    // After the pause ONE request goes out and is held: "Updating…" stays up, and the previous
    // PDF is still there.
    await expect(page.locator("[data-preview-updating]")).toHaveText("Updating…");
    await expect.poll(() => lives(seen).length).toBe(2);
    expect(
      (lives(seen)[1]!.request.postDataJSON() as { data: { i15: string } }).data.i15,
    ).toBe("123");
    await expect(frame(page)).toHaveAttribute("src", firstSrc!);
    // Let the answer go: the PDF is replaced and the label goes.
    gate.release();
    await expect(frame(page)).not.toHaveAttribute("src", firstSrc!);
    await expect(frame(page)).toHaveAttribute("src", /^blob:/);
    await expect(page.locator("[data-preview-updating]")).toHaveCount(0);
    // Quiet again: no more requests.
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(2);
    clean(unmocked, dialogs);
  });

  test("T2 a refusal is shown in the pane, word for word, in place of the PDF; the next good answer replaces it", async ({
    page,
  }) => {
    const R = [
      "INVENTED: the client's contact number is blank.",
      "INVENTED: 7 ATCs; the form has six rows.",
    ];
    const w = world({
      replies: [
        OK_REPLY,
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
            : OK_REPLY(3),
      ],
    });
    const id = idOf(2);
    w.store.set(id, detail({ id }));
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(frame(page)).toBeVisible();
    await page.getByLabel(ITEM15).fill("9");
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText(R);
    await expect(frame(page)).toHaveCount(0);
    // Fixed: the PDF comes back.
    await page.getByLabel(ITEM15).fill("8");
    await expect(frame(page)).toBeVisible();
    await expect(page.locator("[data-preview-problem]")).toHaveCount(0);
    expect(lives(seen)).toHaveLength(3);
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
    await expect(frame(page)).toBeVisible();
    await page.getByLabel(ITEM15).fill("5");
    await expect(page.locator("[data-preview-problem='invalid'] li")).toHaveText([
      "INVENTED: Item 15 must be an amount.",
    ]);
    clean(unmocked, dialogs);
  });

  test("T3 a filed return shows its clear copy, and never calls the live route", async ({
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
    await expect(frame(page)).toHaveAttribute("src", /^blob:/);
    expect(lives(seen)).toHaveLength(0);
    expect(seen.filter((s) => s.path.endsWith("/clear-copy"))).toHaveLength(1);
    await expect(page.locator("[data-preview-open]")).toBeVisible();
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
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([S]);
    expect(lives(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T4 Hide preview and Show preview survive a reload", async ({ page }) => {
    const w = world();
    const id = idOf(6);
    w.store.set(id, detail({ id }));
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(frame(page)).toBeVisible();
    await page.locator("[data-preview-toggle='hide']").click();
    await expect(page.locator("[data-preview-pane]")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Show preview" })).toBeVisible();
    await expect(page.locator("[data-preview-pane]")).toHaveCount(0);
    const afterHide = lives(seen).length;
    await page.waitForTimeout(1200);
    expect(lives(seen)).toHaveLength(afterHide);
    await page.locator("[data-preview-toggle='show']").click();
    await expect(frame(page)).toBeVisible();
    await page.reload();
    await expect(frame(page)).toBeVisible();
    await expect(page.locator("[data-preview-toggle='hide']")).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T5 the 2316: the pane shows the API's sentence and does not ask again", async ({
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
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([S]);
    // Typing in the form asks nothing more.
    await page.getByLabel("Year").fill("2025");
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(1);
    await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([S]);
    clean(unmocked, dialogs);
  });

  test("T6 a draft never saved: no request, and the pane says to save", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/bir-forms/new?form=2551Q");
    await expect(page.locator("[data-preview-save-first]")).toHaveText(
      "Save the draft to see the preview.",
    );
    await page.getByLabel(ITEM15).fill("1");
    await page.waitForTimeout(1500);
    expect(lives(seen)).toHaveLength(0);
    clean(unmocked, dialogs);
  });
  test("T7 the pane is beside the form on a wide screen and below it on a narrow one", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(8);
    w.store.set(id, detail({ id }));
    const { unmocked, dialogs } = await mockApi(page, w);
    const where = async () => {
      const form = (await page.getByLabel(ITEM15).boundingBox())!;
      const pane = (await page.locator("[data-preview-pane]").boundingBox())!;
      return { form, pane };
    };
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto(`/bir-forms/${id}`);
    await expect(frame(page)).toBeVisible();
    // Wide: the pane is to the right of the form (the layout settles, so wait for it).
    await expect
      .poll(async () => {
        const { form, pane } = await where();
        return pane.x > form.x + form.width;
      })
      .toBe(true);
    await page.setViewportSize({ width: 900, height: 900 });
    // Narrow: the pane is below the form.
    await expect
      .poll(async () => {
        const { form, pane } = await where();
        return pane.y > form.y + form.height;
      })
      .toBe(true);
    clean(unmocked, dialogs);
  });
  // Every editor tells the shared page what it would save: a saved draft of each of the
  // twelve forms makes the pane ask for a preview (the 2316 gets its sentence).
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
    test(`T8 the ${form} editor feeds the pane`, async ({ page }) => {
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
      if (form === "2316") {
        await expect(page.locator("[data-preview-problem='refused'] li")).toHaveText([
          "INVENTED: no preview yet.",
        ]);
      } else {
        await expect(frame(page)).toHaveAttribute("src", /^blob:/);
      }
      expect(lives(seen).length).toBeGreaterThanOrEqual(1);
      clean(unmocked, dialogs);
    });
  });
});

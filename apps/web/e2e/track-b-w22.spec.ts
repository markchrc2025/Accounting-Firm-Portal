// track-b-w22.spec.ts — hermetic browser tests for W22: undo a filing made without the
// BIR email (Track A U22), the History, Delete draft on a draft with history, the client
// form's contact-number hint, and the contact-number refusals shown as sent. One router
// answers every /api/v1 call from a table of mocks; any call the table does not cover
// is recorded and FAILS the test. All data is invented.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222k1";
const CLIENT = {
  id: "c2200000-0000-4000-8000-0000000000k1",
  businessName: "INVENTED TWENTY-TWO TRADING",
  tin: "000-111-222-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
};
const USER_ID = "u2200000-0000-4000-8000-0000000000k1";
const BASE_PERMS = [
  "BIRForms:Read",
  "BIRForms:Create",
  "BIRForms:Update",
  "BIRForms:File",
  "Clients:Read",
  "Clients:Create",
  "Clients:Update",
];
const me = (extra: string[] = []) => ({
  user: {
    id: USER_ID,
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

// --- sentences, as the API sends them ---------------------------------------------------

const S403 = "Only a Super Admin can undo a filing.";
const S400 = "Give the reason in at least 10 characters.";
const S409_EMAIL =
  "The filing can only be undone when it was marked filed without the BIR confirmation email. A return with an attached BIR email can never be undone; it is corrected by amending.";
const S409_AMENDED = "This return has an amendment, so its filing cannot be undone.";
const S409_DELETE =
  "This return was filed and the filing was undone. Its history is kept, so it cannot be deleted.";
const CONTACT_BLANK =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const CONTACT_SHORT =
  "The client's contact number must be 11 digits, like 09171234567. eBIRForms accepts no other form.";
const UNDO_TEXT =
  "Use this only when the return never reached the BIR. The return goes back to draft with its figures as filed. The filing is kept in the return's history and cannot be deleted. Then mark it filed again with the BIR confirmation email.";
const OVERRIDE_REASON = "INVENTED: the BIR email was still in transit.";
const FILED_AT = "2026-10-05T02:00:00.000Z";

interface World {
  store: Map<string, Record<string, unknown>>;
  /** Replies to POST undo-filing, in order; the last one repeats. */
  undoReplies: Array<{ status: number; message: string }>;
  /** The client's list of returns (for "has an amendment"). */
  list: Array<Record<string, unknown>>;
}
const idOf = (k: number) => `f2200000-0000-4000-8000-${String(k).padStart(12, "0")}`;

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
    previewAvailable: false,
    canDelete: false,
    computed: null,
    confirmation: null,
    confirmationRequired: true,
    filingUndos: [],
    data: { year: "2026", periodType: "calendar", amended: "no" },
    ...over,
  };
}
const confirmationOf = (kind: "bir_email" | "override") => ({
  id: "k2200000-0000-4000-8000-000000000001",
  kind,
  birFileName: kind === "override" ? null : "000111222333-2551Q-092026.xml",
  receivedAt: kind === "override" ? null : "2026-10-05T01:30:00.000Z",
  filedOn: kind === "override" ? null : "2026-10-05",
  originalFilename: kind === "override" ? null : "email.pdf",
  hasFile: false,
  warnings: [],
  overrideReason: kind === "override" ? OVERRIDE_REASON : null,
  filedWithoutConfirmation: kind === "override",
  uploadedByUserId: USER_ID,
  uploadedAt: FILED_AT,
});
const UNDO_ENTRY = {
  id: "x2200000-0000-4000-8000-000000000001",
  reason: "INVENTED: eBIRForms never took it, the contact number was blank.",
  filedAt: FILED_AT,
  undoneAt: "2026-10-12T02:30:00.000Z",
  undoneByUserId: USER_ID,
  overrideReason: OVERRIDE_REASON,
};

async function mockApi(
  page: Page,
  w: World,
  extraPerms: string[] = SUPER,
  extra: Entry[] = [],
) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
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
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me(extraPerms))],
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
    [
      "GET",
      /^\/api\/v1\/users$/,
      (r) =>
        json(r, [
          {
            id: USER_ID,
            fullName: "Test Operator",
            email: "operator@example.test",
            status: "ACTIVE",
            mfaEnabled: true,
            userRoles: [],
          },
        ]),
    ],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms$/, (r) => json(r, w.list)],
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
      /^\/api\/v1\/bir-forms\/([^/]+)\/undo-filing$/,
      (r, s) => {
        const reply =
          w.undoReplies.length > 1 ? w.undoReplies.shift()! : w.undoReplies[0]!;
        if (reply.status !== 200)
          return json(r, { message: reply.message }, reply.status);
        const id = s.path.split("/")[4]!;
        const cur = w.store.get(id)!;
        const body = s.request.postDataJSON() as { reason: string };
        const next = {
          ...cur,
          status: "draft",
          filedAt: null,
          confirmation: null,
          canDelete: true,
          filingUndos: [
            ...((cur.filingUndos as unknown[]) ?? []),
            { ...UNDO_ENTRY, reason: body.reason },
          ],
        };
        w.store.set(id, next);
        return json(r, next);
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
  return { seen, unmocked, dialogs };
}

const world = (over: Partial<World> = {}): World => ({
  store: new Map(),
  undoReplies: [{ status: 200, message: "" }],
  list: [],
  ...over,
});
function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const posts = (seen: Seen[], tail: string) =>
  seen.filter((s) => s.method === "POST" && s.path.endsWith(tail));
const undoDialog = (page: Page) => page.locator("[data-undo-dialog]");
const undoButton = (page: Page) => page.locator("[data-undo-filing]");

/** A 2551Q filed with the Super Admin override. */
function filedByOverride(w: World, k = 1, over: Record<string, unknown> = {}) {
  const id = idOf(k);
  w.store.set(
    id,
    detail({
      id,
      status: "filed",
      filedAt: FILED_AT,
      confirmation: confirmationOf("override"),
      ...over,
    }),
  );
  return id;
}

// ===========================================================================

test.describe("W22 undo a filing made without the BIR email (hermetic)", () => {
  test("T1 undo: reason, confirm, back to draft, the History, and Mark as filed is offered again", async ({
    page,
  }) => {
    const w = world();
    const id = filedByOverride(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.locator("[data-confirmation-card='override']")).toBeVisible();
    // A filed return: no Mark as filed, the filed banner.
    await expect(page.getByRole("button", { name: "Mark as filed" })).toHaveCount(0);
    await undoButton(page).click();
    const dialog = undoDialog(page);
    await expect(dialog.locator("[data-undo-text]")).toHaveText(UNDO_TEXT);
    await expect(dialog.locator("[data-reason-counter]")).toHaveText("0 / 10");
    await dialog.getByLabel(/Reason for undoing/).fill("The BIR never got it.");
    await expect(dialog.locator("[data-reason-counter]")).toHaveText("21 / 10");
    await dialog.getByRole("button", { name: "Undo filing" }).click();
    await expect(dialog).toHaveCount(0);
    expect(posts(seen, "/undo-filing")).toHaveLength(1);
    expect(posts(seen, "/undo-filing")[0]!.request.postDataJSON()).toEqual({
      reason: "The BIR never got it.",
    });
    // Back to the draft editor: no confirmation card, Mark as filed works as for any draft.
    await expect(page.locator("[data-confirmation-card]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeEnabled();
    // The History: filed on, undone on, by, the reason and the override reason.
    const row = page.locator("[data-filing-history] [data-filing-undo]");
    await expect(row).toHaveCount(1);
    await expect(row.locator("[data-undo-filed-at]")).toHaveText(
      "Oct 05, 2026, 10:00 AM",
    );
    await expect(row.locator("[data-undo-undone-at]")).toHaveText(
      "Oct 12, 2026, 10:30 AM",
    );
    await expect(row.locator("[data-undo-by]")).toHaveText("Test Operator");
    await expect(row.locator("[data-undo-reason]")).toHaveText("The BIR never got it.");
    await expect(row.locator("[data-undo-override-reason]")).toHaveText(OVERRIDE_REASON);
    clean(unmocked, dialogs);
  });

  test("T2 each refusal is shown exactly as sent, and the window stays open", async ({
    page,
  }) => {
    const w = world({
      undoReplies: [
        { status: 403, message: S403 },
        { status: 400, message: S400 },
        { status: 409, message: S409_EMAIL },
        { status: 409, message: S409_AMENDED },
      ],
    });
    const id = filedByOverride(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await undoButton(page).click();
    const dialog = undoDialog(page);
    // A short reason is still sent: the API refuses it in its own words.
    await dialog.getByLabel(/Reason for undoing/).fill("short");
    for (const sentence of [S403, S400, S409_EMAIL, S409_AMENDED]) {
      await dialog.getByRole("button", { name: "Undo filing" }).click();
      await expect(dialog.locator("[data-undo-error]")).toHaveText(sentence);
    }
    expect(posts(seen, "/undo-filing")).toHaveLength(4);
    await expect(dialog.getByLabel(/Reason for undoing/)).toHaveValue("short");
    // Cancel closes it; the return is still filed.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-confirmation-card='override']")).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T3 no button on a return with a BIR email", async ({ page }) => {
    const w = world();
    const id = filedByOverride(w, 2, { confirmation: confirmationOf("bir_email") });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.locator("[data-confirmation-card='bir_email']")).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 no button for anyone but a Super Admin", async ({ page }) => {
    const w = world();
    const id = filedByOverride(w, 3);
    const { unmocked, dialogs } = await mockApi(page, w, []);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.locator("[data-confirmation-card='override']")).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 no button on a return that has an amendment", async ({ page }) => {
    const w = world();
    const id = filedByOverride(w, 4);
    w.list = [
      { id, amendsId: null, status: "filed" },
      { id: idOf(40), amendsId: id, status: "draft" },
    ];
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.locator("[data-confirmation-card='override']")).toBeVisible();
    await expect(page.locator("[data-confirmation-card] [data-uploaded]")).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T3 no button on a draft", async ({ page }) => {
    const w = world();
    const id = idOf(5);
    w.store.set(id, detail({ id }));
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.getByRole("button", { name: "Mark as filed" })).toBeVisible();
    await expect(undoButton(page)).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

test.describe("W22 Delete draft on a draft with history (hermetic)", () => {
  test("T4 a draft with history offers no Delete draft", async ({ page }) => {
    const w = world();
    const id = idOf(6);
    w.store.set(id, detail({ id, canDelete: true, filingUndos: [UNDO_ENTRY] }));
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(page.locator("[data-filing-undo]")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Delete draft" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T4 if the API refuses a delete, its sentence shows as sent", async ({ page }) => {
    const w = world();
    const id = idOf(7);
    w.store.set(id, detail({ id, canDelete: true }));
    const { seen, unmocked, dialogs } = await mockApi(page, w, SUPER, [
      [
        "DELETE",
        /^\/api\/v1\/bir-forms\/[^/]+$/,
        (r) => json(r, { message: S409_DELETE }, 409),
      ],
    ]);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Delete draft" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete draft" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toHaveText(S409_DELETE);
    expect(seen.filter((s) => s.method === "DELETE")).toHaveLength(1);
    clean(unmocked, dialogs);
  });
});

test.describe("W22 the contact number (hermetic)", () => {
  test("T5 the client form hints at the 11-digit number and does not block saving", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w, SUPER, [
      ["GET", /^\/api\/v1\/services/, (r) => json(r, [])],
    ]);
    await page.goto("/clients/new");
    await expect(page.locator("[data-field-hint]")).toHaveText(
      "Contact number: 11 digits, like 09171234567",
    );
    const phone = page.getByLabel(/^Phone/);
    await phone.fill("123");
    await expect(phone).toHaveValue("123");
    clean(unmocked, dialogs);
  });

  for (const [name, sentence] of [
    ["blank", CONTACT_BLANK],
    ["not 11 digits", CONTACT_SHORT],
  ] as const) {
    test(`T6 Export eBIRForms XML shows the ${name} refusal as sent`, async ({
      page,
    }) => {
      const w = world();
      const id = idOf(8);
      w.store.set(id, detail({ id, confirmationRequired: true }));
      const { seen, unmocked, dialogs } = await mockApi(page, w, SUPER, [
        [
          "POST",
          /^\/api\/v1\/bir-forms\/[^/]+\/export$/,
          (r) => json(r, { message: sentence }, 409),
        ],
      ]);
      await page.goto(`/bir-forms/${id}`);
      await page.getByRole("button", { name: "Export eBIRForms XML" }).click();
      await expect(page.getByText(sentence, { exact: true })).toHaveCount(1);
      expect(posts(seen, "/export")).toHaveLength(1);
      clean(unmocked, dialogs);
    });
  }

  test("T6 Mark as filed shows the contact refusal as sent, in the window", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(9);
    w.store.set(id, detail({ id }));
    const checks = [
      "bir-email",
      "file-name",
      "taxpayer",
      "form",
      "period",
      "received",
      "duplicate",
      "timing",
      "upload",
    ].map((cid, i) => ({ n: i + 1, id: cid, status: "ok", message: null }));
    const { unmocked, dialogs } = await mockApi(page, w, SUPER, [
      [
        "POST",
        /^\/api\/v1\/bir-forms\/[^/]+\/confirmation\/check$/,
        (r) =>
          json(r, {
            ok: true,
            checks,
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
        (r) => json(r, { message: CONTACT_BLANK }, 409),
      ],
    ]);
    await page.goto(`/bir-forms/${id}`);
    await page.getByRole("button", { name: "Mark as filed" }).click();
    const dialog = page.locator("[data-confirmation-dialog]");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "good.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 invented"),
    });
    await dialog.getByRole("button", { name: "Check", exact: true }).click();
    await expect(dialog.locator('[data-check-result="ok"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Mark as filed" }).click();
    await expect(dialog.locator("[data-confirmation-error]")).toHaveText(CONTACT_BLANK);
    clean(unmocked, dialogs);
  });
});

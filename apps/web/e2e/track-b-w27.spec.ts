// track-b-w27.spec.ts — hermetic browser tests for W27 (Track A U27, D74): a return never
// leaves the Portal while a required ATC is empty. On a 1701Q with no Item 8 ATC, Export
// eBIRForms XML and Mark as filed are disabled with the API's own sentence; choosing the ATC
// enables them; the filing dialog (the BIR e-mail and the Super Admin override alike) repeats
// the refusal while the saved draft has none; a filed return with none holds back its clear
// copy; and "Undo filing" is offered on a return filed before the confirmation rule. One
// router answers every /api/v1 call from a table of mocks; any call the table does not cover
// is recorded and FAILS the test. All data is invented. (Scaffolding copied from W22.)

import { answerBell } from "./helpers/bell";
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
    form: "1701Q",
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
    data: {
      year: "2026",
      amended: "no",
      rateA: "graduated",
      methodA: "osd",
      salesA: "100000",
    },
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
    if (await answerBell(route)) return; // PB2: the header bell
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

const CHOOSE_8 = "Choose the Item 8 ATC before this return leaves the Portal.";
const exportButton = (page: Page) =>
  page.getByRole("button", { name: "Export eBIRForms XML" });
const markButton = (page: Page) => page.getByRole("button", { name: "Mark as filed" });
const gate = (page: Page) => page.locator("[data-atc-gate]");

function draftWithoutAtc(w: World, k = 1) {
  const id = idOf(k);
  w.store.set(id, detail({ id }));
  return id;
}

test.describe("W27 the ATC gate (hermetic)", () => {
  test("T1 a 1701Q with no Item 8 ATC: Export and Mark as filed disabled with the sentence; choosing the ATC enables them", async ({
    page,
  }) => {
    const w = world();
    const id = draftWithoutAtc(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(exportButton(page)).toBeDisabled();
    await expect(markButton(page)).toBeDisabled();
    await expect(gate(page)).toHaveText(CHOOSE_8);
    await page.getByTestId("atc-select").selectOption("II012");
    await expect(gate(page)).toHaveCount(0);
    await expect(exportButton(page)).toBeEnabled();
    await expect(markButton(page)).toBeEnabled();
    // Back to none: held again.
    await page.getByTestId("atc-select").selectOption("");
    await expect(gate(page)).toHaveText(CHOOSE_8);
    await expect(exportButton(page)).toBeDisabled();
    expect(posts(seen, "/export")).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T2 the filing dialog repeats the refusal on both paths while the saved draft has no ATC; the override cannot file around it", async ({
    page,
  }) => {
    const w = world();
    const id = draftWithoutAtc(w);
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    // Chosen on screen but not saved: the button opens the dialog, which reads the saved draft.
    await page.getByTestId("atc-select").selectOption("II014");
    await markButton(page).click();
    const dialog = page.locator("[data-confirmation-dialog='mark']");
    await expect(dialog.locator("[data-atc-gate]")).toHaveText(CHOOSE_8);
    await expect(dialog.getByRole("button", { name: "Mark as filed" })).toBeDisabled();
    // The Super Admin override: a typed reason does not open the way.
    await dialog.locator("[data-override-link]").click();
    await dialog
      .locator("textarea")
      .fill("INVENTED: the BIR e-mail is still in transit.");
    await expect(dialog.locator("[data-atc-gate]")).toHaveText(CHOOSE_8);
    await expect(dialog.getByRole("button", { name: "Mark as filed" })).toBeDisabled();
    expect(posts(seen, "/mark-filed")).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T3 a 1701Q filed with no ATC: Export and Download clear copy held back with the sentence; Undo filing is offered (filed before the confirmation rule)", async ({
    page,
  }) => {
    const w = world();
    const id = idOf(3);
    w.store.set(
      id,
      detail({
        id,
        status: "filed",
        filedAt: FILED_AT,
        confirmation: null,
        clearCopyAvailable: true,
      }),
    );
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto(`/bir-forms/${id}`);
    await expect(exportButton(page)).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Download clear copy" }),
    ).toBeDisabled();
    await expect(gate(page)).toHaveText(CHOOSE_8);
    await expect(page.locator("[data-no-confirmation]")).toBeVisible();
    await expect(undoButton(page)).toBeVisible();
    expect(posts(seen, "/clear-copy")).toHaveLength(0);
    clean(unmocked, dialogs);
  });
});

// track-c-c2-preview.spec.ts — C2 T4 (hermetic): "Preview PDF" and "Download clear
// copy" on the 1701Q, 1702Q, 1701, 1701A and 1702RT (D53). One router answers every
// /api/v1 call from a table of mocks; any call it does not cover, any browser dialog
// and any new tab fails the test. All data is invented. For each form:
//
//   - a draft the server says can be previewed shows "Preview PDF" directly under
//     "Export eBIRForms XML"; one click sends one POST and the PDF downloads in the
//     page with the server's filename, no popup;
//   - a filed return shows "Download clear copy" and no preview;
//   - a form without a print map (previewAvailable and clearCopyAvailable false)
//     shows neither button, draft or filed.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222c2";
const CLIENT = {
  id: "c2000000-0000-4000-8000-0000000000c2",
  businessName: "INVENTED PREVIEW STORE",
  tin: "000-333-003-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};
const ME = {
  user: {
    id: "u2000000-0000-4000-8000-0000000000c2",
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

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const BUTTON = "Preview PDF";
const CLEAR = "Download clear copy";

interface Case {
  form: string;
  /** The period string the form is saved with. */
  period: string;
  /** The server's preview filename for it. */
  filename: string;
  /** A short id suffix, to keep each form's ids apart. */
  n: string;
}
const CASES: Case[] = [
  {
    form: "1701Q",
    period: "2026-Q3",
    filename: "0003330030001701Qv20182026Q3-DRAFT.pdf",
    n: "1701",
  },
  {
    form: "1702Q",
    period: "2026-Q3",
    filename: "00033300300001702Q2026Q3-DRAFT.pdf",
    n: "1702",
  },
  {
    form: "1701",
    period: "2026",
    filename: "00033300300001701v2018122026-DRAFT.pdf",
    n: "0170",
  },
  {
    form: "1701A",
    period: "2026",
    filename: "0003330030001701A122026-DRAFT.pdf",
    n: "170A",
  },
];

function setup(c: Case) {
  const DRAFT = `f2000000-0000-4000-8000-0000${c.n}0000d`;
  const FILED = `f2000000-0000-4000-8000-0000${c.n}0000f`;
  const BARE = `f2000000-0000-4000-8000-0000${c.n}0000b`;
  const BAREF = `f2000000-0000-4000-8000-0000${c.n}0000c`;
  const form = (over: Record<string, unknown>) => ({
    id: DRAFT,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    form: c.form,
    status: "draft",
    period: c.period,
    filedAt: null,
    createdAt: "2026-10-01T01:00:00.000Z",
    updatedAt: "2026-10-09T02:00:00.000Z",
    amendsId: null,
    sequence: 1,
    data: {},
    computed: null,
    exports: [],
    filedSnapshot: null,
    clearCopyAvailable: false,
    previewAvailable: true,
    canDelete: true,
    ...over,
  });
  return {
    DRAFT,
    FILED,
    BARE,
    BAREF,
    draft: () => form({}),
    filed: () =>
      form({
        id: FILED,
        status: "filed",
        filedAt: "2026-10-09T02:00:00.000Z",
        clearCopyAvailable: true,
        previewAvailable: false,
        canDelete: false,
      }),
    // A form with no print map: the server says neither is available.
    bareDraft: () => form({ id: BARE, previewAvailable: false }),
    bareFiled: () =>
      form({
        id: BAREF,
        status: "filed",
        filedAt: "2026-10-09T02:00:00.000Z",
        clearCopyAvailable: false,
        previewAvailable: false,
        canDelete: false,
      }),
  };
}

async function mockApi(page: Page, c: Case, extra: Entry[]) {
  const s = setup(c);
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  const dialogs: string[] = [];
  const popups: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  page.context().on("page", (p) => popups.push(p.url()));
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    ["GET", /^\/api\/v1\/profile\/me$/, (r) => json(r, { ...ME.user, avatarUrl: null })],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/.+$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, {})],
    ["GET", new RegExp(`^/api/v1/bir-forms/${s.DRAFT}$`), (r) => json(r, s.draft())],
    ["GET", new RegExp(`^/api/v1/bir-forms/${s.FILED}$`), (r) => json(r, s.filed())],
    ["GET", new RegExp(`^/api/v1/bir-forms/${s.BARE}$`), (r) => json(r, s.bareDraft())],
    ["GET", new RegExp(`^/api/v1/bir-forms/${s.BAREF}$`), (r) => json(r, s.bareFiled())],
    // An unsaved-changes save (a fresh editor can differ from {}): answer with the draft.
    ["PATCH", new RegExp(`^/api/v1/bir-forms/${s.DRAFT}$`), (r) => json(r, s.draft())],
  ];
  const table = [...base, ...extra];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const e: Seen = { method: req.method(), path: url.pathname, request: req };
    seen.push(e);
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, h] = table[i]!;
      if (m === e.method && re.test(e.path)) return h(route, e);
    }
    unmocked.push(`${e.method} ${e.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { ...s, seen, unmocked, dialogs, popups };
}

const count = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path)).length;

function clean(m: { unmocked: string[]; dialogs: string[]; popups: string[] }) {
  expect(m.unmocked, `unmocked API calls: ${m.unmocked.join(", ")}`).toEqual([]);
  expect(m.dialogs, `browser dialogs: ${m.dialogs.join(", ")}`).toEqual([]);
  expect(m.popups, `new tabs: ${m.popups.join(", ")}`).toEqual([]);
}

for (const c of CASES) {
  test.describe(`C2 T4 ${c.form} Preview PDF and clear copy (hermetic)`, () => {
    test(`a draft ${c.form}: Preview PDF under Export eBIRForms XML; one click, one POST, the PDF downloads with the server's name, no popup`, async ({
      page,
    }) => {
      const ids = setup(c);
      const previewRe = new RegExp(`^/api/v1/bir-forms/${ids.DRAFT}/preview-pdf$`);
      const m = await mockApi(page, c, [
        [
          "POST",
          previewRe,
          (r) =>
            r.fulfill({
              status: 200,
              contentType: "application/pdf",
              headers: {
                "Content-Disposition": `attachment; filename="${c.filename}"`,
                "Access-Control-Expose-Headers": "Content-Disposition,X-Export-Warnings",
              },
              body: PDF,
            }),
        ],
      ]);
      await page.goto(`/bir-forms/${m.DRAFT}`);
      const preview = page.getByRole("button", { name: BUTTON });
      await expect(preview).toBeVisible();
      const names = await page.locator("button").allInnerTexts();
      expect(names.indexOf(BUTTON)).toBe(names.indexOf("Export eBIRForms XML") + 1);
      await expect(page.getByRole("button", { name: CLEAR })).toHaveCount(0);

      const downloading = page.waitForEvent("download");
      await preview.click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe(c.filename);
      await expect(preview).toBeEnabled();
      expect(count(m.seen, "POST", previewRe)).toBe(1);
      clean(m);
    });

    test(`a filed ${c.form}: Download clear copy, no preview`, async ({ page }) => {
      const m = await mockApi(page, c, []);
      await page.goto(`/bir-forms/${m.FILED}`);
      await expect(page.getByRole("button", { name: CLEAR })).toBeVisible();
      await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
      clean(m);
    });

    test(`a ${c.form} the server has no print map for: neither button, draft or filed`, async ({
      page,
    }) => {
      const m = await mockApi(page, c, []);
      await page.goto(`/bir-forms/${m.BARE}`);
      await expect(
        page.getByRole("button", { name: "Export eBIRForms XML" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
      await expect(page.getByRole("button", { name: CLEAR })).toHaveCount(0);

      await page.goto(`/bir-forms/${m.BAREF}`);
      await expect(page.getByText(/Filed on/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
      await expect(page.getByRole("button", { name: CLEAR })).toHaveCount(0);
      clean(m);
    });
  });
}

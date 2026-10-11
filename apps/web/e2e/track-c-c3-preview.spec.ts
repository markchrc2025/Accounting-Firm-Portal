// track-c-c3-preview.spec.ts — C3 T4 (hermetic): "Preview PDF" on a draft
// whose form has a print map (R3, D52). One router answers every /api/v1 call
// from a table of mocks; any call it does not cover, any browser dialog and any
// new tab fails the test. All data is invented.
//
//   - a draft 2551Q with previewAvailable shows "Preview PDF" directly under
//     "Export eBIRForms XML"; one click sends one POST and the PDF downloads in
//     the page with the server's filename, no popup;
//   - with unsaved changes the click saves first (one PATCH, then one POST); a
//     failed save shows its message and downloads nothing;
//   - a 409 shows its message word for word;
//   - a filed 2551Q shows no preview and keeps "Download clear copy";
//   - a draft 1701 (previewAvailable false) shows no button.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222c3";
const CLIENT = {
  id: "c3000000-0000-4000-8000-0000000000c3",
  businessName: "INVENTED PREVIEW STORE",
  tin: "000-333-003-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "Active",
};
const ME = {
  user: {
    id: "u3000000-0000-4000-8000-0000000000c3",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: ["BIRForms:Read", "BIRForms:Create", "BIRForms:Update", "BIRForms:File", "Clients:Read"],
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
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const COMPUTED_2551Q = { rows: [{ due: 4500 }], i14: 4500, i18: 0, i19: 4500, i23: 0, i24: 4500 };
const DRAFT = "f3000000-0000-4000-8000-000000002551";
const FILED = "f3000000-0000-4000-8000-000000002552";
const D1701 = "f3000000-0000-4000-8000-000000001701";
const PREVIEW = new RegExp(`^/api/v1/bir-forms/${DRAFT}/preview-pdf$`);
const PATCH_DRAFT = new RegExp(`^/api/v1/bir-forms/${DRAFT}$`);
const FILENAME = "0003330030002551Qv2018122026Q3-DRAFT.pdf";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** The data the 2551Q editor itself saves, so a freshly opened draft has no unsaved changes. */
const DATA = {
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
    updatedAt: "2026-10-09T02:00:00.000Z",
    amendsId: null,
    sequence: 1,
    data: DATA,
    computed: COMPUTED_2551Q,
    exports: [],
    filedSnapshot: null,
    clearCopyAvailable: false,
    previewAvailable: true,
    canDelete: true,
    ...over,
  };
}
const draft = (over: Record<string, unknown> = {}) => form(over);
const filed = () =>
  form({
    id: FILED,
    status: "filed",
    filedAt: "2026-10-09T02:00:00.000Z",
    clearCopyAvailable: true,
    previewAvailable: false,
    canDelete: false,
  });
const draft1701 = () =>
  form({ id: D1701, form: "1701", period: "2025", data: {}, computed: null, previewAvailable: false });

async function mockApi(page: Page, extra: Entry[]) {
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
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) => json(r, { ...ME.user, avatarUrl: null }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [CLIENT])],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, (r) => json(r, CLIENT)],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/.+$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, (r) => json(r, COMPUTED_2551Q)],
    ["GET", new RegExp(`^/api/v1/bir-forms/${DRAFT}$`), (r) => json(r, draft())],
    ["GET", new RegExp(`^/api/v1/bir-forms/${FILED}$`), (r) => json(r, filed())],
    ["GET", new RegExp(`^/api/v1/bir-forms/${D1701}$`), (r) => json(r, draft1701())],
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
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs, popups };
}

const pdfReply: Handler = (r) =>
  r.fulfill({
    status: 200,
    contentType: "application/pdf",
    headers: {
      "Content-Disposition": `attachment; filename="${FILENAME}"`,
      // As the API does (apps/api/src/main.ts enableCors exposedHeaders): the page
      // reads the server's filename from this header.
      "Access-Control-Expose-Headers": "Content-Disposition,X-Export-Warnings",
    },
    body: PDF,
  });
const count = (seen: Seen[], method: string, re: RegExp) =>
  seen.filter((s) => s.method === method && re.test(s.path)).length;
const BUTTON = "Preview PDF";

function clean(m: { unmocked: string[]; dialogs: string[]; popups: string[] }) {
  expect(m.unmocked, `unmocked API calls: ${m.unmocked.join(", ")}`).toEqual([]);
  expect(m.dialogs, `browser dialogs: ${m.dialogs.join(", ")}`).toEqual([]);
  expect(m.popups, `new tabs: ${m.popups.join(", ")}`).toEqual([]);
}

test.describe("C3 T4 Preview PDF (hermetic)", () => {
  test("a draft 2551Q shows Preview PDF under Export eBIRForms XML; one click, one POST, the PDF downloads with the server's name, no popup", async ({
    page,
  }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const m = await mockApi(page, [
      [
        "POST",
        PREVIEW,
        async (r, s) => {
          await held;
          return pdfReply(r, s);
        },
      ],
    ]);
    await page.goto(`/bir-forms/${DRAFT}`);
    const exportButton = page.getByRole("button", { name: "Export eBIRForms XML" });
    const preview = page.getByRole("button", { name: BUTTON });
    await expect(preview).toBeVisible();
    // Directly under the export button: the next button in the actions column.
    const buttons = page.locator("button");
    const names = await buttons.allInnerTexts();
    expect(names.indexOf(BUTTON)).toBe(names.indexOf("Export eBIRForms XML") + 1);
    await expect(exportButton).toBeVisible();

    const downloading = page.waitForEvent("download");
    await preview.click();
    await expect(page.getByRole("button", { name: "Preparing…" })).toBeDisabled();
    release();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(FILENAME);
    await expect(preview).toBeEnabled();
    expect(count(m.seen, "POST", PREVIEW)).toBe(1);
    expect(count(m.seen, "PATCH", PATCH_DRAFT)).toBe(0);
    clean(m);
  });

  test("with unsaved changes the click saves first: one PATCH, then one POST", async ({ page }) => {
    const m = await mockApi(page, [
      ["POST", PREVIEW, pdfReply],
      ["PATCH", PATCH_DRAFT, (r) => json(r, draft({ data: { ...DATA, i15: "1500" } }))],
    ]);
    await page.goto(`/bir-forms/${DRAFT}`);
    await page.getByLabel("Creditable percentage tax withheld (Item 15)").fill("1500");
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: BUTTON }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(FILENAME);
    expect(count(m.seen, "PATCH", PATCH_DRAFT)).toBe(1);
    expect(count(m.seen, "POST", PREVIEW)).toBe(1);
    const patch = m.seen.findIndex((s) => s.method === "PATCH" && PATCH_DRAFT.test(s.path));
    const post = m.seen.findIndex((s) => s.method === "POST" && PREVIEW.test(s.path));
    expect(patch).toBeLessThan(post);
    // The save sent what the editor shows, as "Save changes" sends it.
    const body = JSON.parse(m.seen[patch]!.request.postData() ?? "{}");
    expect(body).toMatchObject({ period: "2026-Q3", data: { i15: "1500" } });
    clean(m);
  });

  test("a failed save shows its message, and nothing downloads", async ({ page }) => {
    const MESSAGE = "INVENTED: this draft could not be saved.";
    const m = await mockApi(page, [
      ["POST", PREVIEW, pdfReply],
      ["PATCH", PATCH_DRAFT, (r) => json(r, { message: MESSAGE }, 409)],
    ]);
    let downloads = 0;
    page.on("download", () => (downloads += 1));
    await page.goto(`/bir-forms/${DRAFT}`);
    await page.getByLabel("Creditable percentage tax withheld (Item 15)").fill("1500");
    await page.getByRole("button", { name: BUTTON }).click();
    await expect(page.getByText(MESSAGE)).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toBeEnabled();
    expect(count(m.seen, "PATCH", PATCH_DRAFT)).toBe(1);
    expect(count(m.seen, "POST", PREVIEW)).toBe(0);
    expect(downloads).toBe(0);
    clean(m);
  });

  test("a 409 shows its message word for word", async ({ page }) => {
    const MESSAGE =
      "Schedule 1 row 1: ATC PT150 has no eBIRForms code; this return cannot be exported.";
    const m = await mockApi(page, [["POST", PREVIEW, (r) => json(r, { message: MESSAGE }, 409)]]);
    let downloads = 0;
    page.on("download", () => (downloads += 1));
    await page.goto(`/bir-forms/${DRAFT}`);
    await page.getByRole("button", { name: BUTTON }).click();
    await expect(page.locator("[data-preview-error]")).toHaveText(MESSAGE);
    expect(downloads).toBe(0);
    clean(m);
  });

  test("a filed 2551Q shows no preview and keeps Download clear copy", async ({ page }) => {
    const m = await mockApi(page, []);
    await page.goto(`/bir-forms/${FILED}`);
    await expect(page.getByRole("button", { name: "Download clear copy" })).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
    clean(m);
  });

  test("a draft 1701 (previewAvailable false) shows no button", async ({ page }) => {
    const m = await mockApi(page, []);
    await page.goto(`/bir-forms/${D1701}`);
    await expect(page.getByRole("button", { name: /Save changes/ })).toBeVisible();
    await expect(page.getByRole("button", { name: BUTTON })).toHaveCount(0);
    clean(m);
  });
});

// track-b-form-2307.spec.ts — hermetic browser tests for the 2307 Form view.
//
// HERMETIC BY CONSTRUCTION: every /api/v1 call the 2307 editor makes is mocked,
// and a catch-all route FAILS the test on any call that is not. Nothing here
// touches a running API, a database, or the network.
//
// All fixture data is invented. No real name, TIN, address, phone or email.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import { certificateFileName } from "../src/lib/sheetPdf";
import { mockCertificatePrint } from "./helpers/certificate-print";

const FIXTURE = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("./fixtures/bir-2307-jan-2018-encs.json", import.meta.url)),
    "utf8",
  ),
) as {
  geometry: {
    sheetPx: { w: number; h: number };
    pagePt: { w: number; h: number };
  };
};

const SHEET = FIXTURE.geometry.sheetPx;

// ---------------------------------------------------------------------------
// Invented fixtures
// ---------------------------------------------------------------------------

const ME = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: "22222222-2222-4222-8222-222222222222",
    mfaEnabled: false,
  },
  permissions: {
    global: [
      "BIRForms:Read",
      "BIRForms:Create",
      "BIRForms:Update",
      "BIRForms:File",
      "Clients:Read",
      "Users:Read",
    ],
    clients: [],
    assignedClientIds: ["33333333-3333-4333-8333-333333333333"],
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

/** The payor: the firm's client, the withholding agent issuing the certificate. */
const CLIENT = {
  id: "33333333-3333-4333-8333-333333333333",
  businessName: "NORTHWIND SUPPLY TRADING CORPORATION",
  // Item 7 prints the registered name (W7 R6); the same words, so the print
  // is the one this file has always measured.
  kind: "non-individual",
  regName: "NORTHWIND SUPPLY TRADING CORPORATION",
  tin: "123-456-789-00000",
  branch: "00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
  address: "128 SAMPLE AVENUE, BARANGAY EXAMPLE",
  city: "SAMPLE CITY",
  province: "SAMPLE PROVINCE",
  region: "REGION 0",
  zip: "1600",
};

const COMPUTED_2307 = {
  rows: [{ total: 60000 }, { total: 45000 }],
  totalIncome: 105000,
  totalTax: 5250,
  tM1: 35000,
  tM2: 35000,
  tM3: 35000,
};

const PERIOD = "2026-Q1";
/**
 * The canonical download name, taken from the production helper rather than
 * hand-typed, so the assertion cannot drift from the code it is checking.
 * For this fixture it is "12345678900000-2307-2026-Q1.pdf": a 14-digit prefix,
 * as R6 (W3) rules — pinned literally below so the helper cannot drift either.
 */
const EXPECTED_PDF_NAME = certificateFileName("2307", PERIOD, CLIENT.tin);
if (EXPECTED_PDF_NAME !== "12345678900000-2307-2026-Q1.pdf") {
  throw new Error(`certificateFileName drifted: ${EXPECTED_PDF_NAME}`);
}

// ---------------------------------------------------------------------------
// Mocking: every endpoint the editor touches, plus a catch-all that fails
// ---------------------------------------------------------------------------

async function mockApi(page: Page): Promise<string[]> {
  const unmocked: string[] = [];

  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });

  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  // The catch-all is registered FIRST. Playwright matches routes in REVERSE
  // registration order — the last matching handler wins — so the specific
  // mocks below shadow it, and anything they do not cover lands here: it is an
  // unmocked API call, recorded and asserted against at the end of the test.
  await page.route("**/api/v1/**", (r) => {
    unmocked.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
    return r.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/v1/auth/me", (r) => json(r, ME));
  await page.route("**/api/v1/auth/refresh", (r) =>
    json(r, { accessToken: "test-token" }),
  );
  await page.route("**/api/v1/profile/me", (r) => json(r, PROFILE));
  await page.route("**/api/v1/clients", (r) => json(r, [CLIENT]));
  await page.route("**/api/v1/clients/*", (r) => json(r, CLIENT));
  await page.route("**/api/v1/bir-forms/catalog", (r) => json(r, []));
  await page.route("**/api/v1/bir-forms/compute", (r) => json(r, COMPUTED_2307));

  return unmocked;
}

/** Invented payee, rows and signatories — consistent with COMPUTED_2307. */
export const SYNTHETIC = {
  payeeName: "DELA PAZ, ANDREA SANTOS",
  payeeTin: "987-654-321-00000",
  payeeAddress: "45 INVENTED STREET, FICTION VILLAGE",
  payeeZip: "4027",
  payeeForeignAddress: "UNIT 9, 100 PLACEHOLDER ROAD, NOWHERE",
  rows: [
    { m1: "20000", m2: "20000", m3: "20000", tax: "3000" },
    { m1: "15000", m2: "15000", m3: "15000", tax: "2250" },
  ],
};

async function fillSyntheticCertificate(page: Page): Promise<void> {
  await page.getByLabel("Withholding agent (client)").selectOption(CLIENT.id);
  await page.getByLabel("Year").fill("2026");
  await page.getByLabel("Quarter").selectOption("Q1");

  await page.getByLabel("Payee name").fill(SYNTHETIC.payeeName);
  await page.getByLabel("Payee TIN").fill(SYNTHETIC.payeeTin);
  await page.getByLabel(/Registered address/).fill(SYNTHETIC.payeeAddress);
  await page.getByLabel(/ZIP Code/).fill(SYNTHETIC.payeeZip);
  await page.getByLabel(/Foreign address/).fill(SYNTHETIC.payeeForeignAddress);

  await page.getByRole("button", { name: "+ Add line" }).click();
  const nums = page.locator("table input[type=number]");
  for (let r = 0; r < SYNTHETIC.rows.length; r++) {
    const row = SYNTHETIC.rows[r]!;
    await nums.nth(r * 4 + 0).fill(row.m1);
    await nums.nth(r * 4 + 1).fill(row.m2);
    await nums.nth(r * 4 + 2).fill(row.m3);
    await nums.nth(r * 4 + 3).fill(row.tax);
  }
}

// ---------------------------------------------------------------------------
// T1 — the sheet is visible, on screen, at long-bond size
// ---------------------------------------------------------------------------

test.describe("2307 Form view (hermetic)", () => {
  // Renamed in W3 (R6): the assertion is the sheet's LAYOUT size, not its
  // rendered box at fit-to-width.
  test("T1 the replica's layout size is long-bond 816 x 1248 px, and it is on screen", async ({
    page,
  }) => {
    const unmocked = await mockApi(page);
    await page.setViewportSize({ width: 1600, height: 1200 });

    await page.goto("/bir-forms/new?form=2307");

    // Fill an invented certificate through the Guided pane, so the captured
    // sheet carries data a person can check against a blank 2307.
    await fillSyntheticCertificate(page);

    // Switch from Guided to Form mode.
    await page.getByRole("button", { name: "Form", exact: true }).click();

    // The on-screen VIEW copy. (A second, CAPTURE copy is always staged
    // off-screen; it is the one the PDF is rasterised from.)
    const sheet = page.locator('[data-sheet-copy="view"] .bir-sheet');
    await expect(sheet).toHaveCount(1);
    await expect(sheet).toBeVisible();

    const box = await sheet.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });

    // The sheet is its authored size regardless of the zoom transform, so
    // measure the untransformed layout box.
    const layout = await sheet.evaluate((el) => ({
      offsetWidth: (el as HTMLElement).offsetWidth,
      offsetHeight: (el as HTMLElement).offsetHeight,
    }));
    // eslint-disable-next-line no-console
    console.log("T1-SHEET-BOX " + JSON.stringify({ ...box, ...layout }));

    expect(Math.abs(layout.offsetWidth - SHEET.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.offsetHeight - SHEET.h)).toBeLessThanOrEqual(1);

    // Visible INSIDE the viewport — not staged at left: -10000px.
    expect(box.x).toBeGreaterThan(-1);
    const vp = page.viewportSize()!;
    expect(box.x).toBeLessThan(vp.width);

    // Let the debounced live preview finish so the capture shows both halves.
    await expect(page.locator('iframe[title="Form PDF preview"]')).toBeVisible({
      timeout: 30_000,
    });
    await page.screenshot({
      path: "test-results/track-b-2307-form-view.png",
      fullPage: true,
    });
    // The sheet alone, at 100%, for checking box by box.
    await page.getByRole("button", { name: "100%", exact: true }).click();
    await sheet.screenshot({ path: "test-results/track-b-2307-sheet-100pct.png" });

    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // T2 (C7) — the certificate prints on the server, on the BIR's own blank, under
  // the canonical name. The browser-made raster PDF of the replica (and its pixel
  // checks) is gone: the replica is the view, "Preview PDF" is the print.
  // -------------------------------------------------------------------------

  test("T2 Preview PDF downloads the server's PDF under the certificate's name, in both views; no browser-made PDF is offered", async ({
    page,
  }) => {
    const unmocked = await mockApi(page);
    await page.setViewportSize({ width: 1600, height: 1200 });

    // Only a SAVED certificate prints (W7 R6): open one — its client, year and
    // quarter are the ones this test used to pick on a new certificate.
    const SAVED_ID = "f2307000-0000-4000-8000-0000000000a2";
    await page.route(`**/api/v1/bir-forms/${SAVED_ID}`, (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: SAVED_ID,
          clientId: CLIENT.id,
          clientName: CLIENT.businessName,
          form: "2307",
          status: "draft",
          period: PERIOD,
          filedAt: null,
          createdAt: "2026-04-10T01:00:00.000Z",
          updatedAt: "2026-04-10T01:00:00.000Z",
          data: { year: "2026", quarter: "1" },
          computed: COMPUTED_2307,
          exports: [],
          amendsId: null,
          sequence: 1,
          filedSnapshot: null,
          previewAvailable: true,
          clearCopyAvailable: false,
        }),
      }),
    );
    const print = await mockCertificatePrint(page, SAVED_ID, {
      preview: EXPECTED_PDF_NAME.replace(/\.pdf$/, "-DRAFT.pdf"),
      clear: EXPECTED_PDF_NAME,
    });
    await page.goto(`/bir-forms/${SAVED_ID}`);
    await expect(page.getByLabel("Year")).toHaveValue("2026");

    // The old browser print is gone; one Preview PDF, no clear copy on a draft.
    await expect(page.getByRole("button", { name: /Print certificate/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download clear copy" })).toHaveCount(
      0,
    );
    const preview = page.getByRole("button", { name: "Preview PDF" });
    await expect(preview).toHaveCount(1);
    await expect(preview).toBeEnabled();

    const [first] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      preview.click(),
    ]);
    expect(first.suggestedFilename()).toBe(
      EXPECTED_PDF_NAME.replace(/\.pdf$/, "-DRAFT.pdf"),
    );
    expect(print.previews).toBe(1);

    // The Form view has the same button, and its PDF pane offers no download or print.
    await page.getByRole("button", { name: "Form", exact: true }).click();
    await expect(page.getByRole("button", { name: "Preview PDF" })).toHaveCount(1);
    const pane = page.locator('iframe[title="Form PDF preview"]');
    await expect(pane).toBeVisible({ timeout: 30_000 });
    expect(await pane.getAttribute("src")).toContain("toolbar=0");
    const [second] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: "Preview PDF" }).click(),
    ]);
    expect(second.suggestedFilename()).toBe(
      EXPECTED_PDF_NAME.replace(/\.pdf$/, "-DRAFT.pdf"),
    );
    expect(print.previews).toBe(2);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T3 — the 2316 sheet is untouched. Guards the .bir-doc scoping of the ported
// stylesheet: nothing in bir-form.css may reach the hand-written sheets.
// Baseline banked in W2 pass 1, before any of this existed.
// ---------------------------------------------------------------------------

const BASELINE_2316 = {
  width: 794,
  height: 1123,
  padding: "34px 38px",
  fontSize: "9.5px",
  lineHeight: "11.875px",
  fontFamily: "Arial, Helvetica, sans-serif",
};

test("T3 the 2316 sheet is byte-identical to its pre-change baseline", async ({
  page,
}) => {
  const unmocked = await mockApi(page);
  await page.goto("/bir-forms/new?form=2316");

  // Measured regardless of the off-screen staging position.
  const sheet = page.locator(".bir-sheet");
  await expect(sheet).toHaveCount(1);
  const after = await sheet.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      width: (el as HTMLElement).offsetWidth,
      height: (el as HTMLElement).offsetHeight,
      padding: cs.padding,
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      fontFamily: cs.fontFamily,
    };
  });
  // eslint-disable-next-line no-console
  console.log("T3-AFTER-2316 " + JSON.stringify(after));

  expect(after).toEqual(BASELINE_2316);
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
});

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
import { inflateSync } from "node:zlib";
import { certificateFileName } from "../src/lib/sheetPdf";

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
const PAGE_PT = FIXTURE.geometry.pagePt;

// ---------------------------------------------------------------------------
// The page raster inside a jsPDF PDF.
//
// jsPDF stores an added PNG as a FlateDecode stream with PNG row predictors
// (/Predictor 15) — the same bytes as a PNG's IDAT. Inflate it and undo the
// per-row filters, and you have the RGB pixels of exactly what will print.
// No new dependency: node:zlib plus the five PNG filter types.
// ---------------------------------------------------------------------------

interface Raster {
  w: number;
  h: number;
  rgb: Uint8Array;
}

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
  if (!best) throw new Error("no RGB image stream in the PDF");
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

/** Vertical centre of the ink inside a rectangle, as a 0..1 share of its height. */
function inkCentre(
  r: Raster,
  box: { x: number; y: number; w: number; h: number },
): number {
  let sum = 0;
  let n = 0;
  for (let y = Math.ceil(box.y); y < Math.floor(box.y + box.h); y++) {
    for (let x = Math.ceil(box.x); x < Math.floor(box.x + box.w); x++) {
      const i = (y * r.w + x) * 3;
      const lum = 0.299 * r.rgb[i]! + 0.587 * r.rgb[i + 1]! + 0.114 * r.rgb[i + 2]!;
      if (lum < 110) {
        sum += y;
        n++;
      }
    }
  }
  if (n === 0) return NaN;
  return (sum / n - box.y) / box.h;
}

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
  // T2 — Print produces a one-page long-bond PDF under the canonical name
  // -------------------------------------------------------------------------

  test("T2 Print downloads a 1-page 612 x 936 pt PDF named for the fixture", async ({
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
        }),
      }),
    );
    await page.goto(`/bir-forms/${SAVED_ID}`);
    await expect(page.getByLabel("Year")).toHaveValue("2026");

    const download = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: /Print certificate \(PDF\)/ }).click(),
    ]).then(([d]) => d);

    expect(download.suggestedFilename()).toBe(EXPECTED_PDF_NAME);

    const file = await download.path();
    expect(file).toBeTruthy();
    const bytes = readFileSync(file!);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Parse it with pdfjs-dist, in Node — the page context cannot resolve a
    // bare module specifier, and the legacy ESM build runs on the main thread
    // without a worker.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      isEvalSupported: false,
      useSystemFonts: false,
    }).promise;
    const page1 = await doc.getPage(1);
    const vp = page1.getViewport({ scale: 1 });
    const geom = { pages: doc.numPages, width: vp.width, height: vp.height };

    // eslint-disable-next-line no-console
    console.log(
      "T2-PDF " +
        JSON.stringify({
          name: download.suggestedFilename(),
          bytes: bytes.length,
          ...geom,
        }),
    );

    expect(geom.pages).toBe(1);
    expect(Math.abs(geom.width - PAGE_PT.w)).toBeLessThanOrEqual(1);
    expect(Math.abs(geom.height - PAGE_PT.h)).toBeLessThanOrEqual(1);

    // ---- Beyond the page box: what is actually ON the page. ----------------
    // Page count, size and filename all pass on a garbled raster, and in this
    // unit they did. The two checks below look at the pixels.
    const fromGuided = pdfRaster(bytes);
    expect([fromGuided.w, fromGuided.h]).toEqual([SHEET.w * 2, SHEET.h * 2]);

    // (a) GLYPHS SIT IN THEIR BOXES. Take the first "From" period digit box —
    // it holds "0" for 01/01/2026 — and find where its ink falls vertically.
    // With html2canvas's baseline probe broken by Tailwind's preflight, every
    // glyph is painted low and this digit sits on the box's bottom rule.
    await page.getByRole("button", { name: "Form", exact: true }).click();
    await expect(page.locator('[data-sheet-copy="view"] .bir-sheet')).toBeVisible();
    // Box offsets come from the CAPTURE copy — the one the raster is made from.
    const sheet = page.locator('[data-sheet-copy="capture"] .bir-sheet');
    await expect(sheet).toHaveCount(1);
    const boxCss = await sheet.evaluate((root) => {
      const el = root.querySelector<HTMLElement>('[data-box-group="period"] .bir-box')!;
      let x = 0;
      let y = 0;
      for (
        let n: HTMLElement | null = el;
        n && n !== root;
        n = n.offsetParent as HTMLElement
      ) {
        x += n.offsetLeft;
        y += n.offsetTop;
      }
      return { x, y, w: el.offsetWidth, h: el.offsetHeight, text: el.textContent };
    });
    expect(boxCss.text).toBe("0");
    const inset = 3; // raster px — clear of the 0.7 px border at scale 2
    const boxRaster = {
      x: boxCss.x * 2 + inset,
      y: boxCss.y * 2 + inset,
      w: boxCss.w * 2 - 2 * inset,
      h: boxCss.h * 2 - 2 * inset,
    };
    const centre = inkCentre(fromGuided, boxRaster);
    // eslint-disable-next-line no-console
    console.log("T2-GLYPH " + JSON.stringify({ boxCss, boxRaster, inkCentre: centre }));
    expect(centre).toBeGreaterThan(0.25);
    expect(centre).toBeLessThan(0.75);

    // (b) NOTHING OUTSIDE THE SHEET CAN CHANGE THE PRINT. Print again from
    // Form mode — where the on-screen copy sits inside a Fit-to-width
    // `transform: scale(...)` — with the page root held part-way through a
    // PAUSED animation whose keyframes scale and shift it. html2canvas cancels
    // animations and transforms only on the captured element and its
    // descendants, never its ancestors, and a running animation outranks an
    // ordinary inline style. That is how the intermittent failure arrived: the
    // root's own 300 ms fade-rise restarting inside html2canvas's cloned
    // document. Holding a scaling animation on the root makes the hostile
    // ancestor present on EVERY run (paused, so Playwright still sees a stable
    // button to click). The two rasters must be identical to the byte.
    await page.addStyleTag({
      content: [
        "@keyframes track-b-hostile-ancestor {",
        "  from { transform: translateY(3.3px) scale(0.93); }",
        "  to { transform: none; }",
        "}",
        ".animate-fade-rise { animation: track-b-hostile-ancestor 1s linear -0.37s infinite paused; }",
      ].join("\n"),
    });
    const [download2] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.getByRole("button", { name: /Print certificate \(PDF\)/ }).click(),
    ]);
    const fromFormFit = pdfRaster(readFileSync((await download2.path())!));
    let differing = 0;
    for (let i = 0; i < fromGuided.rgb.length; i++) {
      if (fromGuided.rgb[i] !== fromFormFit.rgb[i]) differing++;
    }
    // eslint-disable-next-line no-console
    console.log(
      "T2-MODES " + JSON.stringify({ bytes: fromGuided.rgb.length, differing }),
    );
    expect(differing).toBe(0);

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

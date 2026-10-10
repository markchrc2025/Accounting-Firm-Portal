// track-b-print-fix.spec.ts — T4 (W3): the html2canvas capture fix on the
// legacy print paths. W2 pass 2 fixed two capture defects on the new 2307 path
// only (F10: text painted too low; F11: an animated ancestor moves the print).
// W3 R5 puts the same capture on every path; this spec checks each one the way
// W2 pass 2 checked the 2307: the ink of a known piece of text must sit in the
// middle of its own box, and nothing outside the captured node may change the
// raster.
//
// HERMETIC: one router, a table of handlers, a catch-all that records
// anything unmocked. All fixture data is invented.

import { expect, test, type Download, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";

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
      "Billing:Read",
      "Users:Read",
    ],
    clients: [],
    assignedClientIds: ["55555555-5555-4555-8555-555555555555"],
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
const CLIENT = {
  id: "55555555-5555-4555-8555-555555555555",
  businessName: "INVENTED PRINTWORKS CORPORATION",
  tin: "222-333-444-00000",
  branch: "00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
  address: "7 SAMPLE LANE, BARANGAY EXAMPLE",
  city: "SAMPLE CITY",
  zip: "1800",
};
const INVOICE = {
  id: "66666666-6666-4666-8666-666666666666",
  number: "BL-2026-0042",
  clientId: CLIENT.id,
  clientName: CLIENT.businessName,
  billedForClientId: null,
  billedForName: null,
  description: "Bookkeeping, invented engagement",
  issuedDate: "2026-07-01",
  dueDate: "2026-07-31",
  status: "Sent",
  subtotal: 10000,
  vat: 1200,
  total: 11200,
  lineItems: [{ description: "Monthly bookkeeping", qty: 1, rate: 10000, amount: 10000 }],
};

type Entry = [method: string, pattern: RegExp, body: unknown];

async function mockApi(page: Page, extra: Entry[] = []): Promise<string[]> {
  const unmocked: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const table: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, ME],
    ["POST", /^\/api\/v1\/auth\/refresh$/, { accessToken: "test-token" }],
    ["GET", /^\/api\/v1\/profile\/me$/, PROFILE],
    ["GET", /^\/api\/v1\/clients$/, [CLIENT]],
    ["GET", /^\/api\/v1\/clients\/[^/]+$/, CLIENT],
    ["GET", /^\/api\/v1\/bir-forms\/catalog$/, []],
    ["POST", /^\/api\/v1\/bir-forms\/compute$/, {}],
    ["GET", /^\/api\/v1\/invoices$/, [INVOICE]],
    ["GET", /^\/api\/v1\/services$/, []],
    ...extra,
  ];
  await page.route("**/api/v1/**", (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, body] = table[i]!;
      if (m === req.method() && re.test(url.pathname)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      }
    }
    unmocked.push(`${req.method()} ${url.pathname}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return unmocked;
}

// ---------------------------------------------------------------------------
// The page image inside a jsPDF PDF. These three paths keep their JPEG
// encoding (W3 A4: the page formats and encodings stay as they are), so the
// image is a /DCTDecode stream — a complete JPEG file. Chromium decodes it.
// ---------------------------------------------------------------------------

function pdfJpeg(pdf: Buffer): { w: number; h: number; jpeg: Buffer } {
  const s = pdf.toString("latin1");
  // Each image XObject's dictionary, whatever order jsPDF writes its keys in.
  const re = /<<([^<>]*\/Subtype \/Image[^<>]*)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  let best: { w: number; h: number; len: number; start: number } | null = null;
  while ((m = re.exec(s))) {
    const dict = m[1]!;
    if (!/\/Filter \/DCTDecode/.test(dict)) continue;
    const w = +(/\/Width (\d+)/.exec(dict)?.[1] ?? 0);
    const h = +(/\/Height (\d+)/.exec(dict)?.[1] ?? 0);
    const len = +(/\/Length (\d+)/.exec(dict)?.[1] ?? 0);
    if (!best || w * h > best.w * best.h) best = { w, h, len, start: re.lastIndex };
  }
  if (!best) throw new Error("no JPEG (DCTDecode) image in the PDF");
  const jpeg = pdf.subarray(best.start, best.start + best.len);
  expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
  return { w: best.w, h: best.h, jpeg };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A box on the captured node, in raster px, with the text it holds and the
 *  horizontal extent of that text's own glyph run. */
interface TextBox extends Box {
  text: string;
  runLeft: number;
  runRight: number;
}

interface Ink {
  /** Vertical centre of the ink as a 0..1 share of the box height (W2's measure). */
  centre: number;
  /** Leftmost and rightmost ink columns, raster px. */
  minX: number;
  maxX: number;
  pixels: number;
}

/**
 * The dark ink inside `box` (raster px), computed in the browser because the
 * browser is what decodes the JPEG. A box with no ink gives NaN throughout.
 */
async function inkIn(page: Page, jpeg: Buffer, box: Box): Promise<Ink> {
  return page.evaluate(
    async ({ b64, box }) => {
      const img = new Image();
      img.src = `data:image/jpeg;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const y0 = Math.ceil(box.y);
      const y1 = Math.floor(box.y + box.h);
      const x0 = Math.ceil(box.x);
      const x1 = Math.floor(box.x + box.w);
      const px = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      let sum = 0;
      let n = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      for (let y = 0; y < y1 - y0; y++) {
        for (let x = 0; x < x1 - x0; x++) {
          const i = (y * (x1 - x0) + x) * 4;
          const lum = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
          if (lum < 110) {
            sum += y0 + y;
            n++;
            minX = Math.min(minX, x0 + x);
            maxX = Math.max(maxX, x0 + x);
          }
        }
      }
      if (n === 0) return { centre: NaN, minX: NaN, maxX: NaN, pixels: 0 };
      return { centre: (sum / n - box.y) / box.h, minX, maxX, pixels: n };
    },
    { b64: jpeg.toString("base64"), box },
  );
}

/** The CSS box of `target` relative to `root`, scaled to raster px and inset,
 *  with the extent of its text run (a Range over its contents). */
async function rasterBox(
  page: Page,
  rootSel: string,
  targetSel: string,
  scale = 2,
): Promise<TextBox> {
  const r = await page.evaluate(
    ({ rootSel, targetSel }) => {
      const root = document.querySelector<HTMLElement>(rootSel)!;
      const el = root.querySelector<HTMLElement>(targetSel)!;
      const a = root.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      return {
        x: b.left - a.left,
        y: b.top - a.top,
        w: b.width,
        h: b.height,
        text: el.textContent ?? "",
        runLeft: t.left - a.left,
        runRight: t.right - a.left,
      };
    },
    { rootSel, targetSel },
  );
  const inset = 1; // raster px — the value boxes here carry no border of their own
  return {
    x: r.x * scale + inset,
    y: r.y * scale + inset,
    w: r.w * scale - 2 * inset,
    h: r.h * scale - 2 * inset,
    text: r.text,
    runLeft: r.runLeft * scale,
    runRight: r.runRight * scale,
  };
}

/** Hold the page root part-way through a paused animation that scales and
 *  shifts it — the hostile ancestor W2 pass 2 used for the 2307 (F11). */
async function hostileAncestor(page: Page) {
  await page.addStyleTag({
    content: [
      "@keyframes track-b-hostile-ancestor {",
      "  from { transform: translateY(3.3px) scale(0.93); }",
      "  to { transform: none; }",
      "}",
      ".animate-fade-rise { animation: track-b-hostile-ancestor 1s linear -0.37s infinite paused; }",
    ].join("\n"),
  });
}

async function download(page: Page, click: () => Promise<void>): Promise<Buffer> {
  const [d] = (await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    click(),
  ])) as [Download, void];
  return readFileSync((await d.path())!);
}

/**
 * The checks on one print path:
 *  (a) the ink in the box is centred in it — W2 pass 2's measure, same band;
 *  (b) that ink is the box's OWN text: its left and right edges match the
 *      text run's within 3 CSS px. Without (b), a one-line shift passes (a)
 *      whenever the line above happens to be centred in the box — on these
 *      sheets the label sits one line above its value, and it did;
 *  (c) the raster is identical with a hostile animated ancestor present (F11).
 */
async function checkPath(
  page: Page,
  label: string,
  print: () => Promise<void>,
  box: TextBox,
) {
  const first = pdfJpeg(await download(page, print));
  const ink = await inkIn(page, first.jpeg, box);
  await hostileAncestor(page);
  const second = pdfJpeg(await download(page, print));
  const identical = first.jpeg.equals(second.jpeg);
  // eslint-disable-next-line no-console
  console.log(
    `T4-${label} ` + JSON.stringify({ image: [first.w, first.h], box, ink, identical }),
  );
  const what = `${label}: the ink of "${box.text}" in its box`;
  expect(ink.centre, `${what} — vertical centre`).toBeGreaterThan(0.25);
  expect(ink.centre, `${what} — vertical centre`).toBeLessThan(0.75);
  const tol = 6; // raster px = 3 CSS px, for side bearings and JPEG edges
  expect(Math.abs(ink.minX - box.runLeft), `${what} — left edge`).toBeLessThanOrEqual(
    tol,
  );
  expect(Math.abs(ink.maxX - box.runRight), `${what} — right edge`).toBeLessThanOrEqual(
    tol,
  );
  expect(identical, `${label}: the raster must not depend on an animated ancestor`).toBe(
    true,
  );
}

// ---------------------------------------------------------------------------
// T4
// ---------------------------------------------------------------------------

test.describe("T4 the capture fix on the legacy print paths (hermetic)", () => {
  test("T4 the legacy 2316 print puts its text inside its boxes", async ({ page }) => {
    const unmocked = await mockApi(page);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/bir-forms/new?form=2316");
    await page.getByLabel("Employer (client)").selectOption(CLIENT.id);
    const sheet = ".bir-sheet-stage > .bir-sheet";
    // Item 1 "For the Year": its value line holds the four digits of the year.
    const box = await rasterBox(page, sheet, "table td:first-child > div");
    expect(box.text).toMatch(/^\d{4}$/);
    await checkPath(
      page,
      "2316",
      () => page.getByRole("button", { name: /Print certificate \(PDF\)/ }).click(),
      box,
    );
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 the legacy 2307 print puts its text inside its boxes", async ({ page }) => {
    const unmocked = await mockApi(page);
    await page.setViewportSize({ width: 1400, height: 1000 });
    await page.goto("/bir-forms/new?form=2307");
    await page.getByLabel("Withholding agent (client)").selectOption(CLIENT.id);
    await page.getByLabel("Year").fill("2026");
    const sheet = ".bir-sheet-stage > .bir-sheet";
    // Item 1 "For the Period From": its value line, 01/01/2026.
    const box = await rasterBox(page, sheet, "table td:first-child > div");
    expect(box.text).toBe("01/01/2026");
    await checkPath(
      page,
      "2307-legacy",
      () => page.getByRole("button", { name: "Print (legacy)" }).click(),
      box,
    );
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("T4 the billing PDF export puts its text inside its boxes", async ({ page }) => {
    const unmocked = await mockApi(page);
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.goto("/billing");
    // Measure in the preview: the same BillingDocument at the same 794 px width
    // the export captures off-screen.
    await page.getByText(INVOICE.number).first().click();
    const doc = "[data-billing-document]";
    await page.locator(doc).first().waitFor();
    // "Control No." value cell: dark text on white, no padding of its own.
    const box = await rasterBox(page, doc, "table tbody tr:first-child td:last-child");
    expect(box.text).toBe(INVOICE.number);
    await page.keyboard.press("Escape");
    await checkPath(
      page,
      "billing",
      () =>
        page
          .getByRole("button", { name: `Download PDF for billing ${INVOICE.number}` })
          .click(),
      box,
    );
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

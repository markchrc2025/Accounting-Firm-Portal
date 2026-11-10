// track-c-c8-2307-block-b.spec.ts — hermetic browser tests for C8: block B entry in the 2307
// editor (the money payments subject to withholding of business tax) and the ATC picker over
// the seeded table, in both blocks.
//
// HERMETIC BY CONSTRUCTION: every /api/v1 call is mocked and a catch-all FAILS the test on
// any call that is not. The "server" keeps the certificate in a variable, so a save and a
// reload really round-trip the data. All data is invented: no real name, TIN, address, phone
// or email.

import { expect, test, type Page, type Route } from "@playwright/test";
import { mockAtcCodes } from "./helpers/atc-codes";
import { mockCertificatePrint } from "./helpers/certificate-print";

const ME = {
  user: {
    id: "11111111-1111-4111-8111-1111111111c8",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: "22222222-2222-4222-8222-2222222222c8",
    mfaEnabled: false,
  },
  permissions: {
    global: ["BirForms:Read", "BirForms:Create", "BirForms:Update", "Clients:Read"],
    clients: [],
    assignedClientIds: [],
    canViewAllClients: true,
  },
};
const CLIENT = {
  id: "33333333-3333-4333-8333-3333333333c8",
  businessName: "INVENTED C8 DISPLAY NAME",
  kind: "non-individual",
  regName: "INVENTED C8 REGISTERED CORPORATION",
  tin: "000-111-222-00000",
  branch: "00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
  address: "12 INVENTED STREET",
  city: "SAMPLE CITY",
  zip: "1600",
};
const FORM_ID = "f8000000-0000-4000-8000-0000000000c8";
const DRAFT = "000111222000-2307-2026-Q1-DRAFT.pdf";
const CLEAR = "000111222000-2307-2026-Q1.pdf";

/** Integer centavos of a typed amount: the exact arithmetic the server uses. */
const cents = (v: unknown) => {
  const s = String(v ?? "")
    .replace(/,/g, "")
    .trim();
  if (s === "") return 0;
  const [p = "0", c = ""] = s.split(".");
  return Number(p) * 100 + Number(c.padEnd(2, "0").slice(0, 2));
};
function blockOf(rows: Record<string, unknown>[] = []) {
  const sum = (k: string) => rows.reduce((t, r) => t + cents(r[k]), 0);
  const total = rows.map((r) => cents(r.m1) + cents(r.m2) + cents(r.m3));
  return {
    rows: total.map((t) => ({ total: t / 100 })),
    totalIncome: total.reduce((a, b) => a + b, 0) / 100,
    totalTax: sum("tax") / 100,
    tM1: sum("m1") / 100,
    tM2: sum("m2") / 100,
    tM3: sum("m3") / 100,
  };
}

function certificate(data: Record<string, unknown> = {}) {
  return {
    id: FORM_ID,
    clientId: CLIENT.id,
    clientName: CLIENT.businessName,
    form: "2307",
    status: "draft",
    period: "2026-Q1",
    filedAt: null,
    createdAt: "2026-04-10T01:00:00.000Z",
    updatedAt: "2026-04-10T01:00:00.000Z",
    data: {
      year: "2026",
      quarter: "1",
      payeeName: "INVENTED PAYEE, ALEX",
      payeeTin: "444-555-666",
      payeeBranch: "00000",
      rows: [
        { atc: "WI010", desc: "FEES", m1: "1,234.56", m2: "", m3: "", tax: "61.73" },
      ],
      ...data,
    },
    computed: null,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
    previewAvailable: true,
    clearCopyAvailable: false,
  };
}

/** The mocked server: one certificate in a variable, saved and read back. */
async function mockServer(page: Page, start: ReturnType<typeof certificate>) {
  const unmocked: string[] = [];
  const state = { form: start, saves: [] as Record<string, unknown>[] };
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
  const json = (route: Route, body: unknown) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/api/v1/**", (r) => {
    unmocked.push(`${r.request().method()} ${new URL(r.request().url()).pathname}`);
    return r.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  await page.route("**/api/v1/auth/me", (r) => json(r, ME));
  await page.route("**/api/v1/auth/refresh", (r) =>
    json(r, { accessToken: "test-token" }),
  );
  await page.route("**/api/v1/profile/me", (r) =>
    json(r, { ...ME.user, avatarUrl: null }),
  );
  await page.route("**/api/v1/clients", (r) => json(r, [CLIENT]));
  await page.route("**/api/v1/clients/*", (r) => json(r, CLIENT));
  await page.route("**/api/v1/bir-forms/catalog", (r) => json(r, []));
  await mockAtcCodes(page);
  await page.route("**/api/v1/bir-forms/compute", (r) => {
    const body = r.request().postDataJSON() as { data: Record<string, unknown> };
    return json(r, {
      ...blockOf(body.data.rows as Record<string, unknown>[]),
      blockB: blockOf(body.data.rowsB as Record<string, unknown>[]),
    });
  });
  await page.route(`**/api/v1/bir-forms/${FORM_ID}`, (r) => {
    if (r.request().method() === "PATCH") {
      const body = r.request().postDataJSON() as { data?: Record<string, unknown> };
      if (body.data) {
        state.saves.push(body.data);
        state.form = { ...state.form, data: body.data as never };
      }
      return json(r, state.form);
    }
    return json(r, state.form);
  });
  const prints = await mockCertificatePrint(page, FORM_ID, {
    preview: DRAFT,
    clear: CLEAR,
  });
  return { unmocked, state, prints };
}

const atcA = (p: Page, n = 1) => p.getByLabel(`ATC, row ${n}`, { exact: true });
const atcB = (p: Page, n = 1) => p.getByLabel(`ATC, block B row ${n}`, { exact: true });

/** Open a picker, search, and choose the one code whose text matches. */
async function pick(
  page: Page,
  picker: ReturnType<typeof atcB>,
  search: string,
  code: string,
) {
  await picker.click();
  await picker.fill(search);
  await page.getByTestId("atc-option").filter({ hasText: code }).click();
  await expect(picker).toHaveValue(code);
}

test.describe("C8 block B entry and the ATC picker (hermetic)", () => {
  test("add a block B row with a chosen ATC, save, reload: it is still there, and Preview PDF is offered", async ({
    page,
  }) => {
    const { unmocked, state, prints } = await mockServer(page, certificate());
    await page.setViewportSize({ width: 1600, height: 1200 });
    await page.goto(`/bir-forms/${FORM_ID}`);
    await expect(page.getByLabel("Payee name")).toHaveValue("INVENTED PAYEE, ALEX");
    await expect(atcB(page)).toHaveCount(0);

    await page.getByRole("button", { name: "+ Add block B line" }).click();
    await expect(atcB(page)).toHaveValue("");
    // Search by description, choose from the table; block B offers WB and WV by classification.
    await atcB(page).click();
    await atcB(page).fill("carriers");
    await expect(page.getByTestId("atc-option")).toHaveCount(1);
    await expect(page.getByTestId("atc-option")).toContainText("WB030");
    await expect(page.getByTestId("atc-option")).toContainText("3%");
    await atcB(page).fill("");
    const codes = await page.getByTestId("atc-option").allTextContents();
    expect(codes.map((t) => t.slice(0, 5))).toEqual(["WB030", "WB040", "WV010", "WV012"]);
    await page.getByTestId("atc-option").filter({ hasText: "WB030" }).click();
    await expect(atcB(page)).toHaveValue("WB030");

    await page.getByLabel("1st month, block B row 1").fill("0.1");
    await page.getByLabel("2nd month, block B row 1").fill("0.2");
    await page.getByLabel("3rd month, block B row 1").fill("0.3");
    await page.getByLabel("Tax withheld, block B row 1").fill("7.77");
    await page.getByLabel("Income payment, block B row 1").fill("TAX ON CARRIERS");
    // The total is the exact sum, and the tax stays what was typed (3% of 0.60 it is not).
    await expect(page.getByTestId("part3-total-B-1")).toContainText("0.60");
    await expect(page.getByLabel("Tax withheld, block B row 1")).toHaveValue("7.77");
    await expect(page.getByTestId("block-b-totals")).toContainText("7.77");

    // Not saved yet: printing asks to save first; after saving, it is offered.
    await expect(page.getByRole("button", { name: "Preview PDF" })).toBeDisabled();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => state.saves.length).toBe(1);
    expect(state.saves[0]!.rowsB).toEqual([
      {
        atc: "WB030",
        desc: "TAX ON CARRIERS",
        m1: "0.1",
        m2: "0.2",
        m3: "0.3",
        tax: "7.77",
      },
    ]);
    // Block A was saved exactly as it was.
    expect(state.saves[0]!.rows).toEqual([
      { atc: "WI010", desc: "FEES", m1: "1,234.56", m2: "", m3: "", tax: "61.73" },
    ]);

    await page.reload();
    await expect(atcB(page)).toHaveValue("WB030");
    await expect(page.getByLabel("3rd month, block B row 1")).toHaveValue("0.3");
    await expect(page.getByLabel("Income payment, block B row 1")).toHaveValue(
      "TAX ON CARRIERS",
    );
    await expect(page.getByTestId("part3-total-B-1")).toContainText("0.60");
    // The replica carries the row on block B, with its total.
    const sheet = page
      .locator(
        '[data-sheet-copy="view"] .bir-sheet, [data-sheet-copy="capture"] .bir-sheet',
      )
      .first();
    await expect(sheet.locator('[data-p3-row="B"]').first()).toContainText("WB030");
    await expect(sheet.locator('[data-total-row="B"]')).toContainText("0.60");

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("button", { name: "Preview PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(DRAFT);
    expect(prints.previews).toBe(1);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("a third decimal is refused in both blocks; the figure stays as it was", async ({
    page,
  }) => {
    const { unmocked } = await mockServer(page, certificate());
    await page.goto(`/bir-forms/${FORM_ID}`);
    await page.getByRole("button", { name: "+ Add block B line" }).click();
    const m1 = page.getByLabel("1st month, block B row 1");
    await m1.fill("12.34");
    await m1.fill("12.345");
    await expect(m1).toHaveValue("12.34");
    await expect(page.getByTestId("third-decimal")).toHaveText(
      "Amounts have pesos and centavos only: a third decimal is not accepted.",
    );
    await m1.fill("12.3");
    await expect(page.getByTestId("third-decimal")).toHaveCount(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("an old draft with a typed ATC the table does not have still opens: it is shown as saved, flagged, and still prints", async ({
    page,
  }) => {
    const { unmocked, prints } = await mockServer(
      page,
      certificate({
        rows: [{ atc: "WI999", desc: "OLD LINE", m1: "100", m2: "", m3: "", tax: "5" }],
      }),
    );
    await page.goto(`/bir-forms/${FORM_ID}`);
    await expect(atcA(page)).toHaveValue("WI999");
    await expect(page.getByTestId("atc-note")).toHaveText(
      "ATC WI999 is not in the BIR ATC table. It is shown as it was saved.",
    );
    // No block B row, nothing about block B on a certificate that never had one.
    await expect(atcB(page)).toHaveCount(0);
    await expect(page.getByTestId("block-b-totals")).toHaveCount(0);
    // Opening and abandoning the picker does not lose the saved code.
    await atcA(page).click();
    await atcA(page).fill("wc0");
    await atcA(page).blur();
    await expect(atcA(page)).toHaveValue("WI999");
    // It prints as saved.
    await expect(page.getByRole("button", { name: "Preview PDF" })).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.getByRole("button", { name: "Preview PDF" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(DRAFT);
    expect(prints.previews).toBe(1);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("the picker never fills an ATC by itself: typing amounts, opening, searching and closing leave a row without an ATC; issuing is blocked until one is chosen", async ({
    page,
  }) => {
    const { unmocked } = await mockServer(
      page,
      certificate({
        rows: [{ atc: "", desc: "", m1: "100", m2: "", m3: "", tax: "" }],
      }),
    );
    await page.goto(`/bir-forms/${FORM_ID}`);
    await expect(atcA(page)).toHaveValue("");
    await page.getByRole("button", { name: "+ Add block B line" }).click();
    await page.getByLabel("1st month, block B row 1").fill("50");
    await page.getByLabel("Tax withheld, block B row 1").fill("1.5");
    await expect(atcB(page)).toHaveValue("");
    // open, search, escape: still empty, nothing chosen
    await atcB(page).click();
    await atcB(page).fill("franchise");
    await expect(page.getByTestId("atc-option")).toHaveCount(1);
    await atcB(page).press("Escape");
    await atcB(page).blur();
    await expect(atcB(page)).toHaveValue("");
    await expect(atcA(page)).toHaveValue("");
    // The table rate is information only: choosing WB040 (2%) fills no amount.
    await pick(page, atcB(page), "franchise", "WB040");
    await expect(page.getByTestId("atc-reference")).toContainText("table rate 2%");
    await expect(page.getByLabel("Tax withheld, block B row 1")).toHaveValue("1.5");
    // A chosen ATC can be cleared on purpose.
    await atcB(page).click();
    await page.getByTestId("atc-clear").click();
    await expect(atcB(page)).toHaveValue("");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("block A offers the expanded-withholding codes from the table, by search on code or description", async ({
    page,
  }) => {
    const { unmocked } = await mockServer(
      page,
      certificate({ rows: [{ atc: "", desc: "", m1: "", m2: "", m3: "", tax: "" }] }),
    );
    await page.goto(`/bir-forms/${FORM_ID}`);
    await atcA(page).click();
    const all = await page.getByTestId("atc-option").allTextContents();
    expect(all.map((t) => t.slice(0, 5))).toEqual([
      "WI010",
      "WI011",
      "WI158",
      "WC010",
      "WC158",
      "WC650",
    ]);
    await atcA(page).fill("top withholding");
    await expect(page.getByTestId("atc-option")).toHaveCount(2);
    await atcA(page).fill("wc1");
    await expect(page.getByTestId("atc-option")).toHaveCount(1);
    await page.getByTestId("atc-option").click();
    await expect(atcA(page)).toHaveValue("WC158");
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

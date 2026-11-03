// track-c-c7-2307.spec.ts — hermetic browser tests for C7 (D56): the 2307 prints on the
// BIR's own blank through the server. "Preview PDF" while a draft, "Download clear copy"
// once issued; the old browser-made PDF button is gone.
//
// HERMETIC BY CONSTRUCTION: every /api/v1 call is mocked and a catch-all FAILS the test on
// any call that is not. All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Route } from "@playwright/test";
import { mockCertificatePrint } from "./helpers/certificate-print";

const ME = {
  user: {
    id: "11111111-1111-4111-8111-1111111111c7",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: "22222222-2222-4222-8222-2222222222c7",
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
  id: "33333333-3333-4333-8333-3333333333c7",
  businessName: "INVENTED C7 DISPLAY NAME",
  kind: "non-individual",
  regName: "INVENTED C7 REGISTERED CORPORATION",
  tin: "000-111-222-00000",
  branch: "00000",
  taxType: "VAT",
  currency: "PHP",
  status: "Active",
  address: "12 INVENTED STREET",
  city: "SAMPLE CITY",
  zip: "1600",
};
const COMPUTED = {
  rows: [{ total: 1234.56 }],
  totalIncome: 1234.56,
  totalTax: 61.73,
  tM1: 1234.56,
  tM2: 0,
  tM3: 0,
};
const CLEAR = "000111222000-2307-2026-Q1.pdf";
const DRAFT = "000111222000-2307-2026-Q1-DRAFT.pdf";

function form(
  id: string,
  over: Record<string, unknown>,
  data: Record<string, unknown> = {},
) {
  return {
    id,
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
        { atc: "WI010", desc: "Fees", m1: "1,234.56", m2: "", m3: "", tax: "61.73" },
      ],
      ...data,
    },
    computed: COMPUTED,
    exports: [],
    amendsId: null,
    sequence: 1,
    filedSnapshot: null,
    previewAvailable: false,
    clearCopyAvailable: false,
    ...over,
  };
}

async function mockApi(page: Page, f?: ReturnType<typeof form>): Promise<string[]> {
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
  await page.route("**/api/v1/bir-forms/compute", (r) => json(r, COMPUTED));
  if (f) await page.route(`**/api/v1/bir-forms/${f.id}`, (r) => json(r, f));
  return unmocked;
}

const preview = (p: Page) => p.getByRole("button", { name: "Preview PDF" });
const clear = (p: Page) => p.getByRole("button", { name: "Download clear copy" });
const old = (p: Page) => p.getByRole("button", { name: /Print certificate/ });

test.describe("C7 the 2307 prints on the BIR's own blank (hermetic)", () => {
  test("a saved draft: Preview PDF only; one POST; the server's file under the certificate's name", async ({
    page,
  }) => {
    const f = form("f7000000-0000-4000-8000-0000000000d1", { previewAvailable: true });
    const unmocked = await mockApi(page, f);
    const calls = await mockCertificatePrint(page, f.id, {
      preview: DRAFT,
      clear: CLEAR,
    });
    await page.goto(`/bir-forms/${f.id}`);
    await expect(page.getByLabel("Payee name")).toHaveValue("INVENTED PAYEE, ALEX");
    await expect(preview(page)).toBeEnabled();
    await expect(clear(page)).toHaveCount(0);
    await expect(old(page)).toHaveCount(0);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      preview(page).click(),
    ]);
    expect(download.suggestedFilename()).toBe(DRAFT);
    expect(calls.previews).toBe(1);
    expect(calls.clearCopies).toBe(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("a certificate not saved yet: Preview PDF is disabled and says why; nothing is sent", async ({
    page,
  }) => {
    const unmocked = await mockApi(page);
    await page.goto("/bir-forms/new?form=2307");
    await expect(preview(page)).toBeDisabled();
    await expect(preview(page)).toHaveAttribute(
      "title",
      "Save the certificate before printing.",
    );
    await expect(clear(page)).toHaveCount(0);
    await expect(old(page)).toHaveCount(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("an issued certificate: Download clear copy only; the file keeps its name; it can be taken again", async ({
    page,
  }) => {
    const f = form("f7000000-0000-4000-8000-0000000000d2", {
      status: "filed",
      filedAt: "2026-04-20T02:15:00.000Z",
      clearCopyAvailable: true,
    });
    const unmocked = await mockApi(page, f);
    const calls = await mockCertificatePrint(page, f.id, {
      preview: DRAFT,
      clear: CLEAR,
    });
    await page.goto(`/bir-forms/${f.id}`);
    await expect(clear(page)).toBeEnabled();
    await expect(preview(page)).toHaveCount(0);
    await expect(old(page)).toHaveCount(0);
    for (let n = 1; n <= 2; n++) {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30_000 }),
        clear(page).click(),
      ]);
      expect(download.suggestedFilename()).toBe(CLEAR);
      await expect.poll(() => calls.clearCopies).toBe(n);
    }
    expect(calls.previews).toBe(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("a certificate issued before the replica (no 4A, 5, branch or block B) still reprints", async ({
    page,
  }) => {
    const f = form(
      "f7000000-0000-4000-8000-0000000000d3",
      { status: "filed", filedAt: "2026-04-20T02:15:00.000Z", clearCopyAvailable: true },
      {
        payeeBranch: undefined,
        payeeZip: undefined,
        payeeForeignAddress: undefined,
        rowsB: undefined,
        payorName: "OLD SIGNER",
        payorTitle: "OWNER",
      },
    );
    const unmocked = await mockApi(page, f);
    const calls = await mockCertificatePrint(page, f.id, {
      preview: DRAFT,
      clear: CLEAR,
    });
    await page.goto(`/bir-forms/${f.id}`);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      clear(page).click(),
    ]);
    expect(download.suggestedFilename()).toBe(CLEAR);
    expect(calls.clearCopies).toBe(1);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });

  test("an issued certificate the server has no print for offers neither button", async ({
    page,
  }) => {
    const f = form("f7000000-0000-4000-8000-0000000000d4", {
      status: "filed",
      filedAt: "2026-04-20T02:15:00.000Z",
    });
    const unmocked = await mockApi(page, f);
    await page.goto(`/bir-forms/${f.id}`);
    await expect(page.getByLabel("Payee name")).toHaveValue("INVENTED PAYEE, ALEX");
    await expect(clear(page)).toHaveCount(0);
    await expect(preview(page)).toHaveCount(0);
    await expect(old(page)).toHaveCount(0);
    expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  });
});

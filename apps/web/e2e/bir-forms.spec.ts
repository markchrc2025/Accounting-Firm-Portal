import { expect, test } from "@playwright/test";

/**
 * BIR Forms end-to-end: author a return, watch the server compute it live, mark
 * it filed, and confirm the filed figures land on the client's tax view — the
 * guardrail-#1 path that makes a generated form authoritative over the estimate.
 *
 * Requires a running API with the smoke seed (admin user + a client). Opt-in via
 * RUN_API_E2E=1 so the default suite stays hermetic, matching financial.spec.ts.
 */
const apiE2e = process.env.RUN_API_E2E === "1";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@firm.test");
  await page.getByLabel("Password").fill("ChangeMe123!");
  await page.getByRole("button", { name: /Sign in/i }).click();
  await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
}

test.describe("BIR Forms (requires API)", () => {
  test.skip(!apiE2e, "set RUN_API_E2E=1 with the API + seed running");

  test("the catalog lists all nine forms and marks the certificates print-only", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/bir-forms");
    await expect(page.getByRole("heading", { name: "BIR Forms" })).toBeVisible();

    // Every form is available; the two certificates print rather than export XML.
    for (const code of ["2551Q", "2550Q", "1701Q", "1701A", "1701", "1702Q", "1702RT", "2307", "2316"]) {
      await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText("Print to PDF").first()).toBeVisible();
    await expect(page.getByText("eBIRForms XML").first()).toBeVisible();
  });

  test("author a 2551Q, compute it live, file it, and see it on the client tax view", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/bir-forms/new?form=2551Q");
    await expect(page.getByRole("heading", { name: "New 2551Q" })).toBeVisible();

    // Pick the first real client in the selector.
    const clientSelect = page.getByLabel("Client");
    await clientSelect.selectOption({ index: 1 });
    const clientName = await clientSelect.locator("option:checked").textContent();

    await page.getByLabel("Year").fill("2026");
    await page.getByLabel("Quarter").selectOption("Q1");

    // ₱1,000,000 taxable at 3% → ₱30,000 due. The browser never computes this;
    // the figure below proves the server round-trip.
    await page.getByRole("row").filter({ hasText: "PT010" }).getByRole("spinbutton").first().fill("1000000");
    await expect(page.getByText("₱30,000.00").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /Save draft/i }).click();
    await expect(page.getByRole("heading", { name: "2551Q" })).toBeVisible();

    // File it — this is what publishes the figures as authoritative.
    await page.getByRole("button", { name: /Mark as filed/i }).click();
    await expect(page.getByText(/These figures are now the/i)).toBeVisible();

    // The filed form now shows under the Filed tab.
    await page.goto("/bir-forms");
    await page.getByRole("button", { name: "Filed", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: "2551Q" }).first()).toBeVisible();

    // …and its figures supersede the estimate on the client's tax page.
    await page.goto("/clients");
    await page.getByRole("link", { name: clientName!.trim() }).first().click();
    await page.getByRole("link", { name: /Tax/i }).first().click();
    await expect(page.getByText("Filed BIR forms")).toBeVisible();
    await expect(page.getByText("AUTHORITATIVE")).toBeVisible();
  });

  test("a 2307 certificate offers printing instead of XML export", async ({ page }) => {
    await signIn(page);
    await page.goto("/bir-forms/new?form=2307");
    await expect(page.getByRole("heading", { name: "New 2307" })).toBeVisible();

    // The editor states why there is no XML, and offers the PDF action instead.
    await expect(page.getByText(/issued to a payee/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Print certificate \(PDF\)/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Export eBIRForms XML/i })).toHaveCount(0);
  });
});

import { expect, test } from "@playwright/test";

/**
 * Phase 2 capture flow against a running API with a VAT client ("VatCo") and an
 * income category ("Consulting") already seeded by the smoke setup. Opt-in via
 * RUN_API_E2E=1 so the default suite stays hermetic.
 */
const apiE2e = process.env.RUN_API_E2E === "1";

test.describe("financial capture (requires API)", () => {
  test.skip(!apiE2e, "set RUN_API_E2E=1 with the API + seed running");

  test("record a VATABLE income for a VAT client via the regime-aware modal", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@firm.test");
    await page.getByLabel("Password").fill("ChangeMe123!");
    await page.getByRole("button", { name: /Sign in/i }).click();
    await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();

    await page.getByRole("link", { name: "VatCo" }).click();
    await expect(page.getByRole("heading", { name: "VatCo" })).toBeVisible();
    await expect(page.getByText(/VAT client/i)).toBeVisible();

    await page.getByRole("button", { name: /Add income/i }).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    // The VAT classification subform proves regime-aware rendering.
    await expect(modal.getByText("VAT class")).toBeVisible();

    const desc = `E2E consulting ${Date.now()}`;
    await modal.getByLabel("Description").fill(desc);
    await modal.getByLabel("Category").selectOption({ label: "Consulting" });
    await modal.getByLabel(/Net of VAT/i).fill("125000");
    await modal.getByRole("button", { name: "Save" }).click();

    // The new row appears in the list with its net amount.
    const row = page.getByRole("row", { name: new RegExp(desc) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("125,000");
    await expect(row).toContainText("VATABLE_12");
  });
});

import { expect, test } from "@playwright/test";

/**
 * Full sign-in flow against a running API + seeded admin. Skipped unless
 * RUN_API_E2E=1 so the default suite stays hermetic (no backend required).
 */
const apiE2e = process.env.RUN_API_E2E === "1";

test.describe("sign-in (requires API)", () => {
  test.skip(!apiE2e, "set RUN_API_E2E=1 with the API + seed running");

  test("admin can sign in and reach the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@firm.test");
    await page.getByLabel("Password").fill("ChangeMe123!");
    await page.getByRole("button", { name: /Sign in/i }).click();

    await expect(page.getByRole("heading", { name: /Dashboard/i })).toBeVisible();
    await expect(page.getByText(/admin@firm.test/i)).toBeVisible();
    await expect(page.getByText(/global permission/i)).toBeVisible();
  });
});

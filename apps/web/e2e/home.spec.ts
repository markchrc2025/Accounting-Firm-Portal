import { expect, test } from "@playwright/test";

test("home page renders the portal title and shared contract", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Accounting Firm Portal/i, level: 1 }),
  ).toBeVisible();
  // A value sourced from @portal/shared should be on the page.
  await expect(page.getByText("VATABLE_12")).toBeVisible();
  await expect(page.getByText("clients:read")).toBeVisible();
});

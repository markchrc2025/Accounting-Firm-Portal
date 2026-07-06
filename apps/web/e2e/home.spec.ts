import { expect, test } from "@playwright/test";

test("unauthenticated visitor lands on the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Accounting Firm Portal/i }),
  ).toBeVisible();
  await expect(page.getByText(/Sign in to continue/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Sign in/i })).toBeVisible();
});

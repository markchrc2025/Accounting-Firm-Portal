/**
 * track-c-m1-connector.spec.ts — M1 T5 (hermetic): the Integrations page's Claude
 * Connector card says who issued the link and who Claude acts as (R3, D41
 * amendment), in the three states of the diagnosis. Every API call is mocked;
 * every name is invented.
 *
 *   (i)   the never-rotated environment link, two Super Admins: no one acts — the
 *         refusal sentence and the advice to rotate;
 *   (ii)  A rotated the link: "Issued by A on <Manila date>. Claude acts as A.";
 *   (iii) A no longer qualifies: "Issued by A on <date>." — no one acts, the
 *         refusal sentence and the advice.
 */
import { expect, test, type Page, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222c1";
const SENTENCE =
  "More than one active Super Admin. Issue the connector key from the Portal's MCP " +
  "Connector page as the Super Admin Claude should act as.";
const ADVICE = "Rotate the link while signed in as the Super Admin Claude should act as.";
const SECRET = "m1-test-secret-not-a-real-key-0123456789";
const A = { name: "Invented Admin A", email: "admin-a@example.test" };
// 17:30 UTC on Oct 10 is 01:30 on Oct 11 in Manila: the card must say Oct 11.
const ISSUED_AT = "2026-10-10T17:30:00.000Z";

const ME = {
  user: {
    id: "u1100000-0000-4000-8000-0000000000c1",
    email: A.email,
    fullName: A.name,
    userType: "FIRM",
    firmId: FIRM_ID,
    mfaEnabled: true,
  },
  permissions: {
    global: [
      "IntegrationClient:Read",
      "IntegrationClient:Create",
      "IntegrationClient:Update",
      "IntegrationClient:Delete",
    ],
    clients: [],
    assignedClientIds: [],
    canViewAllClients: true,
  },
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockApi(page: Page, connector: Record<string, unknown>) {
  const unmocked: string[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    if (key === "GET /api/v1/auth/me") return json(route, ME);
    if (key === "POST /api/v1/auth/refresh")
      return json(route, { accessToken: "test-token" });
    if (key === "GET /api/v1/profile/me")
      return json(route, { ...ME.user, avatarUrl: null });
    if (key === "GET /api/v1/integrations") return json(route, []);
    if (key === "GET /api/v1/clients") return json(route, []);
    if (key === "GET /api/v1/mcp-connector") return json(route, connector);
    unmocked.push(key);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return unmocked;
}

test.describe("M1 T5 · the connector card says who Claude acts as (hermetic)", () => {
  test("(i) the environment link, two Super Admins: no one acts — the refusal sentence and the advice", async ({
    page,
  }) => {
    const unmocked = await mockApi(page, {
      enabled: true,
      source: "environment",
      secret: SECRET,
      issuedBy: null,
      issuedAt: null,
      actingAs: null,
      actingProblem: SENTENCE,
    });
    await page.goto("/settings/integrations");
    const problem = page.getByTestId("mcp-acting-problem");
    await expect(problem).toBeVisible();
    await expect(problem).toContainText(SENTENCE);
    await expect(problem).toContainText(ADVICE);
    await expect(page.getByTestId("mcp-acting-summary")).toHaveCount(0);
    await expect(page.getByText("Claude acts as")).toHaveCount(0);
    expect(unmocked).toEqual([]);
  });

  test("(ii) A rotated: issued by A on the Manila date, Claude acts as A", async ({
    page,
  }) => {
    const unmocked = await mockApi(page, {
      enabled: true,
      source: "portal",
      secret: SECRET,
      issuedBy: A,
      issuedAt: ISSUED_AT,
      actingAs: A,
      actingProblem: null,
    });
    await page.goto("/settings/integrations");
    await expect(page.getByTestId("mcp-acting-summary")).toHaveText(
      `Issued by ${A.name} on Oct 11, 2026. Claude acts as ${A.name}.`,
    );
    await expect(page.getByTestId("mcp-acting-problem")).toHaveCount(0);
    await expect(page.getByText(ADVICE)).toHaveCount(0);
    expect(unmocked).toEqual([]);
  });

  test("(iii) A no longer qualifies: issued by A, no one acts — the refusal sentence and the advice", async ({
    page,
  }) => {
    const unmocked = await mockApi(page, {
      enabled: true,
      source: "portal",
      secret: SECRET,
      issuedBy: A,
      issuedAt: ISSUED_AT,
      actingAs: null,
      actingProblem: SENTENCE,
    });
    await page.goto("/settings/integrations");
    await expect(page.getByTestId("mcp-acting-summary")).toHaveText(
      `Issued by ${A.name} on Oct 11, 2026.`,
    );
    const problem = page.getByTestId("mcp-acting-problem");
    await expect(problem).toContainText(SENTENCE);
    await expect(problem).toContainText(ADVICE);
    expect(unmocked).toEqual([]);
  });
});

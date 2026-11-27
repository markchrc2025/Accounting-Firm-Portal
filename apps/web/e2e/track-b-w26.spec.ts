// track-b-w26.spec.ts - hermetic browser tests for W26: Delete client on the client page (Track A
// U25, D72). One router answers every /api/v1 call from a table of mocks; any call the table
// does not cover is recorded and FAILS the test. All data is invented.

import { answerBell } from "./helpers/bell";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const ALPHA = {
  id: "c2600000-0000-4000-8000-000000000001",
  businessName: "INVENTED ALPHA TRADING",
  tin: "100-200-300-00000",
  taxType: "VAT",
  currency: "PHP",
  status: "ACTIVE",
};
const BETA = {
  id: "c2600000-0000-4000-8000-000000000002",
  businessName: "INVENTED BETA FOODS",
  tin: "100-200-301-00000",
  taxType: "PERCENTAGE",
  currency: "PHP",
  status: "ACTIVE",
};
const ME = {
  user: {
    id: "u2600000-0000-4000-8000-000000000001",
    email: "operator@example.test",
    fullName: "Test Operator",
    userType: "FIRM",
    firmId: "22222222-2222-4222-8222-222222222226",
    mfaEnabled: true,
  },
  permissions: {
    global: [
      "Clients:Read",
      "Clients:Update",
      "Clients:Delete",
      "Sales:Read",
      "Expenses:Read",
    ],
    clients: [],
    assignedClientIds: [],
    canViewAllClients: true,
  },
};

interface Seen {
  method: string;
  path: string;
  request: Request;
}
type Handler = (route: Route, seen: Seen) => Promise<void> | void;
type Entry = [method: string, pattern: RegExp, handler: Handler];
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function mockApi(
  page: Page,
  w: { clients: (typeof ALPHA)[] },
  extra: Entry[] = [],
) {
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  await page.addInitScript(() => {
    window.localStorage.setItem("portal_token", "test-token-not-a-secret");
  });
  const emptyPage = { data: [], page: 1, pageSize: 50, total: 0 };
  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, ME)],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: ME.user.id,
          fullName: ME.user.fullName,
          email: ME.user.email,
          userType: "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, w.clients)],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+$/,
      (r, s) => {
        const c = w.clients.find((x) => s.path.endsWith(x.id));
        return c ? json(r, c) : json(r, { message: "Client not found" }, 404);
      },
    ],
    ["GET", /^\/api\/v1\/clients\/[^/]+\/categories$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/bir\/atc-codes$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/coa\/accounts$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/services$/, (r) => json(r, [])],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/(purchase|income)-transactions$/,
      (r) => json(r, emptyPage),
    ],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/purchase-transactions\/summary$/,
      (r) =>
        json(r, {
          basis: "management-estimate",
          totalNet: 0,
          totalInputVAT: 0,
          count: 0,
          deductibleNet: 0,
          nonDeductibleNet: 0,
          byInputVATCategory: [],
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/clients\/[^/]+\/income-transactions\/summary$/,
      (r) =>
        json(r, {
          basis: "management-estimate",
          totalNet: 0,
          totalOutputVAT: 0,
          count: 0,
          byVatClass: [],
        }),
    ],
  ];
  const table = [...base, ...extra];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const s: Seen = { method: req.method(), path: url.pathname, request: req };
    seen.push(s);
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, h] = table[i]!;
      if (m === s.method && re.test(s.path)) return h(route, s);
    }
    if (await answerBell(route)) return;
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs };
}
function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const CHECK = /^\/api\/v1\/clients\/[^/]+\/delete-check$/;
const ONE = /^\/api\/v1\/clients\/[^/]+$/;
const CONFIRM = "This cannot be undone. Type the client's name to confirm:";

test.describe("W26 delete a client (hermetic)", () => {
  test("T1 a blocked client: the blocker sentences word for word, no Delete client button, nothing deleted", async ({
    page,
  }) => {
    const w = { clients: [ALPHA, BETA] };
    const S = [
      "This client cannot be deleted: it has 3 filed BIR returns. Archive it instead.",
      "This client cannot be deleted: it has 2 sent invoices. Archive it instead.",
    ];
    const { seen, unmocked, dialogs } = await mockApi(page, w, [
      [
        "GET",
        CHECK,
        (r) =>
          json(r, {
            canDelete: false,
            nameToType: "INVENTED ALPHA TRADING CORP",
            blockers: [
              { kind: "filedBirReturns", count: 3, sentence: S[0] },
              { kind: "sentInvoices", count: 2, sentence: S[1] },
            ],
            willDelete: [{ kind: "incomeTransactions", count: 9 }],
            willUnlink: [],
          }),
      ],
    ]);
    await page.goto(`/clients/${ALPHA.id}`);
    await page.getByRole("button", { name: "Delete client" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-blocker]")).toHaveText(S);
    await expect(dialog.getByRole("button", { name: "Delete client" })).toHaveCount(0);
    await expect(dialog.getByRole("textbox")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(seen.filter((s) => s.method === "DELETE")).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T2 a deletable client: counts, the name to type, deleted, back on the list without it and gone from the switcher", async ({
    page,
  }) => {
    const w = { clients: [ALPHA, BETA] };
    const { seen, unmocked, dialogs } = await mockApi(page, w, [
      [
        "GET",
        CHECK,
        (r) =>
          json(r, {
            canDelete: true,
            nameToType: "INVENTED ALPHA TRADING CORP",
            blockers: [],
            willDelete: [
              { kind: "purchaseTransactions", count: 124 },
              { kind: "birFormDrafts", count: 2 },
              { kind: "corFiles", count: 1 },
            ],
            willUnlink: [{ kind: "fsReports", count: 1 }],
          }),
      ],
      [
        "DELETE",
        ONE,
        (r) => {
          w.clients = w.clients.filter((c) => c.id !== ALPHA.id);
          return json(r, {
            deleted: [{ kind: "purchaseTransactions", count: 124 }],
            unlinked: [{ kind: "fsReports", count: 1 }],
            filesNotRemoved: [],
          });
        },
      ],
    ]);
    await page.goto(`/clients/${ALPHA.id}`);
    await expect(
      page.getByRole("button", { name: /INVENTED ALPHA TRADING/ }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "Delete client" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("[data-delete-kind]")).toHaveText([
      "124 purchase records",
      "2 draft BIR returns",
      "1 COR file",
    ]);
    await expect(dialog.locator("[data-unlink-kind]")).toHaveText(
      "1 financial statement report, kept and unlinked",
    );
    await expect(dialog.locator("[data-name-to-type]")).toHaveText(
      "INVENTED ALPHA TRADING CORP",
    );
    const confirm = dialog.getByRole("button", { name: "Delete client" });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(CONFIRM).fill("invented alpha trading");
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(CONFIRM).fill("  Invented   Alpha Trading Corp ");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.locator("[data-clients-notice]")).toHaveText("Client deleted.");
    await expect(
      page.locator("tbody tr").filter({ hasText: "INVENTED ALPHA TRADING" }),
    ).toHaveCount(0);
    await expect(
      page.locator("tbody tr").filter({ hasText: "INVENTED BETA FOODS" }),
    ).toHaveCount(1);
    await expect(page.locator("header")).toContainText("Select client");
    const del = seen.find((s) => s.method === "DELETE")!;
    expect(del.path).toBe(`/api/v1/clients/${ALPHA.id}`);
    expect(del.request.postDataJSON()).toEqual({
      confirmName: "  Invented   Alpha Trading Corp ",
    });
    clean(unmocked, dialogs);
  });

  test("T3 files that could not be removed: the note says so", async ({ page }) => {
    const w = { clients: [ALPHA, BETA] };
    const { unmocked, dialogs } = await mockApi(page, w, [
      [
        "GET",
        CHECK,
        (r) =>
          json(r, {
            canDelete: true,
            nameToType: "INVENTED ALPHA TRADING",
            blockers: [],
            willDelete: [{ kind: "corFiles", count: 1 }],
            willUnlink: [],
          }),
      ],
      [
        "DELETE",
        ONE,
        (r) => {
          w.clients = w.clients.filter((c) => c.id !== ALPHA.id);
          return json(r, {
            deleted: [{ kind: "corFiles", count: 1 }],
            unlinked: [],
            filesNotRemoved: [{ key: "cor/invented.pdf" }],
          });
        },
      ],
    ]);
    await page.goto("/clients");
    await page
      .locator("tbody tr")
      .filter({ hasText: "INVENTED ALPHA TRADING" })
      .getByRole("button", { name: "Delete" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(CONFIRM).fill("INVENTED ALPHA TRADING");
    await dialog.getByRole("button", { name: "Delete client" }).click();
    await expect(page.locator("[data-clients-notice]")).toHaveText(
      "Client deleted. Some stored files could not be removed. They are listed in the server log.",
    );
    await expect(
      page.locator("tbody tr").filter({ hasText: "INVENTED ALPHA TRADING" }),
    ).toHaveCount(0);
    clean(unmocked, dialogs);
  });
});

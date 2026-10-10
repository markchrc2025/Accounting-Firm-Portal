// track-b-w9.spec.ts — hermetic browser tests for W9: the sign-in page says
// why a provider refused (R1); two-factor sign-in can be turned off, and set up
// again, with a current code (R2); the dashboard legend uses the regime labels
// (R3); deleting asks in an in-app dialog, never a browser confirm (R4).
//
// HERMETIC BY CONSTRUCTION: one router answers every /api/v1 call from a table
// of mocks; any call the table does not cover is recorded and FAILS the test.
// The two-factor mocks follow Track A's U9 contract (POST /auth/mfa/disable and
// POST /auth/mfa/enroll take { code } while two-factor is on).
//
// All data is invented. No real name, TIN, address, phone or email.

import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-222222222291";
const ME_ID = "u9000000-0000-4000-8000-000000000001";

const EVERYTHING = [
  "Users:Read",
  "Users:Create",
  "Users:Update",
  "Users:Delete",
  "Roles:Assign",
  "Roles:Configure",
  "Clients:Read",
  "Clients:Create",
  "Clients:ViewAll",
];

function me(global: string[] = EVERYTHING) {
  return {
    user: {
      id: ME_ID,
      email: "admin@example.test",
      fullName: "Test Admin Person",
      userType: "FIRM",
      firmId: FIRM_ID,
      mfaEnabled: true,
    },
    permissions: {
      global,
      clients: [],
      assignedClientIds: [],
      canViewAllClients: true,
    },
  };
}

// ---------------------------------------------------------------------------
// One router, a table of handlers
// ---------------------------------------------------------------------------

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  request: Request;
}
type Handler = (route: Route, seen: Seen) => Promise<void> | void;
type Entry = [method: string, pattern: RegExp, handler: Handler];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function mockApi(
  page: Page,
  opts: { signedOut?: boolean; extra?: Entry[]; mfaEnabled?: boolean } = {},
): Promise<{
  seen: Seen[];
  unmocked: string[];
  dialogs: string[];
  quiet: () => Promise<void>;
}> {
  const who = me();
  const seen: Seen[] = [];
  const unmocked: string[] = [];
  // R4: no browser dialog may open, on any page.
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(`${d.type()}: ${d.message()}`);
    void d.dismiss();
  });
  let inflight = 0;
  let started = 0;
  const own = (url: string) => new URL(url).hostname === "localhost";
  page.on("request", (req) => {
    if (!own(req.url())) return;
    inflight += 1;
    started += 1;
  });
  const settled = (req: Request) => {
    if (own(req.url())) inflight -= 1;
  };
  page.on("requestfinished", settled);
  page.on("requestfailed", settled);
  const quiet = async () => {
    let count = -1;
    let since = 0;
    await expect
      .poll(
        () => {
          const now = Date.now();
          if (inflight > 0 || started !== count) {
            count = started;
            since = now;
            return false;
          }
          return now - since >= 500;
        },
        { intervals: [100], timeout: 15_000 },
      )
      .toBe(true);
  };
  if (!opts.signedOut) {
    await page.addInitScript(() => {
      window.localStorage.setItem("portal_token", "test-token-not-a-secret");
    });
  }
  const base: Entry[] = [
    [
      "GET",
      /^\/api\/v1\/auth\/me$/,
      (r) => (opts.signedOut ? json(r, { message: "Unauthorized" }, 401) : json(r, who)),
    ],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/auth\/sso\/providers$/,
      (r) => json(r, { google: true, microsoft: true }),
    ],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: ME_ID,
          fullName: who.user.fullName,
          email: who.user.email,
          userType: "FIRM",
          mfaEnabled: opts.mfaEnabled ?? true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/firm-invitations$/, (r) => json(r, [])],
  ];
  const table = [...base, ...(opts.extra ?? [])];
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const s: Seen = {
      method: req.method(),
      path: url.pathname,
      search: url.searchParams,
      request: req,
    };
    seen.push(s);
    for (let i = table.length - 1; i >= 0; i--) {
      const [m, re, h] = table[i]!;
      if (m === s.method && re.test(s.path)) return h(route, s);
    }
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs, quiet };
}

const bodyOf = (s: Seen) =>
  JSON.parse(s.request.postData() ?? "{}") as Record<string, unknown>;
const noUnmocked = (unmocked: string[]) =>
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);

// ---------------------------------------------------------------------------
// T1 — the sign-in page says why a provider refused (R1)
// ---------------------------------------------------------------------------

const MS_UNVERIFIED =
  "This Microsoft account's email is not verified. Sign in with your email and password, or with Google.";
const GOOGLE_UNVERIFIED =
  "This Google account's email is not verified. Sign in with your email and password, or with Microsoft.";
const GENERIC = "SSO sign-in failed — please try again.";

test.describe("T1 the sign-in page says why a provider refused (hermetic)", () => {
  for (const [label, query, shown, notShown] of [
    [
      "no provider (U9 as deployed)",
      "?sso_error=email-unverified",
      MS_UNVERIFIED,
      GOOGLE_UNVERIFIED,
    ],
    [
      "provider=microsoft",
      "?sso_error=email-unverified&provider=microsoft",
      MS_UNVERIFIED,
      GOOGLE_UNVERIFIED,
    ],
    [
      "provider=google",
      "?sso_error=email-unverified&provider=google",
      GOOGLE_UNVERIFIED,
      MS_UNVERIFIED,
    ],
    ["an unknown sso_error", "?sso_error=zz-not-a-code", GENERIC, MS_UNVERIFIED],
  ] as const) {
    test(`T1 sso_error ${label} shows its message`, async ({ page }) => {
      const { unmocked, dialogs } = await mockApi(page, { signedOut: true });
      await page.goto(`/login${query}`);
      await expect(page.getByText(shown)).toBeVisible();
      await expect(page.getByText(notShown)).toHaveCount(0);
      if (shown !== GENERIC) await expect(page.getByText(GENERIC)).toHaveCount(0);
      expect(dialogs).toEqual([]);
      noUnmocked(unmocked);
    });
  }
});

// ---------------------------------------------------------------------------
// T2 — two-factor sign-in can be turned off, and set up again, with a code (R2)
// ---------------------------------------------------------------------------

const DISABLE = /^\/api\/v1\/auth\/mfa\/disable$/;
const ENROLL = /^\/api\/v1\/auth\/mfa\/enroll$/;
const CONFIRM = /^\/api\/v1\/auth\/mfa\/confirm$/;
const CODE_REQUIRED =
  "Enter a current code from your authenticator to turn off two-factor sign-in.";
const INVENTED_SECRET = "JBSWY3DPEHPK3PXPTESTONLY";

/** U9's two-factor endpoints over one in-memory flag. `refuse` answers every
 *  disable / enroll with U9's 400. */
function mfaServer(state: { on: boolean }, refuse = false): Entry[] {
  return [
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: ME_ID,
          fullName: "Test Admin Person",
          email: "admin@example.test",
          userType: "FIRM",
          mfaEnabled: state.on,
          avatarUrl: null,
        }),
    ],
    [
      "POST",
      DISABLE,
      (r) => {
        if (refuse) return json(r, { message: CODE_REQUIRED }, 400);
        state.on = false;
        return json(r, { mfaEnabled: false }, 201);
      },
    ],
    [
      "POST",
      ENROLL,
      (r) => {
        if (refuse) return json(r, { message: CODE_REQUIRED }, 400);
        state.on = false;
        return json(
          r,
          {
            secret: INVENTED_SECRET,
            otpauthUrl: `otpauth://totp/MCRC:admin%40example.test?secret=${INVENTED_SECRET}`,
          },
          201,
        );
      },
    ],
    [
      "POST",
      CONFIRM,
      (r) => {
        state.on = true;
        return json(r, { mfaEnabled: true }, 201);
      },
    ],
  ];
}

const posts = (seen: Seen[], re: RegExp) =>
  seen.filter((s) => s.method === "POST" && re.test(s.path));
const mfaStatus = (page: Page) => page.locator("[data-mfa-status]");

test.describe("T2 two-factor sign-in, turned off or set up again with a code (hermetic)", () => {
  test("T2 turning two-factor off sends one POST /auth/mfa/disable with the code, and shows it off", async ({
    page,
  }) => {
    const state = { on: true };
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: mfaServer(state),
    });
    await page.goto("/profile");
    await expect(mfaStatus(page)).toHaveText("On");
    await page.getByRole("button", { name: "Turn off two-factor sign-in" }).click();
    await page.getByLabel("Current code from your authenticator").fill("123456");
    await page.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(mfaStatus(page)).toHaveText("Off");
    await quiet();
    const sent = posts(seen, DISABLE);
    expect(sent).toHaveLength(1);
    expect(bodyOf(sent[0]!)).toEqual({ code: "123456" });
    await expect(
      page.getByRole("button", { name: "Turn off two-factor sign-in" }),
    ).toHaveCount(0);
    expect(dialogs).toEqual([]);
    noUnmocked(unmocked);
  });

  test("T2 a 400 shows the server's message, and two-factor stays on", async ({
    page,
  }) => {
    const state = { on: true };
    const { seen, unmocked, quiet } = await mockApi(page, {
      extra: mfaServer(state, true),
    });
    await page.goto("/profile");
    await expect(mfaStatus(page)).toHaveText("On");
    await page.getByRole("button", { name: "Turn off two-factor sign-in" }).click();
    await page.getByLabel("Current code from your authenticator").fill("000000");
    await page.getByRole("button", { name: "Turn off", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: CODE_REQUIRED }),
    ).toBeVisible();
    await quiet();
    await expect(mfaStatus(page)).toHaveText("On");
    expect(posts(seen, DISABLE)).toHaveLength(1);
    noUnmocked(unmocked);
  });

  test("T2 setting two-factor up again while it is on sends the current code, then confirms the new one", async ({
    page,
  }) => {
    const state = { on: true };
    const { seen, unmocked, quiet } = await mockApi(page, { extra: mfaServer(state) });
    await page.goto("/profile");
    await expect(mfaStatus(page)).toHaveText("On");
    await page.getByRole("button", { name: "Set up again", exact: true }).click();
    await page.getByLabel("Current code from your authenticator").fill("654321");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByText(INVENTED_SECRET)).toBeVisible();
    await page.getByLabel("Code from the new authenticator entry").fill("112233");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(mfaStatus(page)).toHaveText("On");
    await quiet();
    const enrolls = posts(seen, ENROLL);
    expect(enrolls).toHaveLength(1);
    expect(bodyOf(enrolls[0]!)).toEqual({ code: "654321" });
    expect(posts(seen, CONFIRM).map(bodyOf)).toEqual([{ code: "112233" }]);
    noUnmocked(unmocked);
  });

  test("T2 turning two-factor on while it is off sends no code, then confirms the first one", async ({
    page,
  }) => {
    const state = { on: false };
    const { seen, unmocked, quiet } = await mockApi(page, { extra: mfaServer(state) });
    await page.goto("/profile");
    await expect(mfaStatus(page)).toHaveText("Off");
    await expect(
      page.getByRole("button", { name: "Turn off two-factor sign-in" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Turn on two-factor sign-in" }).click();
    await expect(page.getByText(INVENTED_SECRET)).toBeVisible();
    await page.getByLabel("Code from the new authenticator entry").fill("445566");
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(mfaStatus(page)).toHaveText("On");
    await quiet();
    expect(posts(seen, ENROLL).map(bodyOf)).toEqual([{}]);
    expect(posts(seen, CONFIRM).map(bodyOf)).toEqual([{ code: "445566" }]);
    noUnmocked(unmocked);
  });
});

// ---------------------------------------------------------------------------
// T3 — the dashboard legend uses W6's labels (R3)
// ---------------------------------------------------------------------------

test.describe("T3 the dashboard legend (hermetic)", () => {
  test("T3 the regime-mix legend reads VAT-registered, Percentage tax and Exempt from business tax", async ({
    page,
  }) => {
    const { unmocked } = await mockApi(page, {
      extra: [
        [
          "GET",
          /^\/api\/v1\/dashboard$/,
          (r) =>
            json(r, {
              kpis: [{ label: "Active clients", value: 6, isCurrency: false, delta: "" }],
              incomeVsExpenses: [],
              recentActivity: [],
              upcomingFilings: [],
              regimeMix: { vat: 3, percentage: 2, exempt: 1 },
            }),
        ],
      ],
    });
    await page.goto("/");
    const legend = page.locator("[data-regime-legend]");
    await expect(legend.locator("[data-regime=vat]")).toHaveText(/^VAT-registered\s*3$/);
    await expect(legend.locator("[data-regime=percentage]")).toHaveText(
      /^Percentage tax\s*2$/,
    );
    await expect(legend.locator("[data-regime=exempt]")).toHaveText(
      /^Exempt from business tax\s*1$/,
    );
    noUnmocked(unmocked);
  });
});

// ---------------------------------------------------------------------------
// T4 — deleting asks in an in-app dialog, never a browser confirm (R4)
// ---------------------------------------------------------------------------

const VICTIM = {
  id: "u9000000-0000-4000-8000-000000000002",
  email: "staff@example.test",
  fullName: "Test Staff Person",
  userType: "FIRM",
  status: "ACTIVE",
  mfaEnabled: true,
  avatarUrl: null,
  lastLoginAt: null,
  createdAt: "2026-01-05T01:00:00.000Z",
  firmProfile: { title: null, employeeId: null },
  userRoles: [{ role: { name: "Staff" }, clientScopeId: null }],
  assignedClientCount: 0,
};
const SELF = {
  ...VICTIM,
  id: ME_ID,
  email: "admin@example.test",
  fullName: "Test Admin Person",
  userRoles: [{ role: { name: "Super Admin" }, clientScopeId: null }],
};
const CUSTOM_ROLE = {
  id: "r9000000-0000-4000-8000-000000000001",
  name: "Invented Reviewer",
  isSystem: false,
  locked: false,
  canEditPermissions: true,
  canRename: true,
  canDelete: true,
  assignedUserCount: 0,
  permissions: [],
};
const USER_DELETE = new RegExp(`^/api/v1/users/${VICTIM.id}$`);
const ROLE_DELETE = new RegExp(`^/api/v1/roles/${CUSTOM_ROLE.id}$`);

function usersPage(): Entry[] {
  return [
    ["GET", /^\/api\/v1\/users$/, (r) => json(r, [SELF, VICTIM])],
    ["GET", /^\/api\/v1\/roles$/, (r) => json(r, [CUSTOM_ROLE])],
    ["GET", /^\/api\/v1\/roles\/permission-catalog$/, (r) => json(r, [])],
    ["DELETE", USER_DELETE, (r) => json(r, { deleted: true })],
    ["DELETE", ROLE_DELETE, (r) => json(r, { deleted: true })],
  ];
}

const deletes = (seen: Seen[], re: RegExp) =>
  seen.filter((s) => s.method === "DELETE" && re.test(s.path));

test.describe("T4 deleting asks in an in-app dialog (hermetic)", () => {
  test("T4 deleting a user opens the in-app dialog; Cancel sends nothing; Delete sends one DELETE; no browser dialog", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: usersPage(),
    });
    await page.goto("/settings/users");
    const row = page.getByRole("row").filter({ hasText: VICTIM.fullName });
    await row.getByRole("button", { name: "Delete", exact: true }).click();
    const ask = page.getByRole("dialog", {
      name: `Delete ${VICTIM.fullName}? This cannot be undone.`,
    });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(ask).toBeHidden();
    await quiet();
    expect(deletes(seen, USER_DELETE)).toEqual([]);

    await row.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(ask).toBeHidden();
    await quiet();
    expect(deletes(seen, USER_DELETE)).toHaveLength(1);
    expect(dialogs, "no browser dialog may open").toEqual([]);
    noUnmocked(unmocked);
  });

  test("T4 deleting a custom role on the same page asks in-app too; no browser dialog", async ({
    page,
  }) => {
    const { seen, unmocked, dialogs, quiet } = await mockApi(page, {
      extra: usersPage(),
    });
    await page.goto("/settings/users");
    await page.getByRole("button", { name: new RegExp(CUSTOM_ROLE.name) }).click();
    await page.getByRole("button", { name: "Delete role", exact: true }).click();
    const ask = page.getByRole("dialog", {
      name: `Delete the "${CUSTOM_ROLE.name}" role? This cannot be undone.`,
    });
    await expect(ask).toBeVisible();
    await ask.getByRole("button", { name: "Cancel", exact: true }).click();
    await quiet();
    expect(deletes(seen, ROLE_DELETE)).toEqual([]);
    await page.getByRole("button", { name: "Delete role", exact: true }).click();
    await ask.getByRole("button", { name: "Delete role", exact: true }).click();
    await expect(ask).toBeHidden();
    await quiet();
    expect(deletes(seen, ROLE_DELETE)).toHaveLength(1);
    expect(dialogs, "no browser dialog may open").toEqual([]);
    noUnmocked(unmocked);
  });
});

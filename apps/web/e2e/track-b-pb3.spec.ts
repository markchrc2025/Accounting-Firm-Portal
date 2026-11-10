// track-b-pb3.spec.ts - hermetic browser tests for PB3: the API tokens page (a token shown once,
// copy, revoke with a question, the Super Admin's firm tab), the repo kit panel on a project's
// overview (files, copy, zip) and the Connect Claude help (Track A PA3). One router answers every
// /api/v1 call from a table of mocks backed by a small in-memory world; any call the table does
// not cover is recorded and FAILS the test. All data is invented.

import { readFileSync } from "node:fs";
import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const FIRM_ID = "22222222-2222-4222-8222-2222222222p3";
const CLIENT = {
  id: "c3300000-0000-4000-8000-0000000000p3",
  businessName: "INVENTED THIRTY-THREE TRADING",
};
const USER_ID = "u3300000-0000-4000-8000-0000000000p3";
const SECRET = "ppt_TESTONLYnotarealtoken0123456789abcdefghijk";

const me = (perms: string[], userType = "FIRM") => ({
  user: {
    id: USER_ID,
    email: "operator@example.test",
    fullName: "Ana Reyes",
    userType,
    firmId: FIRM_ID,
    mfaEnabled: true,
    ...(userType === "CLIENT" ? { clientId: CLIENT.id } : {}),
  },
  permissions: {
    global: ["Clients:Read", "Projects:Read", ...perms],
    clients: [],
    assignedClientIds: [CLIENT.id],
    canViewAllClients: true,
  },
});

interface Seen {
  method: string;
  path: string;
  search: URLSearchParams;
  request: Request;
}
type Handler = (route: Route, seen: Seen, m: RegExpExecArray) => Promise<void> | void;
type Entry = [method: string, pattern: RegExp, handler: Handler];

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}
const sentence = (route: Route, message: string, status: number) =>
  json(route, { message }, status);

// --- the world --------------------------------------------------------------------------------

interface TokenRec {
  id: string;
  name: string;
  scope: "read" | "read_write";
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  owner: { id: string; fullName: string; email: string };
}
interface World {
  tokens: TokenRec[];
  /** When set, making a token is refused with this sentence. */
  createRefusal?: string;
  /** When set, the repo kit is refused with this sentence. */
  kitRefusal?: string;
}
const ME_OWNER = { id: USER_ID, fullName: "Ana Reyes", email: "operator@example.test" };
const BEN = { id: "u-ben", fullName: "Ben Cruz", email: "ben@example.test" };
const rec = (id: string, over: Partial<TokenRec> = {}): TokenRec => ({
  id,
  name: `Token ${id}`,
  scope: "read_write",
  prefix: `ppt_${id}abcd`.slice(0, 10),
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-11-10T16:30:00.000Z",
  owner: ME_OWNER,
  ...over,
});
const world = (over: Partial<World> = {}): World => ({
  tokens: [
    rec("t1", { name: "Claude Code laptop", lastUsedAt: "2026-11-10T16:30:00.000Z" }),
    rec("t2", {
      name: "Old script",
      scope: "read",
      revokedAt: "2026-11-09T04:00:00.000Z",
    }),
    rec("t3", { name: "Ben's laptop", owner: BEN }),
  ],
  ...over,
});
const dto = (t: TokenRec) => {
  const { owner: _owner, ...rest } = t;
  void _owner;
  return rest;
};

const KIT = {
  projectKey: "PAY",
  serverUrl: "https://portal.example.test",
  tokenEnvVar: "PORTAL_PROJECTS_TOKEN",
  files: [
    { path: ".portal-projects.json", content: '{\n  "project": "PAY"\n}\n' },
    {
      path: ".mcp.json",
      content: '{\n  "url": "https://portal.example.test/api/v1/projects/mcp"\n}\n',
    },
    {
      path: ".claude/hooks/portal-projects-session-start.mjs",
      content: "// hook\nconsole.log('hi');\n",
    },
    {
      path: "CLAUDE.md",
      content:
        "<!-- BEGIN portal-projects -->\nUse PAY-12 style keys.\n<!-- END portal-projects -->\n",
    },
  ],
};
const projectDto = {
  id: "pid-PAY",
  key: "PAY",
  name: "Payments",
  description: "",
  repoUrl: "",
  liveUrl: "",
  deployAppName: "",
  archived: false,
  parent: null,
  client: CLIENT,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};
const overview = {
  security: { state: "clear", open: 0, critical: 0, high: 0 }, // PB4
  recentSessions: [], // PB5
  project: projectDto,
  status: { value: "ON_TRACK", note: "", updatedAt: null },
  statusUpdates: [],
  progress: { done: 0, total: 0, percent: 0 },
  counts: { todo: 0, inProgress: 0, done: 0, overdue: 0, openBugs: 0 },
  countsByStatus: [],
  countsByType: [],
  openMilestones: [],
  inProgress: [],
  recentActivity: [
    {
      id: "a1",
      projectId: "pid-PAY",
      issueKey: "PAY-1",
      issueTitle: "Fix the login page",
      action: "issue.updated",
      actorType: "CLAUDE",
      actor: { id: USER_ID, fullName: "Ana Reyes" },
      channel: "mcp",
      changes: [],
      createdAt: "2026-11-10T16:30:00.000Z",
    },
  ],
  lastActivityAt: null,
};

async function mockApi(
  page: Page,
  w: World,
  who: { perms: string[]; userType?: string } = { perms: [] },
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
  const body = (s: Seen) => s.request.postDataJSON() as Record<string, unknown>;

  const base: Entry[] = [
    ["GET", /^\/api\/v1\/auth\/me$/, (r) => json(r, me(who.perms, who.userType))],
    ["POST", /^\/api\/v1\/auth\/refresh$/, (r) => json(r, { accessToken: "test-token" })],
    [
      "GET",
      /^\/api\/v1\/profile\/me$/,
      (r) =>
        json(r, {
          id: USER_ID,
          fullName: "Ana Reyes",
          email: "operator@example.test",
          userType: who.userType ?? "FIRM",
          mfaEnabled: true,
          avatarUrl: null,
        }),
    ],
    ["GET", /^\/api\/v1\/clients$/, (r) => json(r, [])],
    ["GET", /^\/api\/v1\/notifications\/unread-count$/, (r) => json(r, { count: 0 })],
    [
      "GET",
      /^\/api\/v1\/notifications\/preferences$/,
      (r) => json(r, { emailEnabled: false }),
    ],
    // tokens
    [
      "GET",
      /^\/api\/v1\/tokens$/,
      (r) =>
        json(r, {
          items: w.tokens.filter((t) => t.owner.id === USER_ID).map(dto),
        }),
    ],
    [
      "GET",
      /^\/api\/v1\/tokens\/firm$/,
      (r) =>
        who.perms.includes("IntegrationClient:Update")
          ? json(r, { items: w.tokens })
          : sentence(r, "Only a Super Admin can list every token of the firm.", 403),
    ],
    [
      "POST",
      /^\/api\/v1\/tokens$/,
      (r, s) => {
        if (w.createRefusal) return sentence(r, w.createRefusal, 400);
        const b = body(s) as { name: string; scope: "read" | "read_write" };
        const t = rec(`n${w.tokens.length + 1}`, { name: b.name, scope: b.scope });
        w.tokens.unshift(t);
        return json(r, { ...dto(t), token: SECRET }, 201);
      },
    ],
    [
      "POST",
      /^\/api\/v1\/tokens\/([^/]+)\/revoke$/,
      (r, _s, m) => {
        const t = w.tokens.find((x) => x.id === m[1]);
        if (!t) return sentence(r, "Token not found.", 404);
        t.revokedAt = t.revokedAt ?? "2026-11-10T09:00:00.000Z";
        return json(r, dto(t));
      },
    ],
    // a project's overview and its repo kit
    ["GET", /^\/api\/v1\/projects\/PAY$/, (r) => json(r, overview)],
    [
      "GET",
      /^\/api\/v1\/projects\/meta$/,
      (r) => json(r, { issueTypes: [], issueStatuses: [], labels: [], users: [] }),
    ],
    [
      "GET",
      /^\/api\/v1\/projects\/PAY\/repo-kit$/,
      (r) => (w.kitRefusal ? sentence(r, w.kitRefusal, 409) : json(r, KIT)),
    ],
  ];
  const table = [...base, ...extra];
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
      const hit = re.exec(s.path);
      if (m === s.method && hit) return h(route, s, hit);
    }
    unmocked.push(`${s.method} ${s.path}${url.search}`);
    return route.fulfill({ status: 599, contentType: "application/json", body: "{}" });
  });
  return { seen, unmocked, dialogs };
}

function clean(unmocked: string[], dialogs: string[]) {
  expect(unmocked, `unmocked API calls: ${unmocked.join(", ")}`).toEqual([]);
  expect(dialogs, `browser dialogs: ${dialogs.join(", ")}`).toEqual([]);
}
const posts = (seen: Seen[], re: RegExp) =>
  seen.filter((s) => s.method === "POST" && re.test(s.path));
const rows = (page: Page) =>
  page
    .locator("[data-token]")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-token")));
const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

/** The names and texts of the files in a zip, read from its central directory. */
function readZip(bytes: Buffer): Array<{ name: string; text: string }> {
  const eocd = bytes.length - 22;
  expect(bytes.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(eocd + 10);
  let at = bytes.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; text: string }> = [];
  for (let i = 0; i < count; i++) {
    const size = bytes.readUInt32LE(at + 24);
    const nameLen = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    const start = local + 30 + bytes.readUInt16LE(local + 26);
    out.push({ name, text: bytes.subarray(start, start + size).toString("utf8") });
    at += 46 + nameLen;
  }
  return out;
}

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
});

// ===========================================================================
// The tokens page
// ===========================================================================

test.describe("PB3 my API tokens (hermetic)", () => {
  test("T1 the profile page links to My API tokens; the list shows each token, Manila times, revoked marked", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile");
    await page.getByRole("link", { name: "My API tokens" }).click();
    await expect(page).toHaveURL(/\/profile\/tokens$/);
    await expect.poll(() => rows(page)).toEqual(["t1", "t2"]);
    const t1 = page.locator('[data-token="t1"]');
    await expect(t1).toContainText("Claude Code laptop");
    await expect(t1).toContainText("ppt_t1abcd…");
    await expect(t1).toContainText("Read and write");
    await expect(t1.locator("[data-last-used]")).toHaveText("Nov 11, 2026, 12:30 AM");
    await expect(t1).toContainText("Active");
    const t2 = page.locator('[data-token="t2"]');
    await expect(t2).toContainText("Read");
    await expect(t2.locator("[data-last-used]")).toHaveText("Never used");
    await expect(t2.locator("[data-revoked]")).toContainText("Revoked");
    await expect(t2.getByRole("button")).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T2 create a token: shown once with the warning, copyable, gone when closed and after a reload", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile/tokens");
    await page.getByRole("button", { name: "Create token" }).click();
    const dialog = page.getByRole("dialog", { name: "Create token" });
    await dialog.getByLabel(/^Name/).fill("Build server");
    await dialog.getByRole("radio", { name: /Read and write/ }).check();
    await dialog.getByRole("button", { name: "Create token" }).click();

    const box = page.getByRole("region", { name: "New token" });
    await expect(box).toBeVisible();
    await expect(box.locator("[data-token-value]")).toHaveText(SECRET);
    await expect(box.locator("[data-token-warning]")).toHaveText(
      "This token is shown only once. Copy it now and keep it somewhere safe.",
    );
    expect(posts(seen, /\/tokens$/)[0]!.request.postDataJSON()).toEqual({
      name: "Build server",
      scope: "read_write",
    });

    await box.getByRole("button", { name: "Copy the token" }).click();
    await expect(box.getByText("Copied to the clipboard.").first()).toBeVisible();
    expect(await readClipboard(page)).toBe(SECRET);
    await box.getByRole("button", { name: "Copy the address" }).click();
    expect(await readClipboard(page)).toBe(
      `http://localhost:3000/api/v1/projects/mcp/${SECRET}`,
    );
    await expect(box).toContainText(
      "This address contains your token. Anyone who has it can act as you. Do not share it.",
    );

    // the list shows the new token by its start only
    await expect(page.locator('[data-token="n4"]')).toContainText("Build server");
    await expect(page.locator('[data-token="n4"]')).not.toContainText(SECRET);

    await box.getByRole("button", { name: "I have copied it" }).click();
    await expect(page.getByRole("region", { name: "New token" })).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toContain(SECRET);

    await page.reload();
    await expect(page.locator('[data-token="n4"]')).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain(SECRET);
    clean(unmocked, dialogs);
  });

  test("T3 the API's sentence for a refused token shows as sent", async ({ page }) => {
    const w = world({
      createRefusal: "Give the token a name, for example 'Claude Code laptop'.",
    });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile/tokens");
    await page.getByRole("button", { name: "Create token" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Create token" }).click();
    await expect(page.locator("[data-projects-error]")).toHaveText(
      "Give the token a name, for example 'Claude Code laptop'.",
    );
    await expect(page.getByRole("region", { name: "New token" })).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T4 revoke asks first; Cancel sends nothing; Revoke sends one request and marks it", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile/tokens");
    await page.getByRole("button", { name: "Revoke Claude Code laptop" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Revoke the token “Claude Code laptop”?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(posts(seen, /\/revoke$/)).toHaveLength(0);

    await page.getByRole("button", { name: "Revoke Claude Code laptop" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
    await expect(page.locator("[data-projects-success]")).toContainText(
      "Token “Claude Code laptop” revoked.",
    );
    expect(posts(seen, /\/revoke$/)).toHaveLength(1);
    expect(posts(seen, /\/revoke$/)[0]!.path).toBe("/api/v1/tokens/t1/revoke");
    await expect(page.locator('[data-token="t1"] [data-revoked]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Revoke Claude Code laptop" }),
    ).toHaveCount(0);
    clean(unmocked, dialogs);
  });

  test("T5 a Super Admin also has Firm tokens: owners, Revoke only; nobody else has the tab", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w, {
      perms: ["IntegrationClient:Update"],
    });
    await page.goto("/profile/tokens");
    await page.getByRole("tab", { name: "Firm tokens" }).click();
    await expect.poll(() => rows(page)).toEqual(["t1", "t2", "t3"]);
    await expect(page.locator('[data-token="t3"] [data-owner]')).toContainText(
      "Ben Cruz",
    );
    await expect(page.locator('[data-token="t3"] [data-owner]')).toContainText(
      "ben@example.test",
    );
    await expect(page.getByRole("button", { name: "Create token" })).toHaveCount(0);
    await page.getByRole("button", { name: "Revoke Ben's laptop" }).click();
    await expect(page.getByRole("dialog")).toContainText("of Ben Cruz");
    await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
    await expect.poll(() => posts(seen, /\/t3\/revoke$/).length).toBe(1);
    await expect(page.locator('[data-token="t3"] [data-revoked]')).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("ppt_TESTONLY");
    clean(unmocked, dialogs);
  });

  test("T5 without the Super Admin role there is no Firm tokens tab and the firm list is not asked for", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile/tokens?tab=firm");
    await expect.poll(() => rows(page)).toEqual(["t1", "t2"]);
    await expect(page.getByRole("tab", { name: "Firm tokens" })).toHaveCount(0);
    expect(seen.filter((s) => s.path.endsWith("/tokens/firm"))).toHaveLength(0);
    clean(unmocked, dialogs);
  });

  test("T8 a client user has no tokens page and no link to it", async ({ page }) => {
    const w = world();
    const { seen } = await mockApi(page, w, { perms: [], userType: "CLIENT" }, [
      ["GET", /^\/api\/v1\/portal\/.*$/, (r) => json(r, {})],
    ]);
    await page.goto("/profile/tokens");
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByRole("link", { name: "My API tokens" })).toHaveCount(0);
    expect(seen.filter((s) => /\/tokens/.test(s.path))).toHaveLength(0);
  });
});

// ===========================================================================
// Connect Claude
// ===========================================================================

test.describe("PB3 Connect Claude (hermetic)", () => {
  test("T6 the two addresses are built from the API origin; the connector one shows where the token goes", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/profile/tokens");
    const help = page.locator("[data-connect-claude]");
    await expect(help.locator('[data-connect-line="Address"]').first()).toHaveText(
      "http://localhost:3000/api/v1/projects/mcp",
    );
    await expect(help.locator('[data-connect-line="Header"]')).toHaveText(
      "Authorization: Bearer ${PORTAL_PROJECTS_TOKEN}",
    );
    await expect(help.locator('[data-connect-line="Address"]').nth(1)).toHaveText(
      "http://localhost:3000/api/v1/projects/mcp/<your token>",
    );
    await expect(help.locator("[data-capability-warning]")).toHaveText(
      "This address contains your token. Anyone who has it can act as you. Do not share it.",
    );
    await help.getByRole("button", { name: "Copy the header" }).click();
    expect(await readClipboard(page)).toBe(
      "Authorization: Bearer ${PORTAL_PROJECTS_TOKEN}",
    );
    expect(await page.locator("body").innerText()).not.toMatch(/ppt_[A-Za-z0-9]{20}/);
    clean(unmocked, dialogs);
  });
});

// ===========================================================================
// The repo kit
// ===========================================================================

test.describe("PB3 the repo kit (hermetic)", () => {
  test("T7 a project's overview offers Connect a code repository: steps, files, Copy, and one zip", async ({
    page,
  }) => {
    const w = world();
    const { seen, unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    const panel = page.locator("[data-repo-kit]");
    await expect(panel).toContainText("Connect a code repository");
    await expect(panel.locator("[data-repo-kit-steps] li")).toHaveText([
      "Create a token on My API tokens.",
      "Put it in the environment variable named in the files below on your computer (never in the repository).",
      "Add these files to the repository and commit them.",
      "Open the repository in Claude Code.",
    ]);
    expect(seen.filter((s) => s.path.endsWith("/repo-kit"))).toHaveLength(0);
    await panel.getByRole("button", { name: "Show the files" }).click();
    await expect(panel.locator("[data-kit-file]")).toHaveCount(4);
    await expect(panel.locator("[data-repo-kit-steps] li").nth(1)).toContainText(
      "PORTAL_PROJECTS_TOKEN",
    );

    await panel.getByRole("button", { name: "Copy .mcp.json" }).click();
    expect(await readClipboard(page)).toBe(KIT.files[1]!.content);
    await panel.getByRole("button", { name: "Copy CLAUDE.md" }).click();
    expect(await readClipboard(page)).toBe(KIT.files[3]!.content);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      panel.getByRole("button", { name: "Download all as a zip" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("PAY-repo-kit.zip");
    const zip = readZip(readFileSync((await download.path())!));
    expect(zip).toEqual(KIT.files.map((f) => ({ name: f.path, text: f.content })));
    expect(JSON.stringify(zip)).not.toMatch(/ppt_/);

    await panel.getByRole("link", { name: "My API tokens" }).click();
    await expect(page).toHaveURL(/\/profile\/tokens$/);
    clean(unmocked, dialogs);
  });

  test("T7 the kit's refusal shows as sent, and the Connect Claude help link opens the help", async ({
    page,
  }) => {
    const w = world({
      kitRefusal: "The Portal's address must be https unless it is localhost.",
    });
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    await page.getByRole("button", { name: "Show the files" }).click();
    await expect(page.locator("[data-repo-kit] [data-projects-error]")).toHaveText(
      "The Portal's address must be https unless it is localhost.",
    );
    await page.getByRole("link", { name: "Connect Claude help" }).click();
    await expect(page).toHaveURL(/\/profile\/tokens#connect-claude$/);
    await expect(page.locator("[data-connect-claude]")).toBeVisible();
    clean(unmocked, dialogs);
  });

  test("T7 entries made by Claude are labelled Claude on the overview", async ({
    page,
  }) => {
    const w = world();
    const { unmocked, dialogs } = await mockApi(page, w);
    await page.goto("/projects/PAY");
    await expect(page.locator('[data-activity="a1"]')).toContainText("Claude");
    await expect(page.locator('[data-activity="a1"]')).not.toContainText("Ana Reyes");
    clean(unmocked, dialogs);
  });
});

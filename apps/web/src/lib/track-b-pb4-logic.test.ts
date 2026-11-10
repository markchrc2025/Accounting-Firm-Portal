// track-b-pb4-logic.test.ts - PB4: the small helpers for GitHub links, the security badge, the
// sentences with issue keys, the webhook address, and the exact calls of the new routes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchAudits,
  fetchSecurity,
  githubRef,
  githubStateLabel,
  importAudit,
  importChecklist,
  readFileText,
  safeWebUrl,
  securityText,
  splitIssueKeys,
} from "./projects";
import { GITHUB_WEBHOOK_PATH, githubWebhookUrl } from "./connectClaude";

describe("PB4 GitHub links", () => {
  it("only a web address is followed", () => {
    expect(safeWebUrl("https://github.com/acme/app/pull/12")).toBe(
      "https://github.com/acme/app/pull/12",
    );
    expect(safeWebUrl("http://localhost/x")).toBe("http://localhost/x");
    expect(safeWebUrl("javascript:window.__x=1")).toBeNull();
    expect(safeWebUrl("data:text/html,hi")).toBeNull();
    expect(safeWebUrl("not a url")).toBeNull();
    expect(safeWebUrl("")).toBeNull();
  });

  it("merged beats the state; open, closed and pushed are named; anything else is as sent", () => {
    expect(githubStateLabel({ state: "closed", merged: true })).toBe("Merged");
    expect(githubStateLabel({ state: "merged", merged: false })).toBe("merged");
    expect(githubStateLabel({ state: "open", merged: false })).toBe("Open");
    expect(githubStateLabel({ state: "CLOSED", merged: false })).toBe("Closed");
    expect(githubStateLabel({ state: "pushed", merged: false })).toBe("Pushed");
    expect(githubStateLabel({ state: "draft", merged: false })).toBe("draft");
  });

  it("a pull request is repo#number and a commit is repo@short-sha", () => {
    expect(githubRef({ kind: "pr", repo: "acme/app", number: 12, sha: null })).toBe(
      "acme/app#12",
    );
    expect(
      githubRef({
        kind: "commit",
        repo: "acme/app",
        number: null,
        sha: "0123456789abcdef",
      }),
    ).toBe("acme/app@0123456");
    expect(githubRef({ kind: "pr", repo: "acme/app", number: null, sha: null })).toBe(
      "acme/app",
    );
    expect(githubRef({ kind: "commit", repo: "acme/app", number: null, sha: null })).toBe(
      "acme/app",
    );
  });
});

describe("PB4 the security badge text", () => {
  it("says Clear, the open count, or what blocks (only the parts that are not zero)", () => {
    expect(securityText({ state: "clear", open: 0, critical: 0, high: 0 })).toBe("Clear");
    expect(securityText({ state: "open", open: 3, critical: 0, high: 0 })).toBe("3 open");
    expect(securityText({ state: "blocked", open: 5, critical: 1, high: 2 })).toBe(
      "Blocked: 1 critical, 2 high",
    );
    expect(securityText({ state: "blocked", open: 2, critical: 2, high: 0 })).toBe(
      "Blocked: 2 critical",
    );
    expect(securityText({ state: "blocked", open: 1, critical: 0, high: 1 })).toBe(
      "Blocked: 1 high",
    );
  });
});

describe("PB4 issue keys in a sentence", () => {
  it("cuts the release gate's sentence at its keys and puts every character back", () => {
    const s =
      "This milestone cannot be closed while security issues are open: PAY-3, PAY-9.";
    const parts = splitIssueKeys(s);
    expect(parts.filter((p) => p.key).map((p) => p.text)).toEqual(["PAY-3", "PAY-9"]);
    expect(parts.map((p) => p.text).join("")).toBe(s);
  });
  it("leaves a sentence with no key whole, and does not take lower case or glued text for a key", () => {
    expect(splitIssueKeys("Nothing here.")).toEqual([
      { text: "Nothing here.", key: false },
    ]);
    expect(splitIssueKeys("pay-3 and XPAY-3x")).toEqual([
      { text: "pay-3 and XPAY-3x", key: false },
    ]);
    expect(splitIssueKeys("")).toEqual([]);
    expect(splitIssueKeys("AB-1").map((p) => p.key)).toEqual([true]);
  });
});

describe("PB4 the webhook address", () => {
  it("is the API origin plus the route", () => {
    expect(GITHUB_WEBHOOK_PATH).toBe("/api/v1/projects/github/webhook");
    expect(githubWebhookUrl("https://portal.example.test")).toBe(
      "https://portal.example.test/api/v1/projects/github/webhook",
    );
  });
});

describe("PB4 reading a chosen file", () => {
  it("gives its text", async () => {
    expect(await readFileText(new Blob(['{"a":1}']))).toBe('{"a":1}');
    expect(await readFileText(new Blob([""]))).toBe("");
  });
});

describe("PB4 calls", () => {
  let calls: Array<{ url: string; init: RequestInit }> = [];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const last = () => {
    const c = calls.at(-1)!;
    return {
      path: new URL(c.url).pathname.replace(/^.*\/api\/v1/, ""),
      init: c.init,
      body: c.init.body ? JSON.parse(c.init.body as string) : undefined,
    };
  };

  it("the checklist import is a POST with the text, the switch and dryRun", async () => {
    await importChecklist("PAY", {
      markdown: "- [ ] a",
      headingsAsMilestones: true,
      dryRun: true,
    });
    expect(last().path).toBe("/projects/PAY/import");
    expect(last().init.method).toBe("POST");
    expect(last().body).toEqual({
      markdown: "- [ ] a",
      headingsAsMilestones: true,
      dryRun: true,
    });
    await importChecklist("PAY", {
      markdown: "- [ ] a",
      headingsAsMilestones: false,
      dryRun: false,
    });
    expect(last().body).toEqual({
      markdown: "- [ ] a",
      headingsAsMilestones: false,
      dryRun: false,
    });
  });

  it("security, audit history and the audit import go to their own routes", async () => {
    await fetchSecurity("PAY");
    expect(last().path).toBe("/projects/PAY/security");
    await fetchAudits("PAY");
    expect(last().path).toBe("/projects/PAY/audits");
    await importAudit("PAY", { findings: "[]", run: { run_id: "r1" }, ledger: [] });
    expect(last().path).toBe("/projects/PAY/audits");
    expect(last().init.method).toBe("POST");
    expect(last().body).toEqual({ findings: "[]", run: { run_id: "r1" }, ledger: [] });
  });
});

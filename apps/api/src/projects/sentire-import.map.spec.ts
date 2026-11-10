// sentire-import.map.spec.ts — PA5 (D69): the pure parts of the Sentire Projects importer.
import type { PlanActivity, PlanPerson } from "@portal/projects-core";
import {
  auditCounts,
  channelOf,
  importedChanges,
  importedFrom,
  portalAction,
} from "./sentire-import.map";

const act = (over: Partial<PlanActivity> = {}): PlanActivity => ({
  projectKey: "PAY",
  issueKey: null,
  action: "updated",
  actorType: "USER",
  actorEmail: null,
  client: null,
  channel: "web",
  sessionRef: null,
  summary: "",
  changes: [],
  createdAt: "2026-11-03T10:00:00.000Z",
  ...over,
});
const people = new Map<string, PlanPerson>([
  ["ana@firm.example", { email: "ana@firm.example", name: "Ana Reyes" }],
]);

describe("portalAction", () => {
  it.each([
    ["created", "PAY-1", "issue.created"],
    ["created", null, "project.created"],
    ["updated", "PAY-1", "issue.updated"],
    ["updated", null, "project.updated"],
    ["deleted", "PAY-1", "issue.deleted"],
    ["commented", "PAY-1", "comment.added"],
    ["linked", "PAY-1", "github.linked"],
    ["status", null, "project.status"],
    ["Updated ", "PAY-1", "issue.updated"],
  ])("%s on %s is %s", (action, issueKey, expected) => {
    expect(portalAction(act({ action, issueKey }))).toBe(expected);
  });

  it("a session row is started, unless it says it ended or sits at the session's end", () => {
    expect(
      portalAction(act({ action: "session", summary: "Started a claude-code session" })),
    ).toBe("session.started");
    expect(portalAction(act({ action: "session", summary: "Ended the session" }))).toBe(
      "session.ended",
    );
    expect(
      portalAction(
        act({ action: "session", summary: "x", createdAt: "2026-11-03T12:00:00.000Z" }),
        {
          endedAt: "2026-11-03T12:00:00.000Z",
        },
      ),
    ).toBe("session.ended");
    expect(
      portalAction(act({ action: "session", summary: "x" }), {
        endedAt: "2026-11-03T12:00:00.000Z",
      }),
    ).toBe("session.started");
  });

  it("an action with no Portal name is kept, tagged, and never looks like a Portal event", () => {
    expect(portalAction(act({ action: "Moved Card!" }))).toBe("imported.moved-card-");
    expect(portalAction(act({ action: "   " }))).toBe("imported.activity");
    expect(portalAction(act({ action: "x".repeat(200) })).length).toBe(
      "imported.".length + 60,
    );
  });
});

describe("importedFrom", () => {
  it("names the person, their e-mail, the actor type and the client", () => {
    expect(
      importedFrom(
        act({
          actorType: "CLAUDE",
          actorEmail: "Ana@Firm.example",
          client: "claude-code",
        }),
        people,
      ),
    ).toBe("Ana Reyes <Ana@Firm.example> (claude, claude-code)");
  });
  it("an e-mail with no name in the plan is still named", () => {
    expect(importedFrom(act({ actorEmail: "x@y.example" }), people)).toBe(
      "<x@y.example> (user)",
    );
  });
  it("a row with no e-mail is named by its kind of actor", () => {
    expect(importedFrom(act({ actorType: "GITHUB", client: "github" }), people)).toBe(
      "GitHub (github, github)",
    );
    expect(importedFrom(act({ actorType: "SYSTEM" }), people)).toBe("System (system)");
    expect(importedFrom(act({ actorType: "USER" }), people)).toBe("A person (user)");
  });
});

describe("importedChanges", () => {
  it("keeps the plan's changes, then who, then Sentire's summary", () => {
    const changes = importedChanges(
      act({
        actorEmail: "ana@firm.example",
        summary: "Moved PAY-1",
        changes: [{ field: "status", old: "New", new: "Done" }],
      }),
      people,
    );
    expect(changes.map((c) => c.field)).toEqual(["status", "importedFrom", "summary"]);
    expect(changes[0]).toEqual({ field: "status", old: "New", new: "Done" });
    expect(changes[2]).toEqual({ field: "summary", old: null, new: "Moved PAY-1" });
  });
  it("no summary, no entry; a summary the plan already carries is not doubled", () => {
    expect(importedChanges(act(), people).map((c) => c.field)).toEqual(["importedFrom"]);
    const have = importedChanges(
      act({ summary: "s", changes: [{ field: "summary", old: null, new: "s" }] }),
      people,
    );
    expect(have.filter((c) => c.field === "summary")).toHaveLength(1);
  });
});

describe("audits", () => {
  it("channelOf by who made the run", () => {
    expect(channelOf("CLAUDE")).toBe("mcp");
    expect(channelOf("GITHUB")).toBe("github");
    expect(channelOf("SYSTEM")).toBe("system");
    expect(channelOf("USER")).toBe("web");
  });
  it("auditCounts in the Portal's shape, with every severity present", () => {
    expect(
      auditCounts({ critical: 1, high: 2, needs_validation: 3, rejected: 4 }, 9),
    ).toEqual({
      total: 6,
      confirmed: 3,
      needsValidation: 3,
      rejected: 4,
      bySeverity: { critical: 1, high: 2, medium: 0, low: 0, informational: 0 },
    });
    expect(auditCounts({}, 2)).toEqual({
      total: 0,
      confirmed: 0,
      needsValidation: 0,
      rejected: 2,
      bySeverity: { critical: 0, high: 0, medium: 0, low: 0, informational: 0 },
    });
  });
});

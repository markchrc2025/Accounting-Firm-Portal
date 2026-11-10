import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IMPORT_APPLY_ORDER,
  IMPORT_PLAN_FORMAT,
  IMPORT_PLAN_VERSION,
  SentireExportError,
  UNMAPPED_SENTIRE_FIELDS,
  mapSentireExport,
  validateImportPlan,
  type ImportPlan,
} from "../src";
import { DASHES } from "./helpers";

const here = dirname(fileURLToPath(import.meta.url));
const read = (...p: string[]): string => readFileSync(join(here, ...p), "utf8");

type Tables = Record<string, Record<string, unknown>[]>;
const exportData = (): Tables =>
  JSON.parse(read("fixtures", "sentire-export.json")) as Tables;
const planOf = (data: Tables = exportData()): ImportPlan => mapSentireExport(data);
/** A plan to break on purpose: loosely typed, because the tests put wrong values into it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
const plan = (): Loose => JSON.parse(JSON.stringify(planOf())) as Loose;
const problems = (p: unknown, max?: number): string[] =>
  validateImportPlan(p, max ? { maxMessages: max } : {});
const row = <T extends object>(rows: T[], where: Partial<T>): T =>
  rows.find((r) =>
    Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
  )!;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

describe("mapSentireExport: the plan (golden)", () => {
  it("matches the golden plan for the invented export", () => {
    expect(`${JSON.stringify(planOf(), null, 2)}\n`).toBe(
      read("golden", "sentire-plan.json.golden"),
    );
  });

  it("is versioned and says in what order to apply it", () => {
    const p = planOf();
    expect(p.format).toBe(IMPORT_PLAN_FORMAT);
    expect(p.version).toBe(IMPORT_PLAN_VERSION);
    expect(p.source).toBe("sentire-projects");
    expect(p.applyOrder).toEqual(IMPORT_APPLY_ORDER);
    expect(IMPORT_APPLY_ORDER.slice(0, 6)).toEqual([
      "projects",
      "issueTypes",
      "statuses",
      "labels",
      "milestones",
      "issues",
    ]);
    expect(IMPORT_APPLY_ORDER.indexOf("comments")).toBeGreaterThan(
      IMPORT_APPLY_ORDER.indexOf("issues"),
    );
  });

  it("carries every entity of the export", () => {
    expect(planOf().counts).toEqual({
      people: 2,
      projects: 3,
      issueTypes: 4,
      statuses: 3,
      labels: 2,
      milestones: 2,
      issues: 6,
      comments: 3,
      statusUpdates: 3,
      sessions: 2,
      activities: 3,
      githubLinks: 2,
      securityAudits: 1,
    });
  });

  it("is a valid plan", () => {
    expect(problems(planOf())).toEqual([]);
  });

  it("is the same whatever the style of the export: SQL names, a tables wrapper, Date objects, text", () => {
    const base = planOf();
    const sql = Object.fromEntries(
      Object.entries(exportData()).map(([table, rows]) => [
        snake(table),
        rows.map((r) =>
          Object.fromEntries(Object.entries(r).map(([k, v]) => [snake(k), v])),
        ),
      ]),
    );
    expect(mapSentireExport(sql)).toEqual(base);
    expect(mapSentireExport({ tables: exportData() })).toEqual(base);
    expect(mapSentireExport(read("fixtures", "sentire-export.json"))).toEqual(base);
    const data = exportData();
    const p = row(data.projects!, { key: "PAY" });
    p.createdAt = new Date("2026-02-01T00:00:00.000Z");
    row(data.milestones!, { name: "Beta" }).dueDate = new Date(
      "2026-12-01T00:00:00.000Z",
    );
    expect(mapSentireExport(data)).toEqual(base);
  });

  it("writes a time that has a zone offset as UTC", () => {
    const data = exportData();
    row(data.projects!, { key: "PAY" }).createdAt = "2026-02-01 08:00:00+08";
    expect(planOf(data).projects.find((p) => p.key === "PAY")!.createdAt).toBe(
      "2026-02-01T00:00:00.000Z",
    );
  });
});

describe("mapSentireExport: references are by key or name", () => {
  const p = planOf();

  it("holds no Sentire id anywhere", () => {
    const ids = JSON.stringify(exportData()).match(/00000000-0000-4000-8000-\d{12}/g)!;
    expect(ids.length).toBeGreaterThan(50);
    const text = JSON.stringify(p);
    for (const id of new Set(ids)) expect(text).not.toContain(id);
  });

  it("holds no password hash, token hash or login session", () => {
    // The list of unmapped fields names these columns on purpose; the data must not hold them.
    const text = JSON.stringify({ ...p, unmapped: [] });
    for (const secret of [
      "INVENTED-HASH",
      "INVENTED-TOKEN-HASH",
      "INVENTED-LOGIN-SESSION",
      "spk_abcd",
      "passwordHash",
      "tokenHash",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("refers to projects, issues, types, statuses, milestones, labels and people by key or name", () => {
    const pay1 = row(p.issues, { key: "PAY-1" });
    expect(pay1).toMatchObject({
      projectKey: "PAY",
      number: 1,
      type: "Feature",
      status: "In progress",
      priority: "HIGH",
      milestone: "Beta",
      parentKey: "PAY-3",
      assigneeEmail: "ben@example.test",
      authorEmail: "ana@example.test",
      labels: ["frontend"],
      startDate: "2026-11-02",
      dueDate: "2026-11-20",
      position: 1.5,
    });
    expect(row(p.projects, { key: "PAYAPI" })).toMatchObject({
      parentKey: "PAY",
      archived: true,
    });
    expect(row(p.milestones, { name: "Launch" })).toMatchObject({
      projectKey: "PAY",
      state: "CLOSED",
      closedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(p.comments[0]).toMatchObject({
      issueKey: "PAY-1",
      authorEmail: "ben@example.test",
      actorType: "USER",
    });
    expect(p.githubLinks.map((l) => l.issueKey)).toEqual(["PAY-1", "PAY-1"]);
    expect(p.securityAudits[0]).toMatchObject({
      projectKey: "PAY",
      issueKeys: ["PAY-5"],
      importedByEmail: "ana@example.test",
      scope: ["packages/api", "packages/web"],
    });
  });

  it("keeps the key and the number of every issue, and the counter at or above the highest", () => {
    expect(p.issues.map((i) => [i.key, i.number])).toEqual([
      ["PAY-3", 3],
      ["PAY-1", 1],
      ["PAY-2", 2],
      ["PAY-4", 4],
      ["PAY-5", 5],
      ["PAYAPI-1", 1],
    ]);
    const data = exportData();
    row(data.projects!, { key: "PAY" }).issueCounter = 2;
    expect(planOf(data).projects.find((x) => x.key === "PAY")!.issueCounter).toBe(5);
  });

  it("lists a parent before its children, across the whole plan", () => {
    const order = p.issues.map((i) => i.key);
    for (const i of p.issues)
      if (i.parentKey)
        expect(order.indexOf(i.parentKey)).toBeLessThan(order.indexOf(i.key));
  });

  it("keeps deleted issues, flagged by their time", () => {
    expect(row(p.issues, { key: "PAY-4" }).deletedAt).toBe("2026-04-04T00:00:00.000Z");
  });

  it("keeps the finding id of an issue that came from a security audit", () => {
    expect(row(p.issues, { key: "PAY-5" })).toMatchObject({
      fingerprint: "api-critical-account-takeover",
      labels: ["frontend", "security"],
      priority: "URGENT",
      closedAt: "2026-06-01T00:00:00.000Z",
    });
  });

  it("names work sessions by a plan-made ref and uses it in comments and activity", () => {
    expect(p.sessions.map((s) => s.ref)).toEqual(["PAY#1", "PAY#2"]);
    expect(row(p.comments, { body: "Moved to In progress." }).sessionRef).toBe("PAY#1");
    expect(p.activities.filter((a) => a.sessionRef).map((a) => a.sessionRef)).toEqual([
      "PAY#1",
      "PAY#1",
    ]);
    expect(p.sessions[0]!.issuesTouched).toEqual(["PAY-1"]);
  });

  it("turns activity changes into the Portal's list and works out the channel", () => {
    const upd = row(p.activities, { action: "updated" });
    expect(upd.changes).toEqual([
      { field: "status", old: "New", new: "In progress" },
      { field: "priority", old: "normal", new: "high" },
    ]);
    expect(upd).toMatchObject({
      channel: "mcp",
      client: "claude-code",
      actorType: "CLAUDE",
      actorEmail: "ana@example.test",
      issueKey: "PAY-1",
    });
    expect(row(p.activities, { action: "linked" })).toMatchObject({
      channel: "github",
      actorType: "GITHUB",
      issueKey: "PAY-5",
    });
  });

  it("takes a project's status from the latest update and adds one when the history does not end with it", () => {
    expect(p.statusUpdates.filter((u) => u.projectKey === "PAY")).toHaveLength(2);
    expect(p.statusUpdates.filter((u) => u.projectKey === "BKS")).toEqual([
      {
        projectKey: "BKS",
        status: "AT_RISK",
        note: "Waiting on a vendor",
        actorType: "SYSTEM",
        actorEmail: null,
        createdAt: "2026-10-15T00:00:00.000Z",
      },
    ]);
    expect(p.statusUpdates.filter((u) => u.projectKey === "PAYAPI")).toEqual([]);
  });

  it("lower-cases e-mail addresses", () => {
    expect(p.people).toEqual([
      { email: "ana@example.test", name: "Ana Reyes" },
      { email: "ben@example.test", name: "Ben Cruz" },
    ]);
  });
});

describe("mapSentireExport: warnings", () => {
  const warnings = (change: (d: Tables) => void): string[] => {
    const d = exportData();
    change(d);
    return planOf(d).warnings;
  };
  const base = planOf().warnings;

  it("says what the clean export already says, and nothing else", () => {
    expect(base).toEqual([
      "1 project's current status was not at the end of its status updates, so one update was added, dated at the project's last change (BKS).",
      "1 activity row belongs to no project, or one that is not in the export, and was left out.",
      "These tables were in the export and ignored on purpose (notifications, apiTokens, sessions).",
    ]);
  });

  it("a missing parent issue: the link is emptied, the issue stays, a sentence names it", () => {
    const d = exportData();
    row(d.issues!, { key: "PAY-2" }).parentId = "00000000-0000-4000-8000-999999999999";
    const p = planOf(d);
    expect(row(p.issues, { key: "PAY-2" }).parentKey).toBeNull();
    expect(p.warnings).toContain(
      "1 issue has a parent that is not in the export; the parent link was left empty (PAY-2).",
    );
    expect(problems(p)).toEqual([]);
  });

  it("a missing parent project is emptied the same way", () => {
    const d = exportData();
    row(d.projects!, { key: "PAYAPI" }).parentId = "00000000-0000-4000-8000-999999999999";
    expect(planOf(d).projects.find((x) => x.key === "PAYAPI")!.parentKey).toBeNull();
  });

  it("rows whose project, issue, type or status is missing are left out and counted", () => {
    const gone = "00000000-0000-4000-8000-999999999999";
    const w = warnings((d) => {
      row(d.issues!, { key: "PAY-2" }).projectId = gone;
      row(d.issues!, { key: "PAY-3" }).typeId = gone;
      row(d.issues!, { key: "PAY-4" }).statusId = gone;
      row(d.milestones!, { name: "Beta" }).projectId = gone;
      row(d.statusUpdates!, { note: "Kick-off" }).projectId = gone;
      row(d.comments!, { body: "Started on the form." }).issueId = gone;
      row(d.githubLinks!, { kind: "pr" }).issueId = gone;
      row(d.securityAudits!, { runId: "sample-run-2026-05-30" }).projectId = gone;
    });
    for (const sentence of [
      "1 issue belongs to a project that is not in the export and was left out (PAY-2).",
      "1 issue has a type that is not in the export and was left out (PAY-3).",
      "1 issue has a status that is not in the export and was left out (PAY-4).",
      "1 milestone belongs to a project that is not in the export and was left out (Beta).",
      "1 project status update belongs to a project that is not in the export and was left out.",
      "1 comment points to an issue that is not in the export and was left out.",
      "1 GitHub link points to an issue that is not in the export and was left out.",
      "1 security audit belongs to a project that is not in the export and was left out.",
    ]) {
      expect(w, sentence).toContain(sentence);
    }
  });

  it("a missing milestone, user, session or label link is emptied and counted", () => {
    const gone = "00000000-0000-4000-8000-999999999999";
    const w = warnings((d) => {
      row(d.issues!, { key: "PAY-1" }).milestoneId = gone;
      row(d.issues!, { key: "PAY-1" }).assigneeId = gone;
      row(d.comments!, { body: "Moved to In progress." }).sessionId = gone;
      d.issueLabels!.push({ issueId: gone, labelId: gone });
    });
    expect(w).toContain(
      "1 issue has a milestone that is not in the export; the milestone was left empty (PAY-1).",
    );
    expect(w).toContain(
      "1 reference points to a user that is not in the export; it was left empty.",
    );
    expect(w).toContain(
      "1 row points to a work session that is not in the export; the session link was left empty.",
    );
    expect(w).toContain(
      "1 label link points to an issue or label that is not in the export and was left out.",
    );
  });

  it("uses the plural for more than one, and lists at most five examples", () => {
    const d = exportData();
    for (let n = 0; n < 7; n++) {
      d.issues!.push({
        ...row(d.issues!, { key: "PAY-2" }),
        id: `x${n}`,
        key: `PAY-${100 + n}`,
        number: 100 + n,
        projectId: "gone",
      });
    }
    const w = planOf(d).warnings;
    expect(w).toContain(
      "7 issues belong to a project that is not in the export and were left out (PAY-100, PAY-101, PAY-102, PAY-103, PAY-104).",
    );
  });

  it("says when a core table is missing", () => {
    const d = exportData();
    delete d.statuses;
    delete d.issueTypes;
    expect(planOf(d).warnings).toContain(
      "2 expected tables are missing from the export (issueTypes, statuses); they were read as empty.",
    );
  });

  it("does not repair a duplicate key or number; the validator reports it", () => {
    const d = exportData();
    d.projects!.push({ ...row(d.projects!, { key: "PAY" }), id: "dup-project" });
    d.issues!.push({ ...row(d.issues!, { key: "PAY-2" }), id: "dup-issue" });
    const p = planOf(d);
    expect(p.projects.filter((x) => x.key === "PAY")).toHaveLength(2);
    expect(p.issues.filter((x) => x.key === "PAY-2")).toHaveLength(2);
    expect(problems(p)).toEqual([
      'The project key "PAY" appears 2 times; it must be unique.',
      "Two issues of PAY have the number 2; numbers must be unique within a project.",
      'The issue key "PAY-2" appears 2 times; it must be unique.',
    ]);
  });
});

describe("mapSentireExport: refusals", () => {
  it("refuses what is not an export, with a sentence", () => {
    expect(() => mapSentireExport("{nope")).toThrow(SentireExportError);
    expect(() => mapSentireExport("{nope")).toThrow("The export is not valid JSON.");
    expect(() => mapSentireExport(null)).toThrow(
      "The export must be a JSON object with one array of rows per table.",
    );
    expect(() => mapSentireExport([])).toThrow(
      "The export must be a JSON object with one array of rows per table.",
    );
    expect(() => mapSentireExport({})).toThrow("The export has no projects table.");
    expect(() => mapSentireExport({ projects: {} })).toThrow(
      "The export has no projects table.",
    );
  });

  it("maps an export with an empty projects table to an empty, valid plan", () => {
    const p = mapSentireExport({ projects: [] });
    expect(p.counts.projects).toBe(0);
    expect(p.issues).toEqual([]);
    expect(problems(p)).toEqual([]);
  });
});

describe("the fields that cannot be mapped", () => {
  const p = planOf();

  it("every plan lists them, the same list", () => {
    expect(p.unmapped).toEqual(UNMAPPED_SENTIRE_FIELDS);
    expect(p.unmapped.length).toBeGreaterThanOrEqual(15);
  });

  it("each one has a reason, and none contains a dash", () => {
    for (const u of p.unmapped) {
      expect(u.field.length).toBeGreaterThan(2);
      expect(u.reason.length).toBeGreaterThan(20);
      expect(`${u.field} ${u.reason}`).not.toMatch(DASHES);
    }
  });

  it("names the secrets and the fields the Portal has no place for", () => {
    const fields = p.unmapped.map((u) => u.field).join("\n");
    for (const f of [
      "users.passwordHash",
      "users.role",
      "apiTokens",
      "sessions",
      "notifications",
      "projects.archivedAt",
      "issues.deletedAt",
      "issues.fingerprint",
      "milestones.closedAt",
      "comments.actorKind, comments.sessionId",
      "workSessions",
      "githubLinks",
      "securityAudits",
    ]) {
      expect(fields, f).toContain(f);
    }
  });
});

describe("validateImportPlan", () => {
  it("accepts the mapped plan", () => {
    expect(problems(planOf())).toEqual([]);
  });

  it("refuses what is not a plan", () => {
    expect(problems(null)).toEqual(["The plan must be a JSON object."]);
    expect(problems([])).toEqual(["The plan must be a JSON object."]);
    const wrong = plan();
    wrong.format = "other";
    wrong.version = 2;
    expect(problems(wrong)).toEqual([
      'The plan\'s format must be "portal-projects-import-plan".',
      "The plan is version 2; this check knows version 1.",
    ]);
    const empty = problems({ format: IMPORT_PLAN_FORMAT, version: 1 });
    expect(empty).toContain('The plan has no "projects" list.');
    expect(empty).toHaveLength(13);
  });

  it("projects: key, name, status, parent, loop, counter", () => {
    const p = plan();
    p.projects[0].key = "bks";
    p.projects[1].parentKey = "NOPE";
    p.projects[2].name = " ";
    p.projects.push({
      ...p.projects[1],
      key: "ZZ",
      parentKey: "ZY",
      status: "WRONG",
      issueCounter: -1,
    });
    p.projects.push({ ...p.projects[1], key: "ZY", parentKey: "ZZ", issueCounter: 0 });
    p.projects.push({
      ...p.projects[1],
      key: "SELF",
      parentKey: "SELF",
      issueCounter: 0,
    });
    const out = problems(p);
    expect(out).toContain(
      'The project key "bks" is not valid: use 2 to 10 capital letters or digits, starting with a letter.',
    );
    expect(out).toContain(
      'Project PAY has the parent project "NOPE", which is not in the plan.',
    );
    expect(out).toContain("Project PAYAPI has no name.");
    expect(out).toContain(
      'Project ZZ has the status "WRONG", which is not one of NOT_STARTED, ON_TRACK, AT_RISK, OFF_TRACK, ON_HOLD, FINISHED.',
    );
    expect(out).toContain("These projects are each other's parent in a loop: ZZ, ZY.");
    expect(out).toContain("Project SELF is its own parent.");
    expect(out).toContain(
      "Project ZZ has the issue counter -1; it must be a whole number, 0 or more.",
    );
    expect(out.filter((s) => s.includes("loop"))).toHaveLength(1);
  });

  it("projects: a counter below the highest issue number would reuse numbers", () => {
    const p = plan();
    p.projects.find((x: { key: string }) => x.key === "PAY").issueCounter = 3;
    expect(problems(p)).toEqual([
      "Project PAY has the issue counter 3, below its highest issue number 5; numbers would be reused.",
    ]);
  });

  it("types, statuses and labels: names, colours, categories, the default", () => {
    const p = plan();
    p.issueTypes[1].name = "task";
    p.issueTypes[2].colour = "red";
    p.statuses[1].category = "OPEN";
    p.statuses[1].isDefault = true;
    p.statuses[2].name = "new";
    p.labels[0].colour = "#12345";
    p.labels[1].name = "FRONTEND";
    const out = problems(p);
    expect(out).toContain('The issue type "task" appears 2 times; it must be unique.');
    expect(out).toContain('The issue type "Feature" has the colour "red"; use #rrggbb.');
    expect(out).toContain(
      'The issue status "In progress" has the category "OPEN"; it must be TODO, IN_PROGRESS or DONE.',
    );
    expect(out).toContain('The issue status "new" appears 2 times; it must be unique.');
    expect(out).toContain("Exactly one issue status must be the default; 2 are.");
    expect(out).toContain('The label "frontend" has the colour "#12345"; use #rrggbb.');
    expect(out).toContain('The label "frontend" appears 2 times; it must be unique.');
  });

  it("milestones: project, name, state, dates, order of dates, duplicates", () => {
    const p = plan();
    p.milestones[0].projectKey = "NOPE";
    p.milestones[1].state = "DONE";
    p.milestones[1].dueDate = "2026-02-30";
    p.milestones.push({
      ...p.milestones[1],
      name: "Reversed",
      state: "OPEN",
      startDate: "2026-12-31",
      dueDate: "2026-12-01",
      createdAt: "yesterday",
    });
    p.milestones.push({
      ...p.milestones[1],
      name: "LAUNCH",
      state: "OPEN",
      dueDate: null,
    });
    const out = problems(p);
    expect(out).toContain(
      'Milestone "Beta" of NOPE belongs to the project "NOPE", which is not in the plan.',
    );
    expect(out).toContain(
      'Milestone "Launch" of PAY has the state "DONE"; it must be OPEN, LOCKED or CLOSED.',
    );
    expect(out).toContain(
      'Milestone "Launch" of PAY has dueDate "2026-02-30", which is not a valid date (YYYY-MM-DD).',
    );
    expect(out).toContain(
      'Milestone "Reversed" of PAY starts (2026-12-31) after it is due (2026-12-01).',
    );
    expect(out).toContain(
      'Milestone "Reversed" of PAY has createdAt "yesterday", which is not a valid date and time.',
    );
    expect(out).toContain(
      'The milestone "pay: launch" appears 2 times; it must be unique.',
    );
  });

  it("issues: key, number, project, matching key, duplicates", () => {
    const p = plan();
    const at = (k: string) => p.issues.find((i: { key: string }) => i.key === k);
    at("PAY-1").key = "pay-1";
    at("PAY-2").number = 0;
    at("PAY-3").projectKey = "NOPE";
    at("PAY-4").key = "PAY-9";
    at("PAY-5").number = 1;
    const out = problems(p);
    expect(out).toContain(
      'The issue key "pay-1" is not valid: use a project key, a dash and a number from 1 (for example PAY-12).',
    );
    expect(out).toContain(
      "Issue PAY-2 has the number 0; it must be a whole number from 1.",
    );
    expect(out).toContain(
      'Issue PAY-3 belongs to the project "NOPE", which is not in the plan.',
    );
    expect(out).toContain("Issue PAY-9 does not match its project and number (PAY-4).");
    expect(out).toContain(
      "Two issues of PAY have the number 1; numbers must be unique within a project.",
    );
    expect(out).toContain("Issue PAY-5 does not match its project and number (PAY-1).");
  });

  it("issues: type, status, priority, milestone, label, person, title", () => {
    const p = plan();
    const i = p.issues.find((x: { key: string }) => x.key === "PAY-1");
    i.type = "Chore";
    i.status = "Parked";
    i.priority = "SOON";
    i.milestone = "Gamma";
    i.labels = ["frontend", "ghost"];
    i.assigneeEmail = "nobody@example.test";
    i.authorEmail = "other@example.test";
    i.title = " ";
    const out = problems(p);
    expect(out).toEqual([
      "Issue PAY-1 has no title.",
      'Issue PAY-1 has the type "Chore", which is not in the list of issue types.',
      'Issue PAY-1 has the status "Parked", which is not in the list of issue statuses.',
      'Issue PAY-1 has the priority "SOON"; it must be LOW, NORMAL, HIGH or URGENT.',
      'Issue PAY-1 is in the milestone "Gamma", which PAY does not have.',
      'Issue PAY-1 has the label "ghost", which is not in the list of labels.',
      'Issue PAY-1 names "nobody@example.test" as assignee, who is not in the list of people.',
      'Issue PAY-1 names "other@example.test" as author, who is not in the list of people.',
    ]);
  });

  it("issues: a parent that does not exist, itself, or a loop", () => {
    const p = plan();
    const at = (k: string) => p.issues.find((i: { key: string }) => i.key === k);
    at("PAY-2").parentKey = "PAY-99";
    at("PAY-4").parentKey = "PAY-4";
    at("PAY-5").parentKey = "PAYAPI-1";
    at("PAYAPI-1").parentKey = "PAY-5";
    const out = problems(p);
    expect(out).toContain(
      'Issue PAY-2 has the parent "PAY-99", which is not in the plan.',
    );
    expect(out).toContain("Issue PAY-4 is its own parent.");
    expect(out).toContain(
      "These issues are each other's parent in a loop: PAY-5, PAYAPI-1.",
    );
    expect(out).toHaveLength(3);
  });

  it("dates: calendar days and times must be real", () => {
    const p = plan();
    const i = p.issues.find((x: { key: string }) => x.key === "PAY-1");
    i.startDate = "2026-13-01";
    i.dueDate = "20/11/2026";
    i.createdAt = null;
    i.updatedAt = "2026-11-02 00:00";
    i.closedAt = "2026-02-30T00:00:00.000Z";
    const out = problems(p);
    expect(out).toContain(
      'Issue PAY-1 has startDate "2026-13-01", which is not a valid date (YYYY-MM-DD).',
    );
    expect(out).toContain(
      'Issue PAY-1 has dueDate "20/11/2026", which is not a valid date (YYYY-MM-DD).',
    );
    expect(out).toContain("Issue PAY-1 has no createdAt.");
    expect(out).toContain(
      'Issue PAY-1 has updatedAt "2026-11-02 00:00", which is not a valid date and time.',
    );
    expect(out).toContain(
      'Issue PAY-1 has closedAt "2026-02-30T00:00:00.000Z", which is not a valid date and time.',
    );
    expect(out).toHaveLength(5);
    expect(problems(plan())).toEqual([]);
    const leap = plan();
    leap.issues[0].startDate = "2028-02-29";
    expect(problems(leap)).toEqual([]);
  });

  it("everything that points at something: comments, updates, sessions, activity, links, audits", () => {
    const p = plan();
    p.comments[0].issueKey = "PAY-77";
    p.comments[1].sessionRef = "PAY#9";
    p.comments[1].authorEmail = "who@example.test";
    p.comments[2].body = " ";
    p.statusUpdates[0].projectKey = "NOPE";
    p.statusUpdates[1].status = "GREAT";
    p.sessions[0].issuesTouched = ["PAY-1", "PAY-88"];
    p.sessions[1].ref = "PAY#1";
    p.activities[0].projectKey = "NOPE";
    p.activities[1].issueKey = "PAY-66";
    p.githubLinks[0].kind = "branch";
    p.githubLinks[1].url = p.githubLinks[0].url;
    p.githubLinks[1].issueKey = p.githubLinks[0].issueKey;
    p.securityAudits[0].issueKeys = ["PAY-5", "PAY-55"];
    p.securityAudits[0].importedByEmail = "who@example.test";
    const out = problems(p);
    for (const s of [
      'Comment 1 (on PAY-77) points to the issue "PAY-77", which is not in the plan.',
      'Comment 2 (on PAY-1) points to the work session "PAY#9", which is not in the plan.',
      'Comment 2 (on PAY-1) names "who@example.test" as author, who is not in the list of people.',
      "Comment 3 (on PAY-5) is empty.",
      'Status update 1 of NOPE belongs to the project "NOPE", which is not in the plan.',
      'Status update 2 of PAY has the status "GREAT", which is not one of NOT_STARTED, ON_TRACK, AT_RISK, OFF_TRACK, ON_HOLD, FINISHED.',
      'Work session PAY#1 points to the issue "PAY-88", which is not in the plan.',
      'The work session ref "PAY#1" appears 2 times; it must be unique.',
      'Activity 1 (linked) belongs to the project "NOPE", which is not in the plan.',
      'Activity 2 (session) points to the issue "PAY-66", which is not in the plan.',
      'GitHub link "https://git.example.test/invented/pay/commit/0123456" has the kind "branch"; it must be pr or commit.',
      'GitHub link "https://git.example.test/invented/pay/commit/0123456" appears twice on PAY-1.',
      'Security audit 1 of PAY points to the issue "PAY-55", which is not in the plan.',
      'Security audit 1 of PAY names "who@example.test" as importer, who is not in the list of people.',
    ]) {
      expect(out, s).toContain(s);
    }
  });

  it("people: an e-mail must be lower case and a real address, and unique", () => {
    const p = plan();
    p.people[0].email = "Ana@Example.test";
    p.people[1].email = "no-at-sign";
    p.people.push({ email: "no-at-sign", name: "Dup" });
    const out = problems(p);
    expect(out).toContain(
      'A person has the e-mail "Ana@Example.test"; it must be an e-mail address in lower case.',
    );
    expect(out).toContain(
      'A person has the e-mail "no-at-sign"; it must be an e-mail address in lower case.',
    );
    expect(out).toContain('The person "no-at-sign" appears 2 times; it must be unique.');
  });

  it("refuses a plan that holds a password hash or a token hash", () => {
    for (const key of ["passwordHash", "password_hash", "tokenHash", "token_hash"]) {
      const p = plan();
      p.people[0][key] = "INVENTED";
      expect(problems(p)).toEqual([
        "The plan holds a password or token hash. Remove it: the Portal must never receive Sentire Projects secrets.",
      ]);
    }
  });

  it("returns at most the number of sentences asked for, and says how many more", () => {
    const p = plan();
    for (const i of p.issues) i.priority = "SOON";
    const all = problems(p);
    expect(all).toHaveLength(6);
    expect(problems(p, 4)).toEqual([...all.slice(0, 4), "And 2 more problems."]);
    const one = plan();
    for (const i of one.issues.slice(0, 2)) i.priority = "SOON";
    expect(problems(one, 1)).toEqual([
      expect.stringContaining("priority"),
      "And 1 more problem.",
    ]);
  });

  it("every sentence is plain text without a dash", () => {
    const p = plan();
    p.issues[0].type = "Chore";
    p.projects[0].key = "bks";
    p.milestones[0].dueDate = "nope";
    for (const s of problems(p)) {
      expect(s).not.toMatch(DASHES);
      expect(s.endsWith(".")).toBe(true);
    }
  });
});

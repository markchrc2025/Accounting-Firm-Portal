// briefing.spec.ts — PA3 (D67): the markdown briefing Claude reads at the start of a session.
// Compact on purpose; the layout follows Sentire Projects.
import { describeActivity, renderBriefing, type BriefingInput } from "./briefing";

const base = (): BriefingInput => ({
  project: {
    key: "PAY",
    name: "Payroll",
    description: "Payroll for the firm.",
    status: "AT_RISK",
    statusNote: "Waiting on the BIR table",
    statusUpdatedAt: new Date("2026-11-09T02:30:00Z"),
    repoUrl: "https://github.com/example/payroll",
    liveUrl: "https://payroll.example.test",
    deployAppName: "payroll-app",
  },
  counts: { todo: 4, inProgress: 2, done: 7, overdue: 1, bugsOpen: 2 },
  milestones: [
    {
      name: "Beta",
      dueDate: "2026-11-01",
      done: 3,
      total: 4,
      state: "OPEN",
      overdue: true,
    },
    { name: "GA", dueDate: null, done: 0, total: 0, state: "LOCKED", overdue: false },
  ],
  inProgress: [
    {
      key: "PAY-3",
      status: "In progress",
      type: "Bug",
      priority: "HIGH",
      title: "Fix rounding",
      assignee: "Ana Cruz",
      milestone: "Beta",
      dueDate: "2026-11-02",
      overdue: true,
      labels: ["tax", "urgent"],
    },
  ],
  todo: [
    {
      key: "PAY-5",
      status: "New",
      type: "Task",
      priority: "NORMAL",
      title: "Write the export",
      assignee: null,
      milestone: null,
      dueDate: null,
      overdue: false,
      labels: [],
    },
  ],
  sessions: [
    {
      startedAt: new Date("2026-11-08T01:00:00Z"),
      client: "claude-code",
      userName: "Ana Cruz",
      title: "Rounding",
      summary: "Fixed PAY-3 half way.",
      endedAt: new Date("2026-11-08T03:00:00Z"),
      nextSteps: "Finish PAY-3 and test PAY-5.",
    },
    {
      startedAt: new Date("2026-11-07T01:00:00Z"),
      client: "claude.ai",
      userName: null,
      title: "",
      summary: "",
      endedAt: null,
      nextSteps: "",
    },
  ],
  activity: [
    {
      at: new Date("2026-11-09T05:00:00Z"),
      actor: "Ana Cruz",
      text: "PAY-3 status New to In progress",
    },
    { at: new Date("2026-11-09T04:00:00Z"), actor: "Claude", text: "PAY-5 created" },
  ],
});

describe("PA3 · the briefing", () => {
  it("has the project header, status, links, counts, then the sections in order", () => {
    const md = renderBriefing(base());
    const lines = md.split("\n");
    expect(lines[0]).toBe("# PAY: Payroll");
    expect(md).toContain("Payroll for the firm.");
    expect(md).toContain(
      'Status: At risk, "Waiting on the BIR table" (updated 2026-11-09 10:30)',
    );
    expect(md).toContain("Repo: https://github.com/example/payroll");
    expect(md).toContain("Live: https://payroll.example.test");
    expect(md).toContain("Deployed as: payroll-app");
    expect(md).toContain(
      "Issues: 4 to do, 2 in progress, 7 done, 1 overdue, 2 open bugs.",
    );
    const heads = lines.filter((l) => l.startsWith("## "));
    expect(heads).toEqual([
      "## Open milestones",
      "## In progress",
      "## To do (highest priority first)",
      "## Recent Claude sessions",
      "## Recent activity",
    ]);
  });

  it("milestones show due date, overdue flag, progress and a locked flag", () => {
    const md = renderBriefing(base());
    expect(md).toContain("- Beta due 2026-11-01 (OVERDUE): 3/4 done (75%)");
    expect(md).toContain("- GA: 0/0 done (0%), locked");
  });

  it("an issue line shows key, status, type unless Task, priority unless Normal, title and its details", () => {
    const md = renderBriefing(base());
    expect(md).toContain(
      "- PAY-3 [In progress] Bug HIGH Fix rounding (@Ana Cruz, ms: Beta, due 2026-11-02 (OVERDUE), #tax #urgent)",
    );
    expect(md).toContain("- PAY-5 [New] Write the export");
    expect(md).not.toContain("Write the export (");
  });

  it("sessions show the summary, 'still open' for an open one, and the next steps on their own line", () => {
    const md = renderBriefing(base());
    expect(md).toContain(
      "- 2026-11-08 09:00 (claude-code, Ana Cruz) Rounding: Fixed PAY-3 half way.",
    );
    expect(md).toContain("  Next: Finish PAY-3 and test PAY-5.");
    expect(md).toContain("- 2026-11-07 09:00 (claude.ai): still open");
  });

  it("activity is one line each in Manila time, newest first as given", () => {
    const md = renderBriefing(base());
    expect(md).toContain("- 2026-11-09 13:00 Ana Cruz: PAY-3 status New to In progress");
    expect(md).toContain("- 2026-11-09 12:00 Claude: PAY-5 created");
  });

  it("empty sections say none, and the sessions section is left out when there are none", () => {
    const empty = base();
    empty.milestones = [];
    empty.inProgress = [];
    empty.todo = [];
    empty.sessions = [];
    empty.activity = [];
    empty.project.statusNote = null;
    empty.project.statusUpdatedAt = null;
    empty.project.repoUrl = "";
    empty.project.liveUrl = "";
    empty.project.deployAppName = "";
    empty.project.description = "";
    const md = renderBriefing(empty);
    expect(md).toContain("## Open milestones\n- none");
    expect(md).toContain("## In progress\n- none");
    expect(md).toContain("## To do (highest priority first)\n- none");
    expect(md).not.toContain("Recent Claude sessions");
    expect(md).not.toContain("Repo:");
    expect(md).not.toContain("Live:");
    expect(md).not.toContain("Deployed as:");
    expect(md).toContain("Status: At risk\n");
  });
});

describe("PA3 · one line per activity row", () => {
  it("names the subject, the verb and up to three changes", () => {
    expect(
      describeActivity({
        action: "issue.updated",
        issueKey: "PAY-3",
        changes: [
          { field: "status", old: "New", new: "In progress" },
          { field: "assignee", old: null, new: "Ana" },
        ],
      }),
    ).toBe("PAY-3 updated: status New to In progress, assignee set to Ana");
    expect(
      describeActivity({ action: "project.updated", issueKey: null, changes: [] }),
    ).toBe("project updated");
    expect(
      describeActivity({ action: "something.new", issueKey: "A-1", changes: [] }),
    ).toBe("A-1 something.new");
  });

  it("long values are cut so a line stays a line", () => {
    const line = describeActivity({
      action: "comment.added",
      issueKey: "PAY-1",
      changes: [{ field: "comment", old: null, new: "x".repeat(300) }],
    });
    expect(line.length).toBeLessThan(100);
    expect(line.endsWith("...")).toBe(true);
  });
});

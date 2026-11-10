// PB1: the rules behind the Projects screens, with no screen: the filters and views kept in the
// address, activity grouped by Manila day, a change in plain words, who may do what, the API's
// refusals as sent, and the dates. All data is invented.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  actorName,
  activityHeadline,
  DEFAULT_FILTERS,
  dayText,
  describeChange,
  errorLines,
  filtersToQuery,
  filtersToSearch,
  groupByManilaDay,
  hasNarrowing,
  manilaDay,
  momentText,
  parseFilters,
  projectsCan,
  PROJECT_KEY_RE,
  withView,
  type IssueFilters,
} from "./projects";

const sp = (s: string) => new URLSearchParams(s);

describe("PB1 filters and views, kept in the address", () => {
  it("an empty address is the Open view, newest update first, nothing narrowed", () => {
    expect(parseFilters(sp(""))).toEqual(DEFAULT_FILTERS);
    expect(hasNarrowing(DEFAULT_FILTERS)).toBe(false);
  });

  it("every filter survives the address and back", () => {
    const f: IssueFilters = {
      view: "bugs",
      q: "login page",
      state: "all",
      statusId: "11111111-1111-4111-8111-111111111111",
      typeId: "22222222-2222-4222-8222-222222222222",
      assigneeId: "none",
      milestoneId: "none",
      labelId: "33333333-3333-4333-8333-333333333333",
      priority: "HIGH",
      sort: "due",
    };
    expect(parseFilters(filtersToSearch(f))).toEqual(f);
  });

  it("the address holds only what is not the default", () => {
    expect(filtersToSearch(DEFAULT_FILTERS).toString()).toBe("");
    expect(filtersToSearch({ ...DEFAULT_FILTERS, view: "mine" }).toString()).toBe(
      "view=mine",
    );
    expect(filtersToSearch({ ...DEFAULT_FILTERS, sort: "priority" }).toString()).toBe(
      "sort=priority",
    );
  });

  it("the selected issue is kept when the filters change", () => {
    const next = filtersToSearch(
      { ...DEFAULT_FILTERS, view: "closed" },
      sp("issue=PAY-12&view=open"),
    );
    expect(next.get("issue")).toBe("PAY-12");
    expect(next.get("view")).toBe("closed");
  });

  it("unknown words in the address fall back to the defaults", () => {
    const f = parseFilters(sp("view=nonsense&sort=sideways&priority=SOON&state=maybe"));
    expect(f.view).toBe("open");
    expect(f.sort).toBe("updated");
    expect(f.priority).toBe("");
    expect(f.state).toBe("");
  });

  it("asks the API for the view and for every filter that is set, and only those", () => {
    expect(filtersToQuery(DEFAULT_FILTERS)).toEqual({
      view: "open",
      sort: "updated",
      limit: "200",
    });
    expect(
      filtersToQuery({
        ...DEFAULT_FILTERS,
        view: "mine",
        q: "  billing  ",
        state: "closed",
        statusId: "S",
        typeId: "T",
        assigneeId: "me",
        milestoneId: "none",
        labelId: "L",
        priority: "URGENT",
        sort: "key",
      }),
    ).toEqual({
      view: "mine",
      sort: "key",
      limit: "200",
      q: "billing",
      state: "closed",
      statusId: "S",
      typeId: "T",
      assigneeId: "me",
      milestoneId: "none",
      labelId: "L",
      priority: "URGENT",
    });
  });

  it("choosing a view hands the open/closed/all choice back to the view", () => {
    const f = withView({ ...DEFAULT_FILTERS, state: "closed", q: "x" }, "overdue");
    expect(f.view).toBe("overdue");
    expect(f.state).toBe("");
    expect(f.q).toBe("x");
  });

  it("anything that narrows the list is noticed", () => {
    expect(hasNarrowing({ ...DEFAULT_FILTERS, q: "a" })).toBe(true);
    expect(hasNarrowing({ ...DEFAULT_FILTERS, assigneeId: "none" })).toBe(true);
    expect(hasNarrowing({ ...DEFAULT_FILTERS, sort: "key" })).toBe(false);
  });
});

describe("PB1 dates are Asia/Manila", () => {
  it("a calendar date reads as that date, whatever the machine's zone", () => {
    expect(dayText("2026-11-10")).toBe("Nov 10, 2026");
    expect(dayText("2026-01-01")).toBe("Jan 01, 2026");
    expect(dayText(null)).toBe("");
  });

  it("a moment reads in Manila: 16:00 UTC is already the next morning", () => {
    expect(momentText("2026-11-10T16:00:00.000Z")).toBe("Nov 11, 2026, 12:00 AM");
    expect(momentText("2026-11-10T07:42:00.000Z")).toBe("Nov 10, 2026, 3:42 PM");
  });

  it("the day a moment falls on is its Manila day", () => {
    expect(manilaDay("2026-11-10T15:59:59.000Z")).toBe("2026-11-10");
    expect(manilaDay("2026-11-10T16:00:00.000Z")).toBe("2026-11-11");
  });
});

describe("PB1 activity grouped by Manila day", () => {
  const at = (iso: string, id: string) => ({ id, createdAt: iso });
  it("gathers entries under their Manila day, newest first, in the order given", () => {
    const groups = groupByManilaDay([
      at("2026-11-11T02:00:00.000Z", "a"), // Nov 11, 10:00 in Manila
      at("2026-11-10T16:05:00.000Z", "b"), // Nov 11, 00:05 in Manila: the same day as a
      at("2026-11-10T15:55:00.000Z", "c"), // Nov 10, 23:55 in Manila
      at("2026-11-09T01:00:00.000Z", "d"), // Nov 9, 09:00
    ]);
    expect(groups.map((g) => [g.day, g.items.map((i) => i.id)])).toEqual([
      ["2026-11-11", ["a", "b"]],
      ["2026-11-10", ["c"]],
      ["2026-11-09", ["d"]],
    ]);
    expect(groups[0]!.label).toBe("Wednesday, Nov 11, 2026");
  });

  it("no entries, no groups", () => {
    expect(groupByManilaDay([])).toEqual([]);
  });
});

describe("PB1 a change in plain words", () => {
  it("old to new", () => {
    expect(
      describeChange(
        { field: "status", old: "New", new: "In progress" },
        "issue.updated",
      ),
    ).toBe("Status changed from New to In progress.");
  });
  it("set and cleared", () => {
    expect(
      describeChange({ field: "assignee", old: null, new: "Ana Reyes" }, "issue.updated"),
    ).toBe("Assignee set to Ana Reyes.");
    expect(
      describeChange({ field: "dueDate", old: "2026-11-10", new: null }, "issue.updated"),
    ).toBe("Due date cleared (was Nov 10, 2026).");
  });
  it("dates, priorities and milestone states as words", () => {
    expect(
      describeChange(
        { field: "dueDate", old: "2026-11-10", new: "2026-11-30" },
        "issue.updated",
      ),
    ).toBe("Due date changed from Nov 10, 2026 to Nov 30, 2026.");
    expect(
      describeChange(
        { field: "priority", old: "NORMAL", new: "URGENT" },
        "issue.updated",
      ),
    ).toBe("Priority changed from Normal to Urgent.");
    expect(
      describeChange({ field: "state", old: "OPEN", new: "CLOSED" }, "milestone.updated"),
    ).toBe("State changed from Open to Closed.");
  });
  it("a project's status words", () => {
    expect(
      describeChange(
        { field: "status", old: "NOT_STARTED", new: "AT_RISK" },
        "project.status",
      ),
    ).toBe("Status changed from Not started to At risk.");
  });
  it("a rewritten description says so without the text", () => {
    expect(
      describeChange(
        { field: "description", old: "(previous text)", new: "(new text)" },
        "issue.updated",
      ),
    ).toBe("Description changed.");
  });
  it("a comment shows what was said; the fields that only repeat the headline show nothing", () => {
    expect(
      describeChange({ field: "comment", old: null, new: "Looks good" }, "comment.added"),
    ).toBe("Comment: Looks good");
    expect(
      describeChange({ field: "archived", old: false, new: true }, "project.archived"),
    ).toBeNull();
    expect(
      describeChange({ field: "deleted", old: false, new: true }, "issue.deleted"),
    ).toBeNull();
  });
  it("says who acted and what was done", () => {
    expect(
      actorName({ actorType: "USER", actor: { id: "u", fullName: "Ana Reyes" } }),
    ).toBe("Ana Reyes");
    expect(
      actorName({ actorType: "CLAUDE", actor: { id: "u", fullName: "Ana Reyes" } }),
    ).toBe("Claude");
    expect(actorName({ actorType: "GITHUB", actor: null })).toBe("GitHub");
    expect(actorName({ actorType: "SYSTEM", actor: null })).toBe("System");
    expect(activityHeadline({ action: "issue.created", issueKey: "PAY-3" })).toBe(
      "created PAY-3",
    );
    expect(activityHeadline({ action: "comment.added", issueKey: "PAY-3" })).toBe(
      "commented on PAY-3",
    );
    expect(activityHeadline({ action: "project.status", issueKey: null })).toBe(
      "posted a status update",
    );
  });
});

describe("PB1 who may do what", () => {
  const has =
    (...p: string[]) =>
    (x: string) =>
      p.includes(x);
  it("a Viewer reads and nothing else", () => {
    expect(projectsCan({ userType: "FIRM" }, has("Projects:Read"))).toEqual({
      read: true,
      create: false,
      update: false,
      configure: false,
    });
  });
  it("the four permissions are separate", () => {
    const c = projectsCan(
      { userType: "FIRM" },
      has("Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"),
    );
    expect(c).toEqual({ read: true, create: true, update: true, configure: true });
    expect(projectsCan({ userType: "FIRM" }, has("Projects:Update")).read).toBe(false);
  });
  it("a client user never has any, even if a permission is somehow granted", () => {
    expect(
      projectsCan({ userType: "CLIENT" }, has("Projects:Read", "Projects:Update")),
    ).toEqual({ read: false, create: false, update: false, configure: false });
    expect(projectsCan(null, has("Projects:Read")).read).toBe(false);
  });
});

describe("PB1 the API's refusals, as sent", () => {
  it("a 400 Validation failed lists the message of each error", () => {
    const e = new ApiError(400, "Validation failed", {
      message: "Validation failed",
      errors: [
        { path: "name", message: "String must contain at least 1 character(s)" },
        { path: "key", message: "Required" },
      ],
    });
    expect(errorLines(e)).toEqual([
      "String must contain at least 1 character(s)",
      "Required",
    ]);
  });
  it("any other refusal is its one sentence", () => {
    expect(
      errorLines(
        new ApiError(404, "Project not found.", { message: "Project not found." }),
      ),
    ).toEqual(["Project not found."]);
    expect(
      errorLines(new ApiError(403, "Missing permission(s): Projects:Update", {})),
    ).toEqual(["Missing permission(s): Projects:Update"]);
    expect(
      errorLines(new ApiError(400, "A project with this key already exists.", {})),
    ).toEqual(["A project with this key already exists."]);
  });
  it("a failure with no sentence says something plain", () => {
    expect(errorLines(new TypeError("x"), "Could not save.")).toEqual([
      "Could not save.",
    ]);
  });
});

describe("PB1 the project key hint", () => {
  it("matches the API's format: 2 to 10 capitals or digits, starting with a letter", () => {
    for (const ok of ["PAY", "A1", "ABCDEFGHI9"])
      expect(PROJECT_KEY_RE.test(ok)).toBe(true);
    for (const bad of ["P", "1AB", "pay", "ABCDEFGHIJK", "PA-Y", ""])
      expect(PROJECT_KEY_RE.test(bad)).toBe(false);
  });
});

describe("PB1 no em dash in any Projects text", () => {
  const roots = [
    join(__dirname, "..", "pages", "projects"),
    join(__dirname, "..", "components", "projects"),
  ];
  const files = [
    ...roots.flatMap((r) =>
      readdirSync(r)
        .map((f) => join(r, f))
        .filter(
          (f) => statSync(f).isFile() && /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f),
        ),
    ),
    join(__dirname, "projects.ts"),
    join(__dirname, "markdown.ts"),
  ];
  it("scans the Projects sources", () => {
    expect(files.length).toBeGreaterThan(10);
    const bad = files.filter((f) => readFileSync(f, "utf8").includes("—"));
    expect(bad).toEqual([]);
  });
});

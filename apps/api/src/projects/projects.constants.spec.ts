// projects.constants.spec.ts — PA1 (D65): the pure rules of the Projects module.
import {
  firmPermissionCatalog,
  isFirmPermission,
  DEFAULT_ROLES,
} from "../rbac/permissions.constants";
import {
  addDays,
  DEFAULT_ISSUE_STATUSES,
  DONE_WINDOW_DAYS,
  doneSince,
  manilaDayStart,
  NOTIFICATION_KINDS,
  DEFAULT_ISSUE_TYPES,
  diffFields,
  dayOf,
  dayToDate,
  isOverdue,
  isRealDate,
  ISSUE_KEY_RE,
  manilaToday,
  MESSAGES,
  percent,
  PROJECT_KEY_RE,
  PROJECTS_PERMISSION,
} from "./projects.constants";

describe("PA1 · project keys and issue keys", () => {
  it("a project key is 2 to 10 capital letters or digits, starting with a letter", () => {
    for (const ok of ["PA", "PAY", "A1", "ABCDEFGHIJ", "P2P", "X9Y8Z7"])
      expect(PROJECT_KEY_RE.test(ok)).toBe(true);
    for (const bad of [
      "P",
      "1AB",
      "ABCDEFGHIJK",
      "pay",
      "PA-Y",
      "PA Y",
      "",
      "ÑAB",
      "AB_C",
    ]) {
      expect(PROJECT_KEY_RE.test(bad)).toBe(false);
    }
  });

  it("an issue key is a project key, a dash and a number", () => {
    expect(ISSUE_KEY_RE.exec("PAY-12")?.slice(1)).toEqual(["PAY", "12"]);
    for (const bad of ["PAY12", "PAY-", "pay-1", "P-1", "PAY-1234567890", "PAY-1-2"]) {
      expect(ISSUE_KEY_RE.test(bad)).toBe(false);
    }
  });
});

describe("PA1 · overdue is by the Manila date", () => {
  const at = (iso: string) => manilaToday(Date.parse(iso));

  it("the Manila day changes at 16:00 UTC", () => {
    expect(at("2026-11-10T15:59:59.999Z")).toBe("2026-11-10");
    expect(at("2026-11-10T16:00:00.000Z")).toBe("2026-11-11");
    expect(at("2026-12-31T16:00:00.000Z")).toBe("2027-01-01");
    expect(at("2026-11-10T00:00:00.000Z")).toBe("2026-11-10");
  });

  it("due before today and not done is overdue; due today is not; done is never", () => {
    expect(isOverdue("2026-11-09", "TODO", "2026-11-10")).toBe(true);
    expect(isOverdue("2026-11-09", "IN_PROGRESS", "2026-11-10")).toBe(true);
    expect(isOverdue("2026-11-10", "TODO", "2026-11-10")).toBe(false);
    expect(isOverdue("2026-11-09", "DONE", "2026-11-10")).toBe(false);
    expect(isOverdue(null, "TODO", "2026-11-10")).toBe(false);
  });

  it("dates are real dates written YYYY-MM-DD", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2028-02-29")).toBe(true);
    for (const bad of [
      "2026-02-30",
      "2026-13-01",
      "26-01-01",
      "2026-1-1",
      "tomorrow",
      "",
    ]) {
      expect(isRealDate(bad)).toBe(false);
    }
    expect(dayOf(dayToDate("2026-11-10"))).toBe("2026-11-10");
    expect(dayOf(null)).toBeNull();
  });
});

describe("PA1 · small rules", () => {
  it("diffFields lists the fields that changed, in the order asked, old and new", () => {
    expect(
      diffFields({ a: 1, b: "x", c: null }, { a: 2, b: "x", c: "y", d: 1 }, [
        "a",
        "b",
        "c",
        "d",
      ]),
    ).toEqual([
      { field: "a", old: 1, new: 2 },
      { field: "c", old: null, new: "y" },
      { field: "d", old: null, new: 1 },
    ]);
    expect(diffFields({ a: 1 }, { a: 1 }, ["a"])).toEqual([]);
  });

  it("percent is a whole number, 0 for nothing to do", () => {
    expect([percent(0, 0), percent(1, 3), percent(2, 3), percent(3, 3)]).toEqual([
      0, 33, 67, 100,
    ]);
  });

  it("the starting types and statuses are the owner's, with one default that is a to do status", () => {
    expect(DEFAULT_ISSUE_TYPES.map((t) => t.name)).toEqual([
      "Task",
      "Bug",
      "Feature",
      "Epic",
    ]);
    expect(DEFAULT_ISSUE_STATUSES.map((s) => [s.name, s.category])).toEqual([
      ["New", "TODO"],
      ["In progress", "IN_PROGRESS"],
      ["Blocked", "IN_PROGRESS"],
      ["In review", "IN_PROGRESS"],
      ["Done", "DONE"],
      ["Won't do", "DONE"],
    ]);
    const defaults = DEFAULT_ISSUE_STATUSES.filter((s) => s.isDefault);
    expect(defaults.map((s) => s.name)).toEqual(["New"]);
  });

  it("every message is one plain sentence with no dash in it", () => {
    const texts = Object.values(MESSAGES).flatMap((m) =>
      typeof m === "function"
        ? [
            (m as (x: number | string) => string)(1),
            (m as (x: number | string) => string)(2),
            (m as (x: number | string) => string)("PAY"),
          ]
        : [m],
    );
    for (const t of texts) {
      expect(t).not.toMatch(/[‒-―]/); // no figure, en or em dash
      expect(t).toMatch(/\.$/);
    }
  });
});

describe("PA1 · the permissions", () => {
  it("Projects has four permissions, and Super Admin holds all four by default", () => {
    expect(
      firmPermissionCatalog().find((r) => r.resource === "Projects")?.actions,
    ).toEqual(["Read", "Create", "Update", "Configure"]);
    for (const p of Object.values(PROJECTS_PERMISSION))
      expect(isFirmPermission(p)).toBe(true);
    const admin = DEFAULT_ROLES.find((r) => r.name === "Super Admin")!;
    for (const p of Object.values(PROJECTS_PERMISSION))
      expect(admin.permissions).toContain(p);
    // no other default role gets Projects: the owner assigns them in the role editor
    for (const r of DEFAULT_ROLES.filter((x) => x.name !== "Super Admin")) {
      expect(r.permissions.filter((p) => p.startsWith("Projects:"))).toEqual([]);
    }
  });
});

describe("PA2 · the board's Done window and the notification kinds", () => {
  it("addDays moves a calendar day across months, years and leap days", () => {
    expect(addDays("2026-11-10", 1)).toBe("2026-11-11");
    expect(addDays("2026-11-10", -14)).toBe("2026-10-27");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-11-10", 0)).toBe("2026-11-10");
  });

  it("a Manila day begins at 16:00 UTC the day before", () => {
    expect(manilaDayStart("2026-11-10").toISOString()).toBe("2026-11-09T16:00:00.000Z");
  });

  it("the Done window is today and the 14 days before it, by Manila days", () => {
    expect(DONE_WINDOW_DAYS).toBe(14);
    expect(doneSince("2026-11-10").toISOString()).toBe("2026-10-26T16:00:00.000Z");
    // the first instant of the 14th day back is in; one millisecond before it is out
    const since = doneSince("2026-11-10").getTime();
    expect(new Date(since).toISOString()).toBe(
      manilaDayStart("2026-10-27").toISOString(),
    );
  });

  it("the four notification kinds are fixed strings", () => {
    expect(NOTIFICATION_KINDS).toEqual({
      assigned: "project.issue.assigned",
      commented: "project.issue.commented",
      status: "project.issue.status",
      closed: "project.issue.closed",
    });
  });
});

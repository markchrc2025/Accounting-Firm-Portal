// track-b-pb2-logic.test.ts - PB2: the maths behind the board and the roadmap. All data invented.
import { describe, expect, it } from "vitest";
import {
  findCard,
  indexAtPointer,
  planMove,
  positionFor,
  stepTarget,
  targetOf,
} from "./board";
import { dayNumber, roadmapLayout } from "./roadmap";
import type { Board, IssueItem, Milestone } from "./projects";

const NOW = "2026-11-10T04:00:00.000Z";
const st = (id: string, name: string, category: "TODO" | "IN_PROGRESS" | "DONE") => ({
  id,
  name,
  colour: "#57606a",
  category,
});
const card = (
  key: string,
  n: number,
  statusId: string,
  position: number,
  over = {},
): IssueItem => {
  const status = [
    st("s1", "To do", "TODO"),
    st("s2", "In progress", "IN_PROGRESS"),
    st("s3", "Done", "DONE"),
  ].find((s) => s.id === statusId)!;
  return {
    id: `id-${key}`,
    key,
    number: n,
    title: `Card ${key}`,
    priority: "NORMAL",
    startDate: null,
    dueDate: null,
    overdue: false,
    position,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    closedAt: status.category === "DONE" ? "2026-11-08T02:00:00.000Z" : null,
    project: { key: "PAY", name: "Payments" },
    type: { id: "t", name: "Task", colour: "#57606a" },
    status,
    assignee: null,
    milestone: null,
    parentKey: null,
    labels: [],
    ...over,
  };
};
const board = (): Board => ({
  today: "2026-11-10",
  doneRange: "14d",
  doneSince: "2026-10-27T00:00:00.000Z",
  total: 5,
  columns: [
    {
      status: { ...st("s1", "To do", "TODO"), isDefault: true },
      items: [
        card("PAY-1", 1, "s1", 1),
        card("PAY-2", 2, "s1", 2),
        card("PAY-3", 3, "s1", 3),
      ],
      olderHidden: 0,
    },
    {
      status: { ...st("s2", "In progress", "IN_PROGRESS"), isDefault: false },
      items: [card("PAY-4", 4, "s2", 10, { dueDate: "2026-11-01", overdue: true })],
      olderHidden: 0,
    },
    {
      status: { ...st("s3", "Done", "DONE"), isDefault: false },
      items: [card("PAY-5", 5, "s3", 1)],
      olderHidden: 2,
    },
  ],
});
const keys = (b: Board, col: number) => b.columns[col]!.items.map((i) => i.key);

describe("PB2 board: where a card lands", () => {
  it("a position is the middle between neighbours, one beyond an end, and 1 in an empty column", () => {
    expect(positionFor(1, 2)).toBe(1.5);
    expect(positionFor(3, undefined)).toBe(4);
    expect(positionFor(undefined, 1)).toBe(0);
    expect(positionFor(undefined, undefined)).toBe(1);
  });

  it("moving within a column reorders it and sends only a position", () => {
    const p = planMove(board(), "PAY-1", { statusId: "s1", index: 2 }, NOW)!;
    expect(keys(p.board, 0)).toEqual(["PAY-2", "PAY-3", "PAY-1"]);
    expect(p.position).toBe(4); // after PAY-3 (3)
    expect(p.statusId).toBeNull();
    expect(p.changed).toBe(true);
  });

  it("moving between two cards of another column takes the middle position and sends the status", () => {
    const p = planMove(board(), "PAY-3", { statusId: "s1", index: 1 }, NOW)!;
    expect(p.position).toBe(1.5);
    const q = planMove(board(), "PAY-1", { statusId: "s2", index: 0 }, NOW)!;
    expect(keys(q.board, 0)).toEqual(["PAY-2", "PAY-3"]);
    expect(keys(q.board, 1)).toEqual(["PAY-1", "PAY-4"]);
    expect(q.position).toBe(9); // before PAY-4 (10) is one step less
    expect(q.statusId).toBe("s2");
    expect(q.board.columns[1]!.items[0]!.status.name).toBe("In progress");
  });

  it("an empty column gives position 1; a place past the end is held at the end", () => {
    const b = board();
    b.columns[1]!.items = [];
    expect(planMove(b, "PAY-1", { statusId: "s2", index: 5 }, NOW)!.position).toBe(1);
    const p = planMove(board(), "PAY-1", { statusId: "s2", index: 99 }, NOW)!;
    expect(keys(p.board, 1)).toEqual(["PAY-4", "PAY-1"]);
    expect(p.position).toBe(11);
  });

  it("dropping a card where it already is changes nothing", () => {
    const p = planMove(board(), "PAY-2", { statusId: "s1", index: 1 }, NOW)!;
    expect(p.changed).toBe(false);
    expect(keys(p.board, 0)).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
  });

  it("into a Done column the card gets a closing moment; out of it, it loses it", () => {
    const into = planMove(board(), "PAY-4", { statusId: "s3", index: 0 }, NOW)!;
    const moved = into.board.columns[2]!.items[0]!;
    expect(moved.closedAt).toBe(NOW);
    expect(moved.overdue).toBe(false); // a done card is never overdue
    const out = planMove(board(), "PAY-5", { statusId: "s2", index: 0 }, NOW)!;
    expect(out.board.columns[1]!.items[0]!.closedAt).toBeNull();
    // within Done, the closing moment is kept
    const within = planMove(board(), "PAY-5", { statusId: "s3", index: 0 }, NOW)!;
    expect(within.board.columns[2]!.items[0]!.closedAt).toBe("2026-11-08T02:00:00.000Z");
  });

  it("an overdue card out of Done is overdue again", () => {
    const b = board();
    b.columns[2]!.items = [card("PAY-9", 9, "s3", 1, { dueDate: "2026-11-02" })];
    const out = planMove(b, "PAY-9", { statusId: "s1", index: 0 }, NOW)!;
    expect(out.board.columns[0]!.items[0]!.overdue).toBe(true);
  });

  it("unknown card or column gives nothing, and the original board is not touched", () => {
    const b = board();
    expect(planMove(b, "PAY-99", { statusId: "s1", index: 0 }, NOW)).toBeNull();
    expect(planMove(b, "PAY-1", { statusId: "nope", index: 0 }, NOW)).toBeNull();
    planMove(b, "PAY-1", { statusId: "s2", index: 0 }, NOW);
    expect(keys(b, 0)).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
    expect(findCard(b, "PAY-4")).toMatchObject({ column: 1, index: 0 });
  });
});

describe("PB2 board: the keyboard steps", () => {
  it("down and up move within the column and stop at its ends", () => {
    const b = board();
    let at = targetOf(b, "PAY-1")!;
    expect(at).toEqual({ statusId: "s1", index: 0 });
    at = stepTarget(b, "PAY-1", at, "up");
    expect(at.index).toBe(0);
    at = stepTarget(b, "PAY-1", at, "down");
    at = stepTarget(b, "PAY-1", at, "down");
    at = stepTarget(b, "PAY-1", at, "down");
    expect(at.index).toBe(2); // two other cards in the column: places 0, 1, 2
  });

  it("right and left change column, keep the row where there is room and stop at the last column", () => {
    const b = board();
    let at = { statusId: "s1", index: 2 };
    at = stepTarget(b, "PAY-3", at, "right");
    expect(at).toEqual({ statusId: "s2", index: 1 }); // In progress has one card: places 0 and 1
    at = stepTarget(b, "PAY-3", at, "right");
    expect(at.statusId).toBe("s3");
    expect(stepTarget(b, "PAY-3", at, "right")).toEqual(at);
    at = stepTarget(b, "PAY-3", { statusId: "s1", index: 0 }, "left");
    expect(at).toEqual({ statusId: "s1", index: 0 });
  });
});

describe("PB2 board: the pointer", () => {
  it("counts the card middles the pointer is below", () => {
    expect(indexAtPointer([100, 200, 300], 50)).toBe(0);
    expect(indexAtPointer([100, 200, 300], 150)).toBe(1);
    expect(indexAtPointer([100, 200, 300], 350)).toBe(3);
    expect(indexAtPointer([], 10)).toBe(0);
  });
});

const ms = (over: Partial<Milestone>): Milestone => ({
  id: "m",
  name: "M",
  description: "",
  startDate: null,
  dueDate: null,
  state: "OPEN",
  progress: { done: 0, total: 0, percent: 0 },
  percent: 0,
  today: "2026-11-10",
  overdueIssues: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

describe("PB2 roadmap bar maths", () => {
  it("counts calendar days without any time zone", () => {
    expect(dayNumber("2026-11-11") - dayNumber("2026-11-10")).toBe(1);
    expect(dayNumber("2026-03-01") - dayNumber("2026-02-01")).toBe(28);
  });

  it("puts bars and today on one axis from the earliest to the latest day", () => {
    // axis: Nov 1 to Nov 20 = 20 days
    const l = roadmapLayout(
      [
        ms({
          id: "a",
          startDate: "2026-11-01",
          dueDate: "2026-11-10",
          percent: 40,
          progress: { done: 2, total: 5, percent: 40 },
        }),
        ms({ id: "b", startDate: "2026-11-11", dueDate: "2026-11-20", percent: 0 }),
      ],
      "2026-11-05",
    );
    expect(l.axisStart).toBe("2026-11-01");
    expect(l.axisEnd).toBe("2026-11-20");
    const [a, b] = l.bars;
    expect(a!.left).toBe(0);
    expect(a!.width).toBe(50); // 10 of 20 days, both ends counted
    expect(a!.percent).toBe(40);
    expect(b!.left).toBe(50);
    expect(b!.width).toBe(50);
    expect(l.todayLeft).toBe(22.5); // the middle of day 5 (index 4): (4 + 0.5) / 20
  });

  it("a milestone with one date is a one day bar; a start after the due date is read the right way round", () => {
    const l = roadmapLayout(
      [
        ms({ id: "due", dueDate: "2026-11-20" }),
        ms({ id: "start", startDate: "2026-11-01" }),
        ms({ id: "flip", startDate: "2026-11-10", dueDate: "2026-11-05" }),
      ],
      "2026-11-10",
    );
    const by = (id: string) => l.bars.find((b) => b.id === id)!;
    expect(by("due").width).toBe(5); // 1 of 20
    expect(by("due").left).toBe(95);
    expect(by("start").left).toBe(0);
    expect(by("flip").left).toBe(20); // starts Nov 5, 4 days after Nov 1
    expect(by("flip").width).toBe(30); // Nov 5 to Nov 10, six days of 20
  });

  it("today outside every milestone still has its place; the axis grows to hold it", () => {
    const l = roadmapLayout(
      [ms({ startDate: "2026-12-01", dueDate: "2026-12-10" })],
      "2026-11-21",
    );
    expect(l.axisStart).toBe("2026-11-21");
    expect(l.todayLeft).toBeCloseTo((0.5 / 20) * 100, 5);
    expect(l.bars[0]!.left).toBeCloseTo((10 / 20) * 100, 5);
  });

  it("fill is the milestone's percent, held between 0 and 100; late means past due and not closed", () => {
    const l = roadmapLayout(
      [
        ms({ id: "x", dueDate: "2026-11-01", percent: 140 }),
        ms({ id: "y", dueDate: "2026-11-01", state: "CLOSED" }),
        ms({ id: "z", dueDate: "2026-11-30" }),
      ],
      "2026-11-10",
    );
    const by = (id: string) => l.bars.find((b) => b.id === id)!;
    expect(by("x").percent).toBe(100);
    expect(by("x").late).toBe(true);
    expect(by("y").late).toBe(false);
    expect(by("z").late).toBe(false);
  });

  it("marks the month starts on the axis", () => {
    const l = roadmapLayout(
      [ms({ startDate: "2026-10-20", dueDate: "2026-12-10" })],
      "2026-11-10",
    );
    expect(l.months.map((m) => m.label)).toEqual(["Oct 2026", "Nov 2026", "Dec 2026"]);
    expect(l.months[0]!.left).toBe(0);
  });
});

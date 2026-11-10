// track-b-pb2-screens.test.tsx - PB2: the board (optimistic move and rollback, keyboard move, the
// Done window), the roadmap, My Work and the Projects search, with the API module mocked. The API's
// sentences are shown as sent. All data is invented.

import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchBoard: vi.fn(),
  reorderIssue: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchRoadmap: vi.fn(),
  fetchMyWork: vi.fn(),
  searchProjects: vi.fn(),
}));
vi.mock("../../lib/projects", async (orig) => ({
  ...(await orig<typeof import("../../lib/projects")>()),
  ...api,
}));
const auth = vi.hoisted(() => ({
  user: { userType: "FIRM" } as { userType: string },
  perms: new Set<string>(),
}));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, hasPermission: (p: string) => auth.perms.has(p) }),
  useOptionalAuth: () => ({
    user: auth.user,
    hasPermission: (p: string) => auth.perms.has(p),
  }),
}));

import { ApiError } from "../../lib/api";
import type {
  Board,
  IssueItem,
  Milestone,
  MyWork,
  ProjectsMeta,
  Roadmap as RoadmapData,
} from "../../lib/projects";
import { ProjectsSearchBox } from "../../components/projects/ProjectsNav";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import { BoardTab } from "./BoardTab";
import MyWorkPage from "./MyWorkPage";
import { Roadmap } from "./Roadmap";
import SearchPage from "./SearchPage";

const ALL = ["Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"];
const VIEWER = ["Projects:Read"];

const stat = (id: string, name: string, category: "TODO" | "IN_PROGRESS" | "DONE") => ({
  id,
  name,
  colour: "#57606a",
  category,
});
const META: ProjectsMeta = {
  issueTypes: [],
  issueStatuses: [],
  labels: [],
  users: [
    { id: "u-ana", fullName: "Ana Reyes", email: "ana@example.test" },
    { id: "u-ben", fullName: "Ben Cruz", email: "ben@example.test" },
  ],
};
const card = (
  key: string,
  n: number,
  statusId: string,
  position: number,
  over: Partial<IssueItem> = {},
): IssueItem => {
  const status = [
    stat("s1", "To do", "TODO"),
    stat("s2", "In progress", "IN_PROGRESS"),
    stat("s3", "Done", "DONE"),
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
    closedAt: null,
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
const BOARD = (): Board => ({
  today: "2026-11-10",
  doneRange: "14d",
  doneSince: "2026-10-27T00:00:00.000Z",
  total: 5,
  columns: [
    {
      status: { ...stat("s1", "To do", "TODO"), isDefault: true },
      items: [
        card("PAY-1", 1, "s1", 1),
        card("PAY-2", 2, "s1", 2),
        card("PAY-3", 3, "s1", 3),
      ],
      olderHidden: 0,
    },
    {
      status: { ...stat("s2", "In progress", "IN_PROGRESS"), isDefault: false },
      items: [
        card("PAY-4", 4, "s2", 10, {
          dueDate: "2026-11-01",
          overdue: true,
          assignee: { id: "u-ana", fullName: "Ana Reyes" },
          labels: [{ id: "l1", name: "frontend", colour: "#1a7f37" }],
        }),
      ],
      olderHidden: 0,
    },
    {
      status: { ...stat("s3", "Done", "DONE"), isDefault: false },
      items: [card("PAY-5", 5, "s3", 1, { closedAt: "2026-11-08T02:00:00.000Z" })],
      olderHidden: 2,
    },
  ],
});

function Where() {
  const l = useLocation();
  return <div data-where>{l.pathname + l.search}</div>;
}
function mount(ui: React.ReactElement, path = "/work") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<div data-home>home</div>} />
          <Route
            path="*"
            element={
              <>
                {ui}
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const where = () => document.querySelector("[data-where]")!.textContent;
const column = (id: string) =>
  document.querySelector<HTMLElement>(`[data-column="${id}"]`)!;
const cardEl = (key: string) =>
  document.querySelector<HTMLElement>(`[data-card="${key}"]`)!;
const keysIn = (id: string) =>
  Array.from(column(id).querySelectorAll("[data-card]")).map((c) =>
    c.getAttribute("data-card"),
  );
const dt = () => ({
  setData: vi.fn(),
  getData: vi.fn(),
  effectAllowed: "",
  dropEffect: "",
});
/** Drag a card over a column (clientY 0 = above every card, 1 = below every card) and drop it. */
function dragTo(key: string, colId: string, clientY: number) {
  // jsdom has no DragEvent, so the pointer height is put on the event by hand
  const at = (type: "dragOver" | "drop") => {
    const ev = createEvent[type](column(colId), { dataTransfer: dt() });
    Object.defineProperty(ev, "clientY", { value: clientY });
    fireEvent(column(colId), ev);
  };
  fireEvent.dragStart(cardEl(key), { dataTransfer: dt() });
  at("dragOver");
  at("drop");
}
const live = () => document.querySelector("[data-board-live]")!.textContent;

const board = (can = ALL) => {
  auth.perms = new Set(can);
  return mount(
    <BoardTab
      projectKey="PAY"
      meta={META}
      can={{
        read: true,
        create: can.includes("Projects:Create"),
        update: can.includes("Projects:Update"),
        configure: can.includes("Projects:Configure"),
      }}
    />,
    "/projects/PAY/board",
  );
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  auth.user = { userType: "FIRM" };
  auth.perms = new Set(ALL);
  api.fetchBoard.mockImplementation(() => Promise.resolve(BOARD()));
  api.fetchMilestones.mockResolvedValue([
    { id: "m1", name: "Beta" } as unknown as Milestone,
  ]);
  api.reorderIssue.mockResolvedValue({});
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------------------------

describe("PB2 board: what a card shows", () => {
  it("one column per status in order, each card with key, title, type, priority, assignee, labels and due date", async () => {
    board();
    await screen.findByText("Card PAY-1");
    expect(
      Array.from(document.querySelectorAll("[data-column]")).map((c) =>
        c.getAttribute("data-column-name"),
      ),
    ).toEqual(["To do", "In progress", "Done"]);
    expect(keysIn("s1")).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
    const c = within(cardEl("PAY-4"));
    expect(c.getByText("PAY-4")).toBeTruthy();
    expect(c.getByText("Card PAY-4")).toBeTruthy();
    expect(c.getByText("Task")).toBeTruthy();
    expect(c.getByText("Normal")).toBeTruthy();
    expect(c.getByText("Ana Reyes")).toBeTruthy();
    expect(c.getByText("frontend")).toBeTruthy();
    // overdue in words as well as colour, in Manila calendar days
    expect(c.getByText("Overdue, due Nov 01, 2026")).toBeTruthy();
    expect(within(cardEl("PAY-1")).getByText("Unassigned")).toBeTruthy();
    expect(within(cardEl("PAY-1")).queryByText(/Overdue/)).toBeNull();
  });
});

describe("PB2 board: a move by mouse", () => {
  it("a card dropped on another column is there at once, before the API has answered, and the API is told the status and a position", async () => {
    let answer!: (v: unknown) => void;
    api.reorderIssue.mockReturnValue(new Promise((r) => (answer = r)));
    board();
    await screen.findByText("Card PAY-1");
    dragTo("PAY-1", "s2", 0); // above PAY-4
    await waitFor(() => expect(keysIn("s2")).toEqual(["PAY-1", "PAY-4"]));
    expect(keysIn("s1")).toEqual(["PAY-2", "PAY-3"]);
    expect(api.reorderIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
      position: 9,
      statusId: "s2",
    });
    answer({});
  });

  it("a card dropped in its own column is only reordered: a position and no status", async () => {
    api.reorderIssue.mockReturnValue(new Promise(() => {}));
    board();
    await screen.findByText("Card PAY-1");
    dragTo("PAY-1", "s1", 1); // below the others
    await waitFor(() => expect(keysIn("s1")).toEqual(["PAY-2", "PAY-3", "PAY-1"]));
    expect(api.reorderIssue).toHaveBeenCalledWith("PAY", "PAY-1", { position: 4 });
  });

  it("a card dropped where it already is sends nothing", async () => {
    board();
    await screen.findByText("Card PAY-1");
    dragTo("PAY-2", "s1", 1); // below PAY-1 only is not possible by jsdom heights: below all, then check no change
    // PAY-2 below all moves it to the end; dropping PAY-3 below all leaves it in place
    api.reorderIssue.mockClear();
    dragTo("PAY-3", "s1", 1);
    expect(api.reorderIssue).not.toHaveBeenCalled();
  });

  it("when the API refuses, the card goes back and the API's sentence shows as sent", async () => {
    api.reorderIssue.mockRejectedValue(
      new ApiError(409, "That status does not exist any more.", {}),
    );
    board();
    await screen.findByText("Card PAY-1");
    dragTo("PAY-1", "s2", 0);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("That status does not exist any more.");
    await waitFor(() => expect(keysIn("s1")).toEqual(["PAY-1", "PAY-2", "PAY-3"]));
    expect(keysIn("s2")).toEqual(["PAY-4"]);
    expect(live()).toContain("Could not move PAY-1.");
  });

  it("a Viewer cannot drag a card or pick it up", async () => {
    board(VIEWER);
    await screen.findByText("Card PAY-1");
    expect(cardEl("PAY-1").getAttribute("draggable")).toBe("false");
    fireEvent.keyDown(cardEl("PAY-1"), { key: " " });
    expect(cardEl("PAY-1").getAttribute("data-grabbed")).toBeNull();
    expect(screen.queryByText(/Drag a card/)).toBeNull();
  });
});

describe("PB2 board: a move by keyboard", () => {
  it("Space picks up, the arrows move it at once, Space drops it and the API is told once", async () => {
    board();
    await screen.findByText("Card PAY-1");
    const el = cardEl("PAY-1");
    el.focus();
    fireEvent.keyDown(el, { key: " " });
    expect(cardEl("PAY-1").getAttribute("data-grabbed")).toBe("true");
    expect(live()).toContain("Picked up PAY-1");
    fireEvent.keyDown(cardEl("PAY-1"), { key: "ArrowRight" });
    expect(keysIn("s2")).toEqual(["PAY-1", "PAY-4"]);
    expect(live()).toContain("PAY-1 now in In progress, position 1 of 2");
    fireEvent.keyDown(cardEl("PAY-1"), { key: "ArrowDown" });
    expect(keysIn("s2")).toEqual(["PAY-4", "PAY-1"]);
    expect(api.reorderIssue).not.toHaveBeenCalled(); // nothing is sent until it is dropped
    fireEvent.keyDown(cardEl("PAY-1"), { key: " " });
    await waitFor(() => expect(api.reorderIssue).toHaveBeenCalledTimes(1));
    expect(api.reorderIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
      position: 11,
      statusId: "s2",
    });
    expect(live()).toContain("Dropped PAY-1 in In progress, position 2 of 2");
    expect(cardEl("PAY-1").getAttribute("data-grabbed")).toBeNull();
  });

  it("the focus follows the card into the next column", async () => {
    board();
    await screen.findByText("Card PAY-1");
    cardEl("PAY-1").focus();
    fireEvent.keyDown(cardEl("PAY-1"), { key: " " });
    fireEvent.keyDown(cardEl("PAY-1"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(cardEl("PAY-1"));
    expect(column("s2").contains(document.activeElement)).toBe(true);
  });

  it("Escape puts the card back and sends nothing", async () => {
    board();
    await screen.findByText("Card PAY-1");
    cardEl("PAY-1").focus();
    fireEvent.keyDown(cardEl("PAY-1"), { key: " " });
    fireEvent.keyDown(cardEl("PAY-1"), { key: "ArrowRight" });
    fireEvent.keyDown(cardEl("PAY-1"), { key: "Escape" });
    expect(keysIn("s1")).toEqual(["PAY-1", "PAY-2", "PAY-3"]);
    expect(keysIn("s2")).toEqual(["PAY-4"]);
    expect(api.reorderIssue).not.toHaveBeenCalled();
    expect(live()).toContain("Move cancelled");
  });

  it("an arrow does nothing until a card is picked up; Enter on a card opens the issue", async () => {
    board();
    await screen.findByText("Card PAY-1");
    fireEvent.keyDown(cardEl("PAY-1"), { key: "ArrowRight" });
    expect(keysIn("s1")).toContain("PAY-1");
    fireEvent.keyDown(cardEl("PAY-1"), { key: "Enter" });
    expect(where()).toBe("/projects/PAY/issues/PAY-1");
  });

  it("a refused keyboard move goes back with the sentence", async () => {
    api.reorderIssue.mockRejectedValue(
      new ApiError(403, "Missing permission(s): Projects:Update", {}),
    );
    board();
    await screen.findByText("Card PAY-1");
    cardEl("PAY-1").focus();
    fireEvent.keyDown(cardEl("PAY-1"), { key: " " });
    fireEvent.keyDown(cardEl("PAY-1"), { key: "ArrowRight" });
    fireEvent.keyDown(cardEl("PAY-1"), { key: " " });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Missing permission(s): Projects:Update",
    );
    await waitFor(() => expect(keysIn("s1")).toContain("PAY-1"));
  });
});

describe("PB2 board: moves that arrive together", () => {
  it("the board is asked for again only when the last move has been answered", async () => {
    const answers: Array<(v: unknown) => void> = [];
    api.reorderIssue.mockImplementation(() => new Promise((r) => answers.push(r)));
    board();
    await screen.findByText("Card PAY-1");
    expect(api.fetchBoard).toHaveBeenCalledTimes(1);
    dragTo("PAY-1", "s2", 0);
    dragTo("PAY-2", "s2", 0);
    await waitFor(() => expect(answers.length).toBe(2));
    // both cards are already in their new column
    expect(keysIn("s2")).toEqual(["PAY-2", "PAY-1", "PAY-4"]);
    answers[0]!({});
    await new Promise((r) => setTimeout(r, 50));
    expect(api.fetchBoard).toHaveBeenCalledTimes(1); // the second is still on its way
    expect(keysIn("s2")).toEqual(["PAY-2", "PAY-1", "PAY-4"]);
    answers[1]!({});
    await waitFor(() => expect(api.fetchBoard).toHaveBeenCalledTimes(2));
  });
});

describe("PB2 what a change in a project refreshes", () => {
  it("the board, the roadmap and My Work are asked for again, with the lists they sit beside", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    function Probe() {
      const invalidate = useInvalidateProject("PAY");
      return <button onClick={invalidate}>go</button>;
    }
    render(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("go"));
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]!.queryKey));
    expect(keys).toContain(JSON.stringify(["projects", "board", "PAY"]));
    expect(keys).toContain(JSON.stringify(["projects", "roadmap", "PAY"]));
    expect(keys).toContain(JSON.stringify(["projects", "my-work"]));
    expect(keys).toContain(JSON.stringify(["projects", "issues", "PAY"]));
  });
});

describe("PB2 board: the Done window and the filters", () => {
  it("a Done column says how many older cards are hidden; Show all asks for all and the note goes", async () => {
    api.fetchBoard.mockImplementation((_k: string, f: { doneAll: boolean }) => {
      const b = BOARD();
      if (f.doneAll) {
        b.doneRange = "all";
        b.columns[2]!.olderHidden = 0;
        b.columns[2]!.items.push(card("PAY-6", 6, "s3", 2));
      }
      return Promise.resolve(b);
    });
    board();
    await screen.findByText("Card PAY-1");
    expect(column("s3").textContent).toContain("2 older cards hidden");
    expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({ doneAll: false });
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await screen.findByText("Card PAY-6");
    expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({ doneAll: true });
    expect(column("s3").textContent).not.toContain("older");
    expect(where()).toContain("done=all");
    expect(
      screen
        .getByRole("button", { name: "Show last 14 days" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("one hidden card reads in the singular", async () => {
    api.fetchBoard.mockImplementation(() => {
      const b = BOARD();
      b.columns[2]!.olderHidden = 1;
      return Promise.resolve(b);
    });
    board();
    await screen.findByText("Card PAY-1");
    expect(column("s3").textContent).toContain("1 older card hidden");
  });

  it("the milestone and assignee filters ask the API, including none, unassigned and me", async () => {
    board();
    await screen.findByText("Card PAY-1");
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "none" } });
    await waitFor(() =>
      expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({
        milestone: "none",
        assignee: "",
      }),
    );
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "m1" } });
    await waitFor(() =>
      expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({ milestone: "m1" }),
    );
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "me" } });
    await waitFor(() =>
      expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({
        milestone: "m1",
        assignee: "me",
      }),
    );
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "none" } });
    await waitFor(() =>
      expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({ assignee: "none" }),
    );
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "u-ben" } });
    await waitFor(() =>
      expect(api.fetchBoard.mock.calls.at(-1)![1]).toMatchObject({ assignee: "u-ben" }),
    );
    expect(where()).toContain("assignee=u-ben");
  });

  it("a board that cannot load shows the API's sentence", async () => {
    api.fetchBoard.mockRejectedValue(new ApiError(404, "Project not found.", {}));
    board();
    await screen.findByText("Could not load the board.");
    expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
      "Project not found.",
    );
  });
});

// ---------------------------------------------------------------------------------------------

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

describe("PB2 roadmap", () => {
  const road = (r: Partial<RoadmapData>) => {
    api.fetchRoadmap.mockResolvedValue({
      today: "2026-11-10",
      dated: [],
      undated: [],
      ...r,
    });
    return mount(<Roadmap projectKey="PAY" />);
  };
  beforeEach(() => {
    api.fetchRoadmap.mockReset();
  });

  it("draws a bar per dated milestone, filled by percent done, with a line for today", async () => {
    road({
      dated: [
        ms({
          id: "a",
          name: "Alpha",
          startDate: "2026-11-01",
          dueDate: "2026-11-10",
          percent: 40,
          progress: { done: 2, total: 5, percent: 40 },
        }),
        ms({
          id: "b",
          name: "Beta",
          startDate: "2026-11-11",
          dueDate: "2026-11-20",
          percent: 0,
        }),
      ],
    });
    const a = (await screen.findByRole("progressbar", {
      name: "Alpha, 40% done",
    })) as HTMLElement;
    expect(a.getAttribute("data-bar-left")).toBe("0.00");
    expect(a.getAttribute("data-bar-width")).toBe("50.00");
    expect(a.getAttribute("aria-valuenow")).toBe("40");
    expect(a.querySelector("[data-bar-fill]")!.getAttribute("style")).toContain(
      "width: 40%",
    );
    const b = screen.getByRole("progressbar", { name: "Beta, 0% done" });
    expect(b.getAttribute("data-bar-left")).toBe("50.00");
    const today = document.querySelector<HTMLElement>("[data-today]")!;
    expect(today.getAttribute("data-today")).toBe("2026-11-10");
    expect(today.style.left).toBe("47.5%"); // (9 + 0.5) / 20
    expect(screen.getByText("2 of 5", { exact: false })).toBeTruthy();
  });

  it("lists the milestones with no dates below the bars", async () => {
    road({
      dated: [ms({ id: "a", name: "Alpha", dueDate: "2026-11-20" })],
      undated: [ms({ id: "u", name: "Someday", percent: 10 })],
    });
    const undated = await waitFor(() => {
      const el = document.querySelector("[data-undated]");
      if (!el) throw new Error("none");
      return el as HTMLElement;
    });
    expect(within(undated).getByText("Someday")).toBeTruthy();
    expect(within(undated).getByText("10% done")).toBeTruthy();
    expect(document.querySelectorAll("[data-roadmap-bar]").length).toBe(1);
  });

  it("only undated milestones: no bars, and it says so", async () => {
    road({ undated: [ms({ id: "u", name: "Someday" })] });
    await screen.findByText("Someday");
    expect(document.querySelectorAll("[data-roadmap-bar]").length).toBe(0);
    expect(screen.getByText(/nothing to draw/)).toBeTruthy();
  });

  it("marks a milestone past its due date as past due, in words", async () => {
    road({
      dated: [
        ms({ id: "a", name: "Alpha", startDate: "2026-10-01", dueDate: "2026-10-20" }),
      ],
    });
    await screen.findByText("Past due");
  });

  it("shows the API's sentence when the roadmap cannot load", async () => {
    api.fetchRoadmap.mockRejectedValue(new ApiError(404, "Project not found.", {}));
    mount(<Roadmap projectKey="PAY" />);
    await screen.findByText("Could not load the roadmap.");
    expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
      "Project not found.",
    );
  });
});

// ---------------------------------------------------------------------------------------------

const WORK = (over: Partial<MyWork> = {}): MyWork => ({
  today: "2026-11-10",
  totals: { assignedOpen: 3, overdue: 2, dueThisWeek: 1 },
  assigned: [
    card("PAY-7", 7, "s1", 1, { title: "Urgent thing", priority: "URGENT" }),
    card("PAY-8", 8, "s2", 2, { title: "Normal thing" }),
  ],
  overdue: [
    card("OPS-3", 3, "s1", 1, {
      title: "Late thing",
      dueDate: "2026-11-05",
      overdue: true,
      project: { key: "OPS", name: "Operations" },
      assignee: { id: "u-ben", fullName: "Ben Cruz" },
    }),
  ],
  upcomingMilestones: [
    {
      ...ms({
        id: "m9",
        name: "Launch",
        dueDate: "2026-11-25",
        progress: { done: 1, total: 4, percent: 25 },
      }),
      project: { key: "PAY", name: "Payments" },
    },
  ],
  recentActivity: [
    {
      id: "a1",
      projectId: "p1",
      issueKey: "PAY-7",
      issueTitle: "Made it",
      action: "issue.created",
      actorType: "USER",
      actor: { id: "u-ana", fullName: "Ana Reyes" },
      channel: "WEB",
      changes: [],
      createdAt: "2026-11-10T16:30:00.000Z",
      project: { key: "PAY", name: "Payments" },
    },
  ],
  ...over,
});

describe("PB2 My Work", () => {
  it("shows the totals, my issues in the API's order, the overdue, the milestones and the activity", async () => {
    api.fetchMyWork.mockResolvedValue(WORK());
    mount(<MyWorkPage />, "/projects");
    await screen.findByText("Urgent thing");
    const total = (id: string) =>
      document.querySelector(`[data-total="${id}"]`)!.textContent;
    expect(total("assignedOpen")).toContain("3");
    expect(total("overdue")).toContain("2");
    expect(total("dueThisWeek")).toContain("1");
    const mine = document.querySelector('[data-section="assigned"]')!;
    expect(
      Array.from(mine.querySelectorAll("[data-issue]")).map((e) =>
        e.getAttribute("data-issue"),
      ),
    ).toEqual(["PAY-7", "PAY-8"]);
    const overdue = within(
      document.querySelector('[data-section="overdue"]') as HTMLElement,
    );
    expect(overdue.getByText("Late thing")).toBeTruthy();
    expect(overdue.getByText("Overdue, due Nov 05, 2026")).toBeTruthy();
    expect(overdue.getByText("Operations")).toBeTruthy();
    const miles = within(
      document.querySelector('[data-section="milestones"]') as HTMLElement,
    );
    expect(miles.getByText("Launch")).toBeTruthy();
    expect(miles.getByText("Due Nov 25, 2026")).toBeTruthy();
    const act = within(
      document.querySelector('[data-section="activity"]') as HTMLElement,
    );
    // 16:30 UTC is 12:30 AM the next day in Manila
    expect(act.getByText("Nov 11, 2026, 12:30 AM")).toBeTruthy();
    expect(act.getByRole("link", { name: "PAY-7" }).getAttribute("href")).toBe(
      "/projects/PAY/issues/PAY-7",
    );
  });

  it("says so when there is nothing", async () => {
    api.fetchMyWork.mockResolvedValue(
      WORK({
        totals: { assignedOpen: 0, overdue: 0, dueThisWeek: 0 },
        assigned: [],
        overdue: [],
        upcomingMilestones: [],
        recentActivity: [],
      }),
    );
    mount(<MyWorkPage />, "/projects");
    await screen.findByText("Nothing assigned to you");
    expect(screen.getByText("Nothing is overdue")).toBeTruthy();
    expect(screen.getByText("No milestone is due in the next 30 days")).toBeTruthy();
    expect(screen.getByText("No activity yet")).toBeTruthy();
  });

  it("opens an issue from its key", async () => {
    api.fetchMyWork.mockResolvedValue(WORK());
    mount(<MyWorkPage />, "/projects");
    await screen.findByText("Urgent thing");
    fireEvent.click(
      within(
        document.querySelector('[data-section="assigned"]') as HTMLElement,
      ).getByRole("link", { name: "PAY-7" }),
    );
    expect(where()).toBe("/projects/PAY/issues/PAY-7");
  });

  it("a failure shows the API's sentence; a person without Projects:Read is sent home", async () => {
    api.fetchMyWork.mockRejectedValue(
      new ApiError(403, "Missing permission(s): Projects:Read", {}),
    );
    mount(<MyWorkPage />, "/projects");
    await screen.findByText("Could not load your work.");
    expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
      "Missing permission(s): Projects:Read",
    );
    cleanup();
    auth.perms = new Set();
    mount(<MyWorkPage />, "/projects");
    await screen.findByText("home");
  });

  it("has the two Projects pages and the search box", async () => {
    api.fetchMyWork.mockResolvedValue(WORK());
    mount(<MyWorkPage />, "/projects");
    await screen.findByText("Urgent thing");
    expect(screen.getByRole("link", { name: "My Work" }).getAttribute("href")).toBe(
      "/projects",
    );
    expect(screen.getByRole("link", { name: "All projects" }).getAttribute("href")).toBe(
      "/projects/all",
    );
    expect(
      screen.getByRole("searchbox", { name: "Search issues and projects" }),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------

describe("PB2 search", () => {
  it("Enter on text goes to the results page with the text trimmed and encoded", () => {
    mount(<ProjectsSearchBox />, "/projects");
    const box = screen.getByRole("searchbox", { name: "Search issues and projects" });
    fireEvent.change(box, { target: { value: "  login & pay  " } });
    fireEvent.submit(box.closest("form")!);
    expect(where()).toBe("/projects/search?q=login%20%26%20pay");
  });

  it("Enter on nothing goes to the results page without a text", () => {
    mount(<ProjectsSearchBox />, "/projects");
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
    expect(where()).toBe("/projects/search");
  });

  it("an exact key that the API answers with a jump goes straight to that issue, and Back does not return to the results", async () => {
    api.searchProjects.mockResolvedValue({
      jump: { projectKey: "PAY", issueKey: "PAY-12" },
      issues: [],
      projects: [],
    });
    mount(<SearchPage />, "/projects/search?q=PAY-12");
    await waitFor(() => expect(where()).toBe("/projects/PAY/issues/PAY-12"));
    expect(api.searchProjects).toHaveBeenCalledWith("PAY-12");
  });

  it("an ordinary search lists the issues and the projects, as the API found them", async () => {
    api.searchProjects.mockResolvedValue({
      jump: null,
      issues: [card("PAY-3", 3, "s1", 1, { title: "Login is slow" })],
      projects: [
        {
          id: "p1",
          key: "PAY",
          name: "Payments",
          archived: false,
          client: { id: "c1", businessName: "Reyes Trading" },
        },
        { id: "p2", key: "OLD", name: "Old login", archived: true, client: null },
      ],
    });
    mount(<SearchPage />, "/projects/search?q=login");
    await screen.findByText("Login is slow");
    expect(where()).toBe("/projects/search?q=login");
    const projects = within(
      document.querySelector('[data-section="projects"]') as HTMLElement,
    );
    expect(projects.getByRole("link", { name: "PAY" }).getAttribute("href")).toBe(
      "/projects/PAY",
    );
    expect(projects.getByText("Reyes Trading")).toBeTruthy();
    expect(projects.getByText("Archived")).toBeTruthy();
    expect(screen.getByRole("searchbox").getAttribute("aria-label")).toBe(
      "Search issues and projects",
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("login");
  });

  it("says when nothing matches", async () => {
    api.searchProjects.mockResolvedValue({ jump: null, issues: [], projects: [] });
    mount(<SearchPage />, "/projects/search?q=zzz");
    await screen.findByText("Nothing matches");
  });

  it("an empty search shows the API's sentence as sent", async () => {
    api.searchProjects.mockRejectedValue(
      new ApiError(400, "Type something to search for.", {}),
    );
    mount(<SearchPage />, "/projects/search");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Type something to search for.",
    );
    expect(api.searchProjects).toHaveBeenCalledWith("");
  });

  it("a person without Projects:Read is sent home and nothing is asked", async () => {
    auth.perms = new Set();
    mount(<SearchPage />, "/projects/search?q=pay");
    await screen.findByText("home");
    expect(api.searchProjects).not.toHaveBeenCalled();
  });
});

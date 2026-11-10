// track-b-pb1-screens.test.tsx — PB1: the Projects screens with the API module mocked: the issue
// list (views, filters, quick add, status in the row, overdue, split view), the create form with
// "Create and add another", comments with key links, activity by Manila day, milestones,
// settings refusals, and what a Viewer or a client user does not get. The API's sentences are
// shown as sent. All data is invented.

import {
  cleanup,
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
  fetchProjectsMeta: vi.fn(),
  lookupIssueKey: vi.fn(),
  fetchProjects: vi.fn(),
  fetchProject: vi.fn(),
  fetchIssues: vi.fn(),
  fetchIssue: vi.fn(),
  fetchComments: vi.fn(),
  addComment: vi.fn(),
  quickAddIssue: vi.fn(),
  createIssue: vi.fn(),
  updateIssue: vi.fn(),
  deleteIssue: vi.fn(),
  fetchMilestones: vi.fn(),
  fetchRoadmap: vi.fn(),
  createMilestone: vi.fn(),
  updateMilestone: vi.fn(),
  fetchActivity: vi.fn(),
  postStatusUpdate: vi.fn(),
  listAdmin: vi.fn(),
  createAdmin: vi.fn(),
  updateAdmin: vi.fn(),
  deleteAdmin: vi.fn(),
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
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  fetchClients: vi.fn(() => Promise.resolve([])),
}));

import { ApiError } from "../../lib/api";
import type {
  ActivityItem,
  IssueDetail,
  IssueItem,
  Milestone,
  ProjectOverview,
  ProjectSummary,
  ProjectsMeta,
} from "../../lib/projects";
import { Markdown } from "../../components/projects/parts";
import { ActivityTab } from "./ActivityTab";
import { IssueCreateDialog } from "./IssueCreateDialog";
import { IssuesTab } from "./IssuesTab";
import { MilestonesTab } from "./MilestonesTab";
import ProjectPage from "./ProjectPage";
import ProjectsPage from "./ProjectsPage";
import ProjectsSettingsPage from "./ProjectsSettingsPage";

const ALL = ["Projects:Read", "Projects:Create", "Projects:Update", "Projects:Configure"];
const VIEWER = ["Projects:Read"];

const S_NEW = {
  id: "s-new",
  name: "New",
  colour: "#57606a",
  category: "TODO" as const,
  order: 0,
  isDefault: true,
};
const S_PROG = {
  id: "s-prog",
  name: "In progress",
  colour: "#bf8700",
  category: "IN_PROGRESS" as const,
  order: 1,
  isDefault: false,
};
const S_DONE = {
  id: "s-done",
  name: "Done",
  colour: "#1a7f37",
  category: "DONE" as const,
  order: 2,
  isDefault: false,
};
const T_TASK = { id: "t-task", name: "Task", colour: "#57606a", order: 0 };
const T_BUG = { id: "t-bug", name: "Bug", colour: "#cf222e", order: 1 };
const META: ProjectsMeta = {
  issueTypes: [T_TASK, T_BUG],
  issueStatuses: [S_NEW, S_PROG, S_DONE],
  labels: [{ id: "l-front", name: "frontend", colour: "#1a7f37" }],
  users: [
    { id: "u-ana", fullName: "Ana Reyes", email: "ana@example.test" },
    { id: "u-ben", fullName: "Ben Cruz", email: "ben@example.test" },
  ],
};

const issue = (over: Partial<IssueItem> = {}): IssueItem => ({
  id: "i1",
  key: "PAY-1",
  number: 1,
  title: "Fix the login page",
  priority: "NORMAL",
  startDate: null,
  dueDate: null,
  overdue: false,
  position: 1,
  createdAt: "2026-11-01T01:00:00.000Z",
  updatedAt: "2026-11-02T01:00:00.000Z",
  closedAt: null,
  project: { key: "PAY", name: "Payments" },
  type: T_TASK,
  status: S_NEW,
  assignee: null,
  milestone: null,
  parentKey: null,
  labels: [],
  ...over,
});
const detail = (over: Partial<IssueDetail> = {}): IssueDetail => ({
  ...issue(),
  description: "Some **description**",
  author: { id: "u-ana", fullName: "Ana Reyes" },
  parent: null,
  children: [],
  commentCount: 0,
  githubLinks: [], // PB4
  ...over,
});
const MS: Milestone = {
  id: "m1",
  name: "Beta",
  description: "",
  startDate: null,
  dueDate: "2026-12-01",
  state: "OPEN",
  progress: { done: 1, total: 4, percent: 25 },
  percent: 25,
  today: "2026-11-10",
  overdueIssues: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function Where() {
  return <div data-where>{useLocation().pathname + useLocation().search}</div>;
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
const lastIssueQuery = () =>
  api.fetchIssues.mock.calls.at(-1)![1] as Record<string, string>;

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  auth.user = { userType: "FIRM" };
  auth.perms = new Set(ALL);
  api.fetchIssues.mockResolvedValue({
    items: [issue()],
    total: 1,
    limit: 200,
    offset: 0,
  });
  api.fetchMilestones.mockResolvedValue([MS]);
  // PB2: the Milestones tab also draws the roadmap; an empty one keeps these PB1 checks unchanged
  api.fetchRoadmap.mockResolvedValue({ today: "2026-11-10", dated: [], undated: [] });
  api.fetchProjectsMeta.mockResolvedValue(META);
  api.lookupIssueKey.mockRejectedValue(new ApiError(404, "Issue not found.", {}));
});
afterEach(() => cleanup());

// ---------------------------------------------------------------------------------------------

describe("PB1 markdown on screen", () => {
  it("a script tag in a description is not executed and not in the page", async () => {
    (window as unknown as Record<string, unknown>).__pwned = undefined;
    mount(
      <Markdown
        text={
          'Hello\n\n<script>window.__pwned = 1</script>\n\n<img src=x onerror="window.__pwned = 2">'
        }
      />,
    );
    await screen.findByText("Hello");
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
    expect(document.querySelector("[data-markdown] script")).toBeNull();
    expect(document.querySelector("[data-markdown] img")).toBeNull();
  });

  it("an issue key that exists becomes a link; one that does not stays text; a click stays in the Portal", async () => {
    api.lookupIssueKey.mockImplementation((k: string) =>
      k === "PAY-12"
        ? Promise.resolve(issue({ key: "PAY-12" }))
        : Promise.reject(new ApiError(404, "Issue not found.", {})),
    );
    mount(<Markdown text="Related: PAY-12 and PAY-13" />);
    const link = await screen.findByRole("link", { name: "PAY-12" });
    expect(link.getAttribute("href")).toBe("/projects/PAY/issues/PAY-12");
    await waitFor(() => expect(api.lookupIssueKey).toHaveBeenCalledWith("PAY-13"));
    expect(screen.queryByRole("link", { name: "PAY-13" })).toBeNull();
    expect(api.lookupIssueKey).toHaveBeenCalledTimes(2);
    fireEvent.click(link);
    expect(where()).toBe("/projects/PAY/issues/PAY-12");
  });

  it("each key is asked for once however often it is written", async () => {
    api.lookupIssueKey.mockResolvedValue(issue({ key: "PAY-12" }));
    mount(<Markdown text="PAY-12, PAY-12 and PAY-12" />);
    await screen.findAllByRole("link", { name: "PAY-12" });
    expect(api.lookupIssueKey).toHaveBeenCalledTimes(1);
  });
});

describe("PB1 the issue list", () => {
  const tab = (perms = ALL) => {
    auth.perms = new Set(perms);
    return mount(
      <IssuesTab
        projectKey="PAY"
        can={{
          read: true,
          create: perms.includes("Projects:Create"),
          update: perms.includes("Projects:Update"),
          configure: perms.includes("Projects:Configure"),
        }}
        meta={META}
      />,
      "/projects/PAY/issues",
    );
  };

  it("opens on the Open view and asks the API for it", async () => {
    tab();
    await screen.findByText("Fix the login page");
    expect(lastIssueQuery()).toMatchObject({ view: "open", sort: "updated" });
    expect(
      screen.getByRole("button", { name: "Open" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("the six views are chips, and each asks for its own view", async () => {
    tab();
    await screen.findByText("Fix the login page");
    const names = ["Open", "Assigned to me", "Open bugs", "Overdue", "Closed", "All"];
    for (const n of names) expect(screen.getByRole("button", { name: n })).toBeTruthy();
    for (const [name, view] of [
      ["Assigned to me", "mine"],
      ["Open bugs", "bugs"],
      ["Overdue", "overdue"],
      ["Closed", "closed"],
      ["All", "all"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(lastIssueQuery().view).toBe(view));
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe(
        "true",
      );
    }
  });

  it("every filter reaches the API, assignee none and me included", async () => {
    tab();
    await screen.findByText("Fix the login page");
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "s-prog" } });
    await waitFor(() => expect(lastIssueQuery().statusId).toBe("s-prog"));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "t-bug" } });
    await waitFor(() => expect(lastIssueQuery().typeId).toBe("t-bug"));
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "none" } });
    await waitFor(() => expect(lastIssueQuery().assigneeId).toBe("none"));
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "me" } });
    await waitFor(() => expect(lastIssueQuery().assigneeId).toBe("me"));
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "none" } });
    await waitFor(() => expect(lastIssueQuery().milestoneId).toBe("none"));
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "m1" } });
    await waitFor(() => expect(lastIssueQuery().milestoneId).toBe("m1"));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "l-front" } });
    await waitFor(() => expect(lastIssueQuery().labelId).toBe("l-front"));
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "URGENT" } });
    await waitFor(() => expect(lastIssueQuery().priority).toBe("URGENT"));
    fireEvent.change(screen.getByLabelText("Open, closed or all"), {
      target: { value: "all" },
    });
    await waitFor(() => expect(lastIssueQuery().state).toBe("all"));
    fireEvent.change(screen.getByLabelText("Sort by"), { target: { value: "due" } });
    await waitFor(() => expect(lastIssueQuery().sort).toBe("due"));
    expect(where()).toContain("status=s-prog");
    expect(where()).toContain("assignee=me");
  });

  it("the search text is asked after the Enter key", async () => {
    tab();
    await screen.findByText("Fix the login page");
    const box = screen.getByLabelText("Search");
    fireEvent.change(box, { target: { value: "login" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(lastIssueQuery().q).toBe("login"));
  });

  it("Clear filters goes back to the view with nothing narrowed", async () => {
    tab();
    await screen.findByText("Fix the login page");
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "HIGH" } });
    await waitFor(() => expect(lastIssueQuery().priority).toBe("HIGH"));
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastIssueQuery().priority).toBeUndefined());
  });

  it("quick add sends the title alone, clears the box and asks for the list again", async () => {
    api.quickAddIssue.mockResolvedValue(detail({ key: "PAY-2" }));
    tab();
    await screen.findByText("Fix the login page");
    const before = api.fetchIssues.mock.calls.length;
    const box = screen.getByLabelText("Quick add an issue") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "Write the release notes" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() =>
      expect(api.quickAddIssue).toHaveBeenCalledWith("PAY", "Write the release notes"),
    );
    await waitFor(() => expect(box.value).toBe(""));
    await screen.findByText("Added PAY-2.");
    await waitFor(() =>
      expect(api.fetchIssues.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("quick add shows the API's refusal as sent and keeps the title", async () => {
    api.quickAddIssue.mockRejectedValue(new ApiError(400, "The title is required.", {}));
    tab();
    await screen.findByText("Fix the login page");
    const box = screen.getByLabelText("Quick add an issue") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.submit(box.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe("The title is required.");
    expect(box.value).toBe("x");
  });

  it("the status is a select in the row and a change is sent for that issue", async () => {
    api.updateIssue.mockResolvedValue(detail());
    tab();
    const select = (await screen.findByLabelText("Status of PAY-1")) as HTMLSelectElement;
    expect(select.value).toBe("s-new");
    expect([...select.options].map((o) => o.textContent)).toEqual([
      "New",
      "In progress",
      "Done",
    ]);
    fireEvent.change(select, { target: { value: "s-prog" } });
    await waitFor(() =>
      expect(api.updateIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
        statusId: "s-prog",
      }),
    );
  });

  it("an overdue issue is marked in its row", async () => {
    api.fetchIssues.mockResolvedValue({
      items: [
        issue(),
        issue({
          id: "i2",
          key: "PAY-2",
          title: "Late one",
          dueDate: "2026-10-01",
          overdue: true,
        }),
      ],
      total: 2,
      limit: 200,
      offset: 0,
    });
    tab();
    await screen.findByText("Late one");
    const late = document.querySelector('[data-issue="PAY-2"]')!;
    expect(late.getAttribute("data-overdue")).toBe("true");
    expect(late.querySelector("[data-overdue-chip]")?.textContent).toBe("Overdue");
    expect(
      document.querySelector('[data-issue="PAY-1"]')!.getAttribute("data-overdue"),
    ).toBeNull();
  });

  it("selecting a row opens the details beside the list, and the address says which", async () => {
    api.fetchIssue.mockResolvedValue(detail());
    api.fetchComments.mockResolvedValue([]);
    tab();
    fireEvent.click(await screen.findByRole("button", { name: "Fix the login page" }));
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el as HTMLElement;
    });
    expect(where()).toContain("issue=PAY-1");
    expect(api.fetchIssue).toHaveBeenCalledWith("PAY", "PAY-1");
    expect(
      within(panel).getByRole("link", { name: "Open as a page" }).getAttribute("href"),
    ).toBe("/projects/PAY/issues/PAY-1");
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(document.querySelector("[data-issue-details]")).toBeNull(),
    );
    expect(where()).not.toContain("issue=");
  });

  it("a Viewer gets the list and no write control: no quick add, no New issue, the status is read only", async () => {
    tab(VIEWER);
    await screen.findByText("Fix the login page");
    expect(screen.queryByLabelText("Quick add an issue")).toBeNull();
    expect(screen.queryByRole("button", { name: "New issue" })).toBeNull();
    expect(screen.queryByLabelText("Status of PAY-1")).toBeNull();
    expect(document.querySelector('[data-issue="PAY-1"]')!.textContent).toContain("New");
  });
});

describe("PB1 an issue's details", () => {
  const open = (perms = ALL) => {
    auth.perms = new Set(perms);
    api.fetchIssue.mockResolvedValue(
      detail({
        parentKey: "PAY-9",
        parent: { key: "PAY-9", title: "The parent" },
        children: [issue({ id: "c1", key: "PAY-5", title: "A sub-issue" })],
        description: "See PAY-7",
      }),
    );
    api.fetchComments.mockResolvedValue([
      {
        id: "c1",
        body: "Looks right, see PAY-7",
        author: { id: "u-ben", fullName: "Ben Cruz" },
        createdAt: "2026-11-02T01:00:00.000Z",
        updatedAt: "2026-11-02T01:00:00.000Z",
      },
    ]);
    api.lookupIssueKey.mockImplementation((k: string) =>
      k === "PAY-7"
        ? Promise.resolve(issue({ key: "PAY-7" }))
        : Promise.reject(new ApiError(404, "Issue not found.", {})),
    );
    return mount(<ProjectPage tab="issue" />, "/projects/PAY/issues/PAY-1");
  };

  function shell(perms = ALL) {
    auth.perms = new Set(perms);
    api.fetchProject.mockResolvedValue(OVERVIEW);
    api.fetchIssue.mockResolvedValue(
      detail({
        parentKey: "PAY-9",
        parent: { key: "PAY-9", title: "The parent" },
        children: [issue({ id: "c1", key: "PAY-5", title: "A sub-issue" })],
        description: "See PAY-7",
      }),
    );
    api.fetchComments.mockResolvedValue([
      {
        id: "c1",
        body: "Looks right, see PAY-7",
        author: { id: "u-ben", fullName: "Ben Cruz" },
        createdAt: "2026-11-02T01:00:00.000Z",
        updatedAt: "2026-11-02T01:00:00.000Z",
      },
    ]);
    api.lookupIssueKey.mockImplementation((k: string) =>
      k === "PAY-7"
        ? Promise.resolve(issue({ key: "PAY-7" }))
        : Promise.reject(new ApiError(404, "Issue not found.", {})),
    );
    return mount(
      <Routes>
        <Route
          path="/projects/:key/issues/:issueKey"
          element={<ProjectPage tab="issue" />}
        />
      </Routes>,
      "/projects/PAY/issues/PAY-1",
    );
  }
  void open;

  it("shows the parent, the sub-issues, the labels and the description with its key linked", async () => {
    shell();
    const panel = (await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    expect(within(panel).getByRole("link", { name: "PAY-9" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "PAY-5" })).toBeTruthy();
    expect((await within(panel).findAllByRole("link", { name: "PAY-7" })).length).toBe(2); // description and comment
    expect(panel.querySelector("[data-comment]")!.textContent).toContain("Ben Cruz");
  });

  it("a field changed is saved as it is changed", async () => {
    shell();
    api.updateIssue.mockResolvedValue(detail());
    const panel = (await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    fireEvent.change(within(panel).getByLabelText("Priority"), {
      target: { value: "URGENT" },
    });
    await waitFor(() =>
      expect(api.updateIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
        priority: "URGENT",
      }),
    );
    fireEvent.change(within(panel).getByLabelText("Assignee"), {
      target: { value: "u-ana" },
    });
    await waitFor(() =>
      expect(api.updateIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
        assigneeId: "u-ana",
      }),
    );
    fireEvent.change(within(panel).getByLabelText("Assignee"), { target: { value: "" } });
    await waitFor(() =>
      expect(api.updateIssue).toHaveBeenCalledWith("PAY", "PAY-1", { assigneeId: null }),
    );
    fireEvent.change(within(panel).getByLabelText("Due date"), {
      target: { value: "2026-12-05" },
    });
    await waitFor(() =>
      expect(api.updateIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
        dueDate: "2026-12-05",
      }),
    );
    fireEvent.click(within(panel).getByRole("checkbox"));
    await waitFor(() =>
      expect(api.updateIssue).toHaveBeenCalledWith("PAY", "PAY-1", {
        labelIds: ["l-front"],
      }),
    );
  });

  it("a refused change shows the API's sentence as sent", async () => {
    shell();
    api.updateIssue.mockRejectedValue(
      new ApiError(400, "The due date cannot be before the start date.", {}),
    );
    const panel = (await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    fireEvent.change(within(panel).getByLabelText("Due date"), {
      target: { value: "2020-01-01" },
    });
    expect((await within(panel).findByRole("alert")).textContent).toBe(
      "The due date cannot be before the start date.",
    );
  });

  it("adds a comment with a key in it, and the box is cleared", async () => {
    shell();
    api.addComment.mockResolvedValue({
      id: "c2",
      body: "x",
      author: null,
      createdAt: "2026-11-03T01:00:00.000Z",
      updatedAt: "2026-11-03T01:00:00.000Z",
    });
    const panel = (await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    const box = within(panel).getByLabelText("Add a comment") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Fixed by PAY-7" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Add comment" }));
    await waitFor(() =>
      expect(api.addComment).toHaveBeenCalledWith("PAY", "PAY-1", "Fixed by PAY-7"),
    );
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("deleting asks first, then deletes", async () => {
    shell();
    api.deleteIssue.mockResolvedValue({ deleted: true, key: "PAY-1" });
    const panel = (await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    fireEvent.click(within(panel).getByRole("button", { name: "Delete issue" }));
    expect(api.deleteIssue).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete PAY-1?")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete issue" }));
    await waitFor(() => expect(api.deleteIssue).toHaveBeenCalledWith("PAY", "PAY-1"));
    await waitFor(() => expect(where()).toBe("/projects/PAY/issues"));
  });

  it("a Viewer sees the issue and can change nothing: no comment box, no delete, every field disabled", async () => {
    shell(VIEWER);
    const panel = (await waitFor(() => {
      const el = document.querySelector('[data-issue-details="PAY-1"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    expect(within(panel).queryByLabelText("Add a comment")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Delete issue" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Edit description" })).toBeNull();
    expect((within(panel).getByLabelText("Priority") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect((within(panel).getByLabelText("Title") as HTMLInputElement).disabled).toBe(
      true,
    );
  });
});

describe("PB1 the create form", () => {
  const dialog = (onCreated = vi.fn(), onClose = vi.fn()) => {
    mount(
      <IssueCreateDialog
        projectKey="PAY"
        meta={META}
        milestones={[MS]}
        onClose={onClose}
        onCreated={onCreated}
      />,
    );
    return { onCreated, onClose };
  };

  it("sends only what was filled, and Create hands the new issue on", async () => {
    api.createIssue.mockResolvedValue(detail({ key: "PAY-7" }));
    const { onCreated } = dialog();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "A new thing" },
    });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "HIGH" } });
    fireEvent.change(screen.getByLabelText("Assignee"), { target: { value: "u-ben" } });
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "m1" } });
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-05" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(api.createIssue).toHaveBeenCalledWith("PAY", {
      title: "A new thing",
      priority: "HIGH",
      assigneeId: "u-ben",
      milestoneId: "m1",
      dueDate: "2026-12-05",
      labelIds: ["l-front"],
    });
    expect(onCreated.mock.calls[0]![0].key).toBe("PAY-7");
  });

  it("Create and add another keeps the window open, clears the title and keeps the choices", async () => {
    api.createIssue.mockResolvedValue(detail({ key: "PAY-8" }));
    const { onCreated, onClose } = dialog();
    const title = screen.getByLabelText("Title") as HTMLInputElement;
    fireEvent.change(title, { target: { value: "First" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "URGENT" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and add another" }));
    await screen.findByText("Created PAY-8.");
    expect(title.value).toBe("");
    expect((screen.getByLabelText("Priority") as HTMLSelectElement).value).toBe("URGENT");
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: "Second" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and add another" }));
    await waitFor(() => expect(api.createIssue).toHaveBeenCalledTimes(2));
    expect(api.createIssue.mock.calls[1]![1]).toMatchObject({
      title: "Second",
      priority: "URGENT",
    });
  });

  it("shows the API's refusals as sent", async () => {
    api.createIssue.mockRejectedValue(
      new ApiError(400, "Validation failed", {
        errors: [{ path: "title", message: "The title is required." }],
      }),
    );
    dialog();
    fireEvent.click(screen.getByRole("button", { name: "Create issue" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The title is required.");
  });

  it("Cancel closes it and sends nothing", () => {
    const { onClose } = dialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
    expect(api.createIssue).not.toHaveBeenCalled();
  });
});

const ACT = (
  id: string,
  iso: string,
  over: Partial<ActivityItem> = {},
): ActivityItem => ({
  id,
  projectId: "p1",
  issueKey: "PAY-1",
  issueTitle: "Fix the login page",
  action: "issue.updated",
  actorType: "USER",
  actor: { id: "u-ana", fullName: "Ana Reyes" },
  channel: "web",
  changes: [{ field: "status", old: "New", new: "In progress" }],
  session: null, // PB5
  createdAt: iso,
  ...over,
});

describe("PB1 the activity", () => {
  it("is grouped by Manila day, newest first, each change in plain words", async () => {
    api.fetchActivity.mockResolvedValue({
      items: [
        ACT("a", "2026-11-10T16:30:00.000Z"), // Nov 11, 00:30 in Manila
        ACT("b", "2026-11-10T15:30:00.000Z", { actorType: "CLAUDE", actor: null }), // Nov 10, 23:30
        ACT("c", "2026-11-09T02:00:00.000Z", {
          action: "comment.added",
          changes: [{ field: "comment", old: null, new: "Looks good" }],
        }),
      ],
      page: 1,
      pageSize: 25,
      total: 3,
    });
    mount(<ActivityTab projectKey="PAY" />);
    await screen.findByText("Wednesday, Nov 11, 2026");
    const days = [...document.querySelectorAll("[data-activity-day]")].map((d) =>
      d.getAttribute("data-activity-day"),
    );
    expect(days).toEqual(["2026-11-11", "2026-11-10", "2026-11-09"]);
    expect(screen.getAllByText("Status changed from New to In progress.")).toHaveLength(
      2,
    );
    expect(document.querySelector('[data-activity="b"]')!.textContent).toContain(
      "Claude",
    );
    expect(screen.getByText("Comment: Looks good")).toBeTruthy();
    expect(document.querySelector('[data-activity="a"]')!.textContent).toContain(
      "12:30 AM",
    );
  });

  it("filters by who acted and asks the API for it", async () => {
    api.fetchActivity.mockResolvedValue({
      items: [ACT("a", "2026-11-10T01:00:00.000Z")],
      page: 1,
      pageSize: 25,
      total: 1,
    });
    mount(<ActivityTab projectKey="PAY" />);
    await screen.findByText("Fix the login page");
    for (const [name, type] of [
      ["People", "USER"],
      ["Claude", "CLAUDE"],
      ["GitHub", "GITHUB"],
      ["System", "SYSTEM"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(api.fetchActivity.mock.calls.at(-1)![1].actorType).toBe(type),
      );
    }
    fireEvent.click(screen.getByRole("button", { name: "Everyone" }));
    await waitFor(() =>
      expect(api.fetchActivity.mock.calls.at(-1)![1].actorType).toBeUndefined(),
    );
  });
});

describe("PB1 the milestones", () => {
  it("lists them with state, dates and progress, and creates one", async () => {
    api.createMilestone.mockResolvedValue({ ...MS, id: "m2", name: "Launch" });
    mount(<MilestonesTab projectKey="PAY" canWrite />);
    expect(await screen.findByText("Beta")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText(/Due Dec 01, 2026/)).toBeTruthy();
    expect(screen.getByText("1/4")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "New milestone" }));
    const d = screen.getByRole("dialog");
    expect(within(d).queryByLabelText("State")).toBeNull(); // a new milestone starts Open
    fireEvent.change(within(d).getByLabelText("Name"), { target: { value: "Launch" } });
    fireEvent.change(within(d).getByLabelText("Due date"), {
      target: { value: "2027-01-15" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Create milestone" }));
    await waitFor(() =>
      expect(api.createMilestone).toHaveBeenCalledWith("PAY", {
        name: "Launch",
        description: "",
        startDate: null,
        dueDate: "2027-01-15",
      }),
    );
    await screen.findByText("Milestone Launch created.");
  });

  it("edits one, including its state", async () => {
    api.updateMilestone.mockResolvedValue({ ...MS, state: "LOCKED" });
    mount(<MilestonesTab projectKey="PAY" canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const d = screen.getByRole("dialog");
    expect(
      [...(within(d).getByLabelText("State") as HTMLSelectElement).options].map(
        (o) => o.textContent,
      ),
    ).toEqual(["Open", "Locked", "Closed"]);
    fireEvent.change(within(d).getByLabelText("State"), { target: { value: "LOCKED" } });
    fireEvent.click(within(d).getByRole("button", { name: "Save milestone" }));
    await waitFor(() =>
      expect(api.updateMilestone).toHaveBeenCalledWith("PAY", "m1", {
        name: "Beta",
        description: "",
        startDate: null,
        dueDate: "2026-12-01",
        state: "LOCKED",
      }),
    );
  });

  it("a Viewer sees them and cannot add or edit", async () => {
    mount(<MilestonesTab projectKey="PAY" canWrite={false} />);
    await screen.findByText("Beta");
    expect(screen.queryByRole("button", { name: "New milestone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("shows the API's refusal as sent", async () => {
    api.createMilestone.mockRejectedValue(
      new ApiError(400, "The due date cannot be before the start date.", {}),
    );
    mount(<MilestonesTab projectKey="PAY" canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: "New milestone" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Create milestone",
      }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "The due date cannot be before the start date.",
    );
  });
});

const OVERVIEW: ProjectOverview = {
  security: { state: "clear", open: 0, critical: 0, high: 0 }, // PB4
  recentSessions: [], // PB5
  project: {
    id: "p1",
    key: "PAY",
    name: "Payments",
    description: "The **payments** project",
    repoUrl: "https://example.test/repo",
    liveUrl: "",
    deployAppName: "",
    archived: false,
    parent: null,
    client: { id: "c1", businessName: "INVENTED TRADING" },
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  },
  status: {
    value: "ON_TRACK",
    note: "Going well",
    updatedAt: "2026-11-05T01:00:00.000Z",
  },
  statusUpdates: [
    {
      id: "su2",
      status: "ON_TRACK",
      note: "Going well",
      actorType: "USER",
      actor: { id: "u-ana", fullName: "Ana Reyes" },
      createdAt: "2026-11-05T01:00:00.000Z",
    },
    {
      id: "su1",
      status: "AT_RISK",
      note: "Late",
      actorType: "USER",
      actor: { id: "u-ana", fullName: "Ana Reyes" },
      createdAt: "2026-11-03T01:00:00.000Z",
    },
  ],
  progress: { done: 1, total: 4, percent: 25 },
  counts: { todo: 1, inProgress: 2, done: 1, overdue: 1, openBugs: 0 },
  countsByStatus: [
    { status: S_NEW, count: 1 },
    { status: S_PROG, count: 2 },
    { status: S_DONE, count: 1 },
  ],
  countsByType: [
    { type: T_TASK, count: 3 },
    { type: T_BUG, count: 1 },
  ],
  openMilestones: [MS],
  inProgress: [issue({ key: "PAY-3", title: "In flight", status: S_PROG })],
  recentActivity: [ACT("r1", "2026-11-05T01:00:00.000Z")],
  lastActivityAt: "2026-11-05T01:00:00.000Z",
};

describe("PB1 the project page", () => {
  const page = (perms: string[]) => {
    auth.perms = new Set(perms);
    api.fetchProject.mockResolvedValue(OVERVIEW);
    return mount(
      <Routes>
        <Route path="/projects/:key" element={<ProjectPage tab="overview" />} />
      </Routes>,
      "/projects/PAY",
    );
  };

  it("shows the status, history newest first, counts by status and type, and the details", async () => {
    page(ALL);
    await screen.findByText("Status history");
    const hist = [...document.querySelectorAll("[data-status-update]")].map((e) =>
      e.getAttribute("data-status-update"),
    );
    expect(hist).toEqual(["su2", "su1"]);
    expect(document.querySelector("[data-by-status]")!.textContent).toContain(
      "In progress2",
    );
    expect(document.querySelector("[data-by-type]")!.textContent).toContain("Bug1");
    expect(document.querySelector("[data-open-milestones]")!.textContent).toContain(
      "Beta",
    );
    expect(document.querySelector("[data-in-progress]")!.textContent).toContain("PAY-3");
    expect(
      document.querySelector("[data-project-details] [data-client]")!.textContent,
    ).toBe("INVENTED TRADING");
    expect(document.querySelector('[data-count="overdue"]')!.textContent).toContain(
      "1 overdue",
    );
  });

  it("posts a status update with its note", async () => {
    api.postStatusUpdate.mockResolvedValue(OVERVIEW.statusUpdates[0]);
    page(ALL);
    await screen.findByRole("button", { name: "Post status update" });
    const card = document.querySelector("[data-status-card]") as HTMLElement;
    fireEvent.change(within(card).getByLabelText("Status"), {
      target: { value: "AT_RISK" },
    });
    fireEvent.change(within(card).getByLabelText("Note"), {
      target: { value: "A supplier is late" },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Post status update" }));
    await waitFor(() =>
      expect(api.postStatusUpdate).toHaveBeenCalledWith("PAY", {
        status: "AT_RISK",
        note: "A supplier is late",
      }),
    );
    await screen.findByText("Status update posted.");
  });

  it("a Viewer sees the status and the history but cannot post, and has no Edit button", async () => {
    page(VIEWER);
    await screen.findByText("Status history");
    expect(screen.queryByRole("button", { name: "Post status update" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit project" })).toBeNull();
  });

  it("someone who may update gets Edit project", async () => {
    page(["Projects:Read", "Projects:Update"]);
    expect(await screen.findByRole("button", { name: "Edit project" })).toBeTruthy();
  });

  it("shows the API's refusal to open a project as sent", async () => {
    auth.perms = new Set(ALL);
    api.fetchProject.mockRejectedValue(new ApiError(404, "Project not found.", {}));
    mount(
      <Routes>
        <Route path="/projects/:key" element={<ProjectPage tab="overview" />} />
      </Routes>,
      "/projects/NOPE",
    );
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")?.textContent).toBe(
        "Project not found.",
      ),
    );
  });
});

const SUMMARY = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  ...OVERVIEW.project,
  security: { state: "clear", open: 0, critical: 0, high: 0 }, // PB4
  status: "AT_RISK",
  statusNote: "Late",
  statusUpdatedAt: "2026-11-05T01:00:00.000Z",
  progress: { done: 1, total: 4, percent: 25 },
  counts: { todo: 1, inProgress: 2, done: 1, overdue: 3, openBugs: 2 },
  nextMilestone: MS,
  lastActivityAt: "2026-11-10T16:30:00.000Z",
  ...over,
});

describe("PB1 the portfolio", () => {
  const portfolio = (perms: string[], user = { userType: "FIRM" }) => {
    auth.perms = new Set(perms);
    auth.user = user;
    api.fetchProjects.mockResolvedValue([SUMMARY()]);
    return mount(<ProjectsPage />, "/projects");
  };

  it("shows each project with its client, status, progress, counts, next milestone and last activity", async () => {
    portfolio(ALL);
    const row = (await waitFor(() => {
      const el = document.querySelector('[data-project="PAY"]');
      if (!el) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    expect(row.querySelector("[data-client]")!.textContent).toBe(
      "Client: INVENTED TRADING",
    );
    expect(
      row.querySelector("[data-project-status]")!.getAttribute("data-project-status"),
    ).toBe("AT_RISK");
    expect(row.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe(
      "25",
    );
    expect(row.querySelector('[data-count="todo"]')!.textContent).toBe("1 to do");
    expect(row.querySelector('[data-count="inProgress"]')!.textContent).toBe(
      "2 in progress",
    );
    expect(row.querySelector('[data-count="done"]')!.textContent).toBe("1 done");
    expect(row.querySelector('[data-count="overdue"]')!.textContent).toBe("3 overdue");
    expect(row.querySelector('[data-count="openBugs"]')!.textContent).toBe("2 open bugs");
    expect(row.querySelector("[data-next-milestone]")!.textContent).toContain("Beta");
    expect(row.querySelector("[data-next-milestone]")!.textContent).toContain(
      "Due Dec 01, 2026",
    );
    expect(row.textContent).toContain("Nov 11, 2026, 12:30 AM"); // Manila
  });

  it("the six statuses each have their own colour name", async () => {
    const { PROJECT_STATUS_VARIANT, PROJECT_STATUSES } =
      await import("../../lib/projects");
    const colours = PROJECT_STATUSES.map((s) => PROJECT_STATUS_VARIANT[s]);
    expect(new Set(colours).size).toBe(6);
  });

  it("Show archived asks for the archived ones too", async () => {
    portfolio(ALL);
    await screen.findByText("Payments");
    expect(api.fetchProjects).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByLabelText("Show archived"));
    await waitFor(() => expect(api.fetchProjects).toHaveBeenLastCalledWith(true));
  });

  it("New project and Settings are shown by permission", async () => {
    portfolio(ALL);
    await screen.findByText("Payments");
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    cleanup();
    portfolio(["Projects:Read", "Projects:Create"]);
    await screen.findByText("Payments");
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
    cleanup();
    portfolio(VIEWER);
    await screen.findByText("Payments");
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Settings" })).toBeNull();
  });

  it("a client user is sent home and nothing is asked", async () => {
    portfolio(ALL, { userType: "CLIENT" });
    await screen.findByText("home");
    expect(api.fetchProjects).not.toHaveBeenCalled();
  });

  it("someone without Projects:Read is sent home too", async () => {
    portfolio([]);
    await screen.findByText("home");
    expect(api.fetchProjects).not.toHaveBeenCalled();
  });
});

describe("PB1 the settings", () => {
  const settings = (perms: string[] = ALL) => {
    auth.perms = new Set(perms);
    api.listAdmin.mockImplementation((kind: string) =>
      Promise.resolve(
        kind === "issue-types"
          ? [{ ...T_TASK, issueCount: 4 }]
          : kind === "issue-statuses"
            ? [
                { ...S_NEW, issueCount: 3 },
                { ...S_DONE, issueCount: 0 },
              ]
            : [{ id: "l-front", name: "frontend", colour: "#1a7f37", issueCount: 1 }],
      ),
    );
    return mount(<ProjectsSettingsPage />, "/projects/settings");
  };

  it("lists types, statuses (with category and default) and labels with how many issues use each", async () => {
    settings();
    const statuses = (await waitFor(() => {
      const el = document.querySelector('[data-settings-section="issue-statuses"]');
      if (!el || !el.textContent?.includes("Used by")) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    expect(statuses.textContent).toContain("To do");
    expect(statuses.textContent).toContain("Default");
    expect(statuses.textContent).toContain("Done");
    expect(statuses.textContent).toContain("Used by 3 issues");
    expect(statuses.textContent).toContain("Used by 0 issues");
  });

  it("an in-use refusal is shown exactly as sent", async () => {
    const SENT = "This status is used by 3 issues. Move them to another status first.";
    api.deleteAdmin.mockRejectedValue(new ApiError(409, SENT, { message: SENT }));
    settings();
    const section = (await waitFor(() => {
      const el = document.querySelector('[data-settings-section="issue-statuses"]');
      if (!el || !el.querySelector("[data-setting-row]")) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    fireEvent.click(
      within(
        section.querySelector('[data-setting-row="s-new"]') as HTMLElement,
      ).getByRole("button", { name: "Delete" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete issue status",
      }),
    );
    await waitFor(() =>
      expect(within(section).getByRole("alert").textContent).toBe(SENT),
    );
    expect(api.deleteAdmin).toHaveBeenCalledWith("issue-statuses", "s-new");
  });

  it("adds a status with its category and default", async () => {
    api.createAdmin.mockResolvedValue({});
    settings();
    const section = (await waitFor(() => {
      const el = document.querySelector('[data-settings-section="issue-statuses"]');
      if (!el || !el.querySelector("[data-setting-row]")) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    fireEvent.click(within(section).getByRole("button", { name: "Add issue status" }));
    const d = screen.getByRole("dialog");
    fireEvent.change(within(d).getByLabelText("Name"), { target: { value: "Waiting" } });
    fireEvent.change(within(d).getByLabelText("Category"), {
      target: { value: "IN_PROGRESS" },
    });
    fireEvent.click(within(d).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.createAdmin).toHaveBeenCalledWith("issue-statuses", {
        name: "Waiting",
        colour: "#57606a",
        category: "IN_PROGRESS",
        isDefault: false,
      }),
    );
  });

  it("a save the API refuses shows its sentence in the window", async () => {
    api.createAdmin.mockRejectedValue(
      new ApiError(400, "The colour must look like #1a7f37.", {}),
    );
    settings();
    const section = (await waitFor(() => {
      const el = document.querySelector('[data-settings-section="labels"]');
      if (!el || !el.querySelector("[data-setting-row]")) throw new Error("not yet");
      return el;
    })) as HTMLElement;
    fireEvent.click(within(section).getByRole("button", { name: "Add label" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }),
    );
    expect(
      (await within(screen.getByRole("dialog")).findByRole("alert")).textContent,
    ).toBe("The colour must look like #1a7f37.");
  });

  it("without Configure nothing can be changed and the API's sentence for it is shown", async () => {
    settings(VIEWER);
    await screen.findByText("Missing permission(s): Projects:Configure");
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(api.listAdmin).not.toHaveBeenCalled();
  });
});

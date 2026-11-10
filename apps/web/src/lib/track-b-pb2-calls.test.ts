// track-b-pb2-calls.test.ts - PB2: the exact calls the new screens make of the API (paths, query
// strings, bodies), with fetch stubbed. All data is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchBoard,
  fetchMyWork,
  fetchRoadmap,
  reorderIssue,
  searchProjects,
} from "./projects";
import {
  fetchNotificationPreferences,
  fetchNotifications,
  fetchUnreadCount,
  inAppLink,
  markAllNotificationsRead,
  markNotificationRead,
  saveNotificationPreferences,
} from "./notifications";

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
  const u = new URL(c.url, "http://x.test");
  return {
    path: u.pathname.replace(/^.*\/api\/v1/, ""),
    q: u.searchParams,
    init: c.init,
  };
};

describe("PB2 calls: the board", () => {
  it("asks for the board with the filters as the API names them, and the 14 day window unless all is wanted", async () => {
    await fetchBoard("PAY", { milestone: "", assignee: "", doneAll: false });
    expect(last().path).toBe("/projects/PAY/board");
    expect([...last().q.keys()]).toEqual([]);
    await fetchBoard("PAY", { milestone: "none", assignee: "me", doneAll: true });
    expect(Object.fromEntries(last().q)).toEqual({
      milestoneId: "none",
      assigneeId: "me",
      doneRange: "all",
    });
    await fetchBoard("PAY", { milestone: "m-1", assignee: "none", doneAll: false });
    expect(Object.fromEntries(last().q)).toEqual({
      milestoneId: "m-1",
      assigneeId: "none",
    });
  });

  it("a move is a POST to the issue's reorder route with a position, and a status only when given", async () => {
    await reorderIssue("PAY", "PAY-12", { position: 2.5 });
    expect(last().path).toBe("/projects/PAY/issues/PAY-12/reorder");
    expect(last().init.method).toBe("POST");
    expect(JSON.parse(last().init.body as string)).toEqual({ position: 2.5 });
    await reorderIssue("PAY", "PAY-12", { position: 1, statusId: "s-1" });
    expect(JSON.parse(last().init.body as string)).toEqual({
      position: 1,
      statusId: "s-1",
    });
  });
});

describe("PB2 calls: roadmap, My Work, search", () => {
  it("each goes to its own route", async () => {
    await fetchRoadmap("PAY");
    expect(last().path).toBe("/projects/PAY/roadmap");
    await fetchMyWork();
    expect(last().path).toBe("/projects/my-work");
    await searchProjects("login & pay");
    expect(last().path).toBe("/projects/search");
    expect(last().q.get("q")).toBe("login & pay");
  });
  it("an empty search sends no q at all, so the API answers its sentence", async () => {
    await searchProjects("");
    expect(last().q.has("q")).toBe(false);
  });
});

describe("PB2 calls: notifications", () => {
  it("the list is unread first, 25 at a time; the count has its own route", async () => {
    await fetchNotifications();
    expect(last().path).toBe("/notifications");
    expect(Object.fromEntries(last().q)).toEqual({
      order: "unread-first",
      pageSize: "25",
    });
    await fetchUnreadCount();
    expect(last().path).toBe("/notifications/unread-count");
  });
  it("read and read-all are POSTs; the id is escaped", async () => {
    await markNotificationRead("n 1/2");
    expect(last().path).toBe("/notifications/n%201%2F2/read");
    expect(last().init.method).toBe("POST");
    await markAllNotificationsRead();
    expect(last().path).toBe("/notifications/read-all");
    expect(last().init.method).toBe("POST");
  });
  it("the email preference is read with GET and saved with PATCH { emailEnabled }", async () => {
    await fetchNotificationPreferences();
    expect(last().path).toBe("/notifications/preferences");
    await saveNotificationPreferences(true);
    expect(last().init.method).toBe("PATCH");
    expect(JSON.parse(last().init.body as string)).toEqual({ emailEnabled: true });
    await saveNotificationPreferences(false);
    expect(JSON.parse(last().init.body as string)).toEqual({ emailEnabled: false });
  });
  it("only a path inside the Portal is followed", () => {
    expect(inAppLink("/projects/PAY/issues/PAY-1")).toBe("/projects/PAY/issues/PAY-1");
    expect(inAppLink("https://elsewhere.example")).toBeNull();
    expect(inAppLink("//elsewhere.example")).toBeNull();
    expect(inAppLink("")).toBeNull();
    expect(inAppLink("projects/x")).toBeNull();
  });
});

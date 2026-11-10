// track-b-pb2-bell.test.tsx - PB2: the notification bell (count, polling only while the page is
// visible, opening one marks it read, read all) and the "Email me my notifications" setting on the
// profile page, with the API mocked. The API's sentences are shown as sent. All data is invented.

import {
  act,
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
  fetchNotifications: vi.fn(),
  fetchUnreadCount: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  fetchNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
}));
vi.mock("../lib/notifications", async (orig) => ({
  ...(await orig<typeof import("../lib/notifications")>()),
  ...api,
}));
const profile = vi.hoisted(() => ({ fetchProfile: vi.fn() }));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...profile,
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { userType: "FIRM", fullName: "Ana Reyes" },
    hasPermission: () => true,
    refreshUser: vi.fn(),
  }),
}));

import { ApiError } from "../lib/api";
import type { NotificationItem } from "../lib/notifications";
import ProfilePage from "../pages/ProfilePage";
import { NotificationBell } from "./NotificationBell";

const note = (id: string, over: Partial<NotificationItem> = {}): NotificationItem => ({
  id,
  kind: "project.issue.assigned",
  title: `Title ${id}`,
  body: `Body ${id}`,
  link: `/projects/PAY/issues/PAY-${id.replace("n", "")}`,
  entityType: "Issue",
  entityId: "e",
  readAt: null,
  createdAt: "2026-11-10T16:30:00.000Z",
  ...over,
});
const page = (items: NotificationItem[], total = items.length) => ({
  items,
  page: 1,
  pageSize: 25,
  total,
  unread: items.filter((i) => !i.readAt).length,
});

function Where() {
  const l = useLocation();
  return <div data-where>{l.pathname}</div>;
}
function mount(ui: React.ReactElement, path = "/projects") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
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
const bell = () => screen.getByRole("button", { name: /^Notifications/ });
const setVisibility = (state: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  profile.fetchProfile.mockReset();
  Object.defineProperty(document, "visibilityState", {
    value: "visible",
    configurable: true,
  });
  api.fetchUnreadCount.mockResolvedValue({ count: 0 });
  api.fetchNotifications.mockResolvedValue(page([]));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// ---------------------------------------------------------------------------------------------

describe("PB2 bell: the count", () => {
  it("shows no number when nothing is unread, and the unread count when there is some", async () => {
    mount(<NotificationBell />);
    await waitFor(() => expect(api.fetchUnreadCount).toHaveBeenCalled());
    expect(document.querySelector("[data-bell-count]")).toBeNull();
    expect(bell().getAttribute("aria-label")).toBe("Notifications");
    cleanup();
    api.fetchUnreadCount.mockResolvedValue({ count: 3 });
    mount(<NotificationBell />);
    await waitFor(() =>
      expect(document.querySelector("[data-bell-count]")!.textContent).toBe("3"),
    );
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 3 unread");
  });

  it("a large count reads 99+", async () => {
    api.fetchUnreadCount.mockResolvedValue({ count: 250 });
    mount(<NotificationBell />);
    await waitFor(() =>
      expect(document.querySelector("[data-bell-count]")!.textContent).toBe("99+"),
    );
  });
});

describe("PB2 bell: polling the count", () => {
  const tick = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("asks again every 60 seconds while the page is visible", async () => {
    vi.useFakeTimers();
    mount(<NotificationBell />);
    await tick(0);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(1);
    await tick(59_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(1);
    await tick(1_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(2);
    await tick(60_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(3);
  });

  it("does not ask while the page is hidden, and asks at once when it is visible again", async () => {
    vi.useFakeTimers();
    mount(<NotificationBell />);
    await tick(0);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    await tick(300_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await tick(0);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(2); // the missed polls, once
    await tick(60_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(3);
  });

  it("a page opened in a hidden tab does not poll until it is shown", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    mount(<NotificationBell />);
    await tick(0);
    const afterMount = api.fetchUnreadCount.mock.calls.length;
    await tick(180_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(afterMount);
    setVisibility("visible");
    await tick(0);
    expect(api.fetchUnreadCount.mock.calls.length).toBe(afterMount + 1);
  });

  it("stops asking when the bell goes away", async () => {
    vi.useFakeTimers();
    const view = mount(<NotificationBell />);
    await tick(0);
    view.unmount();
    await tick(300_000);
    expect(api.fetchUnreadCount).toHaveBeenCalledTimes(1);
  });
});

describe("PB2 bell: the panel", () => {
  it("lists the notifications as the API ordered them (unread first), unread marked, with Manila time", async () => {
    api.fetchUnreadCount.mockResolvedValue({ count: 2 });
    api.fetchNotifications.mockResolvedValue(
      page([note("n1"), note("n2"), note("n3", { readAt: "2026-11-09T01:00:00.000Z" })]),
    );
    mount(<NotificationBell />);
    fireEvent.click(bell());
    const dialog = await screen.findByRole("dialog", { name: "Notifications" });
    await within(dialog).findByText("Title n1");
    const rows = Array.from(dialog.querySelectorAll("[data-notification]"));
    expect(rows.map((r) => r.getAttribute("data-notification"))).toEqual([
      "n1",
      "n2",
      "n3",
    ]);
    expect(rows.map((r) => r.getAttribute("data-unread"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    expect(within(dialog).getByText("Body n1")).toBeTruthy();
    expect(within(dialog).getAllByText("Nov 11, 2026, 12:30 AM").length).toBe(3); // 16:30 UTC is Manila the next day
    expect(api.fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it("does not ask for the list until the panel is opened", async () => {
    mount(<NotificationBell />);
    await waitFor(() => expect(api.fetchUnreadCount).toHaveBeenCalled());
    expect(api.fetchNotifications).not.toHaveBeenCalled();
  });

  it("says so when there are none, and when more exist than are shown", async () => {
    mount(<NotificationBell />);
    fireEvent.click(bell());
    await screen.findByText(/Nothing yet/);
    cleanup();
    api.fetchNotifications.mockResolvedValue(page([note("n1")], 80));
    mount(<NotificationBell />);
    fireEvent.click(bell());
    await screen.findByText("Showing the latest 1 of 80.");
  });

  it("clicking one marks it read, goes to its link, closes the panel and refreshes the count", async () => {
    api.fetchUnreadCount
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 1 });
    api.fetchNotifications.mockResolvedValue(page([note("n1"), note("n2")]));
    api.markNotificationRead.mockResolvedValue(
      note("n1", { readAt: "2026-11-10T17:00:00.000Z" }),
    );
    mount(<NotificationBell />);
    await waitFor(() =>
      expect(document.querySelector("[data-bell-count]")!.textContent).toBe("2"),
    );
    fireEvent.click(bell());
    fireEvent.click(await screen.findByText("Title n1"));
    expect(where()).toBe("/projects/PAY/issues/PAY-1");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith("n1"));
    await waitFor(() =>
      expect(document.querySelector("[data-bell-count]")!.textContent).toBe("1"),
    );
    expect(api.markNotificationRead).toHaveBeenCalledTimes(1);
  });

  it("one that is already read is followed without marking it again", async () => {
    api.fetchNotifications.mockResolvedValue(
      page([note("n3", { readAt: "2026-11-09T01:00:00.000Z" })]),
    );
    mount(<NotificationBell />);
    fireEvent.click(bell());
    fireEvent.click(await screen.findByText("Title n3"));
    expect(where()).toBe("/projects/PAY/issues/PAY-3");
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  it("a link that leaves the Portal is not followed, but the notification is still read", async () => {
    api.fetchNotifications.mockResolvedValue(
      page([
        note("n1", { link: "https://elsewhere.example/x" }),
        note("n2", { link: "//elsewhere.example" }),
      ]),
    );
    api.markNotificationRead.mockResolvedValue(note("n1"));
    mount(<NotificationBell />, "/start");
    fireEvent.click(bell());
    fireEvent.click(await screen.findByText("Title n1"));
    expect(where()).toBe("/start");
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith("n1"));
    fireEvent.click(bell());
    fireEvent.click(await screen.findByText("Title n2"));
    expect(where()).toBe("/start");
  });

  it("Mark all as read marks the list read and clears the count", async () => {
    api.fetchUnreadCount
      .mockResolvedValueOnce({ count: 2 })
      .mockResolvedValue({ count: 0 });
    api.fetchNotifications.mockResolvedValue(page([note("n1"), note("n2")]));
    api.markAllNotificationsRead.mockResolvedValue({ updated: 2 });
    mount(<NotificationBell />);
    await waitFor(() =>
      expect(document.querySelector("[data-bell-count]")).not.toBeNull(),
    );
    fireEvent.click(bell());
    await screen.findByText("Title n1");
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    await waitFor(() =>
      expect(
        Array.from(document.querySelectorAll("[data-notification]")).map((r) =>
          r.getAttribute("data-unread"),
        ),
      ).toEqual(["false", "false"]),
    );
    expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.querySelector("[data-bell-count]")).toBeNull());
    expect(
      (screen.getByRole("button", { name: "Mark all as read" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("Mark all as read is off when nothing is unread", async () => {
    api.fetchNotifications.mockResolvedValue(
      page([note("n3", { readAt: "2026-11-09T01:00:00.000Z" })]),
    );
    mount(<NotificationBell />);
    fireEvent.click(bell());
    await screen.findByText("Title n3");
    expect(
      (screen.getByRole("button", { name: "Mark all as read" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows the API's sentence when marking fails, and when the list cannot load", async () => {
    api.fetchUnreadCount.mockResolvedValue({ count: 1 });
    api.fetchNotifications.mockResolvedValue(page([note("n1")]));
    api.markAllNotificationsRead.mockRejectedValue(
      new ApiError(500, "Could not mark them read.", {}),
    );
    mount(<NotificationBell />);
    await waitFor(() =>
      expect(document.querySelector("[data-bell-count]")).not.toBeNull(),
    );
    fireEvent.click(bell());
    await screen.findByText("Title n1");
    fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not mark them read.",
    );
    cleanup();
    api.fetchNotifications.mockRejectedValue(
      new ApiError(500, "Notifications are unavailable.", {}),
    );
    mount(<NotificationBell />);
    fireEvent.click(bell());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Notifications are unavailable.",
    );
  });

  it("Escape and a click outside close the panel", async () => {
    mount(<NotificationBell />);
    fireEvent.click(bell());
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(bell());
    await screen.findByRole("dialog");
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

describe("PB2 profile: Email me my notifications", () => {
  const PROFILE = {
    id: "u1",
    fullName: "Ana Reyes",
    email: "ana@example.test",
    userType: "FIRM" as const,
    mfaEnabled: false,
    avatarUrl: null,
  };
  const box = async () =>
    (await screen.findByRole("checkbox", {
      name: "Email me my notifications",
    })) as HTMLInputElement;
  beforeEach(() => profile.fetchProfile.mockResolvedValue(PROFILE));

  it("shows the saved choice (off by default)", async () => {
    api.fetchNotificationPreferences.mockResolvedValue({ emailEnabled: false });
    mount(<ProfilePage />, "/profile");
    expect((await box()).checked).toBe(false);
    cleanup();
    api.fetchNotificationPreferences.mockResolvedValue({ emailEnabled: true });
    mount(<ProfilePage />, "/profile");
    expect((await box()).checked).toBe(true);
  });

  it("switching it on saves it and says Saved", async () => {
    api.fetchNotificationPreferences.mockResolvedValue({ emailEnabled: false });
    api.saveNotificationPreferences.mockResolvedValue({ emailEnabled: true });
    mount(<ProfilePage />, "/profile");
    fireEvent.click(await box());
    await waitFor(() =>
      expect(api.saveNotificationPreferences).toHaveBeenCalledWith(true),
    );
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect((await box()).checked).toBe(true);
  });

  it("switching it off saves false", async () => {
    api.fetchNotificationPreferences.mockResolvedValue({ emailEnabled: true });
    api.saveNotificationPreferences.mockResolvedValue({ emailEnabled: false });
    mount(<ProfilePage />, "/profile");
    fireEvent.click(await box());
    await waitFor(() =>
      expect(api.saveNotificationPreferences).toHaveBeenCalledWith(false),
    );
    await waitFor(async () => expect((await box()).checked).toBe(false));
  });

  it("a refusal shows the API's sentence and the box stays as it was saved", async () => {
    api.fetchNotificationPreferences.mockResolvedValue({ emailEnabled: false });
    api.saveNotificationPreferences.mockRejectedValue(
      new ApiError(500, "Could not save that.", {}),
    );
    mount(<ProfilePage />, "/profile");
    fireEvent.click(await box());
    expect((await screen.findByText("Could not save that.")).textContent).toBe(
      "Could not save that.",
    );
    expect((await box()).checked).toBe(false);
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

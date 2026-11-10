// notifications.ts - the signed-in person's own notifications (PB2): the list, the unread count,
// marking read, and the email preference. Polling the count is done by the bell, not here.
import { useEffect, useRef } from "react";
import { apiFetch } from "./api";

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** A path in this app, such as /projects/PAY/issues/PAY-12. May be empty. */
  link: string;
  entityType: string;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationPage {
  items: NotificationItem[];
  page: number;
  pageSize: number;
  total: number;
  unread: number;
}

/** How often the bell asks for the unread count while the page is visible. */
export const UNREAD_POLL_MS = 60_000;
export const NOTIFICATIONS_PAGE_SIZE = 25;

export const fetchNotifications = () =>
  apiFetch<NotificationPage>(
    `/notifications?order=unread-first&pageSize=${NOTIFICATIONS_PAGE_SIZE}`,
  );
export const fetchUnreadCount = () =>
  apiFetch<{ count: number }>("/notifications/unread-count");
export const markNotificationRead = (id: string) =>
  apiFetch<NotificationItem>(`/notifications/${encodeURIComponent(id)}/read`, {
    method: "POST",
  });
export const markAllNotificationsRead = () =>
  apiFetch<{ updated: number }>("/notifications/read-all", { method: "POST" });
export const fetchNotificationPreferences = () =>
  apiFetch<{ emailEnabled: boolean }>("/notifications/preferences");
export const saveNotificationPreferences = (emailEnabled: boolean) =>
  apiFetch<{ emailEnabled: boolean }>("/notifications/preferences", {
    method: "PATCH",
    body: JSON.stringify({ emailEnabled }),
  });

/** A link from a notification is followed only when it is a path inside this app. */
export const inAppLink = (link: string): string | null =>
  link.startsWith("/") && !link.startsWith("//") ? link : null;

/**
 * Run `fn` every `ms` while the page is visible and not at all while it is hidden. When the page
 * becomes visible again it runs once at once (polls were missed) and the clock starts afresh.
 */
export function useVisibleInterval(fn: () => void, ms: number): void {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const start = () => {
      stop();
      timer = window.setInterval(() => latest.current(), ms);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        latest.current();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ms]);
}

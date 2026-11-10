// NotificationBell - the bell in the Portal's header for every signed-in person (PB2): the number
// of unread notifications (asked again every 60 seconds while the page is visible, never while it
// is hidden), and a panel with the notifications, unread first. Opening one follows its link and
// marks it read; "Mark all as read" does what it says.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ErrorBanner } from "./projects/parts";
import { cn } from "./ui";
import { errorLines, momentText } from "../lib/projects";
import {
  fetchNotifications,
  fetchUnreadCount,
  inAppLink,
  markAllNotificationsRead,
  markNotificationRead,
  UNREAD_POLL_MS,
  useVisibleInterval,
  type NotificationItem,
  type NotificationPage,
} from "../lib/notifications";

const COUNT_KEY = ["notifications", "unread-count"] as const;
const LIST_KEY = ["notifications", "list"] as const;

export function NotificationBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const count = useQuery({ queryKey: COUNT_KEY, queryFn: fetchUnreadCount });
  useVisibleInterval(
    () => void qc.invalidateQueries({ queryKey: COUNT_KEY }),
    UNREAD_POLL_MS,
  );
  const list = useQuery({
    queryKey: LIST_KEY,
    queryFn: fetchNotifications,
    enabled: open,
  });

  const unread = count.data?.count ?? 0;

  const read = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: (n) => {
      qc.setQueryData<NotificationPage>(LIST_KEY, (old) =>
        old
          ? {
              ...old,
              unread: Math.max(0, old.unread - 1),
              items: old.items.map((x) => (x.id === n.id ? n : x)),
            }
          : old,
      );
      void qc.invalidateQueries({ queryKey: COUNT_KEY });
    },
  });
  const readAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      const at = new Date().toISOString();
      qc.setQueryData<NotificationPage>(LIST_KEY, (old) =>
        old
          ? {
              ...old,
              unread: 0,
              items: old.items.map((x) => (x.readAt ? x : { ...x, readAt: at })),
            }
          : old,
      );
      qc.setQueryData(COUNT_KEY, { count: 0 });
      void qc.invalidateQueries({ queryKey: COUNT_KEY });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function openOne(n: NotificationItem) {
    if (!n.readAt) read.mutate(n.id);
    setOpen(false);
    const to = inAppLink(n.link);
    if (to) navigate(to);
  }

  const items = list.data?.items ?? [];
  return (
    <div ref={wrapRef} className="relative" data-notification-bell>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-content-secondary ring-offset-2 hover:bg-rowhover hover:text-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 ? (
          <span
            data-bell-count
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger px-1 font-mono text-[10px] font-semibold leading-none text-white"
          >
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-30 mt-2 w-[380px] max-w-[92vw] rounded-card border border-line-strong bg-card shadow-lg"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="font-serif text-[16px] font-medium text-navy">
              Notifications
            </h2>
            <button
              type="button"
              disabled={unread === 0 || readAll.isPending}
              onClick={() => readAll.mutate()}
              className="text-[12.5px] font-semibold text-blue underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-content-secondary disabled:no-underline"
            >
              Mark all as read
            </button>
          </div>
          {read.isError || readAll.isError ? (
            <ErrorBanner
              lines={errorLines(read.error ?? readAll.error)}
              className="m-3"
            />
          ) : null}
          <div className="max-h-[420px] overflow-y-auto">
            {list.isPending ? (
              <p className="px-4 py-6 text-[13px] text-content-secondary">Loading…</p>
            ) : list.isError ? (
              <div className="p-3">
                <ErrorBanner lines={errorLines(list.error)} />
              </div>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-content-secondary">
                Nothing yet. You will see here when something needs you.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-notification={n.id}
                      data-unread={n.readAt ? "false" : "true"}
                      onClick={() => openOne(n)}
                      className={cn(
                        "block w-full px-4 py-3 text-left hover:bg-rowhover focus-visible:bg-rowhover focus-visible:outline-none",
                        n.readAt ? "" : "bg-warn-bg-2/60",
                      )}
                    >
                      <span className="flex items-start gap-2">
                        {n.readAt ? null : (
                          <span
                            aria-hidden
                            className="mt-1.5 h-2 w-2 flex-none rounded-full bg-blue"
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              "block text-[13px] text-content",
                              n.readAt ? "font-normal" : "font-semibold",
                            )}
                          >
                            {n.title}
                            {n.readAt ? null : <span className="sr-only"> (unread)</span>}
                          </span>
                          {n.body ? (
                            <span className="mt-0.5 block text-[12.5px] text-content-secondary">
                              {n.body}
                            </span>
                          ) : null}
                          <span className="mt-1 block font-mono text-[10.5px] text-content-secondary">
                            {momentText(n.createdAt)}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {list.data && list.data.total > items.length ? (
            <p className="border-t border-line px-4 py-2 text-[12px] text-content-secondary">
              Showing the latest {items.length} of {list.data.total}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

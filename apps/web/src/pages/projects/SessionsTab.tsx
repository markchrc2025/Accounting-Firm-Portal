// SessionsTab and RecentSessionsCard - the Claude work sessions of a project (PB5, Track A PA3 / PA5):
// who ran it (Claude when no person is known), the client, its title, when it started and ended in
// Asia/Manila ("Open" while it has not ended), what it did and what comes next as sanitised markdown,
// and the issues it touched as links. The Sessions tab pages through all of them; an activity entry
// links here with ?session=<id>, and the tab keeps fetching pages until that session is shown.

import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
  cn,
} from "../../components/ui";
import { ErrorBanner, Markdown } from "../../components/projects/parts";
import {
  errorLines,
  fetchSessions,
  issuePath,
  momentText,
  projectPath,
  sessionPath,
  sessionTitle,
  sessionWho,
  type ClaudeSession,
} from "../../lib/projects";

const PAGE_SIZE = 25;

function IssueKeys({ projectKey, keys }: { projectKey: string; keys: string[] }) {
  if (keys.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2" data-session-issues>
      {keys.map((k) => (
        <li key={k}>
          <Link
            to={issuePath(projectKey, k)}
            className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
          >
            {k}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function When({ s }: { s: ClaudeSession }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-content-secondary">
      <span data-session-started>Started {momentText(s.startedAt)}</span>
      {s.endedAt ? (
        <span data-session-ended>Ended {momentText(s.endedAt)}</span>
      ) : (
        <Chip variant="info" data-session-open>
          Open
        </Chip>
      )}
    </span>
  );
}

export function SessionCard({
  s,
  projectKey,
  highlighted,
}: {
  s: ClaudeSession;
  projectKey: string;
  highlighted?: boolean;
}) {
  return (
    <Card
      id={`session-${s.id}`}
      data-session={s.id}
      data-session-highlighted={highlighted ? "true" : undefined}
      className={cn(highlighted ? "border-gold ring-2 ring-gold" : "")}
    >
      <CardContent className="space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="font-semibold text-navy">{sessionTitle(s)}</h3>
          <span data-session-who className="font-semibold text-content">
            {sessionWho(s)}
          </span>
          {s.client ? <Chip variant="neutral">{s.client}</Chip> : null}
        </div>
        <When s={s} />
        <div data-session-summary>
          {s.summary.trim() ? (
            <Markdown text={s.summary} />
          ) : (
            <p className="text-content-secondary">No summary yet.</p>
          )}
        </div>
        {s.nextSteps.trim() ? (
          <div data-session-next-steps>
            <h4 className="mb-1 text-[12px] font-semibold uppercase tracking-[.08em] text-content-secondary">
              Next steps
            </h4>
            <Markdown text={s.nextSteps} />
          </div>
        ) : null}
        <IssueKeys projectKey={projectKey} keys={s.issueKeys} />
      </CardContent>
    </Card>
  );
}

export function SessionsTab({ projectKey }: { projectKey: string }) {
  const [sp] = useSearchParams();
  const target = sp.get("session");
  const q = useInfiniteQuery({
    queryKey: ["projects", "sessions", projectKey],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => fetchSessions(projectKey, { page: pageParam, pageSize: PAGE_SIZE }),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    retry: false,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const found = target ? items.some((s) => s.id === target) : false;

  // A link from the activity may name a session on a later page: fetch on until it is here.
  useEffect(() => {
    if (target && !found && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
  }, [target, found, q, q.hasNextPage, q.isFetchingNextPage]);
  useEffect(() => {
    if (found) document.getElementById(`session-${target}`)?.scrollIntoView?.({ block: "center" });
  }, [found, target]);
  const lost = !!target && !found && !q.hasNextPage && !q.isPending && !q.isFetchingNextPage;

  return (
    <div className="space-y-4" data-sessions-tab>
      <h2 className="font-serif text-[19px] font-medium text-navy">Claude sessions</h2>
      {lost ? (
        <p role="note" className="text-[13px] text-content-secondary">
          That session is not in this project&apos;s list.
        </p>
      ) : null}
      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
          <ErrorState message="Could not load the sessions." onRetry={() => void q.refetch()} />
        </>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No Claude session yet"
            description="A session is recorded when Claude Code works on this project."
          />
        </Card>
      ) : (
        <>
          {items.map((s) => (
            <SessionCard key={s.id} s={s} projectKey={projectKey} highlighted={s.id === target} />
          ))}
          {q.hasNextPage ? (
            <Button
              variant="outline"
              disabled={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {q.isFetchingNextPage ? "Loading…" : "Show older sessions"}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function RecentSessionsCard({
  projectKey,
  sessions,
}: {
  projectKey: string;
  sessions: ClaudeSession[];
}) {
  return (
    <Card data-recent-sessions>
      <CardHeader>
        <CardTitle>Recent Claude sessions</CardTitle>
        <Link
          to={projectPath(projectKey, "sessions")}
          className="text-[12.5px] text-blue underline-offset-2 hover:underline"
        >
          All sessions
        </Link>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <p className="text-[13px] text-content-secondary">No Claude session yet.</p>
        ) : (
          <ul className="space-y-3" data-recent-sessions-list>
            {sessions.map((s) => (
              <li key={s.id} data-session={s.id} className="space-y-1 text-[13px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link
                    to={sessionPath(projectKey, s.id)}
                    className="font-semibold text-navy underline-offset-2 hover:underline"
                  >
                    {sessionTitle(s)}
                  </Link>
                  <span data-session-who className="text-content-secondary">
                    {sessionWho(s)}
                  </span>
                </div>
                <When s={s} />
                <IssueKeys projectKey={projectKey} keys={s.issueKeys} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

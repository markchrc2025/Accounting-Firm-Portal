// ActivityTab - a project's activity, newest first, grouped by day in Asia/Manila, with a filter
// on who acted (people, Claude, GitHub, system). Each entry says what was done and shows its
// field changes in plain words (PB1).

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  EmptyState,
  ErrorState,
  Skeleton,
  cn,
} from "../../components/ui";
import { ErrorBanner } from "../../components/projects/parts";
import { SessionLink } from "../../components/projects/SessionLink";
import {
  ACTOR_FILTERS,
  actorName,
  activityHeadline,
  describeChange,
  errorLines,
  fetchActivity,
  groupByManilaDay,
  issuePath,
  manilaTime,
  projectKeyOf,
  type ActivityItem,
  type ActorType,
} from "../../lib/projects";

const PAGE_SIZE = 25;

/** The entries of an activity list, grouped by Manila day. */
export function ActivityEntries({
  items,
  projectKey,
}: {
  items: ActivityItem[];
  /** The project the entries belong to (for the link to a session). */
  projectKey?: string;
}) {
  const groups = groupByManilaDay(items);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.day} data-activity-day={g.day}>
          <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[.12em] text-gold-deep">
            {g.label}
          </h3>
          <ul className="space-y-3">
            {g.items.map((a) => (
              <li key={a.id} data-activity={a.id} className="text-[13px]">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-content">{actorName(a)}</span>
                  <span className="text-content-secondary">{activityHeadline(a)}</span>
                  {a.issueKey ? (
                    <Link
                      to={issuePath(a.issueKey.split("-")[0]!, a.issueKey)}
                      className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
                    >
                      {a.issueKey}
                    </Link>
                  ) : null}
                  {a.issueTitle ? (
                    <span className="text-content-secondary">{a.issueTitle}</span>
                  ) : null}
                  <SessionLink
                    projectKey={projectKey ?? projectKeyOf(a.issueKey ?? "")}
                    session={a.session}
                  />
                  <span className="ml-auto font-mono text-[11px] text-content-secondary">
                    {manilaTime(a.createdAt)}
                  </span>
                </div>
                <ul className="mt-0.5 space-y-0.5 pl-3 text-[12.5px] text-content-secondary">
                  {a.changes.map((c, i) => {
                    const text = describeChange(c, a.action);
                    return text ? <li key={i}>{text}</li> : null;
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ActivityTab({ projectKey }: { projectKey: string }) {
  const [actor, setActor] = useState<ActorType | "">("");
  const q = useInfiniteQuery({
    queryKey: ["projects", "activity", projectKey, actor],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      fetchActivity(projectKey, {
        actorType: actor || undefined,
        page: pageParam,
        pageSize: PAGE_SIZE,
      }),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div>
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Who acted"
      >
        {ACTOR_FILTERS.map((f) => (
          <button
            key={f.value || "all"}
            type="button"
            data-actor-filter={f.value || "all"}
            aria-pressed={actor === f.value}
            onClick={() => setActor(f.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors",
              actor === f.value
                ? "border-navy bg-navy text-white"
                : "border-line-input bg-card text-content-secondary hover:border-navy",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
          <ErrorState
            message="Could not load the activity."
            onRetry={() => void q.refetch()}
          />
        </>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title="No activity yet"
            description="Changes to this project will show here."
          />
        </Card>
      ) : (
        <Card>
          <CardContent>
            <ActivityEntries items={items} projectKey={projectKey} />
            {q.hasNextPage ? (
              <div className="mt-5">
                <Button
                  variant="outline"
                  disabled={q.isFetchingNextPage}
                  onClick={() => void q.fetchNextPage()}
                >
                  {q.isFetchingNextPage ? "Loading…" : "Show older activity"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// MyWorkPage - the landing page of Projects (PB2): what is assigned to me by priority, what is
// overdue across every project, the milestones due in the next 30 days, the latest activity, and
// three totals. Everything is as the API answers; dates are in Asia/Manila.

import { useQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from "../../components/ui";
import { ErrorBanner, ProgressBar } from "../../components/projects/parts";
import { IssueRows } from "../../components/projects/IssueRows";
import { SessionLink } from "../../components/projects/SessionLink";
import { ProjectsNav } from "../../components/projects/ProjectsNav";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import {
  actorName,
  activityHeadline,
  dayText,
  errorLines,
  fetchMyWork,
  issuePath,
  momentText,
  projectPath,
  type MyWork,
} from "../../lib/projects";

function Section({
  title,
  count,
  children,
  id,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <section data-section={id} aria-labelledby={`mw-${id}`}>
      <h2
        id={`mw-${id}`}
        className="mb-2 flex items-baseline gap-2 font-serif text-[18px] font-medium text-navy"
      >
        {title}
        {count !== undefined ? (
          <span className="font-mono text-[12px] text-content-secondary">{count}</span>
        ) : null}
      </h2>
      <Card>{children}</Card>
    </section>
  );
}

function Total({ id, label, value }: { id: string; label: string; value: number }) {
  return (
    <Card className="px-5 py-4" data-total={id}>
      <div className="eyebrow">{label}</div>
      <div className="mt-1 font-serif text-[30px] font-medium leading-none text-navy">
        {value}
      </div>
    </Card>
  );
}

function Body({ w }: { w: MyWork }) {
  return (
    <div className="space-y-7">
      <div className="grid gap-3 sm:grid-cols-3">
        <Total
          id="assignedOpen"
          label="Assigned to me, open"
          value={w.totals.assignedOpen}
        />
        <Total id="overdue" label="Overdue, all projects" value={w.totals.overdue} />
        <Total
          id="dueThisWeek"
          label="Mine, due this week"
          value={w.totals.dueThisWeek}
        />
      </div>

      <Section id="assigned" title="Assigned to me" count={w.totals.assignedOpen}>
        {w.assigned.length === 0 ? (
          <EmptyState
            title="Nothing assigned to you"
            description="Open issues assigned to you show here."
          />
        ) : (
          <IssueRows items={w.assigned} />
        )}
      </Section>

      <Section id="overdue" title="Overdue across all projects" count={w.totals.overdue}>
        {w.overdue.length === 0 ? (
          <EmptyState title="Nothing is overdue" />
        ) : (
          <IssueRows items={w.overdue} showAssignee />
        )}
      </Section>

      <Section id="milestones" title="Milestones due in the next 30 days">
        {w.upcomingMilestones.length === 0 ? (
          <EmptyState title="No milestone is due in the next 30 days" />
        ) : (
          <ul className="divide-y divide-line">
            {w.upcomingMilestones.map((m) => (
              <li
                key={m.id}
                data-milestone={m.id}
                className="flex flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 text-[13px]"
              >
                <div className="min-w-[200px] flex-1">
                  <Link
                    to={projectPath(m.project.key, "milestones")}
                    className="font-semibold text-navy underline-offset-2 hover:underline"
                  >
                    {m.name}
                  </Link>
                  <span className="ml-2 font-mono text-[11px] text-content-secondary">
                    {m.project.name}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-content-secondary">
                  Due {dayText(m.dueDate)}
                </span>
                <div className="w-[200px]">
                  <ProgressBar
                    done={m.progress.done}
                    total={m.progress.total}
                    percent={m.progress.percent}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="activity" title="Recent activity">
        {w.recentActivity.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <ul className="divide-y divide-line">
            {w.recentActivity.map((a) => (
              <li
                key={a.id}
                data-activity={a.id}
                className="flex flex-wrap items-baseline gap-x-2 px-5 py-2.5 text-[13px]"
              >
                <span className="font-semibold text-content">{actorName(a)}</span>
                <span className="text-content-secondary">{activityHeadline(a)}</span>
                {a.issueKey ? (
                  <Link
                    to={issuePath(a.project.key, a.issueKey)}
                    className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
                  >
                    {a.issueKey}
                  </Link>
                ) : null}
                {a.issueTitle ? (
                  <span className="text-content-secondary">{a.issueTitle}</span>
                ) : null}
                <SessionLink projectKey={a.project.key} session={a.session} />
                <span className="font-mono text-[11px] text-content-secondary">
                  {a.project.name}
                </span>
                <span className="ml-auto font-mono text-[11px] text-content-secondary">
                  {momentText(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export default function MyWorkPage() {
  const can = useProjectsCan();
  const q = useQuery({
    queryKey: ["projects", "my-work"],
    queryFn: fetchMyWork,
    enabled: can.read,
  });
  if (!can.read) return <Navigate to="/" replace />;
  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow="Project management"
        title="My Work"
        description="What needs you today, across every project."
      />
      <ProjectsNav />
      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-4" />
          <ErrorState
            message="Could not load your work."
            onRetry={() => void q.refetch()}
          />
        </>
      ) : (
        <Body w={q.data} />
      )}
    </div>
  );
}

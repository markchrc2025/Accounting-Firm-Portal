// ProjectsPage - the portfolio (PB1): every project the caller can see, with its status,
// progress, counts, next milestone and last activity, all as the API gives them.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../../components/ui";
import {
  ErrorBanner,
  ProgressBar,
  ProjectStatusChip,
  SuccessBanner,
} from "../../components/projects/parts";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import {
  dayText,
  errorLines,
  fetchProjects,
  momentText,
  projectPath,
  type ProjectSummary,
} from "../../lib/projects";

export default function ProjectsPage() {
  const can = useProjectsCan();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [archived, setArchived] = useState(false);
  const q = useQuery({
    queryKey: ["projects", "portfolio", archived],
    queryFn: () => fetchProjects(archived),
    enabled: can.read,
  });
  if (!can.read) return <Navigate to="/" replace />;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow="Project management"
        title="Projects"
        description="Every project, its progress and what needs attention."
        actions={
          <>
            <label className="flex items-center gap-2 text-[13px] text-content-secondary">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              Show archived
            </label>
            {can.configure ? (
              <Button variant="outline" onClick={() => navigate("/projects/settings")}>
                Settings
              </Button>
            ) : null}
            {can.create ? (
              <Button onClick={() => navigate("/projects/new")}>New project</Button>
            ) : null}
          </>
        }
      />
      {notice ? <SuccessBanner className="mb-4">{notice}</SuccessBanner> : null}

      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-4" />
          <ErrorState
            message="Could not load the projects."
            onRetry={() => void q.refetch()}
          />
        </>
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            description={
              can.create
                ? "Create the first project to start tracking issues and milestones."
                : "No project has been shared with you yet."
            }
          >
            {can.create ? (
              <Button onClick={() => navigate("/projects/new")}>New project</Button>
            ) : null}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-left text-[13px]" data-portfolio>
            <thead>
              <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Progress</th>
                <th className="px-3 py-3 font-medium">Issues</th>
                <th className="px-3 py-3 font-medium">Next milestone</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((p) => (
                <ProjectRow key={p.id} p={p} />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Count({
  name,
  label,
  value,
  hot,
}: {
  name: string;
  label: string;
  value: number;
  hot?: boolean;
}) {
  return (
    <span
      data-count={name}
      className={
        hot && value > 0
          ? "whitespace-nowrap font-semibold text-danger-ink"
          : "whitespace-nowrap text-content-secondary"
      }
    >
      <span className="font-mono">{value}</span> {label}
    </span>
  );
}

function ProjectRow({ p }: { p: ProjectSummary }) {
  const m = p.nextMilestone;
  return (
    <tr
      data-project={p.key}
      className="border-b border-line align-top last:border-0 hover:bg-rowhover"
    >
      <td className="px-4 py-3">
        <Link
          to={projectPath(p.key)}
          className="font-semibold text-navy underline-offset-2 hover:underline"
        >
          {p.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11.5px] text-content-secondary">
          <span className="font-mono">{p.key}</span>
          {p.client ? <span data-client>Client: {p.client.businessName}</span> : null}
          {p.archived ? <Chip variant="neutral">Archived</Chip> : null}
        </div>
      </td>
      <td className="px-3 py-3">
        <ProjectStatusChip status={p.status} />
      </td>
      <td className="min-w-[150px] px-3 py-3">
        <ProgressBar
          done={p.progress.done}
          total={p.progress.total}
          percent={p.progress.percent}
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px]">
          <Count name="todo" label="to do" value={p.counts.todo} />
          <Count name="inProgress" label="in progress" value={p.counts.inProgress} />
          <Count name="done" label="done" value={p.counts.done} />
          <Count name="overdue" label="overdue" value={p.counts.overdue} hot />
          <Count name="openBugs" label="open bugs" value={p.counts.openBugs} hot />
        </div>
      </td>
      <td className="min-w-[170px] px-3 py-3">
        {m ? (
          <div data-next-milestone>
            <div className="font-medium text-content">{m.name}</div>
            <div className="text-[11.5px] text-content-secondary">
              {m.dueDate ? `Due ${dayText(m.dueDate)}` : "No due date"}
            </div>
            <ProgressBar
              className="mt-1"
              done={m.progress.done}
              total={m.progress.total}
              percent={m.progress.percent}
            />
          </div>
        ) : (
          <span className="text-content-secondary">None</span>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[12px] text-content-secondary">
        {p.lastActivityAt ? momentText(p.lastActivityAt) : "None yet"}
      </td>
    </tr>
  );
}

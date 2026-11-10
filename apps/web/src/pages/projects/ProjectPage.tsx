// ProjectPage - one project (PB1): its header and tabs (Overview, Issues, Milestones, Activity),
// and, at an issue's own address, the issue as a page. The tabs share one load of the project's
// overview and of the lists the forms need (issue types, statuses, labels, people).

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Button, Chip, ErrorState, PageHeader, Skeleton, cn } from "../../components/ui";
import {
  ErrorBanner,
  ProjectStatusChip,
  SuccessBanner,
} from "../../components/projects/parts";
import { SecurityChip } from "../../components/projects/SecurityChip";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import {
  errorLines,
  fetchMilestones,
  fetchProject,
  fetchProjectsMeta,
  projectPath,
} from "../../lib/projects";
import { ProjectsSearchBox } from "../../components/projects/ProjectsNav";
import { ActivityTab } from "./ActivityTab";
import { BoardTab } from "./BoardTab";
import { IssueDetails } from "./IssueDetails";
import { IssuesTab } from "./IssuesTab";
import { MilestonesTab } from "./MilestonesTab";
import { OverviewTab } from "./OverviewTab";
import { SecurityTab } from "./SecurityTab";
import { SessionsTab } from "./SessionsTab";
import { ImportChecklistDialog } from "./ImportChecklistDialog";

export type ProjectTab =
  "overview" | "issues" | "issue" | "board" | "milestones" | "sessions" | "security" | "activity";

export default function ProjectPage({ tab }: { tab: ProjectTab }) {
  const { key = "", issueKey = "" } = useParams<{ key: string; issueKey: string }>();
  const can = useProjectsCan();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [importing, setImporting] = useState(false);

  const overview = useQuery({
    queryKey: ["projects", "overview", key],
    queryFn: () => fetchProject(key),
    enabled: can.read,
  });
  const meta = useQuery({
    queryKey: ["projects", "meta"],
    queryFn: fetchProjectsMeta,
    enabled: can.read,
  });
  const milestones = useQuery({
    queryKey: ["projects", "milestones", key],
    queryFn: () => fetchMilestones(key),
    enabled: can.read && tab === "issue",
  });
  if (!can.read) return <Navigate to="/" replace />;

  if (overview.isPending || meta.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (overview.isError || meta.isError) {
    return (
      <>
        <ErrorBanner lines={errorLines(overview.error ?? meta.error)} className="mb-4" />
        <ErrorState
          message="Could not load this project."
          onRetry={() => {
            void overview.refetch();
            void meta.refetch();
          }}
        />
      </>
    );
  }
  const ov = overview.data;
  const p = ov.project;
  const tabs: { id: ProjectTab; label: string; to: string; end?: boolean }[] = [
    { id: "overview", label: "Overview", to: projectPath(key), end: true },
    { id: "issues", label: "Issues", to: projectPath(key, "issues") },
    { id: "board", label: "Board", to: projectPath(key, "board") },
    { id: "milestones", label: "Milestones", to: projectPath(key, "milestones") },
    { id: "sessions", label: "Sessions", to: projectPath(key, "sessions") },
    { id: "security", label: "Security", to: projectPath(key, "security") },
    { id: "activity", label: "Activity", to: projectPath(key, "activity") },
  ];

  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <Link to="/projects/all" className="hover:underline">
              Projects
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono">{p.key}</span>
          </span>
        }
        title={p.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ProjectStatusChip status={ov.status.value} />
            {ov.security.state !== "clear" ? <SecurityChip badge={ov.security} /> : null}
            {p.archived ? <Chip variant="neutral">Archived</Chip> : null}
            {p.client ? <span data-client>Client: {p.client.businessName}</span> : null}
          </span>
        }
        actions={
          <>
            <ProjectsSearchBox />
            {can.create ? (
              <Button variant="outline" onClick={() => setImporting(true)}>
                Import checklist
              </Button>
            ) : null}
            {can.update ? (
              <Button
                variant="outline"
                onClick={() => navigate(projectPath(key, "edit"))}
              >
                Edit project
              </Button>
            ) : null}
          </>
        }
      />
      {notice ? <SuccessBanner className="mb-4">{notice}</SuccessBanner> : null}
      {importing ? (
        <ImportChecklistDialog projectKey={key} onClose={() => setImporting(false)} />
      ) : null}

      <nav className="mb-5 flex gap-1 border-b border-line" aria-label="Project">
        {tabs.map((t) => (
          <NavLink
            key={t.id}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "-mb-px border-b-2 px-3.5 py-2 text-[13.5px] font-medium transition-colors",
                isActive || (t.id === "issues" && tab === "issue")
                  ? "border-gold text-navy"
                  : "border-transparent text-content-secondary hover:text-navy",
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {tab === "overview" ? <OverviewTab ov={ov} can={can} /> : null}
      {tab === "issues" ? (
        <IssuesTab projectKey={key} can={can} meta={meta.data} />
      ) : null}
      {tab === "board" ? <BoardTab projectKey={key} can={can} meta={meta.data} /> : null}
      {tab === "milestones" ? (
        <MilestonesTab projectKey={key} canWrite={can.update} />
      ) : null}
      {tab === "sessions" ? <SessionsTab projectKey={key} /> : null}
      {tab === "security" ? <SecurityTab projectKey={key} can={can} /> : null}
      {tab === "activity" ? <ActivityTab projectKey={key} /> : null}
      {tab === "issue" ? (
        <div className="max-w-4xl">
          <p className="mb-3 text-[12.5px]">
            <Link
              to={projectPath(key, "issues")}
              className="text-blue underline-offset-2 hover:underline"
            >
              Back to the issues
            </Link>
          </p>
          <IssueDetails
            key={issueKey}
            projectKey={key}
            issueKey={issueKey}
            meta={meta.data}
            milestones={milestones.data ?? []}
            canWrite={can.update}
            mode="page"
            onDeleted={(k) =>
              navigate(projectPath(key, "issues"), { state: { notice: `Deleted ${k}.` } })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

// SearchPage - the results of the Projects search (PB2): issues and projects, up to 20 of each, as
// the API finds them. When the API answers `jump` (the text was exactly an issue key), this page
// passes on to that issue at once, replacing itself so Back does not return here.

import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Card, Chip, EmptyState, PageHeader, Skeleton } from "../../components/ui";
import { ErrorBanner } from "../../components/projects/parts";
import { IssueRows } from "../../components/projects/IssueRows";
import { ProjectsNav } from "../../components/projects/ProjectsNav";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import { errorLines, issuePath, projectPath, searchProjects } from "../../lib/projects";

export default function SearchPage() {
  const can = useProjectsCan();
  const [sp] = useSearchParams();
  const q = (sp.get("q") ?? "").trim();
  const result = useQuery({
    queryKey: ["projects", "search", q],
    queryFn: () => searchProjects(q),
    enabled: can.read,
    retry: false,
  });
  if (!can.read) return <Navigate to="/" replace />;
  if (result.data?.jump) {
    return (
      <Navigate
        to={issuePath(result.data.jump.projectKey, result.data.jump.issueKey)}
        replace
      />
    );
  }
  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow="Project management"
        title="Search"
        description={q ? `Results for “${q}”` : "Search issues and projects."}
      />
      <ProjectsNav query={q} />
      {result.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : result.isError ? (
        <ErrorBanner lines={errorLines(result.error)} />
      ) : result.data.issues.length === 0 && result.data.projects.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing matches"
            description={`No issue or project matches “${q}”.`}
          />
        </Card>
      ) : (
        <div className="space-y-7">
          <section data-section="issues">
            <h2 className="mb-2 flex items-baseline gap-2 font-serif text-[18px] font-medium text-navy">
              Issues
              <span className="font-mono text-[12px] text-content-secondary">
                {result.data.issues.length}
              </span>
            </h2>
            <Card>
              {result.data.issues.length === 0 ? (
                <EmptyState title="No issue matches" />
              ) : (
                <IssueRows items={result.data.issues} showAssignee />
              )}
            </Card>
          </section>
          <section data-section="projects">
            <h2 className="mb-2 flex items-baseline gap-2 font-serif text-[18px] font-medium text-navy">
              Projects
              <span className="font-mono text-[12px] text-content-secondary">
                {result.data.projects.length}
              </span>
            </h2>
            <Card>
              {result.data.projects.length === 0 ? (
                <EmptyState title="No project matches" />
              ) : (
                <ul className="divide-y divide-line">
                  {result.data.projects.map((p) => (
                    <li
                      key={p.id}
                      data-project={p.key}
                      className="flex flex-wrap items-center gap-x-3 px-5 py-3 text-[13px]"
                    >
                      <Link
                        to={projectPath(p.key)}
                        className="font-mono text-[12px] font-semibold text-blue underline-offset-2 hover:underline"
                      >
                        {p.key}
                      </Link>
                      <span className="flex-1 text-content">{p.name}</span>
                      {p.client ? (
                        <span className="text-[12px] text-content-secondary">
                          {p.client.businessName}
                        </span>
                      ) : null}
                      {p.archived ? <Chip variant="neutral">Archived</Chip> : null}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}
    </div>
  );
}

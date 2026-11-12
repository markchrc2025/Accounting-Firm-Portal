// OverviewTab - one project at a glance (PB1): its current status with "Post status update" and
// the history, the open milestones with progress, the issues in progress, counts by status and
// by type, recent activity, and the project's details. Every number is the API's.

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, Card, CardContent, CardHeader, CardTitle } from "../../components/ui";
import {
  ColourChip,
  ErrorBanner,
  Field,
  Markdown,
  ProgressBar,
  ProjectStatusChip,
  SuccessBanner,
} from "../../components/projects/parts";
import { SecurityChip } from "../../components/projects/SecurityChip";
import {
  CategoryChip,
  ClientName,
  FeeText,
  RecurringBadge,
} from "../../components/projects/FirmDetails";
import { LinkToClient } from "../../components/projects/LinkToClient";
import { RecentSessionsCard } from "./SessionsTab";
import { RepoKitPanel } from "./RepoKitPanel";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import {
  actorName,
  dayText,
  errorLines,
  issuePath,
  momentText,
  postStatusUpdate,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  projectPath,
  type ProjectOverview,
  type ProjectStatus,
  type ProjectsCan,
} from "../../lib/projects";
import { ActivityEntries } from "./ActivityTab";

export function OverviewTab({ ov, can }: { ov: ProjectOverview; can: ProjectsCan }) {
  const key = ov.project.key;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <StatusCard ov={ov} canWrite={can.update} />
        <Card>
          <CardHeader>
            <CardTitle>Open milestones</CardTitle>
            <Link
              to={projectPath(key, "milestones")}
              className="text-[12.5px] text-blue underline-offset-2 hover:underline"
            >
              All milestones
            </Link>
          </CardHeader>
          <CardContent>
            {ov.openMilestones.length === 0 ? (
              <p className="text-[13px] text-content-secondary">No open milestones.</p>
            ) : (
              <ul className="space-y-3" data-open-milestones>
                {ov.openMilestones.map((m) => (
                  <li key={m.id} data-milestone={m.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-navy">{m.name}</span>
                      <span className="text-[12px] text-content-secondary">
                        {m.dueDate ? `Due ${dayText(m.dueDate)}` : "No due date"}
                      </span>
                    </div>
                    <ProgressBar
                      done={m.progress.done}
                      total={m.progress.total}
                      percent={m.progress.percent}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>In progress</CardTitle>
          </CardHeader>
          <CardContent>
            {ov.inProgress.length === 0 ? (
              <p className="text-[13px] text-content-secondary">
                Nothing is in progress.
              </p>
            ) : (
              <ul className="divide-y divide-line" data-in-progress>
                {ov.inProgress.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <Link
                      to={issuePath(key, i.key)}
                      className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
                    >
                      {i.key}
                    </Link>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <ColourChip name={i.status.name} colour={i.status.colour} />
                    <span className="w-28 truncate text-right text-[12px] text-content-secondary">
                      {i.assignee?.fullName ?? "Unassigned"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <Link
              to={projectPath(key, "activity")}
              className="text-[12.5px] text-blue underline-offset-2 hover:underline"
            >
              All activity
            </Link>
          </CardHeader>
          <CardContent>
            {ov.recentActivity.length === 0 ? (
              <p className="text-[13px] text-content-secondary">No activity yet.</p>
            ) : (
              <ActivityEntries items={ov.recentActivity} projectKey={key} />
            )}
          </CardContent>
        </Card>
        <Card data-overview-security>
          <CardHeader>
            <CardTitle>Security</CardTitle>
            <Link
              to={projectPath(key, "security")}
              className="text-[12.5px] text-blue underline-offset-2 hover:underline"
            >
              Security details
            </Link>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-[13px]">
            <SecurityChip badge={ov.security} />
            <span className="text-content-secondary">
              {ov.security.state === "clear"
                ? "No open security issues."
                : `${ov.security.open} open security ${ov.security.open === 1 ? "issue" : "issues"}.`}
            </span>
          </CardContent>
        </Card>
        <RecentSessionsCard projectKey={key} sessions={ov.recentSessions} />
        <RepoKitPanel projectKey={key} />
      </div>

      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressBar
              done={ov.progress.done}
              total={ov.progress.total}
              percent={ov.progress.percent}
            />
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]"
              data-overview-counts
            >
              <span data-count="todo">
                <span className="font-mono">{ov.counts.todo}</span> to do
              </span>
              <span data-count="inProgress">
                <span className="font-mono">{ov.counts.inProgress}</span> in progress
              </span>
              <span data-count="done">
                <span className="font-mono">{ov.counts.done}</span> done
              </span>
              <span
                data-count="overdue"
                className={ov.counts.overdue > 0 ? "font-semibold text-danger-ink" : ""}
              >
                <span className="font-mono">{ov.counts.overdue}</span> overdue
              </span>
              <span
                data-count="openBugs"
                className={ov.counts.openBugs > 0 ? "font-semibold text-danger-ink" : ""}
              >
                <span className="font-mono">{ov.counts.openBugs}</span> open bugs
              </span>
            </div>
            <div>
              <div className="eyebrow mb-1.5">By status</div>
              <ul className="space-y-1" data-by-status>
                {ov.countsByStatus.map((c) => (
                  <li
                    key={c.status.id}
                    className="flex items-center justify-between text-[12.5px]"
                  >
                    <ColourChip name={c.status.name} colour={c.status.colour} />
                    <span className="font-mono">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="eyebrow mb-1.5">By type</div>
              <ul className="space-y-1" data-by-type>
                {ov.countsByType.map((c) => (
                  <li
                    key={c.type.id}
                    className="flex items-center justify-between text-[12.5px]"
                  >
                    <ColourChip name={c.type.name} colour={c.type.colour} />
                    <span className="font-mono">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
        <DetailsCard ov={ov} canLink={can.update} />
      </div>
    </div>
  );
}

function StatusCard({ ov, canWrite }: { ov: ProjectOverview; canWrite: boolean }) {
  const key = ov.project.key;
  const invalidate = useInvalidateProject(key);
  const [status, setStatus] = useState<ProjectStatus>(ov.status.value);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const post = useMutation({
    mutationFn: () => postStatusUpdate(key, { status, note }),
    onSuccess: () => {
      setNote("");
      setErrors([]);
      setDone(true);
      invalidate();
    },
    onError: (e) => {
      setDone(false);
      setErrors(errorLines(e, "Could not post the status update."));
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setDone(false);
    post.mutate();
  }
  return (
    <Card data-status-card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
        <ProjectStatusChip status={ov.status.value} />
      </CardHeader>
      <CardContent className="space-y-4">
        {ov.status.note ? (
          <p className="text-[13.5px] text-content">{ov.status.note}</p>
        ) : null}
        {ov.status.updatedAt ? (
          <p className="text-[12px] text-content-secondary">
            Updated {momentText(ov.status.updatedAt)}
          </p>
        ) : (
          <p className="text-[12px] text-content-secondary">
            No status update has been posted yet.
          </p>
        )}
        {canWrite ? (
          <form onSubmit={submit} className="space-y-3 border-t border-line pt-4">
            <div className="eyebrow">Post status update</div>
            {done ? <SuccessBanner>Status update posted.</SuccessBanner> : null}
            <ErrorBanner lines={errors} />
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <Field label="Status">
                <select
                  className="input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {PROJECT_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note">
                <textarea
                  className="input min-h-[70px]"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </Field>
            </div>
            <Button type="submit" size="sm" disabled={post.isPending}>
              {post.isPending ? "Posting…" : "Post status update"}
            </Button>
          </form>
        ) : null}
        <div className="border-t border-line pt-4">
          <div className="eyebrow mb-2">Status history</div>
          {ov.statusUpdates.length === 0 ? (
            <p className="text-[13px] text-content-secondary">No updates yet.</p>
          ) : (
            <ul className="space-y-3" data-status-history>
              {ov.statusUpdates.map((u) => (
                <li key={u.id} data-status-update={u.id} className="text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <ProjectStatusChip status={u.status} />
                    <span className="text-[12px] text-content-secondary">
                      {actorName(u)} on {momentText(u.createdAt)}
                    </span>
                  </div>
                  {u.note ? <p className="mt-1 text-content">{u.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DetailsCard({ ov, canLink }: { ov: ProjectOverview; canLink: boolean }) {
  const p = ov.project;
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[130px_1fr] gap-2 text-[13px]">
      <dt className="text-content-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-content">{value}</dd>
    </div>
  );
  return (
    <Card data-project-details>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {p.description.trim() ? (
          <Markdown text={p.description} />
        ) : (
          <p className="text-[13px] text-content-secondary">No description.</p>
        )}
        <dl className="space-y-2 border-t border-line pt-3">
          {row("Key", <span className="font-mono">{p.key}</span>)}
          {row(
            "Client",
            p.client || p.clientName ? (
              <>
                <span data-client>
                  <ClientName p={p} />
                </span>
                {!p.client && p.clientName && canLink ? (
                  <LinkToClient projectKey={p.key} />
                ) : null}
              </>
            ) : (
              "No client"
            ),
          )}
          {row(
            "Professional fee",
            p.professionalFee != null ? <FeeText p={p} /> : "Not set",
          )}
          {row("Category", p.category ? <CategoryChip p={p} /> : "None")}
          {row(
            "Recurring",
            p.isRecurring ? (
              <span data-recurring-details className="flex flex-wrap items-center gap-2">
                <RecurringBadge p={p} />
                <span className="text-[12px] text-content-secondary">
                  From {dayText(p.recurrenceStart)}
                  {p.recurrenceEnd ? ` to ${dayText(p.recurrenceEnd)}` : ", no end date"}
                </span>
              </span>
            ) : (
              "No"
            ),
          )}
          {row(
            "Parent project",
            p.parent ? (
              <Link
                to={projectPath(p.parent.key)}
                className="text-blue underline-offset-2 hover:underline"
              >
                {p.parent.key} {p.parent.name}
              </Link>
            ) : (
              "None"
            ),
          )}
          {row("Created", momentText(p.createdAt))}
          {row(
            "Last activity",
            ov.lastActivityAt ? momentText(ov.lastActivityAt) : "None yet",
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

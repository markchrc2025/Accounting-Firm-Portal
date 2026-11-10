// IssuesTab - a project's issues (PB1): the six built-in views as chips, every filter and sort
// kept in the address (so a view can be shared and survives a reload), a quick add at the top,
// the status of an issue editable in its row, overdue issues marked, the full create form, and
// the issue's details beside the list when a row is selected.

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, Skeleton, cn } from "../../components/ui";
import {
  ColourChip,
  ErrorBanner,
  PriorityChip,
  SuccessBanner,
} from "../../components/projects/parts";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import {
  dayText,
  DEFAULT_FILTERS,
  errorLines,
  fetchIssues,
  fetchMilestones,
  filtersToQuery,
  filtersToSearch,
  hasNarrowing,
  ISSUE_SORT_LABEL,
  ISSUE_SORTS,
  ISSUE_VIEW_LABEL,
  ISSUE_VIEWS,
  issuePath,
  parseFilters,
  PRIORITIES,
  PRIORITY_LABEL,
  quickAddIssue,
  updateIssue,
  withView,
  type IssueFilters,
  type IssueItem,
  type IssueState,
  type ProjectsCan,
  type ProjectsMeta,
} from "../../lib/projects";
import { IssueCreateDialog } from "./IssueCreateDialog";
import { IssueDetails } from "./IssueDetails";

/** What the "open, closed or all" box shows: the choice made, or what the view itself implies. */
const effectiveState = (f: IssueFilters): Exclude<IssueState, ""> =>
  f.state || (f.view === "closed" ? "closed" : f.view === "all" ? "all" : "open");

export function IssuesTab({
  projectKey,
  can,
  meta,
}: {
  projectKey: string;
  can: ProjectsCan;
  meta: ProjectsMeta;
}) {
  const [sp, setSp] = useSearchParams();
  const filters = useMemo(() => parseFilters(sp), [sp]);
  const selected = sp.get("issue");
  const invalidate = useInvalidateProject(projectKey);

  const milestones = useQuery({
    queryKey: ["projects", "milestones", projectKey],
    queryFn: () => fetchMilestones(projectKey),
  });
  const apiQuery = filtersToQuery(filters);
  const list = useQuery({
    queryKey: ["projects", "issues", projectKey, apiQuery],
    queryFn: () => fetchIssues(projectKey, apiQuery),
  });

  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const setFilters = (next: IssueFilters) =>
    setSp(filtersToSearch(next, sp), { replace: true });
  const select = (key: string | null) => {
    const next = new URLSearchParams(sp);
    if (key) next.set("issue", key);
    else next.delete("issue");
    setSp(next, { replace: true });
  };

  // The search box types freely and asks after a short pause (or at once on Enter).
  const [text, setText] = useState(filters.q);
  useEffect(() => setText(filters.q), [filters.q]);
  useEffect(() => {
    if (text === filters.q) return;
    const t = setTimeout(() => setFilters({ ...filters, q: text }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const setStatus = useMutation({
    mutationFn: (v: { issueKey: string; statusId: string }) =>
      updateIssue(projectKey, v.issueKey, { statusId: v.statusId }),
    onSuccess: () => {
      setErrors([]);
      invalidate();
    },
    onError: (e) => setErrors(errorLines(e, "Could not change the status.")),
  });

  const ms = milestones.data ?? [];
  return (
    <div>
      {notice ? <SuccessBanner className="mb-3">{notice}</SuccessBanner> : null}
      <ErrorBanner lines={errors} className="mb-3" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Views">
          {ISSUE_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              data-view={v}
              aria-pressed={filters.view === v}
              onClick={() => setFilters(withView(filters, v))}
              className={cn(
                "rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors",
                filters.view === v
                  ? "border-navy bg-navy text-white"
                  : "border-line-input bg-card text-content-secondary hover:border-navy",
              )}
            >
              {ISSUE_VIEW_LABEL[v]}
            </button>
          ))}
        </div>
        {can.create ? <Button onClick={() => setCreating(true)}>New issue</Button> : null}
      </div>

      {can.create ? (
        <QuickAdd
          projectKey={projectKey}
          onAdded={(key) => {
            invalidate();
            setNotice(`Added ${key}.`);
          }}
        />
      ) : null}

      <Filters
        filters={filters}
        text={text}
        onText={setText}
        onSubmitText={() => setFilters({ ...filters, q: text })}
        onChange={setFilters}
        meta={meta}
        milestones={ms}
      />

      <div
        className={cn(
          "grid gap-5",
          selected ? "lg:grid-cols-[minmax(0,1fr)_minmax(380px,46%)]" : "",
        )}
      >
        <div className="min-w-0">
          {list.isPending ? (
            <div className="space-y-3">
              <Skeleton />
              <Skeleton className="w-2/3" />
            </div>
          ) : list.isError ? (
            <>
              <ErrorBanner lines={errorLines(list.error)} className="mb-3" />
              <ErrorState
                message="Could not load the issues."
                onRetry={() => void list.refetch()}
              />
            </>
          ) : list.data.items.length === 0 ? (
            <Card>
              <EmptyState
                title="No issues here"
                description={
                  hasNarrowing(filters) || filters.view !== "open"
                    ? "No issue matches this view and these filters."
                    : "Add the first issue with the box above."
                }
              />
            </Card>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-left text-[13px]" data-issue-list>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
                    <th className="px-4 py-2.5 font-medium">Issue</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Priority</th>
                    <th className="px-3 py-2.5 font-medium">Assignee</th>
                    <th className="px-3 py-2.5 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((i) => (
                    <IssueRow
                      key={i.id}
                      issue={i}
                      meta={meta}
                      selected={selected === i.key}
                      canWrite={can.update}
                      onSelect={() => select(i.key)}
                      onStatus={(statusId) =>
                        setStatus.mutate({ issueKey: i.key, statusId })
                      }
                    />
                  ))}
                </tbody>
              </table>
              <div className="border-t border-line px-4 py-2 text-[11.5px] text-content-secondary">
                {list.data.total} issue{list.data.total === 1 ? "" : "s"}
                {list.data.total > list.data.items.length
                  ? `, showing ${list.data.items.length}`
                  : ""}
              </div>
            </Card>
          )}
        </div>
        {selected ? (
          <div className="min-w-0">
            <IssueDetails
              key={selected}
              projectKey={projectKey}
              issueKey={selected}
              meta={meta}
              milestones={ms}
              canWrite={can.update}
              mode="split"
              onClose={() => select(null)}
              onDeleted={(k) => {
                select(null);
                setNotice(`Deleted ${k}.`);
              }}
            />
          </div>
        ) : null}
      </div>

      {creating ? (
        <IssueCreateDialog
          projectKey={projectKey}
          meta={meta}
          milestones={ms}
          onClose={() => setCreating(false)}
          onCreated={(issue) => {
            setCreating(false);
            setNotice(`Created ${issue.key}.`);
            select(issue.key);
          }}
        />
      ) : null}
    </div>
  );
}

function QuickAdd({
  projectKey,
  onAdded,
}: {
  projectKey: string;
  onAdded: (key: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: () => quickAddIssue(projectKey, title),
    onSuccess: (i) => {
      setTitle("");
      setErrors([]);
      onAdded(i.key);
    },
    onError: (e) => setErrors(errorLines(e, "Could not add the issue.")),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    add.mutate();
  }
  return (
    <form onSubmit={submit} className="mb-4" data-quick-add>
      <div className="flex gap-2">
        <input
          className="input"
          aria-label="Quick add an issue"
          placeholder="Add an issue by its title and press Enter"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add issue"}
        </Button>
      </div>
      <ErrorBanner lines={errors} className="mt-2" />
    </form>
  );
}

function Filters({
  filters,
  text,
  onText,
  onSubmitText,
  onChange,
  meta,
  milestones,
}: {
  filters: IssueFilters;
  text: string;
  onText: (v: string) => void;
  onSubmitText: () => void;
  onChange: (f: IssueFilters) => void;
  meta: ProjectsMeta;
  milestones: { id: string; name: string }[];
}) {
  const set = <K extends keyof IssueFilters>(k: K, v: IssueFilters[K]) =>
    onChange({ ...filters, [k]: v });
  return (
    <form
      className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
      aria-label="Filters"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmitText();
      }}
    >
      <input
        className="input"
        aria-label="Search"
        placeholder="Search title, key or description"
        value={text}
        onChange={(e) => onText(e.target.value)}
      />
      <select
        className="input"
        aria-label="Open, closed or all"
        value={effectiveState(filters)}
        onChange={(e) => set("state", e.target.value as IssueState)}
      >
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="all">Open and closed</option>
      </select>
      <select
        className="input"
        aria-label="Status"
        value={filters.statusId}
        onChange={(e) => set("statusId", e.target.value)}
      >
        <option value="">Any status</option>
        {meta.issueStatuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Type"
        value={filters.typeId}
        onChange={(e) => set("typeId", e.target.value)}
      >
        <option value="">Any type</option>
        {meta.issueTypes.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Assignee"
        value={filters.assigneeId}
        onChange={(e) => set("assigneeId", e.target.value)}
      >
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        {meta.users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Milestone"
        value={filters.milestoneId}
        onChange={(e) => set("milestoneId", e.target.value)}
      >
        <option value="">Any milestone</option>
        <option value="none">No milestone</option>
        {milestones.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Label"
        value={filters.labelId}
        onChange={(e) => set("labelId", e.target.value)}
      >
        <option value="">Any label</option>
        {meta.labels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Priority"
        value={filters.priority}
        onChange={(e) => set("priority", e.target.value as IssueFilters["priority"])}
      >
        <option value="">Any priority</option>
        {PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
      <select
        className="input"
        aria-label="Sort by"
        value={filters.sort}
        onChange={(e) => set("sort", e.target.value as IssueFilters["sort"])}
      >
        {ISSUE_SORTS.map((s) => (
          <option key={s} value={s}>
            {ISSUE_SORT_LABEL[s]}
          </option>
        ))}
      </select>
      {hasNarrowing(filters) || filters.sort !== DEFAULT_FILTERS.sort ? (
        <Button
          variant="ghost"
          onClick={() => onChange({ ...DEFAULT_FILTERS, view: filters.view })}
          data-clear-filters
        >
          Clear filters
        </Button>
      ) : null}
    </form>
  );
}

function IssueRow({
  issue: i,
  meta,
  selected,
  canWrite,
  onSelect,
  onStatus,
}: {
  issue: IssueItem;
  meta: ProjectsMeta;
  selected: boolean;
  canWrite: boolean;
  onSelect: () => void;
  onStatus: (statusId: string) => void;
}) {
  return (
    <tr
      data-issue={i.key}
      data-overdue={i.overdue ? "true" : undefined}
      aria-selected={selected}
      className={cn(
        "border-b border-line align-top last:border-0 hover:bg-rowhover",
        selected && "bg-warn-bg-2/50",
        i.overdue && "bg-danger-bg/40",
      )}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-start gap-2">
          <Link
            to={issuePath(i.project.key, i.key)}
            className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
            title="Open as a page"
          >
            {i.key}
          </Link>
          <button
            type="button"
            data-select-issue
            onClick={onSelect}
            className="min-w-0 text-left font-medium text-navy hover:underline"
          >
            {i.title}
          </button>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <ColourChip name={i.type.name} colour={i.type.colour} />
          {i.labels.map((l) => (
            <ColourChip key={l.id} name={l.name} colour={l.colour} />
          ))}
          {i.milestone ? (
            <span className="text-[11.5px] text-content-secondary">
              {i.milestone.name}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2.5">
        {canWrite ? (
          <select
            className="input !w-auto !py-1.5 text-[12.5px]"
            aria-label={`Status of ${i.key}`}
            value={i.status.id}
            onChange={(e) => onStatus(e.target.value)}
          >
            {meta.issueStatuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <ColourChip name={i.status.name} colour={i.status.colour} />
        )}
      </td>
      <td className="px-3 py-2.5">
        <PriorityChip priority={i.priority} />
      </td>
      <td className="px-3 py-2.5 text-[12.5px]">
        {i.assignee?.fullName ?? "Unassigned"}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px]">
        {i.dueDate ? (
          <span
            className={
              i.overdue ? "font-semibold text-danger-ink" : "text-content-secondary"
            }
          >
            {dayText(i.dueDate)}
            {i.overdue ? (
              <span
                data-overdue-chip
                className="ml-1.5 rounded-chip bg-danger-bg px-1.5 py-0.5 font-mono text-[9.5px] font-semibold"
              >
                Overdue
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-content-secondary">No date</span>
        )}
      </td>
    </tr>
  );
}

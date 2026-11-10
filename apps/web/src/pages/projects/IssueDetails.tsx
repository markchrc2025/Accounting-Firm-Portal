// IssueDetails - one issue, every field editable, beside the list (split view) and as a page of
// its own at the issue's key (PB1). A change is saved as it is made; the API's sentence shows if
// it refuses. Sub-issues, the parent, labels, a soft delete with a confirmation, and comments.

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button, Card, CardContent, ErrorState, Skeleton } from "../../components/ui";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ColourChip,
  ErrorBanner,
  Field,
  Markdown,
  PriorityChip,
} from "../../components/projects/parts";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import {
  addComment,
  deleteIssue,
  errorLines,
  fetchComments,
  fetchIssue,
  issuePath,
  momentText,
  PRIORITIES,
  PRIORITY_LABEL,
  updateIssue,
  type IssueDetail,
  type IssueInput,
  type Milestone,
  type Priority,
  type ProjectsMeta,
} from "../../lib/projects";

export function IssueDetails({
  projectKey,
  issueKey,
  meta,
  milestones,
  canWrite,
  mode,
  onClose,
  onDeleted,
}: {
  projectKey: string;
  issueKey: string;
  meta: ProjectsMeta;
  milestones: Milestone[];
  canWrite: boolean;
  mode: "split" | "page";
  onClose?: () => void;
  onDeleted: (key: string) => void;
}) {
  const invalidate = useInvalidateProject(projectKey);
  const issue = useQuery({
    queryKey: ["projects", "issue", projectKey, issueKey],
    queryFn: () => fetchIssue(projectKey, issueKey),
  });
  const comments = useQuery({
    queryKey: ["projects", "issue", projectKey, issueKey, "comments"],
    queryFn: () => fetchComments(projectKey, issueKey),
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);

  const patch = useMutation({
    mutationFn: (b: IssueInput) => updateIssue(projectKey, issueKey, b),
    onSuccess: () => {
      setErrors([]);
      invalidate();
    },
    onError: (e) => setErrors(errorLines(e, "Could not save the change.")),
  });
  const remove = useMutation({
    mutationFn: () => deleteIssue(projectKey, issueKey),
    onSuccess: () => {
      invalidate();
      onDeleted(issueKey);
    },
    onError: (e) => {
      setAsking(false);
      setErrors(errorLines(e, "Could not delete the issue."));
    },
  });

  if (issue.isPending) {
    return (
      <div className="space-y-3 p-2">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (issue.isError) {
    return (
      <>
        <ErrorBanner lines={errorLines(issue.error)} className="mb-3" />
        <ErrorState
          message="Could not load this issue."
          onRetry={() => void issue.refetch()}
        />
      </>
    );
  }
  const i = issue.data;
  const save = (b: IssueInput) => patch.mutate(b);

  return (
    <Card data-issue-details={i.key} className="min-w-0">
      <CardContent className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-content-secondary">
              <span className="font-mono font-semibold text-navy">{i.key}</span>
              <ColourChip name={i.type.name} colour={i.type.colour} />
              {i.overdue ? (
                <span
                  data-overdue
                  className="rounded-chip bg-danger-bg px-2 py-0.5 font-mono text-[10px] font-semibold text-danger-ink"
                >
                  Overdue
                </span>
              ) : null}
            </div>
            {i.parent ? (
              <p data-parent-link className="mt-1 text-[12px] text-content-secondary">
                Parent:{" "}
                <Link
                  to={issuePath(projectKey, i.parent.key)}
                  className="font-mono text-blue underline-offset-2 hover:underline"
                >
                  {i.parent.key}
                </Link>{" "}
                {i.parent.title}
              </p>
            ) : null}
          </div>
          <div className="flex flex-none items-center gap-2">
            {mode === "split" ? (
              <>
                <Link
                  to={issuePath(projectKey, i.key)}
                  data-open-full
                  className="text-[12.5px] text-blue underline-offset-2 hover:underline"
                >
                  Open as a page
                </Link>
                <Button variant="ghost" size="sm" onClick={onClose}>
                  Close
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <ErrorBanner lines={errors} />

        <TitleField issue={i} canWrite={canWrite} onSave={(title) => save({ title })} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <select
              className="input"
              disabled={!canWrite}
              value={i.status.id}
              onChange={(e) => save({ statusId: e.target.value })}
            >
              {meta.issueStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select
              className="input"
              disabled={!canWrite}
              value={i.type.id}
              onChange={(e) => save({ typeId: e.target.value })}
            >
              {meta.issueTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className="input"
              disabled={!canWrite}
              value={i.priority}
              onChange={(e) => save({ priority: e.target.value as Priority })}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assignee">
            <select
              className="input"
              disabled={!canWrite}
              value={i.assignee?.id ?? ""}
              onChange={(e) => save({ assigneeId: e.target.value || null })}
            >
              <option value="">Unassigned</option>
              {meta.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Milestone">
            <select
              className="input"
              disabled={!canWrite}
              value={i.milestone?.id ?? ""}
              onChange={(e) => save({ milestoneId: e.target.value || null })}
            >
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <ParentField
            issue={i}
            canWrite={canWrite}
            onSave={(parentKey) => save({ parentKey })}
          />
          <Field label="Start date">
            <input
              type="date"
              className="input"
              disabled={!canWrite}
              value={i.startDate ?? ""}
              onChange={(e) => save({ startDate: e.target.value || null })}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              className="input"
              disabled={!canWrite}
              value={i.dueDate ?? ""}
              onChange={(e) => save({ dueDate: e.target.value || null })}
            />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-[13px] font-semibold text-content">
            Labels
          </span>
          {meta.labels.length === 0 ? (
            <p className="text-[12.5px] text-content-secondary">
              No labels have been made yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3" data-labels>
              {meta.labels.map((l) => {
                const on = i.labels.some((x) => x.id === l.id);
                return (
                  <label key={l.id} className="flex items-center gap-1.5 text-[12.5px]">
                    <input
                      type="checkbox"
                      disabled={!canWrite}
                      checked={on}
                      onChange={() =>
                        save({
                          labelIds: on
                            ? i.labels.filter((x) => x.id !== l.id).map((x) => x.id)
                            : [...i.labels.map((x) => x.id), l.id],
                        })
                      }
                    />
                    <ColourChip name={l.name} colour={l.colour} />
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <DescriptionField
          issue={i}
          canWrite={canWrite}
          onSave={(description) => save({ description })}
        />

        {i.children.length > 0 ? (
          <div data-sub-issues>
            <span className="mb-1.5 block text-[13px] font-semibold text-content">
              Sub-issues
            </span>
            <ul className="divide-y divide-line rounded-input border border-line">
              {i.children.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                  <Link
                    to={issuePath(projectKey, c.key)}
                    className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
                  >
                    {c.key}
                  </Link>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <ColourChip name={c.status.name} colour={c.status.colour} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-content-secondary">
          {i.author ? <span>Created by {i.author.fullName}</span> : null}
          <span>Created {momentText(i.createdAt)}</span>
          <span>Updated {momentText(i.updatedAt)}</span>
          {i.closedAt ? <span>Closed {momentText(i.closedAt)}</span> : null}
          <PriorityChip priority={i.priority} />
        </div>

        <CommentsSection
          projectKey={projectKey}
          issueKey={issueKey}
          canWrite={canWrite}
          list={comments.data}
          loading={comments.isPending}
          error={comments.isError ? errorLines(comments.error) : []}
        />

        {canWrite ? (
          <div className="border-t border-line pt-4">
            <Button
              variant="outline"
              size="sm"
              data-delete-issue
              onClick={() => setAsking(true)}
            >
              Delete issue
            </Button>
          </div>
        ) : null}
      </CardContent>
      {asking ? (
        <ConfirmDialog
          question={`Delete ${i.key}?`}
          detail="The issue disappears from every list. Its number is never reused."
          confirmLabel="Delete issue"
          cancelLabel="Keep it"
          busy={remove.isPending}
          onConfirm={() => remove.mutate()}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </Card>
  );
}

function TitleField({
  issue,
  canWrite,
  onSave,
}: {
  issue: IssueDetail;
  canWrite: boolean;
  onSave: (title: string) => void;
}) {
  const [title, setTitle] = useState(issue.title);
  useEffect(() => setTitle(issue.title), [issue.title]);
  return (
    <Field label="Title">
      <input
        className="input text-[15px] font-semibold"
        disabled={!canWrite}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          if (title !== issue.title) onSave(title);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </Field>
  );
}

function ParentField({
  issue,
  canWrite,
  onSave,
}: {
  issue: IssueDetail;
  canWrite: boolean;
  onSave: (parentKey: string | null) => void;
}) {
  const [v, setV] = useState(issue.parentKey ?? "");
  useEffect(() => setV(issue.parentKey ?? ""), [issue.parentKey]);
  return (
    <Field
      label="Parent issue"
      hint="An issue key of this project, such as PAY-3. Empty means none."
    >
      <input
        className="input font-mono"
        disabled={!canWrite}
        value={v}
        onChange={(e) => setV(e.target.value.toUpperCase())}
        onBlur={() => {
          if (v !== (issue.parentKey ?? "")) onSave(v.trim() || null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
    </Field>
  );
}

function DescriptionField({
  issue,
  canWrite,
  onSave,
}: {
  issue: IssueDetail;
  canWrite: boolean;
  onSave: (description: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(issue.description);
  useEffect(() => setText(issue.description), [issue.description]);
  return (
    <div data-description>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-semibold text-content">Description</span>
        {canWrite && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Edit description
          </Button>
        ) : null}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            className="input min-h-[140px]"
            aria-label="Description"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="text-[11.5px] text-content-secondary">Markdown is supported.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => {
                onSave(text);
                setEditing(false);
              }}
            >
              Save description
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setText(issue.description);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : issue.description.trim() ? (
        <Markdown text={issue.description} />
      ) : (
        <p className="text-[12.5px] text-content-secondary">No description.</p>
      )}
    </div>
  );
}

function CommentsSection({
  projectKey,
  issueKey,
  canWrite,
  list,
  loading,
  error,
}: {
  projectKey: string;
  issueKey: string;
  canWrite: boolean;
  list: import("../../lib/projects").IssueComment[] | undefined;
  loading: boolean;
  error: string[];
}) {
  const invalidate = useInvalidateProject(projectKey);
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const add = useMutation({
    mutationFn: () => addComment(projectKey, issueKey, body),
    onSuccess: () => {
      setBody("");
      setErrors([]);
      invalidate();
    },
    onError: (e) => setErrors(errorLines(e, "Could not add the comment.")),
  });
  return (
    <div data-comments>
      <span className="mb-2 block text-[13px] font-semibold text-content">
        Comments{list ? ` (${list.length})` : ""}
      </span>
      <ErrorBanner lines={error} className="mb-2" />
      {loading ? (
        <Skeleton />
      ) : list && list.length > 0 ? (
        <ul className="space-y-3">
          {list.map((c) => (
            <li
              key={c.id}
              data-comment={c.id}
              className="rounded-input border border-line px-3.5 py-2.5"
            >
              <div className="mb-1 flex items-center justify-between text-[11.5px] text-content-secondary">
                <span className="font-semibold text-content">
                  {c.author?.fullName ?? "Someone"}
                </span>
                <span>{momentText(c.createdAt)}</span>
              </div>
              <Markdown text={c.body} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-content-secondary">No comments yet.</p>
      )}
      {canWrite ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors([]);
            add.mutate();
          }}
        >
          <ErrorBanner lines={errors} />
          <textarea
            className="input min-h-[80px]"
            aria-label="Add a comment"
            placeholder="Add a comment. Markdown is supported, and an issue key such as PAY-12 becomes a link."
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={add.isPending}>
            {add.isPending ? "Adding…" : "Add comment"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

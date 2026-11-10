// IssueCreateDialog - the full create form for an issue, every field, with "Create and add
// another" (PB1). The title is the only required box; the API fills the defaults for the rest and
// its sentences show as sent.

import { useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/ui";
import {
  ColourChip,
  ErrorBanner,
  Field,
  Modal,
  SuccessBanner,
} from "../../components/projects/parts";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import {
  createIssue,
  errorLines,
  PRIORITIES,
  PRIORITY_LABEL,
  type IssueDetail,
  type IssueInput,
  type Milestone,
  type Priority,
  type ProjectsMeta,
} from "../../lib/projects";

export function IssueCreateDialog({
  projectKey,
  meta,
  milestones,
  onClose,
  onCreated,
}: {
  projectKey: string;
  meta: ProjectsMeta;
  milestones: Milestone[];
  onClose: () => void;
  /** Called once the dialog is done with: after "Create", with the new issue. */
  onCreated: (issue: IssueDetail) => void;
}) {
  const invalidate = useInvalidateProject(projectKey);
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [typeId, setTypeId] = useState("");
  const [statusId, setStatusId] = useState("");
  const [priority, setPriority] = useState<"" | Priority>("");
  const [assigneeId, setAssigneeId] = useState("");
  const [milestoneId, setMilestoneId] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [made, setMade] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (_again: boolean) => {
      const body: IssueInput = { title };
      if (description) body.description = description;
      if (typeId) body.typeId = typeId;
      if (statusId) body.statusId = statusId;
      if (priority) body.priority = priority;
      if (assigneeId) body.assigneeId = assigneeId;
      if (milestoneId) body.milestoneId = milestoneId;
      if (parentKey.trim()) body.parentKey = parentKey.trim();
      if (startDate) body.startDate = startDate;
      if (dueDate) body.dueDate = dueDate;
      if (labelIds.length) body.labelIds = labelIds;
      return createIssue(projectKey, body);
    },
    onSuccess: (issue, again) => {
      invalidate();
      if (again) {
        // Ready for the next one: the title and description are new, the rest is kept.
        setTitle("");
        setDescription("");
        setErrors([]);
        setMade(issue.key);
        titleRef.current?.focus();
      } else {
        onCreated(issue);
      }
    },
    onError: (e) => {
      setMade(null);
      setErrors(errorLines(e, "Could not create the issue."));
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    create.mutate(false);
  }

  return (
    <Modal title="New issue" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        {made ? <SuccessBanner>Created {made}.</SuccessBanner> : null}
        <ErrorBanner lines={errors} />
        <Field label="Title">
          <input
            ref={titleRef}
            className="input"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field label="Description" hint="Markdown is supported.">
          <textarea
            className="input min-h-[100px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">
            <select
              className="input"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              <option value="">Default type</option>
              {meta.issueTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select
              className="input"
              value={statusId}
              onChange={(e) => setStatusId(e.target.value)}
            >
              <option value="">Default status</option>
              {meta.issueStatuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select
              className="input"
              value={priority}
              onChange={(e) => setPriority(e.target.value as "" | Priority)}
            >
              <option value="">Default priority</option>
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
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
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
              value={milestoneId}
              onChange={(e) => setMilestoneId(e.target.value)}
            >
              <option value="">No milestone</option>
              {milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Parent issue" hint="An issue key, such as PAY-3.">
            <input
              className="input font-mono"
              value={parentKey}
              onChange={(e) => setParentKey(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Start date">
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
        </div>
        {meta.labels.length > 0 ? (
          <div>
            <span className="mb-1.5 block text-[13px] font-semibold text-content">
              Labels
            </span>
            <div className="flex flex-wrap gap-3">
              {meta.labels.map((l) => (
                <label key={l.id} className="flex items-center gap-1.5 text-[12.5px]">
                  <input
                    type="checkbox"
                    checked={labelIds.includes(l.id)}
                    onChange={() =>
                      setLabelIds((cur) =>
                        cur.includes(l.id)
                          ? cur.filter((x) => x !== l.id)
                          : [...cur, l.id],
                      )
                    }
                  />
                  <ColourChip name={l.name} colour={l.colour} />
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            variant="outline"
            disabled={create.isPending}
            onClick={() => {
              setErrors([]);
              create.mutate(true);
            }}
          >
            Create and add another
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Creating…" : "Create issue"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

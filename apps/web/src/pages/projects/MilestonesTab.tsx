// MilestonesTab - a project's milestones with their state, dates and progress; create and edit
// (name, description, start date, due date, and the state Open, Locked or Closed) (PB1).

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
} from "../../components/ui";
import {
  ErrorBanner,
  Field,
  Modal,
  ProgressBar,
  SuccessBanner,
} from "../../components/projects/parts";
import { useInvalidateProject } from "../../components/projects/useInvalidate";
import { Roadmap } from "./Roadmap";
import {
  createMilestone,
  dayText,
  errorLines,
  fetchMilestones,
  MILESTONE_STATES,
  milestoneStateLabel,
  updateMilestone,
  type Milestone,
  type MilestoneState,
} from "../../lib/projects";

export function MilestonesTab({
  projectKey,
  canWrite,
}: {
  projectKey: string;
  canWrite: boolean;
}) {
  const q = useQuery({
    queryKey: ["projects", "milestones", projectKey],
    queryFn: () => fetchMilestones(projectKey),
  });
  const [editing, setEditing] = useState<Milestone | "new" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-[19px] font-medium text-navy">Milestones</h2>
        {canWrite ? (
          <Button onClick={() => setEditing("new")}>New milestone</Button>
        ) : null}
      </div>
      {notice ? <SuccessBanner className="mb-4">{notice}</SuccessBanner> : null}
      <Roadmap projectKey={projectKey} />
      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
          <ErrorState
            message="Could not load the milestones."
            onRetry={() => void q.refetch()}
          />
        </>
      ) : q.data.length === 0 ? (
        <Card>
          <EmptyState
            title="No milestones yet"
            description="A milestone groups issues that ship together."
          />
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {q.data.map((m) => (
              <li
                key={m.id}
                data-milestone={m.id}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4"
              >
                <div className="min-w-[200px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-navy">{m.name}</span>
                    <Chip
                      variant={
                        m.state === "OPEN"
                          ? "success"
                          : m.state === "LOCKED"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {milestoneStateLabel(m.state)}
                    </Chip>
                  </div>
                  <div className="mt-0.5 text-[12px] text-content-secondary">
                    {m.startDate ? `Starts ${dayText(m.startDate)}` : "No start date"}
                    {" · "}
                    {m.dueDate ? `Due ${dayText(m.dueDate)}` : "No due date"}
                    {m.overdueIssues > 0 ? ` · ${m.overdueIssues} overdue` : ""}
                  </div>
                  {m.description ? (
                    <p className="mt-1 text-[12.5px] text-content-secondary">
                      {m.description}
                    </p>
                  ) : null}
                </div>
                <div className="w-[220px]">
                  <ProgressBar
                    done={m.progress.done}
                    total={m.progress.total}
                    percent={m.progress.percent}
                  />
                </div>
                {canWrite ? (
                  <Button variant="outline" size="sm" onClick={() => setEditing(m)}>
                    Edit
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing ? (
        <MilestoneDialog
          projectKey={projectKey}
          milestone={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(m, created) => {
            setEditing(null);
            setNotice(created ? `Milestone ${m.name} created.` : "Milestone saved.");
          }}
        />
      ) : null}
    </div>
  );
}

function MilestoneDialog({
  projectKey,
  milestone,
  onClose,
  onSaved,
}: {
  projectKey: string;
  milestone: Milestone | null;
  onClose: () => void;
  onSaved: (m: Milestone, created: boolean) => void;
}) {
  const invalidate = useInvalidateProject(projectKey);
  const [name, setName] = useState(milestone?.name ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [startDate, setStartDate] = useState(milestone?.startDate ?? "");
  const [dueDate, setDueDate] = useState(milestone?.dueDate ?? "");
  const [state, setState] = useState<MilestoneState>(milestone?.state ?? "OPEN");
  const [errors, setErrors] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () =>
      milestone
        ? updateMilestone(projectKey, milestone.id, {
            name,
            description,
            startDate: startDate || null,
            dueDate: dueDate || null,
            state,
          })
        : createMilestone(projectKey, {
            name,
            description,
            startDate: startDate || null,
            dueDate: dueDate || null,
          }),
    onSuccess: (m) => {
      invalidate();
      onSaved(m, !milestone);
    },
    onError: (e) => setErrors(errorLines(e, "Could not save the milestone.")),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    save.mutate();
  }
  return (
    <Modal title={milestone ? "Edit milestone" : "New milestone"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner lines={errors} />
        <Field label="Name">
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Description">
          <textarea
            className="input min-h-[80px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
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
        {milestone ? (
          <Field label="State">
            <select
              className="input"
              value={state}
              onChange={(e) => setState(e.target.value as MilestoneState)}
            >
              {MILESTONE_STATES.map((s) => (
                <option key={s} value={s}>
                  {milestoneStateLabel(s)}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending
              ? "Saving…"
              : milestone
                ? "Save milestone"
                : "Create milestone"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

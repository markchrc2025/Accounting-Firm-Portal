// BirDeadlinesPage - the BIR deadlines of the firm's clients (PB7, Track A PA8 / D70). A month range
// (this month and next by default, in Manila), filters by form, client and status, and the due dates
// in order as the API gives them (a date on a weekend already moved to Monday). Under each date the
// forms and the period they cover; under each form the clients with their status and a link: open
// the return when there is one, otherwise create its draft (the existing create route). The API's
// notes and what client records lack are shown as sent.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  Button,
  Card,
  CardContent,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  type ChipVariant,
} from "../components/ui";
import { ErrorBanner } from "../components/projects/parts";
import { createBirForm } from "../lib/api";
import {
  CHIP_KINDS,
  CHIP_LABEL,
  CHIP_OF,
  fetchBirDeadlines,
  filterChoices,
  filterDeadlines,
  monthOf,
  nextMonth,
  type ChipKind,
  type DeadlineClientRow,
  type DeadlineFormEntry,
} from "../lib/birDeadlines";
import { dayHeading, errorLines, manilaToday } from "../lib/projects";

const CHIP_VARIANT: Record<ChipKind, ChipVariant> = {
  not_started: "neutral",
  draft: "info",
  filed: "success",
  filed_no_email: "warn",
  overdue: "danger",
};

export default function BirDeadlinesPage() {
  const { hasPermission } = useAuth();
  const canRead = hasPermission("BIRForms:Read");
  const canCreate = hasPermission("BIRForms:Create");
  const thisMonth = monthOf(manilaToday());
  const [from, setFrom] = useState(thisMonth);
  const [to, setTo] = useState(nextMonth(thisMonth));
  const [form, setForm] = useState("");
  const [clientId, setClientId] = useState("");
  const [chip, setChip] = useState<ChipKind | "">("");
  const [errors, setErrors] = useState<string[]>([]);

  const q = useQuery({
    queryKey: ["bir-deadlines", from, to],
    queryFn: () => fetchBirDeadlines(from, to),
    enabled: canRead && !!from && !!to,
    retry: false,
  });
  const choices = useMemo(() => filterChoices(q.data?.deadlines ?? []), [q.data]);
  const days = useMemo(
    () => filterDeadlines(q.data?.deadlines ?? [], { form, clientId, chip }),
    [q.data, form, clientId, chip],
  );

  if (!canRead) return <Navigate to="/" replace />;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow="BIR"
        title="BIR Deadlines"
        description="The returns each client must file, by due date."
      />
      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-end gap-4 text-[13px]">
          <label className="block">
            <span className="mb-1.5 block font-semibold text-content">From</span>
            <input
              type="month"
              className="input font-mono"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-semibold text-content">To</span>
            <input
              type="month"
              className="input font-mono"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block font-semibold text-content">Form</span>
            <select
              className="input"
              value={form}
              onChange={(e) => setForm(e.target.value)}
            >
              <option value="">All forms</option>
              {choices.forms.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block font-semibold text-content">Client</span>
            <select
              className="input"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">All clients</option>
              {choices.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block font-semibold text-content">Status</span>
            <select
              className="input"
              value={chip}
              onChange={(e) => setChip(e.target.value as ChipKind | "")}
            >
              <option value="">All statuses</option>
              {CHIP_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CHIP_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <ErrorBanner lines={errors} className="mb-4" />

      {q.isPending ? (
        <div className="space-y-3">
          <Skeleton />
          <Skeleton className="w-2/3" />
        </div>
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
          <ErrorState
            message="Could not load the deadlines."
            onRetry={() => void q.refetch()}
          />
        </>
      ) : (
        <div className="space-y-5">
          {q.data.notes.map((n) => (
            <p
              key={n}
              role="note"
              data-deadlines-note
              className="rounded-input border border-line bg-paper px-3 py-2 text-[12.5px] text-content-secondary"
            >
              {n}
            </p>
          ))}
          {q.data.missing.length > 0 ? (
            <div
              data-deadlines-missing
              className="rounded-input border border-gold bg-warn-bg-2 px-4 py-3 text-[13px]"
            >
              <h2 className="mb-1 font-semibold text-content">
                Client records that lack what the deadlines need
              </h2>
              <ul className="space-y-1">
                {q.data.missing.map((m) => (
                  <li key={m.clientId} data-missing-client={m.clientId}>
                    <Link
                      to={`/clients/${encodeURIComponent(m.clientId)}`}
                      className="font-semibold text-blue underline-offset-2 hover:underline"
                    >
                      {m.clientName}
                    </Link>
                    : {m.missing.map((x) => x.sentence).join(" ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {days.length === 0 ? (
            <Card>
              <EmptyState
                title="No deadline to show"
                description={
                  form || clientId || chip
                    ? "Nothing matches these filters in this range."
                    : "No client has a return due in this range."
                }
              />
            </Card>
          ) : (
            days.map((d) => (
              <Card key={d.dueDate} data-due-date={d.dueDate}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-serif text-[17px] font-medium text-navy">
                      {dayHeading(d.dueDate)}
                    </h2>
                    <span
                      data-due-count
                      className="font-mono text-[12px] text-content-secondary"
                    >
                      {d.filed} of {d.total} filed
                    </span>
                  </div>
                  {d.forms.map((e) => (
                    <FormBlock
                      key={`${e.form}|${e.period}`}
                      entry={e}
                      canCreate={canCreate}
                      onError={setErrors}
                    />
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function FormBlock({
  entry,
  canCreate,
  onError,
}: {
  entry: DeadlineFormEntry;
  canCreate: boolean;
  onError: (lines: string[]) => void;
}) {
  return (
    <div
      data-deadline-form={`${entry.form}|${entry.period}`}
      className="border-t border-line pt-3"
    >
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="font-mono font-semibold text-navy">{entry.form}</span>
        {entry.alternatives.length > 0 ? (
          <span className="font-mono text-content-secondary">
            or {entry.alternatives.join(" or ")}
          </span>
        ) : null}
        <span className="text-content">{entry.title}</span>
        <span data-period className="text-content-secondary">
          {entry.periodWords}
        </span>
      </div>
      <ul className="divide-y divide-line">
        {entry.clients.map((c) => (
          <ClientRow
            key={c.clientId}
            entry={entry}
            row={c}
            canCreate={canCreate}
            onError={onError}
          />
        ))}
      </ul>
    </div>
  );
}

function ClientRow({
  entry,
  row,
  canCreate,
  onError,
}: {
  entry: DeadlineFormEntry;
  row: DeadlineClientRow;
  canCreate: boolean;
  onError: (lines: string[]) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const kind = CHIP_OF[row.status];
  // No return yet: make its draft for this client, form and period, then open it.
  const create = useMutation({
    mutationFn: () =>
      createBirForm({
        clientId: row.clientId,
        form: entry.form,
        period: entry.period,
        data: {},
      }),
    onSuccess: (f) => {
      onError([]);
      void qc.invalidateQueries({ queryKey: ["bir-deadlines"] });
      navigate(`/bir-forms/${encodeURIComponent(f.id)}`);
    },
    onError: (e) => onError(errorLines(e, "Could not create the draft.")),
  });
  return (
    <li
      data-deadline-client={row.clientId}
      className="flex flex-wrap items-center gap-3 py-2 text-[13px]"
    >
      <span className="min-w-[200px] text-content">{row.clientName}</span>
      <Chip variant={CHIP_VARIANT[kind]} data-status={row.status}>
        {CHIP_LABEL[kind]}
      </Chip>
      <span className="ml-auto">
        {row.birFormId ? (
          <Link
            to={`/bir-forms/${encodeURIComponent(row.birFormId)}`}
            data-open-return
            className="text-blue underline-offset-2 hover:underline"
          >
            Open the return
          </Link>
        ) : canCreate ? (
          <Button
            size="sm"
            variant="outline"
            data-create-draft
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? "Creating…" : "Create the draft"}
          </Button>
        ) : null}
      </span>
    </li>
  );
}

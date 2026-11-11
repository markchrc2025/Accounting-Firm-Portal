// RecurrenceFields - whether a project recurs, and its schedule (PB7, PA8 / D70). The dates come
// from projects-core: before the schedule is saved they are worked out here and labelled as a
// preview; once saved, the API's recurrence-preview gives them. Each date creates a task in the
// project, due that day.

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, cn } from "../ui";
import { Field } from "./parts";
import {
  dayText,
  errorLines,
  fetchRecurrencePreview,
  manilaToday,
  RECURRENCE_END_HINT,
  RECURRING_LINE,
} from "../../lib/projects";
import {
  FREQUENCIES,
  FREQUENCY_LABELS,
  previewDates,
  sameSchedule,
  type Frequency,
  type Schedule,
} from "../../lib/recurrence";

export type { Schedule };

export function RecurrenceFields({
  value,
  onChange,
  savedKey,
  saved,
}: {
  value: Schedule;
  onChange: (next: Schedule) => void;
  /** The project's key when it has a saved recurring schedule, else null. */
  savedKey: string | null;
  saved: Schedule;
}) {
  const set = (patch: Partial<Schedule>) => onChange({ ...value, ...patch });
  const fromApi = !!savedKey && value.on && sameSchedule(value, saved);
  const api = useQuery({
    queryKey: ["projects", "recurrence-preview", savedKey],
    queryFn: () => fetchRecurrencePreview(savedKey!),
    enabled: fromApi,
    retry: false,
  });
  const local = value.on && !fromApi ? previewDates(value, manilaToday()) : null;

  return (
    <Card data-recurrence>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={value.on}
            aria-label="Recurring"
            data-recurring-switch
            onClick={() => set({ on: !value.on })}
            className={cn(
              "relative h-6 w-11 flex-none rounded-full transition-colors",
              value.on ? "bg-navy" : "bg-line-strong",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all",
                value.on ? "left-[22px]" : "left-0.5",
              )}
            />
          </button>
          <span className="text-[13px] font-semibold text-content">Recurring</span>
        </div>
        {value.on ? (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Start date">
                <input
                  type="date"
                  required
                  className="input font-mono"
                  value={value.start}
                  onChange={(e) => set({ start: e.target.value })}
                />
              </Field>
              <Field label="End date" hint={RECURRENCE_END_HINT}>
                <input
                  type="date"
                  className="input font-mono"
                  value={value.end}
                  onChange={(e) => set({ end: e.target.value })}
                />
              </Field>
              <Field label="Frequency">
                <select
                  className="input"
                  value={value.frequency}
                  onChange={(e) => set({ frequency: e.target.value as Frequency })}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div
              data-recurrence-preview={fromApi ? "saved" : "preview"}
              className="text-[13px]"
            >
              <h3 className="mb-1 font-semibold text-content">
                {fromApi
                  ? "The next 5 dates"
                  : "The next 5 dates (preview, not saved yet)"}
              </h3>
              {fromApi ? (
                api.isPending ? (
                  <p className="text-content-secondary">Working out the dates…</p>
                ) : api.isError ? (
                  <p role="alert" className="text-danger-ink">
                    {errorLines(api.error).join(" ")}
                  </p>
                ) : (
                  <Dates dates={api.data.dates} />
                )
              ) : local && local.problems.length > 0 ? (
                <p data-recurrence-problem className="text-content-secondary">
                  {local.problems[0]}
                </p>
              ) : (
                <Dates dates={local?.dates ?? []} />
              )}
              <p data-recurring-line className="mt-2 text-[12px] text-content-secondary">
                {RECURRING_LINE}
              </p>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Dates({ dates }: { dates: string[] }) {
  if (dates.length === 0)
    return <p className="text-content-secondary">No dates left in this schedule.</p>;
  return (
    <ol className="flex flex-wrap gap-2" data-recurrence-dates>
      {dates.map((d) => (
        <li
          key={d}
          data-date={d}
          className="rounded-chip border border-line px-2 py-0.5 font-mono text-[12px]"
        >
          {dayText(d)}
        </li>
      ))}
    </ol>
  );
}

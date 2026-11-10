// Roadmap - the milestones of a project as bars on one time axis (PB2): each dated milestone is a
// bar from its start to its due date, filled as far as it is done, with a line for today (Manila).
// Milestones with no dates are listed below the bars.

import { useQuery } from "@tanstack/react-query";
import { Card, Chip, ErrorState, Skeleton, cn } from "../../components/ui";
import { ErrorBanner } from "../../components/projects/parts";
import { roadmapLayout } from "../../lib/roadmap";
import {
  dayText,
  errorLines,
  fetchRoadmap,
  milestoneStateLabel,
  type Milestone,
} from "../../lib/projects";

const BAR_TONE: Record<Milestone["state"], string> = {
  OPEN: "bg-blue/25 border-blue/60",
  LOCKED: "bg-warn-bg border-gold",
  CLOSED: "bg-line border-line-strong",
};
const FILL_TONE: Record<Milestone["state"], string> = {
  OPEN: "bg-blue",
  LOCKED: "bg-gold",
  CLOSED: "bg-content-secondary",
};

export function Roadmap({ projectKey }: { projectKey: string }) {
  const q = useQuery({
    queryKey: ["projects", "roadmap", projectKey],
    queryFn: () => fetchRoadmap(projectKey),
  });

  return (
    <section className="mb-6" data-roadmap aria-labelledby="roadmap-title">
      <h2
        id="roadmap-title"
        className="mb-2 font-serif text-[19px] font-medium text-navy"
      >
        Roadmap
      </h2>
      {q.isPending ? (
        <Skeleton />
      ) : q.isError ? (
        <>
          <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
          <ErrorState
            message="Could not load the roadmap."
            onRetry={() => void q.refetch()}
          />
        </>
      ) : q.data.dated.length === 0 && q.data.undated.length === 0 ? (
        <Card className="px-5 py-4 text-[13px] text-content-secondary">
          The roadmap fills in as milestones are added.
        </Card>
      ) : (
        <Card className="px-5 py-4">
          {q.data.dated.length > 0 ? (
            <Bars roadmap={q.data} />
          ) : (
            <p className="text-[13px] text-content-secondary">
              No milestone has a date yet, so there is nothing to draw.
            </p>
          )}
          {q.data.undated.length > 0 ? (
            <div data-undated className="mt-4 border-t border-line pt-3">
              <h3 className="eyebrow mb-1.5">No dates</h3>
              <ul className="space-y-1 text-[13px]">
                {q.data.undated.map((m) => (
                  <li
                    key={m.id}
                    data-undated-milestone={m.id}
                    className="flex items-center gap-2"
                  >
                    <span className="font-semibold text-navy">{m.name}</span>
                    <Chip variant="neutral">{milestoneStateLabel(m.state)}</Chip>
                    <span className="font-mono text-[11px] text-content-secondary">
                      {m.percent ?? m.progress.percent}% done
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      )}
    </section>
  );
}

function Bars({ roadmap }: { roadmap: { today: string; dated: Milestone[] } }) {
  const layout = roadmapLayout(roadmap.dated, roadmap.today);
  return (
    <div>
      <div className="relative ml-0 h-5 text-[10.5px] text-content-secondary" aria-hidden>
        {layout.months.map((m) => (
          <span
            key={`${m.label}-${m.left}`}
            className="absolute top-0 whitespace-nowrap font-mono"
            style={{ left: `${m.left}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="relative">
        {/* today */}
        <div
          data-today={roadmap.today}
          aria-hidden
          className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-danger"
          style={{ left: `${layout.todayLeft}%` }}
        >
          <span className="absolute -top-0.5 left-1 whitespace-nowrap font-mono text-[10px] font-semibold text-danger">
            Today
          </span>
        </div>
        <ul className="space-y-3 pt-4">
          {layout.bars.map((b) => (
            <li key={b.id} data-roadmap-bar={b.id}>
              <div className="relative h-6">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={b.percent}
                  aria-label={`${b.name}, ${b.percent}% done`}
                  data-bar-left={b.left.toFixed(2)}
                  data-bar-width={b.width.toFixed(2)}
                  className={cn(
                    "absolute top-0 h-6 min-w-[6px] overflow-hidden rounded-input border",
                    BAR_TONE[b.state],
                  )}
                  style={{ left: `${b.left}%`, width: `${b.width}%` }}
                >
                  <div
                    data-bar-fill={b.percent}
                    className={cn("h-full", FILL_TONE[b.state])}
                    style={{ width: `${b.percent}%` }}
                  />
                </div>
              </div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-[12px]">
                <span className="font-semibold text-navy">{b.name}</span>
                <span className="font-mono text-[11px] text-content-secondary">
                  {b.startDate ? dayText(b.startDate) : "No start"} to{" "}
                  {b.dueDate ? dayText(b.dueDate) : "no due date"}
                </span>
                <span className="font-mono text-[11px] text-content-secondary">
                  {b.percent}% done ({b.done} of {b.total})
                </span>
                {b.late ? (
                  <span className="font-semibold text-danger">Past due</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

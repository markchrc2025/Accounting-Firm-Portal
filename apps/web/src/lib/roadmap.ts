// roadmap.ts - the maths of the roadmap bars (PB2): where each milestone's bar starts and how wide
// it is on a shared time axis, how far it is filled, and where today sits. Calendar days only
// (YYYY-MM-DD as the API writes them, today in Manila), so no time zone enters the sums.
import type { Milestone } from "./projects";

const MS_DAY = 86_400_000;
/** Whole days since 1970-01-01 for a YYYY-MM-DD date. */
export function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / MS_DAY);
}
const dayString = (n: number): string => new Date(n * MS_DAY).toISOString().slice(0, 10);

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface RoadmapBar {
  id: string;
  name: string;
  state: Milestone["state"];
  startDate: string | null;
  dueDate: string | null;
  /** Percent of the axis from the left edge to the bar's start. */
  left: number;
  /** Percent of the axis the bar covers (both end days included). */
  width: number;
  /** Percent done, 0 to 100: how far the bar is filled. */
  percent: number;
  done: number;
  total: number;
  /** Due before today and not closed. */
  late: boolean;
}
export interface RoadmapLayout {
  bars: RoadmapBar[];
  /** Percent from the left edge to the middle of today's day. */
  todayLeft: number;
  axisStart: string;
  axisEnd: string;
  months: { label: string; left: number }[];
}

export function roadmapLayout(dated: Milestone[], today: string): RoadmapLayout {
  const t = dayNumber(today);
  const spans = dated.map((m) => {
    const a = dayNumber((m.startDate ?? m.dueDate)!);
    const b = dayNumber((m.dueDate ?? m.startDate)!);
    return { m, from: Math.min(a, b), to: Math.max(a, b) };
  });
  const min = Math.min(t, ...spans.map((s) => s.from));
  const max = Math.max(t, ...spans.map((s) => s.to));
  const length = max - min + 1;
  const pct = (n: number) => (n / length) * 100;

  const months: RoadmapLayout["months"] = [];
  for (let n = min; n <= max; n++) {
    const d = new Date(n * MS_DAY);
    if (n === min || d.getUTCDate() === 1) {
      months.push({
        label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
        left: pct(n - min),
      });
    }
  }
  return {
    bars: spans.map(({ m, from, to }) => ({
      id: m.id,
      name: m.name,
      state: m.state,
      startDate: m.startDate,
      dueDate: m.dueDate,
      left: pct(from - min),
      width: pct(to - from + 1),
      percent: Math.max(0, Math.min(100, m.percent ?? m.progress.percent)),
      done: m.progress.done,
      total: m.progress.total,
      late: m.dueDate !== null && m.state !== "CLOSED" && dayNumber(m.dueDate) < t,
    })),
    todayLeft: pct(t - min + 0.5),
    axisStart: dayString(min),
    axisEnd: dayString(max),
    months,
  };
}

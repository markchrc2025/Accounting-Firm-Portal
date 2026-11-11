// recurrence.ts (web) - PB7: the recurring-project helpers the form uses, taken from
// @portal/projects-core (its recurrence module only; see vite.config.ts). Nothing is retyped here.
export {
  FREQUENCIES,
  FREQUENCY_LABELS,
  isFrequency,
  nextOccurrences,
  validateRecurrence,
  type Frequency,
} from "@portal/projects-core/recurrence";

import {
  nextOccurrences,
  validateRecurrence,
  type Frequency,
} from "@portal/projects-core/recurrence";
import { dayBefore } from "./projects";

/** The recurring schedule as the project form holds it. */
export interface Schedule {
  on: boolean;
  start: string;
  end: string;
  frequency: Frequency;
}

export const sameSchedule = (a: Schedule, b: Schedule) =>
  a.on === b.on && a.start === b.start && a.end === b.end && a.frequency === b.frequency;

/** The next 5 dates of an unsaved schedule (today included), or the sentences that stop it. */
export function previewDates(
  s: Schedule,
  today: string,
): { dates: string[]; problems: string[] } {
  const problems = validateRecurrence({
    recurring: true,
    start: s.start,
    end: s.end,
    frequency: s.frequency,
  });
  if (problems.length > 0) return { dates: [], problems };
  try {
    return {
      dates: nextOccurrences(s.start, s.frequency, s.end || null, dayBefore(today), 5),
      problems: [],
    };
  } catch (e) {
    return { dates: [], problems: [e instanceof Error ? e.message : String(e)] };
  }
}

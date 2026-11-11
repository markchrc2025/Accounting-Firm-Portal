// recurrence-plan.ts — PA8 (D70): the pure rules of a recurring project. Every date comes from
// @portal/projects-core (PC5); nothing here does its own date arithmetic.
import {
  addDays,
  occurrencesBetween,
  validateRecurrence,
  type Frequency,
  type RecurrenceInput,
} from "@portal/projects-core";

/** How many days before its due date an occurrence's task is made. */
export const LEAD_DAYS: Readonly<Record<Frequency, number>> = {
  DAILY: 1,
  WEEKLY: 7,
  BI_WEEKLY: 14,
  MONTHLY: 30,
  QUARTERLY: 30,
  ANNUALLY: 30,
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const dayText = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/**
 * The period an occurrence stands for, in words, from its date (its due date):
 * Daily "5 November 2026", Weekly "Week of 12 November 2026", Bi-Weekly "Fortnight of 12 November
 * 2026", Monthly "November 2026", Quarterly "Q4 2026" (the calendar quarter), Annually "2026".
 */
export function occurrenceLabel(frequency: Frequency, date: string): string {
  switch (frequency) {
    case "DAILY":
      return dayText(date);
    case "WEEKLY":
      return `Week of ${dayText(date)}`;
    case "BI_WEEKLY":
      return `Fortnight of ${dayText(date)}`;
    case "MONTHLY":
      return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
    case "QUARTERLY":
      return `Q${Math.ceil(Number(date.slice(5, 7)) / 3)} ${date.slice(0, 4)}`;
    case "ANNUALLY":
      return date.slice(0, 4);
  }
}

const MAX_TITLE = 300;

/** "Encoding: November 2026". A very long project name is cut; the label is kept whole. */
export function occurrenceTitle(projectName: string, frequency: Frequency, date: string): string {
  const tail = `: ${occurrenceLabel(frequency, date)}`;
  const name = projectName.length + tail.length > MAX_TITLE
    ? projectName.slice(0, MAX_TITLE - tail.length)
    : projectName;
  return `${name}${tail}`;
}

export interface GenerateInput {
  start: string;
  end: string | null;
  frequency: Frequency;
  /** The Manila day generation began; null means today. Nothing earlier is ever made. */
  activeFrom: string | null;
  /** A Manila date. */
  today: string;
}

/**
 * The occurrence dates whose task is due to be made by `today`: on or after the day generation
 * began and on or before today plus the lead time (and the end date, when there is one).
 */
export function datesToGenerate(i: GenerateInput): string[] {
  const from = i.activeFrom ?? i.today;
  return occurrencesBetween(
    i.start,
    i.frequency,
    i.end,
    from,
    addDays(i.today, LEAD_DAYS[i.frequency]),
  );
}

/** PC5's sentences about a schedule; an empty list means it can be saved. */
export function recurrenceProblems(input: RecurrenceInput): string[] {
  return validateRecurrence(input);
}

// birDeadlines.ts - the BIR Deadlines page (PB7, Track A PA8 / D70): GET /bir/deadlines answers the
// due dates in order (a weekend date already moved to Monday by the API), each with its forms, the
// period each covers and the clients who must file, each with a status. Nothing here decides a due
// date; the page only shows, filters and counts what the API answered.
import { apiFetch } from "./api";

export type DeadlineStatus =
  "not_started" | "draft" | "filed_bir" | "filed_override" | "filed" | "overdue";

export interface DeadlineClientRow {
  clientId: string;
  clientName: string;
  status: DeadlineStatus;
  /** The return on file for this client, form and period, or null. */
  birFormId: string | null;
}
export interface DeadlineFormEntry {
  form: string;
  /** Other forms that stand for the same row (the 1701A beside the 1701). */
  alternatives: string[];
  title: string;
  period: string;
  periodWords: string;
  clients: DeadlineClientRow[];
}
export interface DeadlineDay {
  dueDate: string;
  forms: DeadlineFormEntry[];
}
export interface DeadlinesAnswer {
  from: string;
  to: string;
  today: string;
  notes: string[];
  deadlines: DeadlineDay[];
  missing: {
    clientId: string;
    clientName: string;
    missing: { field: string; sentence: string }[];
  }[];
}

export const fetchBirDeadlines = (from: string, to: string) =>
  apiFetch<DeadlinesAnswer>(
    `/bir/deadlines?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );

/** The chip a status shows, in the owner's words. */
export type ChipKind = "not_started" | "draft" | "filed" | "filed_no_email" | "overdue";
export const CHIP_OF: Record<DeadlineStatus, ChipKind> = {
  not_started: "not_started",
  draft: "draft",
  filed_bir: "filed",
  filed: "filed",
  filed_override: "filed_no_email",
  overdue: "overdue",
};
export const CHIP_LABEL: Record<ChipKind, string> = {
  not_started: "Not started",
  draft: "Draft",
  filed: "Filed",
  filed_no_email: "Filed without BIR email",
  overdue: "Overdue",
};
export const CHIP_KINDS: ChipKind[] = [
  "not_started",
  "draft",
  "filed",
  "filed_no_email",
  "overdue",
];
/** Filed in any way (with the BIR e-mail, without it, or a form that files without one). */
export const isFiled = (s: DeadlineStatus): boolean =>
  s === "filed" || s === "filed_bir" || s === "filed_override";

/** "2026-11" for a Manila day "2026-11-10"; the month after "2026-12" is "2027-01". */
export const monthOf = (day: string): string => day.slice(0, 7);
export function nextMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export interface DeadlineFilters {
  form: string;
  clientId: string;
  chip: ChipKind | "";
}

/**
 * The due dates after the filters, with the forms and clients that remain; a form with no client
 * left, and a date with no form left, are dropped. Each date carries its count: filed of total,
 * over the clients shown.
 */
export function filterDeadlines(
  days: DeadlineDay[],
  f: DeadlineFilters,
): (DeadlineDay & { filed: number; total: number })[] {
  const out: (DeadlineDay & { filed: number; total: number })[] = [];
  for (const d of days) {
    const forms = d.forms
      .filter((e) => !f.form || e.form === f.form)
      .map((e) => ({
        ...e,
        clients: e.clients.filter(
          (c) =>
            (!f.clientId || c.clientId === f.clientId) &&
            (!f.chip || CHIP_OF[c.status] === f.chip),
        ),
      }))
      .filter((e) => e.clients.length > 0);
    if (forms.length === 0) continue;
    const all = forms.flatMap((e) => e.clients);
    out.push({
      ...d,
      forms,
      filed: all.filter((c) => isFiled(c.status)).length,
      total: all.length,
    });
  }
  return out;
}

/** The forms and the clients the answer names, for the filter lists (sorted). */
export function filterChoices(days: DeadlineDay[]): {
  forms: string[];
  clients: { id: string; name: string }[];
} {
  const forms = new Set<string>();
  const clients = new Map<string, string>();
  for (const d of days)
    for (const e of d.forms) {
      forms.add(e.form);
      for (const c of e.clients) clients.set(c.clientId, c.clientName);
    }
  return {
    forms: [...forms].sort(),
    clients: [...clients.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

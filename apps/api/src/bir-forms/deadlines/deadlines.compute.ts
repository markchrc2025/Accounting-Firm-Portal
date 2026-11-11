// deadlines.compute.ts — PA8 (D70): the BIR deadlines answer, from clients and the returns on file.
// Pure: no database, no clock (today is passed in, a Manila date).
import { CONFIRMATION_FORMS } from "../../bir-confirmation/confirmation-forms";
import {
  dueDateForReturn,
  formTitle,
  periodsOfForm,
  periodWords,
  WEEKEND_NOTE,
} from "./due-rules";
import {
  missingInfo,
  requiredReturns,
  type DeadlineClient,
  type MissingItem,
} from "./eligibility";

export type DeadlineStatus =
  "not_started" | "draft" | "filed_bir" | "filed_override" | "filed" | "overdue";

export interface ReturnRecord {
  id: string;
  clientId: string;
  form: string;
  period: string;
  status: "draft" | "filed";
  sequence: number;
  createdAt: string;
  /** The live confirmation of a filed return: the BIR e-mail, a Super Admin's override, or none. */
  confirmation: "bir_email" | "override" | null;
}

export interface DeadlineClientRow {
  clientId: string;
  clientName: string;
  status: DeadlineStatus;
  birFormId: string | null;
}
export interface DeadlineFormEntry {
  form: string;
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
  missing: { clientId: string; clientName: string; missing: MissingItem[] }[];
}

interface Input {
  clients: DeadlineClient[];
  returns: ReturnRecord[];
  from: string;
  to: string;
  today: string;
}

const byName = (a: DeadlineClient, b: DeadlineClient) =>
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

function statusOf(
  rows: ReturnRecord[],
  due: string,
  today: string,
): { status: DeadlineStatus; birFormId: string | null } {
  const filed = rows
    .filter((r) => r.status === "filed")
    .sort((a, b) => b.sequence - a.sequence)[0];
  if (filed) {
    const status: DeadlineStatus = !CONFIRMATION_FORMS.has(filed.form)
      ? "filed"
      : filed.confirmation === "bir_email"
        ? "filed_bir"
        : filed.confirmation === "override"
          ? "filed_override"
          : "filed";
    return { status, birFormId: filed.id };
  }
  const draft = rows
    .filter((r) => r.status === "draft")
    .sort((a, b) => b.sequence - a.sequence || b.createdAt.localeCompare(a.createdAt))[0];
  if (due < today) return { status: "overdue", birFormId: draft?.id ?? null };
  return draft
    ? { status: "draft", birFormId: draft.id }
    : { status: "not_started", birFormId: null };
}

export function computeDeadlines({
  clients,
  returns,
  from,
  to,
  today,
}: Input): DeadlinesAnswer {
  const index = new Map<string, ReturnRecord[]>();
  for (const r of returns) {
    const k = `${r.clientId}|${r.form}|${r.period}`;
    (index.get(k) ?? index.set(k, []).get(k)!).push(r);
  }
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  // dueDate -> "form|period" -> entry
  const days = new Map<string, Map<string, DeadlineFormEntry>>();

  for (const c of [...clients].sort(byName)) {
    for (const req of requiredReturns(c)) {
      for (let y = fromYear - 2; y <= toYear + 1; y++) {
        for (const period of periodsOfForm(req.form, y)) {
          const due = dueDateForReturn(req.form, period, c.fiscalYearStart);
          if (!due) continue;
          const month = due.slice(0, 7);
          if (month < from || month > to) continue;
          const rows = [req.form, ...req.alternatives].flatMap(
            (f) => index.get(`${c.id}|${f}|${period}`) ?? [],
          );
          const { status, birFormId } = statusOf(rows, due, today);
          const day = days.get(due) ?? days.set(due, new Map()).get(due)!;
          const key = `${req.form}|${period}`;
          const entry =
            day.get(key) ??
            day
              .set(key, {
                form: req.form,
                alternatives: req.alternatives,
                title: formTitle(req.form),
                period,
                periodWords: periodWords(period),
                clients: [],
              })
              .get(key)!;
          entry.clients.push({ clientId: c.id, clientName: c.name, status, birFormId });
        }
      }
    }
  }

  const deadlines: DeadlineDay[] = [...days.keys()].sort().map((dueDate) => ({
    dueDate,
    forms: [...days.get(dueDate)!.values()].sort(
      (a, b) => a.form.localeCompare(b.form) || a.period.localeCompare(b.period),
    ),
  }));

  const missing = [...clients]
    .sort(byName)
    .map((c) => ({ clientId: c.id, clientName: c.name, missing: missingInfo(c) }))
    .filter((m) => m.missing.length > 0);

  return { from, to, today, notes: [WEEKEND_NOTE], deadlines, missing };
}

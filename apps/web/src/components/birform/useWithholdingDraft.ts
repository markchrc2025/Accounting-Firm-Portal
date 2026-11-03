// useWithholdingDraft — everything the 0619-E, 1601-EQ and 1601-C editors share (W17):
// the saved draft, the editor's state, the live server computation, save and "Mark as
// filed", and — for the two returns the books can fill — "Portal books | Manual".
//
// The period column is the authority: the year, month or quarter in the draft's data
// are written from it. The browser computes no tax and no date: Item 2's default due
// date and every total are the server's.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ApiError,
  computeBirForm,
  createBirForm,
  fetchBirForm,
  fetchClients,
  updateBirForm,
  type BirForm0619EComputed,
  type BirForm1601CComputed,
  type BirForm1601EQComputed,
} from "../../lib/api";
import { hasUnsavedChanges } from "../../lib/birPreview";
import { EQ_1601_SPEC, SCHEDULE_1_SPEC } from "../../lib/bookFigures";
import {
  BOOK_KEYS,
  BOOK_LABELS,
  buildData,
  emptyEqRow,
  emptySchedule,
  emptyValues,
  hydrate,
  periodOf,
  periodOptions,
  ROWS_ON_THE_FORM,
  splitPeriod,
  type EqRow,
  type ScheduleRow,
  type Values,
  type WithholdingForm,
} from "../../lib/withholding";
import { useAmendmentHeading } from "./useAmendmentHeading";
import { useBookFigures } from "./useBookFigures";

const UNTOUCHED = {
  "0619E": emptyValues("0619E"),
  "1601EQ": emptyValues("1601EQ"),
  "1601C": emptyValues("1601C"),
} as const;

type Computed = BirForm0619EComputed | BirForm1601EQComputed | BirForm1601CComputed;

export function useWithholdingDraft(form: WithholdingForm) {
  const { id } = useParams<{ id: string }>();
  const isNew = !id;
  const navigate = useNavigate();

  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const existing = useQuery({
    queryKey: ["bir-form", id],
    queryFn: () => fetchBirForm(id!),
    enabled: !isNew,
  });
  const amendment = useAmendmentHeading(existing.data);
  // An amendment draft is an amended return (W3 F26).
  const amended = existing.data?.amendsId ? "yes" : "no";

  const [clientId, setClientId] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [sub, setSubRaw] = useState(() => periodOptions(form)[0]!.value);
  const [values, setValues] = useState<Values>(() => emptyValues(form));
  const [rows, setRows] = useState<EqRow[]>(() =>
    form === "1601EQ" ? [emptyEqRow()] : [],
  );
  const [schedule, setSchedule] = useState<ScheduleRow[]>(emptySchedule);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from an existing form.
  useEffect(() => {
    const d = existing.data?.data;
    if (!d) return;
    setClientId(existing.data!.clientId);
    const p = splitPeriod(form, existing.data!.period || "");
    if (p) {
      setYear(p.year);
      setSubRaw(p.sub);
    }
    const h = hydrate(form, d);
    // A saved due date that is the server's own default for the month still follows it.
    const def = (existing.data!.computed as { defaultDueDate?: string } | null)
      ?.defaultDueDate;
    if (form === "0619E" && def && h.values.dueDate === def) h.values.dueDate = "";
    setValues(h.values);
    setRows(h.rows);
    setSchedule(h.schedule);
  }, [existing.data, form]);

  const set = useCallback((k: string, v: string) => {
    setValues((prev) => ({ ...prev, [k]: v }));
  }, []);
  /** The month or quarter. A 4th-quarter 1601-EQ cannot carry an over-remittance over. */
  const setSub = useCallback((v: string) => {
    setSubRaw(v);
    if (v === "Q4") {
      setValues((prev) =>
        prev.overRemittanceChoice === "carried"
          ? { ...prev, overRemittanceChoice: "" }
          : prev,
      );
    }
  }, []);

  const period = periodOf(form, year, sub);
  const data = useMemo(
    () => buildData(form, { year, sub, amended, values, rows, schedule }),
    [form, year, sub, amended, values, rows, schedule],
  );

  const isFiled = existing.data?.status === "filed";
  const booked = form !== "1601C";
  const books = useBookFigures({
    form: form === "0619E" ? "0619E" : "1601EQ",
    knownKeys: BOOK_KEYS[form === "0619E" ? "0619E" : "1601EQ"],
    rowSpec: form === "1601EQ" ? EQ_1601_SPEC : SCHEDULE_1_SPEC,
    labels: BOOK_LABELS[form === "0619E" ? "0619E" : "1601EQ"],
    untouched: UNTOUCHED[form],
    clientId,
    period,
    isNew,
    // The 1601-C has no books source: the hook is held inert.
    isFiled: isFiled || !booked,
    saved: existing.data
      ? {
          clientId: existing.data.clientId,
          period: existing.data.period || "",
          data: existing.data.data,
        }
      : undefined,
    data,
    apply: (next) => {
      setValues((prev) => {
        const out = { ...prev };
        for (const k of BOOK_KEYS[form === "0619E" ? "0619E" : "1601EQ"]) {
          if (k !== "rows" && next[k] != null) out[k] = String(next[k]);
        }
        return out;
      });
      if (form === "1601EQ" && Array.isArray(next.rows)) {
        setRows(
          (next.rows as Record<string, unknown>[]).map((r) => ({
            atc: String(r.atc ?? ""),
            base: String(r.base ?? ""),
            rate: String(r.rate ?? ""),
            withheld: String(r.withheld ?? ""),
          })),
        );
      }
    },
  });

  // Live authoritative totals (server compute). An existing form is computed only
  // once it is hydrated, as every editor does (W3).
  const [debounced, setDebounced] = useState<typeof data | null>(isNew ? data : null);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(data), 350);
    return () => window.clearTimeout(t);
  }, [data]);
  const computeQ = useQuery({
    queryKey: ["bir-compute-withholding", form, debounced],
    queryFn: () => computeBirForm<Computed>(form, debounced!),
    staleTime: Infinity,
    enabled: debounced !== null,
  });
  const computed = (computeQ.data ??
    (existing.data?.computed as Computed | null | undefined) ??
    undefined) as Computed | undefined;

  // What a save writes: the figures, Item 2's date (the typed one, else the server's
  // default) and how the books filled them (`_source`, kept as it was on a 1601-C).
  const defaultDueDate =
    (computed as BirForm0619EComputed | undefined)?.defaultDueDate ?? "";
  const keptSource = !booked
    ? (existing.data?.data as Record<string, unknown> | undefined)?._source
    : undefined;
  const saveData = useMemo(() => {
    const out: Record<string, unknown> = { ...data };
    if (form === "0619E" && !values.dueDate) out.dueDate = defaultDueDate;
    if (books.source) out._source = books.source;
    else if (keptSource !== undefined) out._source = keptSource;
    return out;
  }, [data, form, values.dueDate, defaultDueDate, books.source, keptSource]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) return createBirForm({ clientId, form, period, data: saveData });
      return updateBirForm(id!, { period, data: saveData });
    },
    onSuccess: (saved) => {
      setError(null);
      if (isNew) navigate(`/bir-forms/${saved.id}`);
      else void existing.refetch();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not save the form."),
  });

  // Filing lifecycle: mark filed. The server refuses a 1601-EQ of more than six ATCs.
  const setStatus = useMutation({
    mutationFn: (status: "draft" | "filed") => updateBirForm(id!, { status }),
    onSuccess: () => {
      setError(null);
      void existing.refetch();
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not update the form status."),
  });

  // The amended copy of a return is "not amended" in storage until it is saved.
  const needsAmendedSave =
    !isFiled &&
    !!existing.data?.amendsId &&
    (existing.data.data as { amended?: unknown }).amended !== "yes";

  // A 1601-EQ with more than six ATCs is shown whole; it cannot be filed, previewed or copied.
  const rowCount = (computed as BirForm1601EQComputed | undefined)?.rowCount ?? 0;
  const tooManyRows = form === "1601EQ" && rowCount > ROWS_ON_THE_FORM;

  return {
    form,
    id,
    isNew,
    navigate,
    existing,
    clients: clientsQ.data ?? [],
    amendment,
    clientId,
    setClientId,
    year,
    setYear,
    sub,
    setSub,
    period,
    values,
    set,
    rows,
    setRows,
    schedule,
    setSchedule,
    error,
    setError,
    data,
    saveData,
    computed,
    books,
    booked,
    save,
    setStatus,
    isFiled,
    needsAmendedSave,
    tooManyRows,
    rowCount,
    dirty: hasUnsavedChanges(existing.data, period, saveData),
    /** Item 2's value: what was typed, else the server's default for the month. */
    dueDate: values.dueDate || defaultDueDate,
  };
}

export type WithholdingDraft = ReturnType<typeof useWithholdingDraft>;

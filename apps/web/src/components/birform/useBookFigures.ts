// useBookFigures — the state behind "Portal books | Manual" on the 2551Q and
// the 2550Q editors (W16, Track A U15). One hook for both forms.
//
// What it owns: the mode, what the books last gave this draft (the baseline),
// the books' own lines and warnings, the message when a fetch fails, and the
// question "Fill from the Portal's books?". What it never does: change a number
// the user can see without that question having been answered — the one
// exception is a brand-new draft with nothing typed, which the books fill.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, fetchBookFigures } from "../../lib/api";
import {
  badgeText,
  buildSource,
  currentValues,
  differing,
  editedBadgeText,
  flattenFigures,
  lineFor,
  patchData,
  printedLabel,
  rowRoom,
  readSource,
  sameAmount,
  staleCount,
  validPeriod,
  type BookField,
  type BookLine,
  type BookMode,
  type BookSource,
} from "../../lib/bookFigures";

type Data = Record<string, unknown>;

/** The words the books use for a box; its id when they gave no line. */
const labelFor = (f: BookField, from: readonly BookLine[]) =>
  printedLabel(lineFor(f, from)?.label ?? f.id);

/** What the books gave, read into fields. */
interface Fresh {
  figures: Data;
  asOf: string;
  fields: BookField[];
  lines: BookLine[];
  recordCount: number;
}

/** What the draft was last filled with. */
interface Baseline {
  figures: Data;
  asOf: string;
  fields: BookField[];
}

export interface BookItem {
  id: string;
  label: string;
  /** What the draft holds; undefined for a Schedule 1 row it does not have yet. */
  typed: string | undefined;
  books: string;
  /** Typed over since the books last filled it: left unticked on a refresh. */
  edited: boolean;
}

export interface BookQuestion {
  /** "switch": Manual to Portal books. "refresh": the books moved on. */
  kind: "switch" | "refresh";
  items: BookItem[];
}

export interface BookBadgeInfo {
  text: string;
  edited: boolean;
  /** The Sales & Income or Expenses page, or null when the books gave no line. */
  href: string | null;
  /** What the books counted, said in the link's tooltip: the pages take no filter yet. */
  title: string | null;
  reset: () => void;
}

export interface BookFigures {
  /** False on a filed return: no switch, nothing fetched. */
  enabled: boolean;
  mode: BookMode;
  fetching: boolean;
  error: string | null;
  warnings: string[];
  /** "Refresh from books" just found nothing to change (R3). */
  match: boolean;
  /** How many figures the books give differently from what the draft holds. */
  stale: number;
  question: BookQuestion | null;
  /** What a save writes as the draft's `_source`; null when the books never filled it. */
  source: BookSource | null;
  /** A filed return filled from the books: when. */
  filledOn: string | null;
  choose: (mode: BookMode) => void;
  refresh: () => void;
  review: () => void;
  answer: (fill: boolean, ids: string[]) => void;
  badge: (id: string) => BookBadgeInfo | null;
}

export function useBookFigures(opts: {
  form: "2551Q" | "2550Q";
  knownKeys: readonly string[];
  clientId: string;
  period: string;
  isNew: boolean;
  isFiled: boolean;
  /** The saved draft, once loaded. */
  saved: { clientId: string; period: string; data: Data } | undefined;
  /** The editor's data as the compute sees it (no `_source`). */
  data: Data;
  /** Put these values into the editor's boxes. */
  apply: (next: Data) => void;
}): BookFigures {
  const { form, knownKeys, clientId, period, isNew, isFiled, saved, data, apply } = opts;

  const [mode, setMode] = useState<BookMode>(isNew ? "books" : "manual");
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [lines, setLines] = useState<BookLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [question, setQuestion] = useState<BookQuestion | null>(null);
  const [match, setMatch] = useState(false);
  // Books fetched that the draft has not taken yet (the staleness note, the open question).
  const [waiting, setWaiting] = useState<Fresh | null>(null);

  // The latest of everything an async step needs after its await.
  const dataRef = useRef(data);
  dataRef.current = data;
  const baselineRef = useRef(baseline);
  baselineRef.current = baseline;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const clientRef = useRef(clientId);
  clientRef.current = clientId;

  // StrictMode runs effects twice in development: one ask per reason, tracked
  // in refs rather than in effect cleanups.
  const inited = useRef(false);
  const lastKey = useRef<string | null>(null);
  const request = useRef(0);

  /** Ask the books. Resolves to null on a failure (its message is set) or when a
   *  newer ask has replaced this one. */
  const ask = useCallback(
    async (forClient: string, forPeriod: string): Promise<Fresh | null> => {
      const mine = ++request.current;
      setFetching(true);
      setError(null);
      setMatch(false);
      try {
        const r = await fetchBookFigures(forClient, form, forPeriod);
        if (mine !== request.current) return null;
        setLines(r.lines);
        setWarnings(r.warnings);
        return {
          figures: r.figures,
          asOf: r.asOf,
          fields: flattenFigures(r.figures, knownKeys),
          lines: r.lines,
          recordCount: r.recordCount,
        };
      } catch (e) {
        if (mine === request.current) {
          setError(
            e instanceof ApiError ? e.message : "Could not read the Portal's books.",
          );
        }
        return null;
      } finally {
        if (mine === request.current) setFetching(false);
      }
    },
    [form, knownKeys],
  );

  /** The draft takes the books' figures for these boxes and remembers them. */
  const take = useCallback((fresh: Fresh, ids: string[]) => {
    if (ids.length > 0) applyRef.current(patchData(dataRef.current, fresh.fields, ids));
    const next = { figures: fresh.figures, asOf: fresh.asOf, fields: fresh.fields };
    baselineRef.current = next;
    setBaseline(next);
    setMode("books");
    setWaiting(null);
    setQuestion(null);
  }, []);

  /** The boxes where the draft and the books disagree, as the question lists them. */
  const itemsFor = useCallback((fresh: Fresh): BookItem[] => {
    const values = currentValues(dataRef.current, fresh.fields);
    const before = new Map(
      (baselineRef.current?.fields ?? []).map((f) => [f.id, f.books]),
    );
    return differing(values, fresh.fields, rowRoom(dataRef.current)).map((f) => ({
      id: f.id,
      label: labelFor(f, fresh.lines),
      typed: values[f.id],
      books: f.books,
      edited: before.has(f.id) && !sameAmount(values[f.id], before.get(f.id)),
    }));
  }, []);

  /** A new draft's first ask: the books fill it, unless the user already typed. */
  const autoFill = useCallback(
    async (forClient: string, forPeriod: string) => {
      const fresh = await ask(forClient, forPeriod);
      if (!fresh) {
        setMode("manual");
        return;
      }
      if (fresh.recordCount === 0) {
        setMode("manual");
        return;
      }
      const items = itemsFor(fresh);
      if (items.every((i) => i.typed === undefined || i.typed === "")) {
        take(
          fresh,
          fresh.fields.map((f) => f.id),
        );
      } else {
        setWaiting(fresh);
        setQuestion({ kind: "switch", items });
      }
    },
    [ask, itemsFor, take],
  );

  /** Ask the books again and put the difference to the user. */
  const refresh = useCallback(async () => {
    const forClient = clientRef.current || saved?.clientId || "";
    const fresh = await ask(forClient, period);
    if (!fresh) return;
    const items = itemsFor(fresh);
    if (items.length === 0) {
      take(fresh, []);
      setMatch(true);
      return;
    }
    setWaiting(fresh);
    setQuestion({ kind: "refresh", items });
  }, [ask, itemsFor, take, saved?.clientId, period]);

  // The note is about what the draft held when the books were read: any change goes.
  useEffect(() => {
    setMatch(false);
  }, [data]);

  // An existing draft: read its `_source` once. A draft saved in Portal books
  // checks the books once in the background and never refreshes by itself.
  useEffect(() => {
    if (isNew || !saved || inited.current) return;
    inited.current = true;
    lastKey.current = `${saved.clientId}|${saved.period}`;
    const src = readSource(saved.data);
    if (!src) return;
    const next: Baseline = {
      figures: src.fed,
      asOf: src.asOf,
      fields: flattenFigures(src.fed, knownKeys),
    };
    baselineRef.current = next;
    setBaseline(next);
    setMode(src.mode);
    if (src.mode !== "books" || isFiled || !validPeriod(saved.period)) return;
    void (async () => {
      const fresh = await ask(saved.clientId, saved.period);
      if (fresh && staleCount(next.fields, fresh.fields) > 0) setWaiting(fresh);
    })();
  }, [isNew, saved, isFiled, knownKeys, ask]);

  // A new draft is asked as soon as it has a client and a quarter; a change of
  // either later, in Portal books, puts the difference to the user.
  useEffect(() => {
    if (isFiled || !clientId || !validPeriod(period)) return;
    if (!isNew && !inited.current) return;
    const key = `${clientId}|${period}`;
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (modeRef.current !== "books") return;
    void (baselineRef.current ? refresh() : autoFill(clientId, period));
  }, [isFiled, isNew, clientId, period, refresh, autoFill]);

  const choose = useCallback(
    (to: BookMode) => {
      if (to === modeRef.current) return;
      if (to === "manual") {
        setMode("manual");
        setQuestion(null);
        return;
      }
      const forClient = clientRef.current || saved?.clientId || "";
      if (!forClient || !validPeriod(period)) {
        // A new draft with no client yet: the client's choice asks the books.
        if (isNew) setMode("books");
        return;
      }
      void (async () => {
        const fresh = await ask(forClient, period);
        if (!fresh) return; // stays in Manual; the message shows in the card
        const items = itemsFor(fresh);
        if (items.length === 0) {
          take(fresh, []);
          return;
        }
        setWaiting(fresh);
        setQuestion({ kind: "switch", items });
      })();
    },
    [ask, itemsFor, take, saved?.clientId, period, isNew],
  );

  const review = useCallback(() => {
    if (!waiting) return;
    setQuestion({ kind: "refresh", items: itemsFor(waiting) });
  }, [waiting, itemsFor]);

  const answer = useCallback(
    (fill: boolean, ids: string[]) => {
      if (!waiting) {
        setQuestion(null);
        return;
      }
      take(waiting, fill ? ids : []);
    },
    [waiting, take],
  );

  const values = useMemo(
    () => (baseline ? currentValues(data, baseline.fields) : {}),
    [data, baseline],
  );

  const source = useMemo(
    () =>
      baseline
        ? buildSource(mode, baseline.asOf, baseline.figures, baseline.fields, values)
        : null,
    [baseline, mode, values],
  );

  const stale =
    mode === "books" && waiting && baseline
      ? staleCount(baseline.fields, waiting.fields)
      : 0;

  const reset = useCallback((id: string) => {
    const b = baselineRef.current;
    if (!b) return;
    applyRef.current(patchData(dataRef.current, b.fields, [id]));
  }, []);

  const badge = useCallback(
    (id: string): BookBadgeInfo | null => {
      if (mode !== "books" || !baseline || isFiled) return null;
      const field = baseline.fields.find((f) => f.id === id);
      if (!field) return null;
      const edited = !sameAmount(values[id], field.books);
      const line = lineFor(field, lines);
      const owner = clientId || saved?.clientId || "";
      const page = line?.filter.kind === "purchases" ? "expenses" : "sales";
      return {
        text: edited ? editedBadgeText(field.books) : badgeText(line?.records),
        edited,
        href: line && owner ? `/clients/${owner}/${page}` : null,
        title: line
          ? `This page can't be filtered yet. The books counted records dated ${line.filter.from} to ${line.filter.to}` +
            (line.filter.atc ? ` under ${line.filter.atc}` : "") +
            (line.filter.vatClass ? ` with VAT class ${line.filter.vatClass}` : "") +
            (line.filter.inputVATCategory ? ` in ${line.filter.inputVATCategory}` : "") +
            "."
          : null,
        reset: () => reset(id),
      };
    },
    [mode, baseline, isFiled, values, lines, clientId, saved?.clientId, reset],
  );

  const filledOn = useMemo(() => {
    if (!isFiled) return null;
    return readSource(saved?.data)?.asOf ?? null;
  }, [isFiled, saved]);

  return {
    enabled: !isFiled,
    mode,
    fetching,
    error,
    warnings,
    match,
    stale,
    question,
    source,
    filledOn,
    choose,
    refresh: () => void refresh(),
    review,
    answer,
    badge,
  };
}

// AtcPicker — the ATC chooser of the 2307's Part III rows (C8).
//
// The codes come from the seeded BirAtcCode table (GET /bir/atc-codes, the route the
// transaction entry already reads). Block A offers the expanded-withholding codes
// (classification "ewt"); block B offers the business-tax withholding codes the 2307 carries
// (classification "percentage_wt" and "wvat", and only those the table marks for the 2307
// certificate). Nothing is read from the first letters of a code.
//
//   * search by code or by description;
//   * the description and the table rate are shown for reference, and for reference only:
//     the tax withheld is typed, never derived from the rate;
//   * no default: an ATC the preparer has not chosen stays empty, and choosing one fills
//     nothing else on the row;
//   * an ATC saved earlier that is not in the table (typed before this picker) stays shown
//     as it was, with a plain note beside it; it is never removed.
//
// Follows AccountCombobox (the chart-of-accounts picker); the 1701/1702 ATC selector is a
// plain <select> of the choices printed on those forms and does not fit a 100-code table.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBirAtcCodes, type BirAtcCode } from "../../lib/api";
import { cn } from "../ui";

export type Part3Block = "A" | "B";

/** The seeded table, once: every code, every classification (about 250 rows). */
export function useAtcTable() {
  return useQuery({
    queryKey: ["bir-atc-table"],
    queryFn: () => fetchBirAtcCodes(),
    staleTime: 10 * 60 * 1000,
  });
}

/** The codes a block offers, read from the classification (never the letters of the code). */
export function atcOffered(table: BirAtcCode[], block: Part3Block): BirAtcCode[] {
  return table.filter((c) => {
    if (c.status === "repealed") return false;
    if (block === "A") return c.classification === "ewt";
    return (
      (c.classification === "percentage_wt" || c.classification === "wvat") &&
      c.certificate === "2307"
    );
  });
}

/** Matches on code or description: a code that starts with the text first, then the rest. */
export function searchAtc(codes: BirAtcCode[], query: string): BirAtcCode[] {
  const q = query.trim().toLowerCase();
  if (!q) return codes;
  const starts: BirAtcCode[] = [];
  const codeHas: BirAtcCode[] = [];
  const describes: BirAtcCode[] = [];
  for (const c of codes) {
    const code = c.atc.toLowerCase();
    if (code.startsWith(q)) starts.push(c);
    else if (code.includes(q)) codeHas.push(c);
    else if (c.description.toLowerCase().includes(q)) describes.push(c);
  }
  return [...starts, ...codeHas, ...describes];
}

/** The table rate as a percentage ("0.030000" is "3%"); "" when the table has none. */
export function rateText(rate: string | number | null | undefined): string {
  if (rate == null || rate === "") return "";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "";
  return `${String(Number((n * 100).toFixed(4)))}%`;
}

const CLASS_WORDS: Record<string, string> = {
  ewt: "expanded withholding",
  fwt: "final withholding",
  percentage_wt: "percentage-tax withholding",
  wvat: "withholding VAT",
  vat: "VAT",
};

/**
 * The plain note for a saved ATC the block does not offer: not in the table at all, or in
 * the table under a classification this block does not offer. "" when there is nothing to say.
 */
export function savedAtcNote(
  code: string,
  table: BirAtcCode[] | undefined,
  block: Part3Block,
): string {
  const c = code.trim();
  // An empty table is a table not seeded, not a verdict on the code: no note.
  if (!c || !table || table.length === 0) return "";
  const hit = table.find((t) => t.atc === c);
  if (!hit) return `ATC ${c} is not in the BIR ATC table. It is shown as it was saved.`;
  if (atcOffered([hit], block).length === 0 && hit.status !== "repealed") {
    const what = CLASS_WORDS[hit.classification] ?? hit.classification;
    return `ATC ${c} is in the BIR ATC table as a ${what} code, not one offered for block ${block}. It is shown as it was saved.`;
  }
  if (hit.status === "repealed")
    return `ATC ${c} is a repealed code in the BIR ATC table. It is shown as it was saved.`;
  return "";
}

export function AtcPicker({
  label,
  block,
  value,
  onChange,
  table,
  loading,
  failed,
}: {
  /** The accessible name of the field ("ATC, row 1"). */
  label: string;
  block: Part3Block;
  /** The ATC saved on the row; "" while none is chosen. */
  value: string;
  onChange: (code: string) => void;
  /** The whole seeded table, once loaded. */
  table: BirAtcCode[] | undefined;
  loading?: boolean;
  failed?: boolean;
}) {
  const offered = useMemo(() => (table ? atcOffered(table, block) : []), [table, block]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => searchAtc(offered, query), [offered, query]);
  useEffect(() => setActive(0), [query]);

  const chosen = value ? (table?.find((t) => t.atc === value) ?? null) : null;
  const note = savedAtcNote(value, table, block);

  function choose(c: BirAtcCode) {
    onChange(c.atc);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      const pick = matches[active];
      if (pick) {
        e.preventDefault();
        choose(pick);
      }
    }
  }

  const status = failed
    ? "The ATC table could not be loaded."
    : loading
      ? "Loading the ATC table…"
      : "";

  return (
    <div
      ref={wrapRef}
      data-testid="atc-picker"
      className="relative min-w-[11rem]"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
          // Abandoned search text reverts to the saved code; the saved code is never lost.
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        className="input w-full font-mono"
        placeholder="Select ATC…"
        value={open ? query : value}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        // Focus stays on the field after a choice: clicking it again opens the list again.
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <div
          role="listbox"
          aria-label={`${label}: codes`}
          className="absolute left-0 top-[calc(100%+4px)] z-40 max-h-[300px] w-[min(520px,90vw)] overflow-auto rounded-card border border-line-strong bg-card shadow-dropdown"
        >
          {status ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-content-secondary">
              {status}
            </p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-content-secondary">
              {query.trim()
                ? `No ATC matches “${query.trim()}”.`
                : "The ATC table has no codes for this block."}
            </p>
          ) : (
            <div className="p-1.5">
              {value ? (
                <button
                  type="button"
                  data-testid="atc-clear"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange("");
                    setQuery("");
                    setOpen(false);
                  }}
                  className="mb-1 w-full rounded-btn px-2.5 py-1.5 text-left text-[12px] text-content-secondary hover:bg-rowhover"
                >
                  Clear the ATC (leave this row without one)
                </button>
              ) : null}
              {matches.map((c, i) => (
                <button
                  key={c.atc}
                  type="button"
                  role="option"
                  aria-selected={c.atc === value}
                  data-testid="atc-option"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(c)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-btn px-2.5 py-2 text-left transition-colors",
                    i === active ? "bg-rowhover" : "hover:bg-rowhover",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[12.5px] font-semibold text-navy">
                      {c.atc}
                      {c.status === "legacy" ? (
                        <span className="ml-2 font-sans text-[10.5px] font-normal uppercase tracking-wide text-content-muted">
                          legacy
                        </span>
                      ) : null}
                    </span>
                    <span className="block text-[12px] text-content-secondary">
                      {c.description}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[11px] text-content-muted">
                    {rateText(c.rate) || "no rate"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {chosen && !note ? (
        <p
          data-testid="atc-reference"
          className="mt-1 text-[11.5px] text-content-secondary"
        >
          {chosen.description}
          {rateText(chosen.rate)
            ? ` · table rate ${rateText(chosen.rate)} (for reference; the tax withheld is typed)`
            : ""}
        </p>
      ) : null}
      {note ? (
        <p data-testid="atc-note" className="mt-1 text-[11.5px] text-content-secondary">
          {note}
        </p>
      ) : null}
    </div>
  );
}

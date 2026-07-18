import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./ui";
import type { ChartAccount } from "../lib/api";

/** Rank matches: name starts-with, then name contains, then code match. */
function searchAccounts(accounts: ChartAccount[], query: string): ChartAccount[] {
  const q = query.trim().toLowerCase();
  if (!q) return accounts;
  const starts: ChartAccount[] = [];
  const contains: ChartAccount[] = [];
  const byCode: ChartAccount[] = [];
  for (const a of accounts) {
    const name = a.name.toLowerCase();
    if (name.startsWith(q)) starts.push(a);
    else if (name.includes(q)) contains.push(a);
    else if (a.code.includes(q)) byCode.push(a);
  }
  return [...starts, ...contains, ...byCode];
}

/**
 * Type-to-search Chart-of-Accounts picker. The user searches by ACCOUNT NAME
 * (or code) and picks from the dropdown; the selection is always a real chart
 * account — free text is never submitted. Cleared text clears the selection.
 */
export function AccountCombobox({
  accounts,
  value,
  onSelect,
  disabled,
  placeholder = "Type an account name…",
  className,
}: {
  accounts: ChartAccount[];
  /** Selected account code ("" = none). */
  value: string;
  onSelect: (code: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const selected = useMemo(
    () => accounts.find((a) => a.code === value) ?? null,
    [accounts, value],
  );
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => searchAccounts(accounts, query), [accounts, query]);
  useEffect(() => setActive(0), [query]);

  const display = open ? query : selected ? selected.name : "";

  function choose(a: ChartAccount) {
    onSelect(a.code);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
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
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div
      ref={wrapRef}
      className={cn("relative", className)}
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) {
          // Abandoned search text reverts to the current selection; clearing
          // happens in onChange the moment the user empties the field.
          setOpen(false);
          setQuery("");
        }
      }}
    >
      <input
        value={display}
        disabled={disabled}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value.trim() === "" && selected) onSelect("");
        }}
        onKeyDown={onKeyDown}
        placeholder={selected ? selected.name : placeholder}
        autoComplete="off"
        className={cn("input", disabled && "opacity-60")}
      />

      {open && !disabled && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-40 max-h-[280px] w-full min-w-[300px] overflow-auto rounded-card border border-line-strong bg-card shadow-dropdown">
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-content-secondary">
              No matching account in the chart.
            </p>
          ) : (
            <div className="p-1.5">
              {matches.map((a, i) => (
                <button
                  key={a.code}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(a)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-btn px-2.5 py-2 text-left transition-colors",
                    i === active ? "bg-rowhover" : "hover:bg-rowhover",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-navy">
                      {a.name}
                    </span>
                    <span className="block truncate text-[11.5px] text-content-secondary">
                      {a.class}
                      {a.parentName ? ` · ${a.parentName}` : ""}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[11px] text-content-muted">
                    {a.code}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

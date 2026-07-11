import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./ui";
import {
  loadPhLocations,
  searchLocations,
  type PhLocation,
} from "../lib/phLocations";

/**
 * Type-to-search city / municipality picker over the full Philippine dataset.
 * The user can free-type any value (the field is not locked to the list), but
 * picking a suggestion fires `onSelect` with the matched row so the parent can
 * auto-fill province, region and ZIP. The dataset lazy-loads on first focus.
 */
export function CityCombobox({
  value,
  onChange,
  onSelect,
  error,
}: {
  value: string;
  onChange: (city: string) => void;
  onSelect: (loc: PhLocation) => void;
  error?: boolean;
}) {
  const [all, setAll] = useState<PhLocation[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Load the dataset once, the first time the field is interacted with.
  function ensureLoaded() {
    if (!all) void loadPhLocations().then(setAll);
  }

  const matches = useMemo(
    () => (all ? searchLocations(all, value) : []),
    [all, value],
  );
  useEffect(() => setActive(0), [value]);

  function choose(loc: PhLocation) {
    onSelect(loc);
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
      className="relative"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <input
        value={value}
        onFocus={() => {
          ensureLoaded();
          setOpen(true);
        }}
        onChange={(e) => {
          ensureLoaded();
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Start typing a city or municipality…"
        autoComplete="off"
        aria-invalid={error || undefined}
        className={cn("input", error && "border-danger")}
      />

      {open && value.trim() !== "" && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-40 max-h-[280px] w-full overflow-auto rounded-card border border-line-strong bg-card shadow-dropdown">
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-content-secondary">
              {all ? "No matching city — you can keep your typed value." : "Loading cities…"}
            </p>
          ) : (
            <div className="p-1.5">
              {matches.map((m, i) => (
                <button
                  key={`${m.city}|${m.province}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(m)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-btn px-2.5 py-2 text-left transition-colors",
                    i === active ? "bg-rowhover" : "hover:bg-rowhover",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-navy">
                      {m.city}
                    </span>
                    <span className="block truncate text-[11.5px] text-content-secondary">
                      {m.province} · {m.region}
                    </span>
                  </span>
                  <span className="flex-none font-mono text-[11px] text-content-muted">
                    {m.zip || "—"}
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

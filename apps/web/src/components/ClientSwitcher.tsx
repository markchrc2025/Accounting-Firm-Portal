import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { fetchClients } from "../lib/api";
import { cn, RegimeChip } from "./ui";

/**
 * Top-bar client switcher (design handoff). Shows the active client and opens a
 * searchable dropdown of the firm's clients; selecting one navigates to that
 * client's workspace (`/clients/:id`), which reveals the Client Workspace nav.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function ClientSwitcher({ activeClientId }: { activeClientId: string | null }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data: clients } = useQuery({ queryKey: ["clients"], queryFn: fetchClients });

  const active = clients?.find((c) => c.id === activeClientId);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = clients ?? [];
    if (!q) return list;
    return list.filter(
      (c) => c.businessName.toLowerCase().includes(q) || (c.tin ?? "").toLowerCase().includes(q),
    );
  }, [clients, query]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 rounded-btn border border-line-input bg-card px-3 py-1.5 text-left transition-colors hover:border-navy"
      >
        <span className="font-mono text-[9.5px] uppercase tracking-[.18em] text-gold-deep">
          Client
        </span>
        <span className="text-[13.5px] font-semibold text-navy">
          {active ? active.businessName : "Select client"}
        </span>
        {active?.taxType ? <RegimeChip regime={active.taxType} /> : null}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" className="text-content-muted" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-40 w-[340px] rounded-card border border-line-strong bg-card shadow-dropdown">
          <div className="border-b border-line p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search clients by name or TIN…"
              className="w-full rounded-input border border-line-input bg-paper px-3 py-2 text-[13px] focus-visible:bg-card focus-visible:outline-none"
            />
          </div>
          <div className="max-h-[320px] overflow-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-content-secondary">
                No clients match.
              </p>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setOpen(false);
                    setQuery("");
                    navigate(`/clients/${c.id}`);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-btn px-2.5 py-2 text-left transition-colors hover:bg-rowhover",
                    c.id === activeClientId && "bg-rowhover",
                  )}
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy font-mono text-[10px] font-semibold text-gold-soft">
                    {initials(c.businessName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-navy">
                      {c.businessName}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-content-secondary">
                      {c.tin ?? "—"}
                    </span>
                  </span>
                  {c.taxType ? <RegimeChip regime={c.taxType} /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

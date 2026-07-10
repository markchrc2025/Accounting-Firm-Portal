import * as React from "react";
import { ChevronDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RegimeChip,
} from "@/components/ui";
import { api } from "@/mock";
import { cn, initials } from "@/lib/utils";
import { useSession } from "@/session";

/**
 * Firm-mode client switcher. The trigger shows the active client + regime; the
 * 340px dropdown offers a search box and client rows (initials tile, name, mono
 * TIN, regime chip). Selecting a client re-contextualizes the whole Client
 * Workspace via `setActiveClient`.
 */
export function ClientSwitcher(): React.JSX.Element {
  const { activeClient, activeClientId, regime, setActiveClient } = useSession();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: () => api.listClients(),
  });

  const query = search.trim().toLowerCase();
  const filtered = query
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.tin.toLowerCase().includes(query),
      )
    : clients;

  const handlePick = (id: string) => {
    setActiveClient(id);
    setOpen(false);
    setSearch("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Switch client"
          className="flex items-center gap-2.5 rounded-btn border border-line-strong bg-paper px-3 py-[7px] transition-colors hover:border-line-input"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-gold-deep">
            CLIENT
          </span>
          <span className="text-[13.5px] font-semibold text-navy">
            {activeClient?.name ?? "Select client"}
          </span>
          {regime ? <RegimeChip regime={regime} /> : null}
          <ChevronDown className="h-3.5 w-3.5 text-content-secondary" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[340px] p-2">
        <Input
          autoFocus
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-1.5 py-2 text-[13.5px]"
          aria-label="Search clients"
        />
        <div className="max-h-[360px] overflow-auto">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-[13px] text-content-muted">
              No clients found.
            </div>
          ) : (
            filtered.map((c) => {
              const selected = c.id === activeClientId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handlePick(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-btn px-2.5 py-2.5 text-left transition-colors hover:bg-paper",
                    selected && "bg-paper",
                  )}
                >
                  <span className="flex h-7 w-7 flex-none items-center justify-center rounded-[6px] bg-navy text-[11px] font-bold text-gold-soft">
                    {initials(c.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-content">
                      {c.name}
                    </span>
                    <span className="block font-mono text-[11px] text-content-muted">
                      TIN {c.tin}
                    </span>
                  </span>
                  <RegimeChip regime={c.regime} />
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

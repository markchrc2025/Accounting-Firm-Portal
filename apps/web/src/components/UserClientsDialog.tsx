// UserClientsDialog — give a firm user their clients (W8 R1, D14, D42).
//
// The checklist is the firm's clients as the viewer sees them (GET /clients),
// pre-ticked from GET /users/:id/clients. Save sends the whole ticked list to
// POST /users/:id/assign-clients, which replaces the user's assignments.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  assignUserClients,
  fetchClients,
  fetchUserClients,
  type FirmUserSummary,
} from "../lib/api";
import { matchesClientSearch } from "../lib/userClients";
import { Button } from "./ui";

const NO_CLIENTS_QUESTION = "Save with no clients? This user will see no clients.";

export function UserClientsDialog({
  user,
  onClose,
}: {
  user: FirmUserSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const clients = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  const assigned = useQuery({
    queryKey: ["user-clients", user.id],
    queryFn: () => fetchUserClients(user.id),
  });
  /** The ticked client ids; null until the user's assignments have loaded. */
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [search, setSearch] = useState("");
  const [askEmpty, setAskEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = `user-clients-${user.id}`;

  const current =
    ticked ?? (assigned.data ? new Set(assigned.data.clients.map((c) => c.id)) : null);
  const shown = useMemo(
    () => (clients.data ?? []).filter((c) => matchesClientSearch(c, search)),
    [clients.data, search],
  );

  const save = useMutation({
    mutationFn: (ids: string[]) => assignUserClients(user.id, ids),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.removeQueries({ queryKey: ["user-clients", user.id] });
      onClose();
    },
    onError: (e) => {
      setAskEmpty(false);
      setError(e instanceof ApiError ? e.message : "The clients could not be saved.");
    },
  });

  function update(next: Set<string>) {
    setTicked(next);
    setAskEmpty(false);
    setError(null);
  }
  function toggle(id: string, on: boolean) {
    if (!current) return;
    const next = new Set(current);
    if (on) next.add(id);
    else next.delete(id);
    update(next);
  }
  function onSave() {
    if (!current) return;
    if (current.size === 0 && !askEmpty) {
      setAskEmpty(true);
      return;
    }
    setError(null);
    save.mutate([...current]);
  }

  const loading = clients.isPending || assigned.isPending;
  const loadError = clients.isError || assigned.isError;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={() => {
        if (!save.isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-card border border-line bg-card shadow-xl"
      >
        <div className="border-b border-line bg-sidebar px-6 py-5">
          <h2 id={titleId} className="font-serif text-[18px] font-medium text-navy">
            Clients for {user.fullName}
          </h2>
          <p className="mt-1 text-[12.5px] text-content-secondary">
            This user sees only the clients ticked here — their sales, expenses, billings,
            BIR forms, financial statements and COR files.
          </p>
        </div>

        <div className="space-y-3 px-6 py-4">
          <input
            type="search"
            aria-label="Search clients"
            placeholder="Search by name or TIN"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!current || shown.length === 0}
              onClick={() => {
                if (!current) return;
                const next = new Set(current);
                shown.forEach((c) => next.add(c.id));
                update(next);
              }}
            >
              Select all shown
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!current || current.size === 0}
              onClick={() => update(new Set())}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto border-y border-line-divider px-6">
          {loading ? (
            <p className="py-6 text-center text-[13px] text-content-secondary">
              Loading clients…
            </p>
          ) : loadError || !current ? (
            <p role="alert" className="py-6 text-center text-[13px] text-danger-ink">
              The clients could not be loaded.
            </p>
          ) : shown.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-content-secondary">
              No client matches the search.
            </p>
          ) : (
            <ul className="divide-y divide-line-divider">
              {shown.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={current.has(c.id)}
                      onChange={(e) => toggle(c.id, e.target.checked)}
                    />
                    <span className="min-w-0 flex-1 text-[13px] text-content">
                      {c.businessName}
                    </span>
                    <span className="font-mono text-[11.5px] text-content-secondary">
                      {c.tin ?? ""}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error ? (
          <p
            role="alert"
            className="mx-6 mt-4 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
          >
            {error}
          </p>
        ) : null}

        {askEmpty ? (
          <div className="mx-6 mt-4 rounded-input border border-gold/50 bg-warn-bg-2 px-3.5 py-3 text-[12.5px] text-content">
            <p>{NO_CLIENTS_QUESTION}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={() => setAskEmpty(false)}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={save.isPending} onClick={onSave}>
                {save.isPending ? "Saving…" : "Save with no clients"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex justify-end gap-2 px-6 py-4">
          {askEmpty ? null : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={save.isPending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button size="sm" disabled={!current || save.isPending} onClick={onSave}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

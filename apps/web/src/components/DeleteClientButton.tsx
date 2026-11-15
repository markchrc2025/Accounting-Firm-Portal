// DeleteClientButton - W26: "Delete client" for a client entered by mistake or twice (Track A
// U25, D72). Only for someone who holds Clients:Delete. It asks inside the page, never in a
// browser dialog: first the API's delete-check, then either every blocker sentence word for word
// (and no delete button), or what will be deleted and what will be kept, and the client's name to
// type. The API's 400, 409 and 404 sentences show word for word in the dialog. After a delete:
// the Clients list with "Client deleted.", every cached query for the client gone, and the
// switcher back to "Select client" if it was this client.

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, type ClientSummary } from "../lib/api";
import {
  ACTIVE_CLIENT_KEY,
  CANNOT_UNDO,
  DELETED_NOTE,
  deleteClient,
  deleteLine,
  FILES_NOT_REMOVED_NOTE,
  fetchClientDeleteCheck,
  nameMatches,
  unlinkLine,
} from "../lib/clientDelete";
import { Button, cn } from "./ui";

const sentenceOf = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : fallback;

export function DeleteClientButton({
  clientId,
  clientName,
  variant = "button",
}: {
  clientId: string;
  clientName: string;
  /** "button" on the client page; "link" in the Clients list's row actions. */
  variant?: "button" | "link";
}) {
  const { hasPermission } = useAuth();
  const [asking, setAsking] = useState(false);
  if (!hasPermission("Clients:Delete")) return null;
  return (
    <>
      {variant === "link" ? (
        <button
          type="button"
          data-delete-client={clientId}
          onClick={() => setAsking(true)}
          className="text-[12.5px] font-semibold text-danger-ink hover:underline"
        >
          Delete
        </button>
      ) : (
        <Button
          variant="ghost"
          data-delete-client={clientId}
          className="text-danger-ink hover:bg-danger-bg"
          onClick={() => setAsking(true)}
        >
          Delete client
        </Button>
      )}
      {asking ? (
        <DeleteClientDialog
          clientId={clientId}
          clientName={clientName}
          onClose={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}

function DeleteClientDialog({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const boxId = useId();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const check = useQuery({
    queryKey: ["client-delete-check", clientId],
    queryFn: () => fetchClientDeleteCheck(clientId),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const remove = useMutation({
    mutationFn: () => deleteClient(clientId, typed),
    onSettled: () => {
      busy.current = false;
    },
    onSuccess: (r) => {
      // Gone at once everywhere: every query that names the client, and the client lists.
      qc.setQueryData<ClientSummary[]>(["clients"], (list) =>
        list ? list.filter((c) => c.id !== clientId) : list,
      );
      qc.removeQueries({ predicate: (q) => q.queryKey.includes(clientId) });
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      try {
        if (window.localStorage.getItem(ACTIVE_CLIENT_KEY) === clientId)
          window.localStorage.removeItem(ACTIVE_CLIENT_KEY);
      } catch {
        /* the switcher works without it */
      }
      const notice =
        r.filesNotRemoved.length > 0
          ? `${DELETED_NOTE} ${FILES_NOT_REMOVED_NOTE}`
          : DELETED_NOTE;
      navigate("/clients", { state: { notice } });
    },
    onError: (e) => setError(sentenceOf(e, "Could not delete this client.")),
  });

  // Escape closes, as a browser dialog's Cancel would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !remove.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, remove.isPending]);

  const c = check.data;
  const matches = !!c && nameMatches(typed, c.nameToType);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={() => {
        if (!remove.isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-delete-client-dialog
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-card border border-line bg-card shadow-xl"
      >
        <p id={titleId} className="px-6 pb-2 pt-5 text-[14px] font-medium text-content">
          Delete {clientName}?
        </p>
        <div className="space-y-3 px-6 pb-1 text-[13px] text-content">
          {check.isPending ? (
            <p className="text-content-secondary">Checking what this client holds…</p>
          ) : check.isError ? (
            <p
              role="alert"
              className="rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
            >
              {sentenceOf(check.error, "Could not check this client.")}
            </p>
          ) : !c!.canDelete ? (
            <ul data-delete-blockers className="space-y-2">
              {c!.blockers.map((b) => (
                <li
                  key={b.kind}
                  data-blocker={b.kind}
                  className="rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
                >
                  {b.sentence}
                </li>
              ))}
            </ul>
          ) : (
            <>
              {c!.willDelete.length > 0 ? (
                <div data-will-delete>
                  <p className="mb-1 font-semibold">This deletes, with the client:</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {c!.willDelete.map((k) => (
                      <li key={k.kind} data-delete-kind={k.kind}>
                        {deleteLine(k.kind, k.count)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p data-will-delete>The client holds no records; only the client goes.</p>
              )}
              {c!.willUnlink.length > 0 ? (
                <div data-will-unlink>
                  <p className="mb-1 font-semibold">This keeps:</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {c!.willUnlink.map((k) => (
                      <li key={k.kind} data-unlink-kind={k.kind}>
                        {unlinkLine(k.kind, k.count)}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div>
                <label htmlFor={boxId} className="block font-semibold">
                  {CANNOT_UNDO}
                </label>
                <p data-name-to-type className="mt-1 font-mono text-[13px] text-navy">
                  {c!.nameToType}
                </p>
                <input
                  id={boxId}
                  className="input mt-1.5 w-full"
                  autoComplete="off"
                  value={typed}
                  disabled={remove.isPending}
                  onChange={(e) => {
                    setTyped(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            </>
          )}
          {error ? (
            <p
              role="alert"
              data-delete-error
              className="rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
            >
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={onClose}
          >
            {c && !c.canDelete ? "Close" : "Keep it"}
          </Button>
          {c?.canDelete ? (
            <Button
              variant="danger"
              size="sm"
              className={cn(!matches && "opacity-60")}
              disabled={!matches || remove.isPending}
              onClick={() => {
                if (busy.current) return;
                busy.current = true;
                setError(null);
                remove.mutate();
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete client"}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

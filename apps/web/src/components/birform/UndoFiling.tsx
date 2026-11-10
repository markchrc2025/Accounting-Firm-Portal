// UndoFiling — take back a filing made WITHOUT the BIR confirmation email (W22, Track A
// U22), and the History a return keeps of the filings taken back. The button is a Super
// Admin's, on the confirmation card of an override filing only. The API checks everything
// and its sentences show as sent; the browser works out nothing.

import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  fetchBirForms,
  fetchUsers,
  undoBirFormFiling,
  type BirFormDetail,
} from "../../lib/api";
import { useOptionalAuth } from "../../auth/AuthContext";
import { receivedText } from "../../lib/birConfirmation";
import {
  hasAmendmentIn,
  offersUndo,
  UNDO_FILING_TEXT,
  UNDO_REASON_MIN_LENGTH,
} from "../../lib/undoFiling";
import { Button, Card, CardContent } from "../ui";

/** "Undo filing" with its window. Renders nothing when it is not offered. */
export function UndoFilingControl({
  detail,
  superAdmin,
}: {
  detail: BirFormDetail;
  superAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Whether an amendment names this return: the client's list says (amendsId). Only
  // asked for the one case where the button could show.
  const eligible = superAdmin && detail.confirmation?.kind === "override";
  const list = useQuery({
    queryKey: ["bir-forms", "amendments", detail.clientId],
    queryFn: () => fetchBirForms({ clientId: detail.clientId }),
    enabled: eligible && detail.status === "filed",
    staleTime: 0,
  });
  const amended = list.isPending ? undefined : hasAmendmentIn(list.data, detail.id);
  // Not known yet: nothing flashes. If the list failed, the API will refuse in words.
  if (list.isPending && list.fetchStatus !== "idle") return null;
  if (!offersUndo(detail, superAdmin, amended)) return null;
  return (
    <>
      <div>
        <Button
          variant="outline"
          size="sm"
          data-undo-filing
          onClick={() => setOpen(true)}
        >
          Undo filing
        </Button>
      </div>
      {open ? (
        <UndoFilingDialog
          detail={detail}
          onClose={() => setOpen(false)}
          onDone={(draft) => {
            setOpen(false);
            qc.setQueryData(["bir-form", draft.id], draft);
            void qc.invalidateQueries({ queryKey: ["bir-form", draft.id] });
            void qc.invalidateQueries({ queryKey: ["bir-forms"] });
          }}
        />
      ) : null}
    </>
  );
}

function UndoFilingDialog({
  detail,
  onClose,
  onDone,
}: {
  detail: BirFormDetail;
  onClose: () => void;
  onDone: (draft: BirFormDetail) => void;
}) {
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One click, one request.
  const busy = useRef(false);
  const undo = useMutation({
    mutationFn: () => undoBirFormFiling(detail.id, reason),
    onSuccess: onDone,
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not undo the filing."),
    onSettled: () => {
      busy.current = false;
    },
  });
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={() => {
        if (!undo.isPending) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !undo.isPending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-undo-dialog
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-card shadow-xl"
      >
        <p id={titleId} className="px-6 pb-1 pt-5 text-[14px] font-medium text-content">
          Undo filing
        </p>
        <p data-undo-text className="px-6 pb-2 text-[13px] text-content-secondary">
          {UNDO_FILING_TEXT}
        </p>
        <div className="space-y-2 px-6 py-2">
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold text-content">
              Reason for undoing the filing
            </span>
            <textarea
              className="input w-full"
              rows={3}
              autoFocus
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setError(null);
              }}
            />
          </label>
          <p
            data-reason-counter
            className="text-right font-mono text-[11.5px] text-content-secondary"
          >
            {reason.trim().length} / {UNDO_REASON_MIN_LENGTH}
          </p>
        </div>
        {error ? (
          <p
            role="alert"
            data-undo-error
            className="mx-6 mt-1 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button variant="outline" size="sm" disabled={undo.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={undo.isPending}
            onClick={() => {
              if (busy.current) return;
              busy.current = true;
              setError(null);
              undo.mutate();
            }}
          >
            {undo.isPending ? "Undoing…" : "Undo filing"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Who undid it: the name when the caller may read the firm's users, else the id. */
function WhoLine({ userId }: { userId: string | null }) {
  const mayReadUsers = useOptionalAuth()?.hasPermission("Users:Read") ?? false;
  const users = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: !!userId && mayReadUsers,
  });
  if (!userId) return null;
  return <>{users.data?.find((u) => u.id === userId)?.fullName ?? userId}</>;
}

/** The filings taken back, oldest first. Shown on the draft and on the return filed again. */
export function FilingHistory({ detail }: { detail: BirFormDetail }) {
  const undos = detail.filingUndos ?? [];
  if (undos.length === 0) return null;
  return (
    <Card data-filing-history className="mt-6">
      <CardContent className="space-y-3">
        <div className="eyebrow">History</div>
        <ul className="space-y-3">
          {undos.map((u) => (
            <li key={u.id} data-filing-undo className="space-y-0.5 text-[12.5px]">
              <div className="text-content">
                Filed <span data-undo-filed-at>{receivedText(u.filedAt)}</span>
                {" · "}undone <span data-undo-undone-at>{receivedText(u.undoneAt)}</span>
                {u.undoneByUserId ? (
                  <>
                    {" "}
                    by{" "}
                    <span data-undo-by>
                      <WhoLine userId={u.undoneByUserId} />
                    </span>
                  </>
                ) : null}
              </div>
              <div className="text-content">
                Reason: <span data-undo-reason>{u.reason}</span>
              </div>
              {u.overrideReason ? (
                <div className="text-content-secondary">
                  Filed without the BIR email because:{" "}
                  <span data-undo-override-reason>{u.overrideReason}</span>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ConfirmDialog — an in-app "are you sure?" (W9 R4). The Portal never opens a
// browser confirm: this asks inside the page, names the action on its button,
// and shows the server's refusal where the question was asked.

import { useEffect, useId } from "react";
import { Button } from "./ui";

export function ConfirmDialog({
  question,
  confirmLabel,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  /** The question, e.g. "Delete Sam Cruz? This cannot be undone." */
  question: string;
  /** The confirming button's label, e.g. "Delete". */
  confirmLabel: string;
  busy?: boolean;
  /** The server's message when the action was refused. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  // Escape cancels, as a browser confirm's Cancel would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-card border border-line bg-card shadow-xl"
      >
        <p id={titleId} className="px-6 pb-2 pt-5 text-[14px] font-medium text-content">
          {question}
        </p>
        {error ? (
          <p
            role="alert"
            className="mx-6 mt-2 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
          >
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

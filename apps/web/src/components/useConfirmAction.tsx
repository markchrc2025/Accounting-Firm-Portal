// useConfirmAction — ask in the page before an action (W10 R1). `ask` opens the
// in-app ConfirmDialog; its confirm button runs the action once, and closes the
// dialog when the action succeeds. If the action throws, the server's message
// shows in the dialog and the dialog stays open. Cancel and Escape send nothing.

import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export interface ConfirmRequest {
  /** The question, word for word as the person reads it. */
  question: string;
  /** The confirm button: the action's verb ("Post", "Delete", …). */
  confirmLabel: string;
  /** What runs on confirm; a thrown error's message is shown in the dialog. */
  action: () => Promise<unknown>;
  /** Shown when the action fails without a message of its own. */
  failure?: string;
}

export function useConfirmAction(): {
  ask: (request: ConfirmRequest) => void;
  dialog: ReactNode;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback((next: ConfirmRequest) => {
    setError(null);
    setRequest(next);
  }, []);
  const cancel = useCallback(() => setRequest(null), []);

  const dialog = request ? (
    <ConfirmDialog
      question={request.question}
      confirmLabel={request.confirmLabel}
      busy={busy}
      error={error}
      onCancel={cancel}
      onConfirm={() => {
        setBusy(true);
        setError(null);
        request
          .action()
          .then(() => setRequest(null))
          .catch((e: unknown) =>
            setError(
              e instanceof Error && e.message
                ? e.message
                : (request.failure ?? "That did not work — please try again."),
            ),
          )
          .finally(() => setBusy(false));
      }}
    />
  ) : null;

  return { ask, dialog };
}

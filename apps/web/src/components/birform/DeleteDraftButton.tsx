// DeleteDraftButton — "Delete draft" on a draft the caller may delete (W15 R1,
// Track A U14). It asks in the page, never in a browser dialog; the server's
// 409 or 403 shows word for word in the dialog. On success it goes back to BIR
// Forms with the notice "Draft deleted."

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteBirForm, type BirFormDetail } from "../../lib/api";
import { deleteDraftBody } from "../../lib/birDraft";
import { ConfirmDialog } from "../ConfirmDialog";
import { Button } from "../ui";

export function DeleteDraftButton({ detail }: { detail: BirFormDetail }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A second click can land before `isPending` disables the button; the ref
  // makes sure one confirmation sends one DELETE.
  const busy = useRef(false);
  const remove = useMutation({
    mutationFn: () => deleteBirForm(detail.id),
    onSettled: () => {
      busy.current = false;
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["bir-form", detail.id] });
      void qc.invalidateQueries({ queryKey: ["bir-forms"] });
      navigate("/bir-forms", { state: { notice: "Draft deleted." } });
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not delete this draft."),
  });

  if (!detail.canDelete) return null;
  return (
    <>
      <Button
        variant="ghost"
        className="text-danger-ink hover:bg-danger-bg"
        onClick={() => {
          setError(null);
          setAsking(true);
        }}
      >
        Delete draft
      </Button>
      {asking ? (
        <ConfirmDialog
          question="Delete this draft?"
          detail={deleteDraftBody(detail)}
          confirmLabel="Delete draft"
          cancelLabel="Keep it"
          busy={remove.isPending}
          error={error}
          onConfirm={() => {
            if (busy.current) return;
            busy.current = true;
            setError(null);
            remove.mutate();
          }}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </>
  );
}

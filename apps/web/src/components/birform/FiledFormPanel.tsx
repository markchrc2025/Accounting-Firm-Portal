// FiledFormPanel.tsx — the filed state every BIR editor shares (W3).
//
// A filed form is sealed (R1). The editors render it read-only; these pieces
// say so and offer the one correction path each kind of form has (R2):
//   - the seven returns: "Amend" — POST /bir-forms/:id/amend opens a new draft;
//   - the 2307 and 2316 certificates: "Issue a corrected certificate" — a NEW
//     certificate for the same client, pre-filled from this one, with no link
//     to it; this one stays issued.

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { amendBirForm, ApiError, type BirFormDetail } from "../../lib/api";
import { filedBannerTitle, isCertificate } from "../../lib/birFiling";
import { Button } from "../ui";

/** The green banner a filed form shows: "Filed on …" or "Issued on …". */
export function FiledBanner({
  form,
  filedAt,
  children,
}: {
  form: string;
  filedAt: string | null | undefined;
  children?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="rounded-card border border-success/40 bg-success-bg px-3.5 py-2.5 text-[12.5px] text-content"
    >
      <div className="font-semibold">{filedBannerTitle(form, filedAt)}</div>
      {children ? <div className="mt-0.5">{children}</div> : null}
      <div className="mt-1 text-content-secondary">
        {isCertificate(form)
          ? "Issued certificates are sealed and cannot be changed. To correct one, issue a corrected certificate; this one stays issued."
          : "Filed returns are sealed and cannot be changed. To correct this one, amend it."}
      </div>
    </div>
  );
}

/**
 * The correction action for a filed form: "Amend" on a return, "Issue a
 * corrected certificate" on a certificate. Errors from the server are shown as
 * it sent them.
 */
export function FiledFormAction({ detail }: { detail: BirFormDetail }) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // A second click can land before `isPending` disables the button; the ref
  // makes sure one Amend sends one POST.
  const busy = useRef(false);
  const amend = useMutation({
    mutationFn: () => amendBirForm(detail.id),
    onSettled: () => {
      busy.current = false;
    },
    onSuccess: (draft) => {
      setError(null);
      navigate(`/bir-forms/${draft.id}`);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not amend this form."),
  });

  if (isCertificate(detail.form)) {
    return (
      <Button
        variant="outline"
        onClick={() =>
          navigate(
            `/bir-forms/new?form=${encodeURIComponent(detail.form)}&correctFrom=${encodeURIComponent(detail.id)}`,
          )
        }
      >
        Issue a corrected certificate
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="outline"
        disabled={amend.isPending}
        onClick={() => {
          if (busy.current) return;
          busy.current = true;
          amend.mutate();
        }}
      >
        {amend.isPending ? "Amending…" : "Amend"}
      </Button>
      {error ? (
        <p role="alert" className="text-[12px] text-danger-ink">
          {error}
        </p>
      ) : null}
    </>
  );
}

// BirConfirmation — the BIR's eBIRForms confirmation email, as the web handles it (W18,
// Track A U18): the Mark as filed dialog (check the PDF, read it back, file with it), the
// card a filed return shows, and "Attach confirmation" for one filed before. The API reads
// and checks the PDF; the browser only sends the file and shows what the API says, every
// message word for word. It never opens or parses the PDF itself.

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  attachBirConfirmation,
  checkConfirmation,
  fetchBirConfirmationUrl,
  fetchUsers,
  markBirFormFiled,
  type BirFormConfirmation,
  type BirFormDetail,
  type ConfirmationCheckResult,
} from "../../lib/api";
import { useOptionalAuth } from "../../auth/AuthContext";
import { downloadFromUrl } from "../../lib/download";
import {
  canConfirm,
  CHECK_MARK,
  CHECK_NAMES,
  CHECK_WORD,
  DIALOG_TITLE,
  OVERRIDE_MIN_LENGTH,
  periodText,
  receivedText,
  whenText,
  type ConfirmationMode,
} from "../../lib/birConfirmation";
import { Button, Card, CardContent, Chip, cn } from "../ui";

/** Super Admin only: the Claude connector's page is gated the same way (only the Super
 *  Admin role holds IntegrationClient:Update). The API refuses anyone else in words. */
function useIsSuperAdmin(): boolean {
  return useOptionalAuth()?.hasPermission("IntegrationClient:Update") ?? false;
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

export function ConfirmationDialog({
  detail,
  mode,
  onClose,
  onDone,
}: {
  detail: BirFormDetail;
  mode: ConfirmationMode;
  onClose: () => void;
  onDone: (filed: BirFormDetail) => void;
}) {
  const titleId = useId();
  const superAdmin = useIsSuperAdmin();
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<File | null>(null);
  const [result, setResult] = useState<ConfirmationCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  // One click, one request.
  const busy = useRef(false);

  const check = useMutation({
    mutationFn: (f: File) => checkConfirmation(detail.id, f),
    onSuccess: (r, f) => {
      setResult(r);
      setChecked(f);
      setError(null);
    },
    onError: (e) =>
      setError(e instanceof ApiError ? e.message : "Could not check the confirmation."),
    onSettled: () => {
      busy.current = false;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === "mark") {
        return override
          ? markBirFormFiled(detail.id, { overrideReason: reason })
          : markBirFormFiled(detail.id, { file });
      }
      return attachBirConfirmation(detail.id, {
        file: file!,
        replace: mode === "replace",
      });
    },
    onSuccess: (filed) => onDone(filed),
    onError: (e) => {
      setError(e instanceof ApiError ? e.message : "Could not save the confirmation.");
      // A refused Mark as filed carries the checks it made: show them.
      const body =
        e instanceof ApiError
          ? (e.body as Partial<ConfirmationCheckResult> | undefined)
          : undefined;
      if (body && Array.isArray(body.checks)) {
        setResult(body as ConfirmationCheckResult);
      }
    },
    onSettled: () => {
      busy.current = false;
    },
  });

  // Escape closes, as the other dialogs do (not while a request is on its way).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !check.isPending && !submit.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [check.isPending, submit.isPending, onClose]);

  const pending = check.isPending || submit.isPending;
  const ready = canConfirm(result, checked, file);
  const confirmLabel = DIALOG_TITLE[mode];

  function choose(f: File | null) {
    setFile(f);
    // A different file is a different check.
    setResult(null);
    setChecked(null);
    setError(null);
  }

  function runCheck() {
    if (!file || busy.current) return;
    busy.current = true;
    setError(null);
    check.mutate(file);
  }
  function runSubmit() {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    submit.mutate();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-confirmation-dialog={mode}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-card border border-line bg-card shadow-xl"
      >
        <p id={titleId} className="px-6 pb-1 pt-5 text-[14px] font-medium text-content">
          {DIALOG_TITLE[mode]}
        </p>

        {override ? (
          <div className="space-y-2 px-6 py-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-content">
                Reason for filing without the BIR email
              </span>
              <textarea
                className="input w-full"
                rows={3}
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
              {reason.trim().length} / {OVERRIDE_MIN_LENGTH}
            </p>
          </div>
        ) : (
          <div className="space-y-3 px-6 py-3">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-content">
                BIR confirmation email (PDF)
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="block w-full text-[13px] text-content"
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
              />
            </label>
            <p className="text-[12px] text-content-secondary">
              Print the BIR&apos;s confirmation email to PDF from Gmail and upload it
              here.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!file || pending}
              onClick={runCheck}
            >
              {check.isPending ? "Checking…" : "Check"}
            </Button>
            {result ? <CheckReadBack result={result} /> : null}
          </div>
        )}

        {error ? (
          <p
            role="alert"
            data-confirmation-error
            className="mx-6 mt-1 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
          >
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4">
          <div>
            {mode === "mark" && superAdmin ? (
              <button
                type="button"
                data-override-link
                className="text-[12.5px] text-blue underline-offset-2 hover:underline"
                onClick={() => {
                  setOverride((o) => !o);
                  setError(null);
                }}
              >
                {override ? "Use the BIR email" : "File without the BIR email"}
              </button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pending || (override ? reason.trim() === "" : !ready)}
              onClick={runSubmit}
            >
              {submit.isPending ? "Saving…" : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** What the API read of the file, and each check with its own message. */
function CheckReadBack({ result }: { result: ConfirmationCheckResult }) {
  const p = result.parsed;
  return (
    <div data-check-result={result.ok ? "ok" : "failed"} className="space-y-3">
      {p ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-input bg-sidebar px-3.5 py-2.5 text-[12.5px]">
          <dt className="text-content-secondary">BIR file name</dt>
          <dd data-read="file-name" className="break-all font-mono text-content">
            {p.birFileName}
          </dd>
          <dt className="text-content-secondary">Form</dt>
          <dd data-read="form" className="text-content">
            {p.form}
          </dd>
          <dt className="text-content-secondary">Period</dt>
          <dd data-read="period" className="text-content">
            {periodText(p)}
          </dd>
          <dt className="text-content-secondary">Received by the BIR</dt>
          <dd data-read="received" className="text-content">
            {receivedText(p.receivedAt)}
          </dd>
        </dl>
      ) : null}
      <ul className="space-y-1.5">
        {result.checks.map((c) => (
          <li
            key={c.id}
            data-check={c.id}
            data-status={c.status}
            className="flex items-start gap-2 text-[12.5px]"
          >
            <span
              aria-label={CHECK_WORD[c.status]}
              className={cn(
                "mt-0.5 w-4 shrink-0 text-center font-semibold",
                c.status === "ok" && "text-success",
                c.status === "error" && "text-danger-ink",
                c.status === "warning" && "text-gold-deep",
                c.status === "skipped" && "text-content-muted",
              )}
            >
              {CHECK_MARK[c.status]}
            </span>
            <span className="min-w-0">
              <span className="font-semibold text-content">{CHECK_NAMES[c.id]}</span>
              {c.status === "skipped" ? (
                <span className="ml-2 text-content-muted">skipped</span>
              ) : null}
              {c.message ? (
                <span data-check-message className="block text-content-secondary">
                  {c.message}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mark as filed
// ---------------------------------------------------------------------------

/**
 * "Mark as filed". For a return that needs the BIR's confirmation (the API says so,
 * `confirmationRequired`) it opens the dialog and never calls PATCH; every other form
 * files exactly as it did, through `onPlain`.
 */
export function MarkAsFiledButton({
  detail,
  disabled,
  pending,
  onPlain,
}: {
  detail: BirFormDetail;
  disabled: boolean;
  /** The plain PATCH's request is on its way. */
  pending: boolean;
  /** The old route: PATCH status filed (1601-C, 2307, 2316). */
  onPlain: () => void;
}) {
  const [open, setOpen] = useState(false);
  const done = useConfirmationDone();
  if (!detail.confirmationRequired) {
    return (
      <Button variant="outline" disabled={disabled} onClick={onPlain}>
        {pending ? "Marking…" : "Mark as filed"}
      </Button>
    );
  }
  return (
    <>
      <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        Mark as filed
      </Button>
      {open ? (
        <ConfirmationDialog
          detail={detail}
          mode="mark"
          onClose={() => setOpen(false)}
          onDone={(filed) => {
            setOpen(false);
            done(filed);
          }}
        />
      ) : null}
    </>
  );
}

/** What happens after the API files or attaches: the editor re-reads the return. */
function useConfirmationDone() {
  const qc = useQueryClient();
  return (filed: BirFormDetail) => {
    qc.setQueryData(["bir-form", filed.id], filed);
    void qc.invalidateQueries({ queryKey: ["bir-form", filed.id] });
    void qc.invalidateQueries({ queryKey: ["bir-forms"] });
  };
}

// ---------------------------------------------------------------------------
// The card on a filed return
// ---------------------------------------------------------------------------

/** Who uploaded it: the name, when the caller may read the firm's users; otherwise no name. */
function useUploaderName(userId: string | null): string | null {
  const mayReadUsers = useOptionalAuth()?.hasPermission("Users:Read") ?? false;
  const users = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: !!userId && mayReadUsers,
  });
  return users.data?.find((u) => u.id === userId)?.fullName ?? null;
}

function UploadedLine({ c }: { c: BirFormConfirmation }) {
  const who = useUploaderName(c.uploadedByUserId);
  return (
    <div data-uploaded className="text-[12px] text-content-secondary">
      Uploaded {who ? `by ${who} ` : ""}on {whenText(c.uploadedAt)}
    </div>
  );
}

/**
 * The BIR confirmation of a filed return: for an email, when the BIR received it, its
 * file name, who uploaded it and when, its warnings, and a link to the PDF; for an
 * override, that it was filed without one, and why. A Super Admin can replace it. A
 * return filed before there were confirmations says so and offers "Attach confirmation".
 * Shown only for the nine returns that need one.
 */
export function ConfirmationCard({ detail }: { detail: BirFormDetail }) {
  const superAdmin = useIsSuperAdmin();
  const done = useConfirmationDone();
  const [dialog, setDialog] = useState<"attach" | "replace" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  if (detail.status !== "filed" || !detail.confirmationRequired) return null;
  const c = detail.confirmation ?? null;

  async function viewPdf() {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const { url } = await fetchBirConfirmationUrl(detail.id);
      downloadFromUrl(
        url,
        `${(c?.birFileName ?? "confirmation").replace(/\.xml$/i, "")}-BIR-confirmation.pdf`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not open the confirmation.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <Card data-confirmation-card={c ? c.kind : "none"}>
      <CardContent className="space-y-2">
        <div className="eyebrow">BIR confirmation</div>
        {c === null ? (
          <>
            <p data-no-confirmation className="text-[13px] text-content">
              No BIR confirmation attached
            </p>
            <Button variant="outline" size="sm" onClick={() => setDialog("attach")}>
              Attach confirmation
            </Button>
          </>
        ) : c.kind === "override" ? (
          <>
            <div>
              <Chip variant="gold">Filed without BIR confirmation</Chip>
            </div>
            <p data-override-reason className="text-[13px] text-content">
              {c.overrideReason}
            </p>
            <UploadedLine c={c} />
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="text-content-secondary">Received by the BIR</dt>
              <dd data-received className="text-content">
                {receivedText(c.receivedAt)}
              </dd>
              <dt className="text-content-secondary">BIR file name</dt>
              <dd data-bir-file-name className="break-all font-mono text-content">
                {c.birFileName}
              </dd>
            </dl>
            <UploadedLine c={c} />
            {c.warnings.length > 0 ? (
              <ul
                data-confirmation-warnings
                className="list-disc space-y-0.5 pl-5 text-[12px] text-content-secondary"
              >
                {c.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
            {c.hasFile ? (
              <button
                type="button"
                data-view-pdf
                disabled={opening}
                className="text-[12.5px] text-blue underline-offset-2 hover:underline"
                onClick={() => void viewPdf()}
              >
                View PDF
              </button>
            ) : null}
          </>
        )}
        {c !== null && superAdmin ? (
          <div>
            <Button variant="outline" size="sm" onClick={() => setDialog("replace")}>
              Replace
            </Button>
          </div>
        ) : null}
        {error ? (
          <p
            role="alert"
            data-confirmation-card-error
            className="text-[12px] text-danger-ink"
          >
            {error}
          </p>
        ) : null}
      </CardContent>
      {dialog ? (
        <ConfirmationDialog
          detail={detail}
          mode={dialog}
          onClose={() => setDialog(null)}
          onDone={(filed) => {
            setDialog(null);
            done(filed);
          }}
        />
      ) : null}
    </Card>
  );
}

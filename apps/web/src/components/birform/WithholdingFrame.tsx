// WithholdingFrame — the page the 0619-E, 1601-EQ and 1601-C editors share (W17): the
// header, the server's messages word for word, the filer and period card, the
// computed read-outs, and the buttons. The three are PRINTED, not exported: there is
// no "Export eBIRForms XML". "Preview PDF" on a draft and "Download clear copy" on a
// filed return are always offered; until the print maps land the server answers 409
// with a sentence, which shows as it is.

import type { ReactNode } from "react";
import { Button, Card, CardContent, ErrorState, PageHeader, Skeleton } from "../ui";
import type { ClientSummary } from "../../lib/api";
import {
  FORM_NAME,
  FORM_TITLE,
  periodOptions,
  sixRowsSentence,
} from "../../lib/withholding";
import { DeleteDraftButton } from "./DeleteDraftButton";
import { ExportListItem, ClearCopyButton } from "./ClearCopyButton";
import { FiledBanner, FiledFormAction } from "./FiledFormPanel";
import { MarkAsFiledButton } from "./BirConfirmation";
import { PreviewPdfButton } from "./PreviewPdfButton";
import {
  BookFiledLine,
  BookProvider,
  BookQuestionDialog,
  BookSwitch,
} from "./BookFigures";
import type { WithholdingDraft } from "./useWithholdingDraft";

export function WithholdingFrame({
  draft,
  children,
  summary,
  aboveForm,
}: {
  draft: WithholdingDraft;
  /** The cards of the return, under the filer and period card. */
  children: ReactNode;
  /** The computed read-outs. */
  summary: ReactNode;
  /** A note over the whole form (the 1601-C's). */
  aboveForm?: ReactNode;
}) {
  const { form, existing, isNew, id, isFiled, books, tooManyRows } = draft;
  const title = FORM_TITLE[form];

  if (!isNew && existing.isPending) {
    return (
      <div className="animate-fade-rise space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (!isNew && existing.isError) {
    return (
      <ErrorState
        message="Could not load this form."
        onRetry={() => void existing.refetch()}
      />
    );
  }

  const detail = existing.data;
  const filedAt = detail?.filedAt ?? null;
  const subLabel = form === "1601EQ" ? "Quarter" : "Month";

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title={isNew ? `New ${title.code}` : title.code}
        eyebrow={title.eyebrow}
        description={draft.amendment}
        actions={
          <Button variant="ghost" onClick={() => draft.navigate("/bir-forms")}>
            Back
          </Button>
        }
      />

      {draft.error ? (
        <div
          role="alert"
          data-form-error
          className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink"
        >
          {draft.error}
        </div>
      ) : null}

      {aboveForm}
      {draft.booked ? (
        <>
          <BookFiledLine books={books} />
        </>
      ) : null}

      <BookProvider value={books}>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <fieldset disabled={isFiled} className="min-w-0 space-y-6">
            {/* Filer + period */}
            <Card>
              <CardContent className="space-y-4">
                {draft.booked ? <BookSwitch books={books} /> : null}
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block sm:col-span-1">
                    <span className="mb-1.5 block text-[13px] font-semibold text-content">
                      Client
                    </span>
                    <select
                      className="input w-full"
                      value={draft.clientId}
                      disabled={!isNew}
                      onChange={(e) => draft.setClientId(e.target.value)}
                    >
                      <option value="">Select client…</option>
                      {draft.clients.map((cl: ClientSummary) => (
                        <option key={cl.id} value={cl.id}>
                          {cl.businessName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-content">
                      Year
                    </span>
                    <input
                      className="input w-full font-mono"
                      value={draft.year}
                      onChange={(e) =>
                        draft.setYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                      }
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-semibold text-content">
                      {subLabel}
                    </span>
                    <select
                      className="input w-full"
                      value={draft.sub}
                      onChange={(e) => draft.setSub(e.target.value)}
                    >
                      {periodOptions(form).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="text-[11.5px] text-content-secondary">{FORM_NAME[form]}</p>
              </CardContent>
            </Card>

            {children}
          </fieldset>

          {/* Computed + actions */}
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-2.5">
                <div className="eyebrow mb-1">Computed (authoritative)</div>
                {summary}
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              {isFiled ? null : (
                <Button
                  disabled={
                    !draft.clientId || draft.save.isPending || draft.setStatus.isPending
                  }
                  onClick={() => draft.save.mutate()}
                >
                  {draft.save.isPending
                    ? "Saving…"
                    : isNew
                      ? "Save draft"
                      : "Save changes"}
                </Button>
              )}
              {draft.needsAmendedSave ? (
                <p className="text-center text-[11.5px] text-content-muted">
                  Save this amendment first: saving records it as an amended return.
                  Filing waits until then.
                </p>
              ) : null}
              {isNew ? (
                <p className="text-center text-[11.5px] text-content-muted">
                  Save the draft to preview it.
                </p>
              ) : null}
              {/* Printed, not exported: a preview of the draft; a clear copy once filed. */}
              {!isNew && !isFiled ? (
                <PreviewPdfButton
                  formId={id!}
                  dirty={draft.dirty}
                  save={() => draft.save.mutateAsync()}
                  blockedReason={
                    tooManyRows ? sixRowsSentence(draft.rowCount) : undefined
                  }
                />
              ) : null}
              {!isNew ? (
                isFiled && detail ? (
                  <>
                    <ClearCopyButton formId={id!} disabled={tooManyRows} />
                    <FiledFormAction detail={{ ...detail, clearCopyAvailable: false }} />
                  </>
                ) : (
                  <MarkAsFiledButton
                    detail={detail!}
                    disabled={
                      draft.setStatus.isPending ||
                      draft.save.isPending ||
                      existing.isFetching ||
                      draft.needsAmendedSave ||
                      tooManyRows
                    }
                    pending={draft.setStatus.isPending}
                    onPlain={() => draft.setStatus.mutate("filed")}
                  />
                )
              ) : null}
              {detail ? <DeleteDraftButton detail={detail} /> : null}
            </div>

            {isFiled ? <FiledBanner form={form} filedAt={filedAt} /> : null}

            {!isNew && detail && detail.exports.length > 0 ? (
              <Card>
                <CardContent>
                  <div className="eyebrow mb-2">Exports</div>
                  <ul className="space-y-1.5">
                    {detail.exports.map((e) => (
                      <ExportListItem key={e.id} item={e} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>
      </BookProvider>
      <BookQuestionDialog books={books} />
    </div>
  );
}

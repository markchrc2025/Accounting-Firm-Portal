// AlphalistPanel — the 1601-EQ's alphalist (the BIR's QAP .DAT file) (W19, Track A U19).
// The API makes the file from the posted expenses and repeats the BIR Validation
// program's rules first; this panel only asks it, shows what it says word for word, and
// downloads the file under the name it gives. It works out nothing itself. The file must
// still be validated in the BIR Alphalist Validation program before eSubmission.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  downloadAlphalist,
  fetchAlphalistCheck,
  type AlphalistCheck,
  type BirFormDetail,
} from "../../lib/api";
import { canDownload, showsSchedule2, VALIDATE_NOTE } from "../../lib/alphalist";
import { downloadBlob } from "../../lib/download";
import { Button, Card, CardContent, peso } from "../ui";

/** The refusals the API sent with a 409, if it sent them. */
function refusalsOf(e: unknown): string[] {
  const r = (e as { body?: { refusals?: unknown } } | undefined)?.body?.refusals;
  return Array.isArray(r) ? r.map(String) : [];
}

export function AlphalistPanel({ detail }: { detail: BirFormDetail }) {
  const check = useQuery({
    queryKey: ["bir-alphalist-check", detail.id],
    queryFn: () => fetchAlphalistCheck(detail.id),
    // The owner fixes expenses in another tab: ask again when he comes back.
    staleTime: 0,
    refetchOnMount: "always",
  });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; refusals: string[] } | null>(
    null,
  );

  async function download(c: AlphalistCheck) {
    if (busy || !c.fileName) return;
    setBusy(true);
    setProblem(null);
    try {
      const blob = await downloadAlphalist(detail.id);
      downloadBlob(blob, c.fileName);
    } catch (e) {
      setProblem({
        message: e instanceof ApiError ? e.message : "Could not make the alphalist.",
        refusals: refusalsOf(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const c = check.data;
  const filed = detail.status === "filed";
  return (
    <Card data-alphalist-panel={c?.source ?? "loading"}>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Alphalist (.DAT)</div>
          <Button
            variant="outline"
            size="sm"
            disabled={check.isFetching}
            onClick={() => void check.refetch()}
          >
            {check.isFetching ? "Checking…" : "Refresh"}
          </Button>
        </div>

        {check.isError ? (
          <p role="alert" data-alphalist-error className="text-[12.5px] text-danger-ink">
            {check.error instanceof ApiError
              ? check.error.message
              : "Could not check the alphalist."}
          </p>
        ) : null}

        {c ? (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
              <dt className="text-content-secondary">Schedule 1</dt>
              <dd data-schedule1 className="text-content">
                {c.schedule1.rows} rows · income{" "}
                <span className="font-mono">{peso(c.schedule1.income)}</span> · tax{" "}
                <span className="font-mono">{peso(c.schedule1.tax)}</span>
              </dd>
              <dt className="text-content-secondary">Item 19</dt>
              <dd data-item19 className="font-mono text-content">
                {peso(c.returnTotal)}
              </dd>
              {showsSchedule2(c) ? (
                <>
                  <dt className="text-content-secondary">Schedule 2</dt>
                  <dd data-schedule2 className="text-content">
                    {c.schedule2.rows} rows · income{" "}
                    <span className="font-mono">{peso(c.schedule2.income)}</span>
                  </dd>
                </>
              ) : null}
            </dl>

            {c.notes.length > 0 ? (
              <ul
                data-alphalist-notes
                className="list-disc space-y-0.5 pl-5 text-[12px] text-content-secondary"
              >
                {c.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}

            {c.refusals.length > 0 ? (
              <ul
                role="alert"
                data-alphalist-refusals
                className="list-disc space-y-0.5 rounded-input border border-danger/40 bg-danger-bg py-2.5 pl-8 pr-3.5 text-[12.5px] text-danger-ink"
              >
                {c.refusals.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}

            {/* A filed return with no stored rows has nothing to download: its refusal says so. */}
            {c.source === "none" && filed ? null : (
              <div className="space-y-1.5">
                <Button
                  disabled={!canDownload(c) || busy}
                  onClick={() => void download(c)}
                >
                  {busy ? "Preparing…" : "Download alphalist (.DAT)"}
                </Button>
                <p data-validate-note className="text-[11.5px] text-content-secondary">
                  {VALIDATE_NOTE}
                </p>
              </div>
            )}
          </>
        ) : null}

        {problem ? (
          <div
            role="alert"
            data-alphalist-download-error
            className="space-y-1 text-[12.5px] text-danger-ink"
          >
            <p>{problem.message}</p>
            {problem.refusals.length > 1 ? (
              <ul className="list-disc pl-5">
                {problem.refusals.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** After filing: the alphalist could not be stored, and why (the API's own words). */
export function AlphalistWarning({ detail }: { detail: BirFormDetail }) {
  const w = detail.alphalist?.warning;
  if (!w) return null;
  return (
    <div
      role="alert"
      data-alphalist-warning
      className="rounded-card border border-warn/40 bg-warn-bg-2 px-4 py-3 text-[12.5px] text-content"
    >
      <p className="font-semibold">{w.message}</p>
      {w.refusals.length > 0 ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {w.refusals.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

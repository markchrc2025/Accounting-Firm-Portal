// ReceiptScansPage — /receipt-scans (W12 R1–R4): send a pile of receipt photos
// with its cost shown first, and see the piles. Reading happens on the server
// (Track A U11); nothing reaches the books until a person approves (W13).

import { useMemo, useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  AiStatusStrip,
  ScanAccess,
  ScanStatusChip,
} from "../components/ReceiptScanParts";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { fetchClients } from "../lib/api";
import { permittedFor } from "../lib/permissions";
import {
  ACCEPTED_FILES,
  defaultScanPeriod,
  estimateCounts,
  estimateSentence,
  fetchAiEstimate,
  fetchAiStatus,
  fetchReceiptScans,
  localRefusal,
  noFitSentence,
  phpFromUsd,
  sendReceiptScan,
  usd,
  type ReceiptScanSummary,
} from "../lib/receiptScans";

export default function ReceiptScansPage() {
  return (
    <ScanAccess>
      <div className="animate-fade-rise">
        <PageHeader
          title="Scan receipts"
          eyebrow="EXPENSES · AI READING"
          description="Send a pile of receipt photos. AI reads them at half price and the rows come back here for review; nothing reaches the books until a person approves."
        />
        <AiStatusStrip />
        <UploadPanel />
        <PilesList />
      </div>
    </ScanAccess>
  );
}

const labelCls =
  "mb-1 block font-mono text-[10px] uppercase tracking-[.14em] text-content-muted";

/** R3: client, period, the photos, the cost first, then Send. */
function UploadPanel() {
  const { permissions } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const statusQ = useQuery({ queryKey: ["ai-status"], queryFn: fetchAiStatus });
  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: fetchClients });
  // The user's clients: those they may add expenses to.
  const clients = useMemo(
    () =>
      (clientsQ.data ?? []).filter((c) =>
        permittedFor(permissions, "Expenses:Create", c.id),
      ),
    [clientsQ.data, permissions],
  );

  const wanted = params.get("clientId") ?? "";
  const [chosenClient, setChosenClient] = useState<string | null>(null);
  const clientId = chosenClient ?? (clients.some((c) => c.id === wanted) ? wanted : "");
  const [period, setPeriod] = useState(() => defaultScanPeriod());
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const status = statusQ.data;
  const off = !status || !status.configured || !status.enabled;
  const refusal = files.length ? localRefusal(files) : null;
  const counts = estimateCounts(files);
  const estimateQ = useQuery({
    queryKey: ["ai-estimate", counts.images, counts.pdfs],
    queryFn: () => fetchAiEstimate(counts.images, counts.pdfs),
    enabled: files.length > 0 && !refusal && !off,
  });
  const estimate = estimateQ.data;

  const send = useMutation({
    mutationFn: () =>
      sendReceiptScan({ clientId, periodFrom: period.from, periodTo: period.to, files }),
    onSuccess: (scan) => {
      void qc.invalidateQueries({ queryKey: ["receipt-scans"] });
      void qc.invalidateQueries({ queryKey: ["ai-status"] });
      navigate(`/receipt-scans/${scan.id}`);
    },
    onError: (e: Error) => setError(e.message),
  });

  const choose = (list: FileList | null) => {
    setError(null);
    setFiles(list ? Array.from(list) : []);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!off) choose(e.dataTransfer.files);
  };

  const canSend =
    !off &&
    !!clientId &&
    !!period.from &&
    !!period.to &&
    files.length > 0 &&
    !refusal &&
    !!estimate?.fits &&
    !send.isPending;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Send a pile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={labelCls} htmlFor="scan-client">
              Client
            </label>
            <select
              id="scan-client"
              className="input min-w-[240px]"
              value={clientId}
              disabled={off}
              onChange={(e) => setChosenClient(e.target.value)}
            >
              <option value="">Choose a client</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="scan-from">
              From
            </label>
            <input
              id="scan-from"
              type="date"
              className="input"
              value={period.from}
              disabled={off}
              onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="scan-to">
              To
            </label>
            <input
              id="scan-to"
              type="date"
              className="input"
              value={period.to}
              disabled={off}
              onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
            />
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!off) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "rounded-card border-2 border-dashed px-5 py-6 text-center text-[13px]",
            off
              ? "border-line-divider bg-sidebar text-content-muted"
              : dragging
                ? "border-navy bg-warn-bg-2 text-navy"
                : "border-line-strong bg-card text-content-secondary",
          )}
        >
          <p>
            Drop receipt photos here: JPEG, PNG, WebP, PDF or HEIC, up to 100 files of 10
            MB each.
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_FILES}
            aria-label="Receipt photos"
            className="sr-only"
            disabled={off}
            onChange={(e) => {
              choose(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={off}
            onClick={() => inputRef.current?.click()}
          >
            Choose photos
          </Button>
          {files.length ? (
            <p className="mt-2 text-content">
              {files.length} {files.length === 1 ? "file" : "files"} chosen.{" "}
              <button
                type="button"
                className="text-blue underline-offset-2 hover:underline"
                onClick={() => choose(null)}
              >
                Clear
              </button>
            </p>
          ) : null}
        </div>

        {refusal ? (
          <p
            data-scan-refusal
            role="alert"
            className="rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
          >
            {refusal}
          </p>
        ) : null}
        {estimate && status ? (
          <p data-scan-estimate className="text-[13px] text-content">
            {estimateSentence(estimate, files.length, status.usdToPhp)}
          </p>
        ) : estimateQ.isError ? (
          <p role="alert" className="text-[12.5px] text-danger-ink">
            {(estimateQ.error as Error).message}
          </p>
        ) : null}
        {estimate && status && !estimate.fits ? (
          <p data-scan-nofit className="text-[13px] font-semibold text-warn">
            {noFitSentence(estimate, status.usdToPhp)}
          </p>
        ) : null}
        {error ? (
          <p
            data-scan-error
            role="alert"
            className="rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[12.5px] text-danger-ink"
          >
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button disabled={!canSend} onClick={() => send.mutate()}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const MANILA_DATE_TIME = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
  timeStyle: "short",
});

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : MANILA_DATE_TIME.format(d);
}

/** R4: the piles, newest first; polled every 60 s while any is reading. */
function PilesList() {
  const statusQ = useQuery({ queryKey: ["ai-status"], queryFn: fetchAiStatus });
  const scansQ = useQuery({
    queryKey: ["receipt-scans"],
    queryFn: fetchReceiptScans,
    refetchInterval: (q) =>
      q.state.data?.some((s) => s.status === "reading") ? 60_000 : false,
  });
  const rate = statusQ.data?.usdToPhp;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Piles</CardTitle>
      </CardHeader>
      {scansQ.isError ? (
        <ErrorState
          message="Could not load the piles."
          onRetry={() => void scansQ.refetch()}
        />
      ) : scansQ.isPending ? (
        <CardContent className="space-y-3">
          <Skeleton />
          <Skeleton className="w-3/4" />
        </CardContent>
      ) : scansQ.data.length === 0 ? (
        <EmptyState title="No piles yet" description="Piles you send appear here." />
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full min-w-[760px] text-left text-[13px]"
            aria-label="Piles"
          >
            <thead className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
              <tr>
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-3 py-2.5 font-semibold">Period</th>
                <th className="px-3 py-2.5 text-right font-semibold">Files</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                <th className="px-5 py-2.5 font-semibold">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider align-top">
              {scansQ.data.map((s) => (
                <PileRow key={s.id} scan={s} rate={rate} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PileRow({ scan: s, rate }: { scan: ReceiptScanSummary; rate?: number }) {
  // Cost: estimated while reading, actual once ready.
  const actual = s.actualUsd;
  return (
    <tr data-scan-id={s.id} className="hover:bg-rowhover">
      <td className="px-5 py-3">
        <Link
          to={`/receipt-scans/${s.id}`}
          className="font-semibold text-navy hover:underline"
        >
          {s.clientName}
        </Link>
      </td>
      <td className="px-3 py-3 font-mono text-[12px] text-content-secondary">
        {s.periodFrom} – {s.periodTo}
      </td>
      <td className="px-3 py-3 text-right font-mono tabular-nums">{s.fileCount}</td>
      <td className="px-3 py-3">
        <ScanStatusChip status={s.status} />
        {s.problem ? (
          <p className="mt-1 max-w-[280px] text-[12px] text-danger-ink">{s.problem}</p>
        ) : null}
      </td>
      <td data-scan-cost className="px-3 py-3 text-right">
        {actual !== null ? (
          <>
            <div className="font-mono tabular-nums">
              {rate !== undefined ? phpFromUsd(actual, rate) : null}
            </div>
            <div className="font-mono text-[11px] text-content-muted">{usd(actual)}</div>
          </>
        ) : (
          <>
            <div className="font-mono tabular-nums">
              {rate !== undefined ? `About ${phpFromUsd(s.estimatedUsd, rate)}` : null}
            </div>
            <div className="font-mono text-[11px] text-content-muted">
              {usd(s.estimatedUsd)} estimated
            </div>
          </>
        )}
      </td>
      <td className="px-5 py-3 text-[12.5px] text-content-secondary">
        {s.createdByName}
        <div className="text-[11.5px] text-content-muted">{when(s.createdAt)}</div>
      </td>
    </tr>
  );
}

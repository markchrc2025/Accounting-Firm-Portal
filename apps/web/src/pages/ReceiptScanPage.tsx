// ReceiptScanPage — /receipt-scans/:id (W12 R5): review each receipt beside its
// photo, READ-ONLY. Every field the AI doubts is outlined in amber with its
// reason; each row's chip says what approving would do, with the import's own
// messages. Editing, approving and discarding come in W13.

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  AiStatusStrip,
  PhotoViewer,
  ScanAccess,
  ScanStatusChip,
} from "../components/ReceiptScanParts";
import {
  Button,
  Card,
  CardContent,
  Chip,
  cn,
  ErrorState,
  PageHeader,
  peso,
  Skeleton,
  type ChipVariant,
} from "../components/ui";
import {
  cellText,
  checkLabel,
  COLUMN_GROUPS,
  fetchReceiptScan,
  fileProblem,
  fileResultLabel,
  isInProgress,
  type CheckOutcome,
  type ReceiptScanDetail,
  type ScanFile,
  type ScanRow,
} from "../lib/receiptScans";

export default function ReceiptScanPage() {
  return (
    <ScanAccess>
      <Review />
    </ScanAccess>
  );
}

function Review() {
  const { id = "" } = useParams();
  const scanQ = useQuery({
    queryKey: ["receipt-scan", id],
    queryFn: () => fetchReceiptScan(id),
    enabled: !!id,
    // While the pile is preparing or being read, look again every 60 seconds.
    refetchInterval: (q) =>
      q.state.data && isInProgress(q.state.data.scan.status) ? 60_000 : false,
  });

  const back = (
    <Link
      to="/receipt-scans"
      className="text-[13px] text-blue underline-offset-2 hover:underline"
    >
      ← All piles
    </Link>
  );

  if (scanQ.isError) {
    return (
      <div className="animate-fade-rise space-y-4">
        {back}
        <Card>
          <ErrorState
            message="Could not load this pile."
            onRetry={() => void scanQ.refetch()}
          />
        </Card>
      </div>
    );
  }
  if (scanQ.isPending) {
    return (
      <div className="animate-fade-rise space-y-4">
        {back}
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <ReviewBody detail={scanQ.data} back={back} />;
}

function ReviewBody({ detail, back }: { detail: ReceiptScanDetail; back: ReactNode }) {
  const { scan, files, totals } = detail;
  const [index, setIndex] = useState(0);
  const at = Math.min(index, Math.max(0, files.length - 1));
  const file = files[at];

  // ← and → move between files, unless the reader is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "ArrowRight") setIndex((i) => Math.min(files.length - 1, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files.length]);

  return (
    <div className="animate-fade-rise">
      <div className="mb-3">{back}</div>
      <PageHeader
        title="Review receipts"
        eyebrow="SCAN RECEIPTS · READ-ONLY"
        description={`${scan.clientName} · ${scan.periodFrom} – ${scan.periodTo}`}
        actions={<ScanStatusChip status={scan.status} />}
      />
      <AiStatusStrip />
      {scan.problem ? (
        <p
          role="alert"
          className="mb-4 rounded-input border border-danger/40 bg-danger-bg px-4 py-2.5 text-[12.5px] text-danger-ink"
        >
          {scan.problem}
        </p>
      ) : null}

      <div
        data-scan-totals
        className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-card border border-line-strong bg-sidebar px-5 py-3 text-[13px]"
      >
        <Total name="files" label="Files" value={totals.files} />
        <Total name="rows" label="Rows" value={totals.rows} />
        <Total
          name="posted"
          label="Will post"
          value={totals.posted}
          className="text-success"
        />
        <Total
          name="held"
          label="Will be held"
          value={totals.held}
          className="text-warn"
        />
        <Total
          name="rejected"
          label="Will be rejected"
          value={totals.rejected}
          className="text-danger-ink"
        />
        <span className="ml-auto">
          Gross{" "}
          <span data-total="gross" className="font-mono font-semibold">
            {peso(totals.grossAmount)}
          </span>
        </span>
      </div>

      {files.length === 0 || !file ? (
        <Card>
          <CardContent>
            <p className="text-[13px] text-content-secondary">
              {scan.status === "preparing"
                ? "Preparing…"
                : scan.status === "reading"
                  ? "Still reading."
                  : "This pile has no files."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
          <nav aria-label="Files" className="space-y-1">
            {files.map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === at ? "true" : undefined}
                className={cn(
                  "block w-full rounded-btn px-3 py-2 text-left text-[12.5px] transition-colors",
                  i === at
                    ? "border-l-[3px] border-gold bg-warn-bg-2 font-semibold text-navy"
                    : "text-content-secondary hover:bg-rowhover",
                )}
              >
                <span className="block truncate">{f.name}</span>
                <span className="block text-[11px] font-normal text-content-muted">
                  {fileResultLabel(f)}
                </span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={at === 0}
                onClick={() => setIndex(at - 1)}
              >
                Previous
              </Button>
              <div className="min-w-0 text-center">
                <h2
                  data-file-name
                  className="truncate font-serif text-[16px] font-semibold text-navy"
                >
                  {file.name}
                </h2>
                <div className="font-mono text-[11px] text-content-muted">
                  File {at + 1} of {files.length}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={at >= files.length - 1}
                onClick={() => setIndex(at + 1)}
              >
                Next
              </Button>
            </div>
            <PhotoViewer key={file.id} file={file} />
          </div>

          <div className="min-w-0 space-y-4">
            <FileRows file={file} />
          </div>
        </div>
      )}
    </div>
  );
}

function Total({
  name,
  label,
  value,
  className,
}: {
  name: string;
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <span className={className}>
      <span data-total={name} className="font-semibold">
        {value}
      </span>{" "}
      {label}
    </span>
  );
}

function FileRows({ file }: { file: ScanFile }) {
  const problem = fileProblem(file);
  if (problem !== null) {
    return (
      <Card>
        <CardContent>
          <p data-file-problem className="text-[13px] text-content-secondary">
            {problem}
          </p>
        </CardContent>
      </Card>
    );
  }
  if (file.rows.length === 0) {
    return (
      <Card>
        <CardContent>
          <p className="text-[13px] text-content-secondary">
            No receipts were found in this file.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <>
      {file.rows.map((row, i) => (
        <RowCard key={row.id} row={row} n={i + 1} of={file.rows.length} />
      ))}
    </>
  );
}

const CHECK_CHIP: Record<CheckOutcome, ChipVariant> = {
  posted: "success",
  held: "warn",
  rejected: "danger",
};

function RowCard({ row, n, of }: { row: ScanRow; n: number; of: number }) {
  const doubts = new Map(row.doubts.map((d) => [d.field, d.reason]));
  return (
    <Card data-scan-row>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="font-serif text-[14px] font-semibold text-navy">
          Receipt {n} of {of}
        </span>
        <Chip data-check variant={CHECK_CHIP[row.check.outcome] ?? "neutral"}>
          {checkLabel(row.check.outcome)}
        </Chip>
        {row.check.needsReview ? <Chip variant="gold">Needs review</Chip> : null}
      </div>
      <CardContent className="space-y-4">
        {row.check.messages.length ? (
          <ul
            data-check-messages
            className="list-disc space-y-0.5 pl-5 text-[12.5px] text-content"
          >
            {row.check.messages.map((m, j) => (
              <li key={j}>{m}</li>
            ))}
          </ul>
        ) : null}
        {COLUMN_GROUPS.map((g) => (
          <section key={g.name}>
            <h3 className="eyebrow mb-1.5">{g.name}</h3>
            <dl className="grid gap-2 sm:grid-cols-2">
              {g.columns.map((col) => {
                const reason = doubts.get(col);
                return (
                  <div
                    key={col}
                    data-field={col}
                    data-doubt={reason ? "true" : undefined}
                    className={cn(
                      "rounded-input border px-2.5 py-1.5",
                      reason
                        ? "border-warn bg-warn-bg ring-1 ring-warn"
                        : "border-line-divider",
                    )}
                  >
                    <dt className="font-mono text-[10px] uppercase tracking-[.1em] text-content-muted">
                      {col}
                    </dt>
                    <dd className="break-words text-[13px] text-content">
                      {cellText(col, row.cells[col] ?? null)}
                    </dd>
                    {reason ? (
                      <p
                        data-doubt-reason
                        className="mt-1 text-[12px] font-medium text-warn"
                      >
                        {reason}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}

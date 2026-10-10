// ReceiptScanParts — the pieces both scan-receipt pages share (W12): who may
// open them (R1), the AI status strip (R2), a pile's status chip (R4) and the
// photo viewer (R5).

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  budgetLine,
  fetchAiStatus,
  NOT_CONFIGURED_SENTENCE,
  scanStatusLabel,
  SWITCHED_OFF_SENTENCE,
  WARNING_SENTENCE,
  type ScanFile,
  type ScanStatus,
} from "../lib/receiptScans";
import { Button, Card, Chip, EmptyState, Skeleton, type ChipVariant } from "./ui";

/** R1: firm users who may add expenses; a client principal is sent home. */
export function ScanAccess({ children }: { children: ReactNode }) {
  const { user, hasPermission } = useAuth();
  if (user?.userType === "CLIENT") return <Navigate to="/" replace />;
  if (!hasPermission("Expenses:Create")) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <EmptyState
            title="Scan receipts"
            description="Scanning receipts needs permission to add expenses for at least one client."
          />
        </Card>
      </div>
    );
  }
  return <>{children}</>;
}

/** R2: what is left of this month's AI budget, and whether reading is on. */
export function AiStatusStrip() {
  const statusQ = useQuery({ queryKey: ["ai-status"], queryFn: fetchAiStatus });
  if (statusQ.isPending) {
    return (
      <div className="mb-5">
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (statusQ.isError || !statusQ.data) {
    return (
      <p
        role="alert"
        className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-4 py-2.5 text-[12.5px] text-danger-ink"
      >
        Could not load the AI reading status.
      </p>
    );
  }
  const s = statusQ.data;
  return (
    <div
      data-ai-status
      className="mb-5 space-y-1 rounded-card border border-line-strong bg-card px-5 py-3 text-[13px]"
    >
      <p data-ai-budget className="font-medium text-navy">
        {budgetLine(s)}
      </p>
      {s.warning ? (
        <p data-ai-warning className="font-semibold text-warn">
          {WARNING_SENTENCE}
        </p>
      ) : null}
      {!s.configured ? (
        <p data-ai-off className="text-danger-ink">
          {NOT_CONFIGURED_SENTENCE}
        </p>
      ) : !s.enabled ? (
        <p data-ai-off className="text-danger-ink">
          {SWITCHED_OFF_SENTENCE}
        </p>
      ) : null}
    </div>
  );
}

const STATUS_CHIP: Record<ScanStatus, ChipVariant> = {
  reading: "info",
  ready: "gold",
  failed: "danger",
  approved: "success",
  discarded: "neutral",
};

/** R4: Reading / Ready for review / Failed / Approved / Discarded. */
export function ScanStatusChip({ status }: { status: ScanStatus }) {
  return (
    <Chip data-scan-status variant={STATUS_CHIP[status] ?? "neutral"}>
      {scanStatusLabel(status)}
    </Chip>
  );
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

/**
 * R5: the photo, with zoom in and out, rotate 90° and fit to width. A PDF
 * opens in the browser's own viewer from the same signed URL. Key it by the
 * file's id so each file opens fitted and upright.
 */
export function PhotoViewer({ file }: { file: ScanFile }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [broken, setBroken] = useState(false);

  if (!file.imageUrl) {
    return (
      <p className="rounded-card border border-dashed border-line-strong bg-sidebar px-5 py-10 text-center text-[13px] text-content-secondary">
        The photo is not available.
      </p>
    );
  }

  const isPdf = file.contentType === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    return (
      <div className="space-y-2">
        <iframe
          title={file.name}
          src={file.imageUrl}
          className="h-[70vh] w-full rounded-card border border-line-strong bg-card"
        />
        <a
          href={file.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[12.5px] text-blue underline-offset-2 hover:underline"
        >
          Open the PDF in a new tab
        </a>
      </div>
    );
  }

  const zoomTo = (z: number) =>
    setZoom(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100)));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => zoomTo(zoom - ZOOM_STEP)}>
          Zoom out
        </Button>
        <Button variant="outline" size="sm" onClick={() => zoomTo(zoom + ZOOM_STEP)}>
          Zoom in
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRotation((r) => (r + 90) % 360)}
        >
          Rotate
        </Button>
        <Button variant="outline" size="sm" onClick={() => setZoom(1)}>
          Fit to width
        </Button>
      </div>
      <div className="h-[70vh] overflow-auto rounded-card border border-line-strong bg-sidebar">
        {broken ? (
          <p className="px-5 py-10 text-center text-[13px] text-content-secondary">
            This browser cannot show this photo.{" "}
            <a
              href={file.imageUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue underline-offset-2 hover:underline"
            >
              Open it in a new tab
            </a>
            .
          </p>
        ) : (
          <img
            src={file.imageUrl}
            alt={file.name}
            data-zoom={String(zoom)}
            data-rotation={String(rotation)}
            onError={() => setBroken(true)}
            style={{
              width: `${zoom * 100}%`,
              maxWidth: "none",
              transform: `rotate(${rotation}deg)`,
              transformOrigin: "center center",
            }}
            className="block"
          />
        )}
      </div>
    </div>
  );
}

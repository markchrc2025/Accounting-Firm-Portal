// DriveParts — receipt photos from Google Drive (W15): the Settings card (R3),
// a client's linked folder (R4) and the "From Google Drive" tab of the send
// panel (R5). The Portal reads the folder through a read-only robot account and
// keeps only links; every message from the server is shown word for word.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { fetchClient } from "../lib/api";
import {
  driveCounts,
  driveDefaultTicks,
  driveSendLabel,
  fetchDriveFiles,
  fetchDriveStatus,
  fileSize,
  linkDriveFolder,
  MAX_DRIVE_FILES,
  newFileCount,
  sendDrivePile,
  unlinkDriveFolder,
  type DriveFile,
} from "../lib/drive";
import { estimateSentence, fetchAiEstimate, noFitSentence } from "../lib/receiptScans";
import { Button, Card, CardContent, CardHeader, CardTitle, Chip, Skeleton } from "./ui";

const message = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

// --- R3: the Settings card ----------------------------------------------------

/** "Google Drive" on Settings → Integrations, from GET /drive/status. */
export function GoogleDriveCard() {
  const statusQ = useQuery({ queryKey: ["drive-status"], queryFn: fetchDriveStatus });
  const [copied, setCopied] = useState(false);
  const s = statusQ.data;

  async function copy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure context or permissions).
    }
  }

  return (
    <Card data-drive-card className="mb-6">
      <CardHeader>
        <CardTitle>Google Drive</CardTitle>
        {s ? (
          <Chip variant={s.configured ? "success" : s.problem ? "danger" : "neutral"}>
            {s.configured ? "Connected" : s.problem ? "Needs attention" : "Not set up"}
          </Chip>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {statusQ.isPending ? (
          <Skeleton className="w-2/3" />
        ) : statusQ.isError || !s ? (
          <p role="alert" className="text-danger-ink">
            {message(statusQ.error, "Could not load the Google Drive status.")}
          </p>
        ) : s.configured && s.robotEmail ? (
          <>
            <p data-drive-state className="text-content">
              Connected as {s.robotEmail}. Share each client&apos;s receipts folder with
              this address as Viewer.
            </p>
            <Button variant="outline" size="sm" onClick={() => void copy(s.robotEmail!)}>
              {copied ? "Copied" : "Copy address"}
            </Button>
          </>
        ) : s.problem ? (
          <p data-drive-state className="text-danger-ink">
            {s.problem}
          </p>
        ) : (
          <p data-drive-state className="text-content-secondary">
            Not set up yet. The owner adds GOOGLE_SERVICE_ACCOUNT_JSON to the API service
            in Sliplane.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- R4: a client's linked folder ---------------------------------------------

/** The client's Drive folder on the Scan receipts page: link, change, unlink. */
export function DriveFolderPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const statusQ = useQuery({ queryKey: ["drive-status"], queryFn: fetchDriveStatus });
  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
  });
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["client", clientId] });
    void qc.invalidateQueries({ queryKey: ["drive-files", clientId] });
  };
  const save = useMutation({
    mutationFn: () => linkDriveFolder(clientId, link.trim()),
    onSuccess: () => {
      setError(null);
      setEditing(false);
      setLink("");
      refresh();
    },
    onError: (e) => setError(message(e, "Could not link the folder.")),
  });
  const unlink = useMutation({
    mutationFn: () => unlinkDriveFolder(clientId),
    onSuccess: () => {
      setError(null);
      refresh();
    },
    onError: (e) => setError(message(e, "Could not unlink the folder.")),
  });

  if (statusQ.isPending || clientQ.isPending) {
    return (
      <div data-drive-folder>
        <Skeleton className="h-5 w-64" />
      </div>
    );
  }
  if (!statusQ.data?.configured) {
    return (
      <p data-drive-folder className="text-[13px] text-content-secondary">
        Google Drive isn&apos;t set up yet. See{" "}
        <Link
          to="/settings/integrations"
          className="text-blue underline-offset-2 hover:underline"
        >
          Settings
        </Link>
        .
      </p>
    );
  }

  const folder = clientQ.data?.driveFolder ?? null;
  const errorLine = error ? (
    <p role="alert" className="text-[12.5px] text-danger-ink">
      {error}
    </p>
  ) : null;

  if (editing) {
    return (
      <div data-drive-folder className="space-y-2">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <label className="min-w-[320px] flex-1">
            <span className="mb-1 block font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
              Paste the folder&apos;s link
            </span>
            <input
              className="input w-full"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://drive.google.com/drive/folders/…"
              autoFocus
            />
          </label>
          <Button type="submit" size="sm" disabled={!link.trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setLink("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </form>
        {errorLine}
      </div>
    );
  }

  if (!folder) {
    return (
      <div data-drive-folder className="space-y-2">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Link a Drive folder
        </Button>
        {errorLine}
      </div>
    );
  }

  return (
    <div data-drive-folder className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
          Drive folder
        </span>
        <span className="font-semibold text-navy">{folder.name}</span>
        <a
          href={folder.link}
          target="_blank"
          rel="noreferrer"
          className="text-blue underline-offset-2 hover:underline"
        >
          Open in Drive
        </a>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError(null);
            setEditing(true);
          }}
        >
          Change
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={unlink.isPending}
          onClick={() => {
            setError(null);
            unlink.mutate();
          }}
        >
          {unlink.isPending ? "Unlinking…" : "Unlink"}
        </Button>
      </div>
      {errorLine}
    </div>
  );
}

// --- R5: the "From Google Drive" tab ------------------------------------------

const MANILA_DATE = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  dateStyle: "medium",
});
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : MANILA_DATE.format(d);
};

function DriveRow({
  file,
  ticked,
  onToggle,
}: {
  file: DriveFile;
  ticked: boolean;
  onToggle: () => void;
}) {
  const blocked = file.problem !== null;
  return (
    <li className="flex items-start gap-3 py-2 text-[12.5px]">
      <input
        type="checkbox"
        className="mt-0.5"
        aria-label={file.name}
        checked={ticked}
        disabled={blocked}
        onChange={onToggle}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-content">{file.name}</div>
        <div className="text-[11.5px] text-content-muted">
          {file.path ? <span className="mr-2">{file.path}</span> : null}
          <span className="mr-2">{day(file.modifiedTime)}</span>
          <span>{fileSize(file.bytes)}</span>
        </div>
        {blocked ? (
          <div className="text-[11.5px] text-danger-ink">{file.problem}</div>
        ) : null}
      </div>
    </li>
  );
}

/** The Drive tab: the linked folder's files, ticked, estimated, then sent. */
export function DriveTab({
  clientId,
  period,
  off,
  usdToPhp,
}: {
  clientId: string;
  period: { from: string; to: string };
  /** AI reading is not set up or switched off: nothing can be sent. */
  off: boolean;
  usdToPhp: number | undefined;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const statusQ = useQuery({ queryKey: ["drive-status"], queryFn: fetchDriveStatus });
  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId,
  });
  const configured = !!statusQ.data?.configured;
  const folder = clientQ.data?.driveFolder ?? null;
  const listQ = useQuery({
    queryKey: ["drive-files", clientId],
    queryFn: () => fetchDriveFiles(clientId),
    enabled: !!clientId && configured && !!folder,
  });
  const files = listQ.data?.files ?? [];
  // The person's own ticks, once they change any; until then, the defaults.
  const [own, setOwn] = useState<Set<string> | null>(null);
  const ticked = own ?? driveDefaultTicks(files);
  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOwn(next);
  };
  const n = ticked.size;
  const counts = driveCounts(files, ticked);
  const estimateQ = useQuery({
    queryKey: ["ai-estimate", counts.images, counts.pdfs],
    queryFn: () => fetchAiEstimate(counts.images, counts.pdfs),
    enabled: n > 0 && n <= MAX_DRIVE_FILES && !off,
  });
  const estimate = n > 0 && n <= MAX_DRIVE_FILES ? estimateQ.data : undefined;
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: () =>
      sendDrivePile({
        clientId,
        periodFrom: period.from,
        periodTo: period.to,
        driveFileIds: files
          .filter((f) => ticked.has(f.driveFileId))
          .map((f) => f.driveFileId),
      }),
    onSuccess: (pile) => {
      void qc.invalidateQueries({ queryKey: ["receipt-scans"] });
      void qc.invalidateQueries({ queryKey: ["ai-status"] });
      void qc.invalidateQueries({ queryKey: ["drive-files", clientId] });
      navigate(`/receipt-scans/${pile.id}`);
    },
    onError: (e) => setError(message(e, "The pile was not sent.")),
  });

  if (!clientId) {
    return (
      <p data-drive-tab className="text-[13px] text-content-secondary">
        Choose a client first.
      </p>
    );
  }
  // W15 R4: the client's folder sits at the top of the tab, linked or not.
  const listing =
    statusQ.isPending ||
    clientQ.isPending ||
    !configured ||
    !folder ? null : listQ.isPending ? (
      <Skeleton className="w-2/3" />
    ) : listQ.isError ? (
      <p role="alert" className="text-[12.5px] text-danger-ink">
        {message(listQ.error, "Could not list the Drive folder.")}
      </p>
    ) : (
      renderListing()
    );
  return (
    <div data-drive-tab className="space-y-3">
      <DriveFolderPanel clientId={clientId} />
      {listing}
    </div>
  );

  function renderListing() {
    const fresh = files.filter((f) => !f.alreadyRead);
    const read = files.filter((f) => f.alreadyRead);
    const newCount = newFileCount(files);
    const folderName = listQ.data?.folder?.name ?? folder?.name ?? "";
    const canSend =
      !off &&
      !!period.from &&
      !!period.to &&
      n > 0 &&
      n <= MAX_DRIVE_FILES &&
      !!estimate?.fits &&
      !send.isPending;

    return (
      <div className="space-y-3">
        <p data-drive-header className="text-[13px] font-semibold text-navy">
          {newCount} new {newCount === 1 ? "file" : "files"} in {folderName}
        </p>
        {listQ.data?.truncated ? (
          <p className="text-[12px] text-content-muted">Showing the newest 500 files.</p>
        ) : null}
        <ul className="max-h-[360px] divide-y divide-line-divider overflow-auto rounded-card border border-line-strong px-3">
          {fresh.map((f) => (
            <DriveRow
              key={f.driveFileId}
              file={f}
              ticked={ticked.has(f.driveFileId)}
              onToggle={() => toggle(f.driveFileId)}
            />
          ))}
        </ul>
        {read.length ? (
          <details data-already-read className="text-[12.5px]">
            <summary className="cursor-pointer text-content-secondary">
              Already read ({read.length})
            </summary>
            <ul className="mt-1 divide-y divide-line-divider px-3">
              {read.map((f) => (
                <DriveRow
                  key={f.driveFileId}
                  file={f}
                  ticked={ticked.has(f.driveFileId)}
                  onToggle={() => toggle(f.driveFileId)}
                />
              ))}
            </ul>
          </details>
        ) : null}
        {estimate && usdToPhp !== undefined ? (
          <p data-scan-estimate className="text-[13px] text-content">
            {estimateSentence(estimate, n, usdToPhp)}
          </p>
        ) : null}
        {estimate && usdToPhp !== undefined && !estimate.fits ? (
          <p data-scan-nofit className="text-[13px] font-semibold text-warn">
            {noFitSentence(estimate, usdToPhp)}
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
          <Button
            data-drive-send
            disabled={!canSend}
            onClick={() => {
              setError(null);
              send.mutate();
            }}
          >
            {send.isPending ? "Sending…" : driveSendLabel(n)}
          </Button>
        </div>
      </div>
    );
  }
}

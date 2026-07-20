/**
 * Documents — a firm-level file browser over the object-storage bucket, so
 * every client's stored COR is visible in one place (no per-client digging).
 * Read-only: files are viewed/downloaded via short-lived signed URLs; upload
 * and delete stay on the client form, next to the OCR review flow.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ApiError, fetchStoredFiles, fetchStoredFileUrl, type StoredFile } from "../lib/api";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/** "12.3 KB" / "1.2 MB" — bucket-browser style sizes. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const FileIcon = () => (
  <svg
    width="26"
    height="26"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden="true"
    className="text-gold-deep"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
);

export default function DocumentsPage() {
  const filesQ = useQuery({ queryKey: ["stored-files"], queryFn: fetchStoredFiles });
  const [search, setSearch] = useState("");
  // Key of the row whose signed URL is currently being fetched.
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const files = filesQ.data?.files ?? [];
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return files;
    return files.filter(
      (f) =>
        (f.clientName ?? "").toLowerCase().includes(q) ||
        (f.tin ?? "").toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q),
    );
  }, [files, search]);
  const totalBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  async function openFile(file: StoredFile): Promise<void> {
    setOpenError(null);
    setOpeningKey(file.key);
    try {
      const { url } = await fetchStoredFileUrl(file.key);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setOpenError(
        err instanceof ApiError ? err.message : "Could not open this file — please retry.",
      );
    } finally {
      setOpeningKey(null);
    }
  }

  // Storage-not-configured (503) gets its own explanation, not a generic error.
  const storageOff =
    filesQ.error instanceof ApiError && filesQ.error.status === 503;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Documents"
        eyebrow="Firm admin"
        actions={
          filesQ.data ? (
            <span className="font-mono text-[11.5px] uppercase tracking-[.1em] text-content-secondary">
              {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalBytes)}
            </span>
          ) : undefined
        }
      />

      <div className="mb-4 max-w-md">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client, TIN, or object key…"
          aria-label="Search documents"
          className="input w-full"
        />
      </div>

      {openError ? (
        <div className="mb-4 rounded-card border border-danger/30 bg-danger-bg px-4 py-3 text-[12.5px] text-danger-ink">
          {openError}
        </div>
      ) : null}

      {filesQ.isPending ? (
        <Card className="p-6">
          <div className="space-y-3.5">
            <Skeleton className="h-5 w-48" />
            <Skeleton />
            <Skeleton className="w-5/6" />
            <Skeleton className="w-2/3" />
          </div>
        </Card>
      ) : filesQ.isError ? (
        <Card>
          {storageOff ? (
            <EmptyState
              title="File storage is not configured"
              description="Set the S3 storage variables (endpoint, bucket, access key, secret) on the API service to enable the document browser."
            />
          ) : (
            <ErrorState
              message="Could not load the firm's documents."
              onRetry={() => void filesQ.refetch()}
            />
          )}
        </Card>
      ) : files.length === 0 ? (
        <Card>
          <EmptyState
            title="No documents yet"
            description="Upload a COR on a client's form and it will appear here."
          />
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState title="No matches" description="No documents match your search." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                  <th className="px-4 py-2.5 font-semibold">File</th>
                  <th className="px-4 py-2.5 font-semibold">Client</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Size</th>
                  <th className="px-4 py-2.5 font-semibold">Last modified</th>
                  <th className="px-4 py-2.5 text-right font-semibold">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-divider">
                {rows.map((f) => (
                  <tr key={f.key} className="text-[13px] transition-colors hover:bg-rowhover">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <FileIcon />
                        <div className="min-w-0">
                          <span className="block font-semibold text-content">
                            BIR 2303 — Certificate of Registration
                          </span>
                          <span className="block truncate font-mono text-[11px] text-content-tertiary">
                            {f.key}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {f.clientId ? (
                        <div>
                          <Link
                            to={`/clients/${f.clientId}`}
                            className="font-semibold text-navy hover:underline"
                          >
                            {f.clientName}
                          </Link>
                          <span className="block font-mono text-[11.5px] text-content-secondary">
                            {f.tin || "—"}
                            {f.clientStatus === "ARCHIVED" ? " · ARCHIVED" : ""}
                          </span>
                        </div>
                      ) : (
                        <Chip variant="warn">Unlinked object</Chip>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-content-secondary">
                      {formatBytes(f.size)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-content-secondary">
                      {f.lastModified ? f.lastModified.slice(0, 10) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={openingKey === f.key}
                          onClick={() => void openFile(f)}
                          aria-label={`Open the COR for ${f.clientName ?? f.key}`}
                        >
                          {openingKey === f.key ? "Opening…" : "View / Download"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

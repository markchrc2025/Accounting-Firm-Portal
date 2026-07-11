import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { fetchFilings, fetchPortalContext } from "../lib/api";
import {
  Button,
  Card,
  Chip,
  type ChipVariant,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/** Format an ISO date string as e.g. "Apr 24, 2026"; guard invalid/empty input. */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

/** Map a filing status to a chip tone; tolerant of case/whitespace. */
function statusTone(status: string): ChipVariant {
  const s = status.trim().toLowerCase();
  if (s === "filed" || s === "accepted") return "success";
  if (s === "amended") return "gold";
  if (s === "ready") return "info";
  if (s === "draft") return "neutral";
  return "neutral";
}

export default function PortalFilingsPage() {
  const [formFilter, setFormFilter] = useState("All");

  const ctxQ = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });
  const clientId = ctxQ.data?.id ?? "";

  const filingsQuery = useQuery({
    queryKey: ["portal-filings", clientId],
    queryFn: () => fetchFilings(clientId),
    enabled: clientId !== "",
  });

  const filings = filingsQuery.data ?? [];

  // Distinct form values present in the data, for the form filter options.
  const forms = useMemo(
    () => Array.from(new Set(filings.map((f) => f.form))).sort(),
    [filings],
  );
  const rows = useMemo(
    () =>
      formFilter === "All"
        ? filings
        : filings.filter((f) => f.form === formFilter),
    [filings, formFilter],
  );

  // --- Business-context guards (needed for the header) -----------------------
  if (ctxQ.isError) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState
            message="Could not load your business details."
            onRetry={() => void ctxQ.refetch()}
          />
        </Card>
      </div>
    );
  }
  if (ctxQ.isPending || !ctxQ.data) {
    return (
      <div className="animate-fade-rise space-y-6">
        <Skeleton className="h-8 w-64" />
        <Card>
          <div className="px-6 py-5">
            <Skeleton className="h-6 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  const ctx = ctxQ.data;

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Filed BIR Forms"
        eyebrow="YOUR BUSINESS"
        description={ctx.businessName}
      />

      {/* Form filter */}
      <div className="mb-4 flex items-end gap-3">
        <label className="block">
          <div className="mb-1 text-[13px] font-semibold text-content">Form</div>
          <select
            className="input"
            value={formFilter}
            onChange={(e) => setFormFilter(e.target.value)}
          >
            <option value="All">All</option>
            {forms.map((form) => (
              <option key={form} value={form}>
                {form}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                <Th>Form</Th>
                <Th>Period</Th>
                <Th>Filed</Th>
                <Th>Status</Th>
                <Th className="text-right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-divider">
              {filingsQuery.isPending &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="text-[13px]">
                    <Td>
                      <Skeleton className="w-16" />
                    </Td>
                    <Td>
                      <Skeleton className="w-44" />
                    </Td>
                    <Td>
                      <Skeleton className="w-24" />
                    </Td>
                    <Td>
                      <Skeleton className="w-20" />
                    </Td>
                    <Td className="text-right">
                      <Skeleton className="ml-auto w-16" />
                    </Td>
                  </tr>
                ))}

              {filingsQuery.isError && (
                <tr>
                  <td colSpan={5}>
                    <ErrorState
                      message="Could not load your filings."
                      onRetry={() => void filingsQuery.refetch()}
                    />
                  </td>
                </tr>
              )}

              {filingsQuery.isSuccess && filings.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <EmptyState
                      title="No filed forms yet"
                      description="Filed BIR forms will appear here once your accountant files them."
                    />
                  </td>
                </tr>
              )}

              {filingsQuery.isSuccess &&
                filings.length > 0 &&
                rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState
                        title="No matching forms"
                        description={`No filings match the "${formFilter}" filter.`}
                      />
                    </td>
                  </tr>
                )}

              {rows.map((f) => (
                <tr
                  key={f.id}
                  className="text-[13px] transition-colors hover:bg-rowhover"
                >
                  <Td>
                    <Chip variant={f.form === "2550Q" ? "vat" : "info"}>
                      {f.form}
                    </Chip>
                  </Td>
                  <Td className="text-content">
                    <div className="font-mono text-[12px] text-content-secondary">
                      {fmtDate(f.periodStart)} – {fmtDate(f.periodEnd)}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[.14em] text-content-tertiary">
                      {f.periodType}
                    </div>
                  </Td>
                  <Td className="font-mono text-[12px] text-content-secondary">
                    {fmtDate(f.updatedAt)}
                  </Td>
                  <Td>
                    <Chip variant={statusTone(f.status)}>{f.status}</Chip>
                  </Td>
                  <Td className="text-right">
                    {f.pdfUrl ? (
                      <a
                        href={f.pdfUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center rounded-btn border border-line-input bg-card px-4 py-[7px] text-[13px] font-semibold text-navy transition-colors hover:border-navy"
                      >
                        PDF
                      </a>
                    ) : (
                      <Button variant="outline" size="sm" disabled>
                        PDF
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {filingsQuery.isSuccess && filings.length > 0 && (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.14em] text-content-secondary">
          {rows.length} of {filings.length} filing(s)
        </p>
      )}
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <th className={cn("px-4 py-2.5 font-semibold", className)}>{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children?: ReactNode;
  className?: string;
}) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}

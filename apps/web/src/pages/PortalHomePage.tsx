import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { useAuth } from "../auth/AuthContext";
import {
  fetchFilings,
  fetchIncomeSummary,
  fetchPortalContext,
  fetchPurchaseSummary,
} from "../lib/api";
import {
  Card,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  peso,
  Skeleton,
} from "../components/ui";

/**
 * TRAIN graduated income-tax brackets, as a management estimate only (the BIR
 * Generator owns the authoritative figure). Each tuple is
 * `[over, notOver, baseTax, ratePercent]`; tax = baseTax + (taxable − over) × rate%.
 */
const TRAIN_BRACKETS: readonly [number, number | null, number, number][] = [
  [0, 250000, 0, 0],
  [250000, 400000, 0, 15],
  [400000, 800000, 22500, 20],
  [800000, 2000000, 102500, 25],
  [2000000, 8000000, 402500, 30],
  [8000000, null, 2202500, 35],
];

function estimateIncomeTax(taxable: number): number {
  for (const [over, notOver, baseTax, rate] of TRAIN_BRACKETS) {
    if (taxable > over && (notOver === null || taxable <= notOver)) {
      return baseTax + (taxable - over) * (rate / 100);
    }
  }
  return 0;
}

/** Format an ISO date as a short, readable day. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PortalHomePage() {
  const { user } = useAuth();
  const firstName = (user?.fullName ?? "").trim().split(/\s+/)[0] ?? "";

  const ctxQuery = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });
  const ctx = ctxQuery.data;
  const clientId = ctx?.id ?? "";

  const income = useQuery({
    queryKey: ["income-summary", clientId],
    queryFn: () => fetchIncomeSummary(clientId),
    enabled: !!clientId,
  });
  const purchase = useQuery({
    queryKey: ["purchase-summary", clientId],
    queryFn: () => fetchPurchaseSummary(clientId),
    enabled: !!clientId,
  });
  const filings = useQuery({
    queryKey: ["filings", clientId],
    queryFn: () => fetchFilings(clientId),
    enabled: !!clientId,
  });

  if (ctxQuery.isPending) {
    return (
      <div className="animate-fade-rise space-y-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (ctxQuery.isError || !ctx) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState
            message="Could not load your organization."
            onRetry={() => void ctxQuery.refetch()}
          />
        </Card>
      </div>
    );
  }

  const summariesPending = income.isPending || purchase.isPending;
  const summariesError = income.isError || purchase.isError;
  const taxable = Math.max(
    0,
    (income.data?.totalNet ?? 0) - (purchase.data?.deductibleNet ?? 0),
  );
  const estimatedTax = estimateIncomeTax(taxable);

  return (
    <div className="animate-fade-rise space-y-6">
      <div>
        <div className="eyebrow mb-1.5">YOUR BUSINESS · {ctx.businessName}</div>
        <h1 className="font-serif text-[30px] font-medium text-navy">
          Magandang hapon, {firstName}.
        </h1>
      </div>

      {summariesError ? (
        <Card>
          <ErrorState
            message="Could not load your figures."
            onRetry={() => {
              void income.refetch();
              void purchase.refetch();
            }}
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Income"
            value={
              summariesPending ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                peso(income.data?.totalNet ?? 0)
              )
            }
          />
          <StatCard
            label="Expenses"
            value={
              summariesPending ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                peso(purchase.data?.totalNet ?? 0)
              )
            }
          />
          <StatCard
            navy
            label="Estimated tax"
            caption="PREPARED BY YOUR MCRC TEAM"
            value={
              summariesPending ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                peso(estimatedTax)
              )
            }
          />
        </div>
      )}

      <Card>
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-serif text-[15px] font-semibold text-navy">
            Filed BIR forms
          </h2>
        </div>
        {filings.isPending ? (
          <div className="space-y-3 px-6 py-5">
            <Skeleton />
            <Skeleton className="w-3/4" />
            <Skeleton className="w-2/3" />
          </div>
        ) : filings.isError ? (
          <ErrorState
            message="Could not load your filed forms."
            onRetry={() => void filings.refetch()}
          />
        ) : (filings.data ?? []).length === 0 ? (
          <EmptyState
            title="No filed forms yet"
            description="Your MCRC team's filings will appear here once submitted."
          />
        ) : (
          <ul className="divide-y divide-line-divider">
            {(filings.data ?? []).map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-3 px-6 py-3.5 text-[13px] transition-colors hover:bg-rowhover"
              >
                <Chip variant="vat">{f.form}</Chip>
                <span className="font-mono text-[12px] text-content-secondary">
                  {fmtDate(f.periodStart)} – {fmtDate(f.periodEnd)}
                </span>
                <span className="ml-auto font-mono text-[11px] text-content-tertiary">
                  Filed {fmtDate(f.updatedAt)}
                </span>
                {f.pdfUrl ? (
                  <a
                    href={f.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-blue underline-offset-2 hover:text-navy-hover hover:underline"
                  >
                    PDF
                  </a>
                ) : (
                  <span className="text-content-muted">—</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  caption,
  navy = false,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  navy?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border p-5",
        navy ? "border-navy bg-navy text-white" : "border-line-strong bg-card",
      )}
    >
      <div
        className={cn(
          "font-mono text-[10px] font-semibold uppercase tracking-[.18em]",
          navy ? "text-gold-soft" : "text-gold-deep",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-2 font-serif text-[32px] font-medium tabular-nums",
          navy ? "text-white" : "text-navy",
        )}
      >
        {value}
      </div>
      {caption ? (
        <div
          className={cn(
            "mt-1.5 font-mono text-[10px] uppercase tracking-[.14em]",
            navy ? "text-blue-light" : "text-content-tertiary",
          )}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}

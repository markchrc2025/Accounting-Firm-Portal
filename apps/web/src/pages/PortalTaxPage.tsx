import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPortalContext, fetchTaxEstimate } from "../lib/api";
import {
  EstimateNotice,
  TaxEstimateBody,
  TaxEstimateSkeleton,
  TaxPeriodPicker,
} from "../components/TaxEstimateView";
import { lastEndedQuarter } from "../lib/taxPeriod";
import { Card, CardContent, ErrorState, PageHeader, Skeleton } from "../components/ui";

/**
 * Client-portal, READ-ONLY tax estimate for the signed-in client's own org.
 *
 * GUARDRAIL: this is a *management estimate* only — never authoritative. The
 * API computes it (GET /clients/:id/tax-estimate, U10 R1, D47) for the period
 * chosen here; this page computes nothing. The filed returns for the period,
 * which the API lists beside the estimate, are the figures that count.
 */
export default function PortalTaxPage() {
  const [period, setPeriod] = useState<{ year: number; quarter: number | null }>(() =>
    lastEndedQuarter(),
  );
  const ctxQ = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });

  const clientId = ctxQ.data?.id ?? "";

  const estimateQ = useQuery({
    queryKey: ["tax-estimate", clientId, period.year, period.quarter],
    queryFn: () => fetchTaxEstimate(clientId, period.year, period.quarter),
    enabled: clientId !== "",
  });

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
        <Skeleton className="h-20 w-full" />
        <Card>
          <CardContent className="space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton />
            <Skeleton className="w-3/4" />
            <Skeleton className="h-9 w-40" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const ctx = ctxQ.data;

  let body: ReactNode;
  if (estimateQ.isError) {
    body = (
      <Card>
        <ErrorState
          message="Could not load your tax estimate."
          onRetry={() => void estimateQ.refetch()}
        />
      </Card>
    );
  } else if (estimateQ.isPending || !estimateQ.data) {
    body = <TaxEstimateSkeleton />;
  } else {
    body = <TaxEstimateBody estimate={estimateQ.data} />;
  }

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Tax Estimate"
        eyebrow="MANAGEMENT ESTIMATE"
        description={ctx.businessName}
        actions={<TaxPeriodPicker {...period} onChange={setPeriod} />}
      />

      {/* Prominent guardrail: this is an estimate, not the authoritative figure. */}
      <EstimateNotice notice={estimateQ.data?.notice} />

      {body}

      {/* Engagement-lead contact */}
      <p className="mt-6 text-[13px] text-content-secondary">
        Questions about your estimate? Contact your MCRC engagement lead —{" "}
        <a
          href="mailto:a.reyes@mcrc.ph"
          className="text-blue underline-offset-2 hover:text-navy-hover hover:underline"
        >
          a.reyes@mcrc.ph
        </a>
      </p>
    </div>
  );
}

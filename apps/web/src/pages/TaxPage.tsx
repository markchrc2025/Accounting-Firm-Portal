import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { ClientWorkspaceTabs } from "../components/ClientWorkspaceTabs";
import {
  EstimateNotice,
  TaxEstimateBody,
  TaxEstimateSkeleton,
  TaxPeriodPicker,
} from "../components/TaxEstimateView";
import { lastEndedQuarter } from "../lib/taxPeriod";
import { fetchClient, fetchTaxEstimate } from "../lib/api";
import { Card, EmptyState, ErrorState, PageHeader } from "../components/ui";

/**
 * Management-estimate tax computation for a client.
 *
 * GUARDRAIL: this is a *management estimate* only — never authoritative. The
 * API computes it (GET /clients/:id/tax-estimate, U10 R1, D47) for the period
 * chosen here; this page computes nothing. The filed returns for the period,
 * which the API lists beside the estimate, are the figures that count.
 */
export default function TaxPage() {
  const { clientId = "" } = useParams();
  const [period, setPeriod] = useState<{ year: number; quarter: number | null }>(() =>
    lastEndedQuarter(),
  );

  const clientQ = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => fetchClient(clientId),
    enabled: !!clientId,
  });
  const estimateQ = useQuery({
    queryKey: ["tax-estimate", clientId, period.year, period.quarter],
    queryFn: () => fetchTaxEstimate(clientId, period.year, period.quarter),
    enabled: !!clientId,
  });

  if (!clientId) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <EmptyState
            title="No client selected"
            description="Open a client to see its tax estimate."
          />
        </Card>
      </div>
    );
  }

  let body: ReactNode;
  if (estimateQ.isError) {
    body = (
      <Card>
        <ErrorState
          message="Could not load this client's tax estimate."
          onRetry={() => void estimateQ.refetch()}
        />
      </Card>
    );
  } else if (estimateQ.isPending || !estimateQ.data) {
    body = <TaxEstimateSkeleton />;
  } else {
    body = (
      <TaxEstimateBody
        estimate={estimateQ.data}
        filedFormHref={(id) => `/bir-forms/${id}`}
        aside={
          /* Tax Rules — conceptual link, no route yet. */
          <div className="rounded-card border border-dashed border-line-strong bg-sidebar px-5 py-4 text-[12.5px] text-content-secondary">
            Configure tax rules — coming soon
          </div>
        }
      />
    );
  }

  return (
    <div className="animate-fade-rise">
      <ClientWorkspaceTabs clientId={clientId} />
      <PageHeader
        title="Tax Computation"
        eyebrow="MANAGEMENT ESTIMATE"
        description={clientQ.data?.businessName ?? estimateQ.data?.client.businessName}
        actions={<TaxPeriodPicker {...period} onChange={setPeriod} />}
      />

      {/* Prominent guardrail: this is an estimate, not the authoritative figure. */}
      <EstimateNotice notice={estimateQ.data?.notice} />

      {body}
    </div>
  );
}

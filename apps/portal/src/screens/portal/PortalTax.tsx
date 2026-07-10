/**
 * Screen 21 — Client Portal · Tax estimate (READ-ONLY).
 *
 * A simplified, client-facing view of the in-app tax estimate: the same gold
 * ESTIMATE banner as the firm screen, a compact ledger card (gross income →
 * deductions → taxable income → estimated tax due), and a contact line pointing
 * to the client's MCRC engagement lead. Loading / empty / error states.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { api } from "@/mock";
import { useSession } from "@/session";
import { peso } from "@/lib/utils";

const PERIOD = "2026-Q2";

/** The prominent gold estimate banner (exact copy per spec). */
function EstimateBanner(): React.JSX.Element {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-card border border-warn/40 bg-warn-bg-2 px-5 py-4 text-warn">
      <Sparkles className="mt-0.5 h-[18px] w-[18px] shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="mb-1">
          <span className="rounded-chip bg-warn/15 px-2 py-[2px] font-mono text-[10px] font-semibold uppercase tracking-[.18em]">
            Estimate
          </span>
        </div>
        <p className="text-[13px] leading-snug">
          This computation is an in-app estimate for planning. The authoritative figure
          comes from the BIR Form Generator when the return is filed.
        </p>
      </div>
    </div>
  );
}

/** Engagement-lead contact line shown beneath the ledger. */
function ContactLine(): React.JSX.Element {
  return (
    <p className="mt-5 text-[13px] text-content-secondary">
      Questions about your estimate? Contact your MCRC engagement lead, Alvin Reyes —{" "}
      <a
        href="mailto:a.reyes@mcrc.ph"
        className="font-medium text-blue underline-offset-2 hover:underline"
      >
        a.reyes@mcrc.ph
      </a>
      .
    </p>
  );
}

export function PortalTaxScreen(): React.JSX.Element {
  const { activeClientId, activeClient } = useSession();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["portal-tax", activeClientId, PERIOD],
    queryFn: () => api.getTaxComputation(activeClientId, PERIOD),
    enabled: Boolean(activeClient),
  });

  const header = (
    <PageHeader
      eyebrow={activeClient ? `${activeClient.name} · Income tax` : "Income tax"}
      title="Tax estimate"
      description="An in-app estimate of your income tax for planning, prepared by your MCRC team."
    />
  );

  // Guard: hold a skeleton until the active client resolves.
  if (!activeClient) {
    return (
      <>
        <Skeleton className="mb-6 h-9 w-64" />
        <Skeleton className="h-48 w-full rounded-card" />
      </>
    );
  }

  if (isLoading) {
    return (
      <>
        {header}
        <EstimateBanner />
        <Card className="px-6 py-5">
          <Skeleton className="h-4 w-40" />
          <div className="mt-6 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </Card>
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <EstimateBanner />
        <ErrorState
          title="Couldn't load your estimate"
          message="The tax estimate for this period failed to load. Please try again."
          onRetry={() => void refetch()}
        />
      </>
    );
  }

  if (!data) {
    return (
      <>
        {header}
        <EstimateBanner />
        <EmptyState
          variant="dashed"
          title="No estimate for this period"
          description="There's no income-tax estimate for your organization yet. Once your MCRC team records income and expenses, your estimate will appear here."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <EstimateBanner />

      <Card>
        <CardHeader>
          <CardTitle>Estimated income tax</CardTitle>
          <p className="text-[12px] text-content-secondary">
            Graduated income-tax estimate · {data.period}
          </p>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2.5 text-[13.5px]">
            <div className="flex items-center justify-between">
              <dt className="text-content-secondary">Gross income</dt>
              <dd className="font-mono tabular-nums text-content">
                {peso(data.grossIncome)}
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-content-secondary">− Deductions</dt>
              <dd className="font-mono tabular-nums text-content">
                −{peso(data.deductions)}
              </dd>
            </div>
            <div className="flex items-center justify-between border-t border-line-strong pt-2.5">
              <dt className="font-semibold text-navy">= Taxable income</dt>
              <dd className="font-mono font-semibold tabular-nums text-navy">
                {peso(data.taxableIncome)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 flex items-end justify-between border-t border-line-strong pt-4">
            <div>
              <div className="eyebrow">Estimated tax due</div>
              <div className="mt-1 text-[11px] text-content-muted">
                Planning estimate — not the filed figure
              </div>
            </div>
            <div className="font-serif text-[34px] font-medium leading-none text-navy tabular-nums">
              {peso(data.estimatedTaxDue)}
            </div>
          </div>
        </CardContent>
      </Card>

      <ContactLine />
    </>
  );
}

/**
 * Screen 20 — Client Portal home.
 *
 * The simplified, client-facing dashboard for the active organization (default
 * c1 Malaya Trading, VAT, Owner "Ramon Villanueva"). A warm Tagalog greeting,
 * three stat cards (Income, Expenses, and a navy ESTIMATED TAX card prepared by
 * the MCRC team), an income-vs-expenses trend, and the list of filed BIR forms
 * (PDF downloads). Loading / error states are handled below a static header.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ErrorState,
  PageHeader,
  Skeleton,
  type ChipVariant,
} from "@/components/ui";
import { TrendLine } from "@/components/charts";
import { api, DASHBOARD } from "@/mock";
import type { Filing, FilingForm } from "@/types";
import { useSession } from "@/session";
import { peso } from "@/lib/utils";

const PERIOD = "2026-Q2";

/** Form → chip tone. The VAT quarterly return reads as the VAT (blue) chip. */
function formVariant(form: FilingForm): ChipVariant {
  return form === "2550Q" ? "vat" : "info";
}

function HomeSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="px-6 py-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-9 w-32" />
            <Skeleton className="mt-3 h-3 w-28" />
          </Card>
        ))}
      </div>
      <Card className="px-6 py-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-5 h-[220px] w-full" />
      </Card>
      <Card className="px-6 py-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    </div>
  );
}

export function PortalHomeScreen(): React.JSX.Element {
  const { activeClientId, activeClient, user } = useSession();

  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  const incomeQuery = useQuery({
    queryKey: ["portal-income", activeClientId, PERIOD],
    queryFn: () => api.listIncome(activeClientId, PERIOD),
    enabled: Boolean(activeClient),
  });
  const expenseQuery = useQuery({
    queryKey: ["portal-expenses", activeClientId, PERIOD],
    queryFn: () => api.listExpenses(activeClientId, PERIOD),
    enabled: Boolean(activeClient),
  });
  const taxQuery = useQuery({
    queryKey: ["portal-tax", activeClientId, PERIOD],
    queryFn: () => api.getTaxComputation(activeClientId, PERIOD),
    enabled: Boolean(activeClient),
  });
  const filingsQuery = useQuery({
    queryKey: ["portal-filings", activeClientId],
    queryFn: () => api.listFilings(activeClientId),
    enabled: Boolean(activeClient),
  });

  // Keep the greeting stable; the Tagalog "Magandang hapon" (Good afternoon) is literal.
  const header = (
    <PageHeader
      eyebrow={activeClient ? activeClient.name : undefined}
      title={`Magandang hapon, ${firstName}.`}
      description="Your income, expenses, and BIR filings at a glance — prepared with your MCRC team."
    />
  );

  // Guard: hold a skeleton until the active client resolves.
  if (!activeClient) {
    return (
      <>
        <Skeleton className="mb-6 h-9 w-72" />
        <HomeSkeleton />
      </>
    );
  }

  const isLoading =
    incomeQuery.isLoading ||
    expenseQuery.isLoading ||
    taxQuery.isLoading ||
    filingsQuery.isLoading;
  const isError =
    incomeQuery.isError ||
    expenseQuery.isError ||
    taxQuery.isError ||
    filingsQuery.isError;

  if (isLoading) {
    return (
      <>
        {header}
        <HomeSkeleton />
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <ErrorState
          title="Couldn't load your dashboard"
          message="Your organization's summary failed to load. Please try again."
          onRetry={() => {
            void incomeQuery.refetch();
            void expenseQuery.refetch();
            void taxQuery.refetch();
            void filingsQuery.refetch();
          }}
        />
      </>
    );
  }

  const income = (incomeQuery.data ?? []).reduce((sum, r) => sum + r.netAmount, 0);
  const expenses = (expenseQuery.data ?? []).reduce((sum, r) => sum + r.amount, 0);
  const estimatedTax = taxQuery.data?.estimatedTaxDue;
  const filings: Filing[] = filingsQuery.data ?? [];

  return (
    <>
      {header}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Card className="px-6 py-5">
          <div className="eyebrow">Income · {PERIOD}</div>
          <div className="mt-2 font-serif text-[32px] font-medium leading-none text-navy tabular-nums">
            {peso(income)}
          </div>
          <div className="mt-2 text-[12px] text-content-secondary">Recorded this quarter</div>
        </Card>

        <Card className="px-6 py-5">
          <div className="eyebrow">Expenses · {PERIOD}</div>
          <div className="mt-2 font-serif text-[32px] font-medium leading-none text-navy tabular-nums">
            {peso(expenses)}
          </div>
          <div className="mt-2 text-[12px] text-content-secondary">Recorded this quarter</div>
        </Card>

        <div className="rounded-card bg-navy px-6 py-5 text-white">
          <div className="font-mono text-[10px] uppercase tracking-[.18em] text-gold-soft">
            Estimated tax
          </div>
          <div className="mt-2 font-serif text-[32px] font-medium leading-none tabular-nums">
            {estimatedTax === undefined ? "—" : peso(estimatedTax)}
          </div>
          <div className="mt-2 font-mono text-[10px] uppercase tracking-[.16em] text-white/55">
            Prepared by your MCRC team
          </div>
        </div>
      </div>

      {/* Trend chart — DASHBOARD.incomeVsExpenses is a stand-in monthly series. */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Income vs expenses</CardTitle>
          <p className="text-[12px] text-content-secondary">Last 6 months</p>
        </CardHeader>
        <CardContent>
          <TrendLine data={DASHBOARD.incomeVsExpenses} />
        </CardContent>
      </Card>

      {/* Filed BIR forms */}
      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Filed BIR forms</CardTitle>
          <p className="text-[12px] text-content-secondary">
            Filed on your behalf by MCRC — download the PDF copy.
          </p>
        </CardHeader>
        <CardContent className="py-0">
          {filings.length === 0 ? (
            <p className="py-6 text-[13px] text-content-secondary">
              No BIR forms have been filed for your organization yet.
            </p>
          ) : (
            <ul className="divide-y divide-line-divider">
              {filings.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 py-3.5">
                  <Chip variant={formVariant(f.form)} className="shrink-0">
                    {f.form}
                  </Chip>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-content">{f.period}</div>
                    <div className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
                      Filed {f.filed}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={`Download PDF for ${f.reference}`}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    PDF
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

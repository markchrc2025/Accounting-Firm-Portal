/**
 * Screen 5 — Firm dashboard (portfolio overview).
 *
 * Variant A (default): 4 white KPI cards. Variant B: a full-width navy-hero panel.
 * Below both: income-vs-expenses bar, recent-activity feed, upcoming-filings list,
 * and a regime-mix bar. Four states: loading / empty (dashed) / error (inline banner)
 * / default.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Plus } from "lucide-react";

import {
  Avatar,
  AvatarFallback,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  EmptyState,
  PageHeader,
  Skeleton,
} from "@/components/ui";
import { IncomeExpensesBar, RegimeMixBar } from "@/components/charts";
import { TWO_COLUMN_GRID } from "@/components/shell";
import { McrcMark } from "@/components/shell";
import { api } from "@/mock";
import type { KpiCard, UpcomingFiling } from "@/types";
import { useSession } from "@/session";
import { cn, peso } from "@/lib/utils";

/** Currency KPIs format with ₱; count KPIs render plain. */
function formatKpi(kpi: KpiCard): string {
  return kpi.isCurrency ? peso(kpi.value) : kpi.value.toLocaleString("en-PH");
}

/** A single white KPI card (variant A). */
function KpiTile({ kpi }: { kpi: KpiCard }): React.JSX.Element {
  return (
    <Card className="px-6 py-5">
      <div className="eyebrow">{kpi.label}</div>
      <div className="mt-2 font-serif text-[36px] font-medium leading-none text-navy">
        {formatKpi(kpi)}
      </div>
      <div className="mt-2 text-[12px] text-content-secondary">{kpi.delta}</div>
    </Card>
  );
}

/** Full-width navy hero panel (variant B). */
function HeroPanel({ kpis }: { kpis: KpiCard[] }): React.JSX.Element {
  const income = kpis[0];
  const expenses = kpis[1];
  const activeClients = kpis[2];
  const filings = kpis[3];
  return (
    <div className="rounded-card bg-navy-hero px-8 py-7 text-white">
      <div className="font-mono text-[10px] uppercase tracking-[.18em] text-gold-soft">
        {income?.label ?? "Portfolio income"} · FY 2026
      </div>
      <div className="mt-2 font-serif text-[52px] font-medium leading-none">
        {income ? formatKpi(income) : "—"}
      </div>
      {income ? (
        <div className="mt-2 text-[12px] text-white/70">{income.delta}</div>
      ) : null}
      <div className="mt-6 flex flex-wrap items-stretch gap-x-10 gap-y-4 border-t border-white/10 pt-5">
        {expenses ? (
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-white/60">
              {expenses.label}
            </div>
            <div className="mt-1 font-serif text-[22px] font-medium">
              {formatKpi(expenses)}
            </div>
          </div>
        ) : null}
        {activeClients ? (
          <div className="border-l border-white/10 pl-10">
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-white/60">
              {activeClients.label}
            </div>
            <div className="mt-1 font-serif text-[22px] font-medium">
              {formatKpi(activeClients)}
            </div>
          </div>
        ) : null}
        {filings ? (
          <div className="border-l border-white/10 pl-10">
            <div className="font-mono text-[10px] uppercase tracking-[.18em] text-gold-soft">
              {filings.label}
            </div>
            <div className="mt-1 font-serif text-[22px] font-medium text-gold-soft">
              {formatKpi(filings)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** One row of the upcoming-filings list. */
function UpcomingRow({ item }: { item: UpcomingFiling }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-3">
      <Chip variant="neutral" size="sm" className="shrink-0">
        {item.form}
      </Chip>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-content">
          {item.client}
        </div>
        <div className="truncate text-[12px] text-content-secondary">
          {item.period}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-chip px-[9px] py-[3px] font-mono text-[10px] font-semibold",
          item.urgency === "urgent"
            ? "bg-warn-bg text-warn"
            : "bg-info-bg text-info",
        )}
      >
        {item.due}
      </span>
    </div>
  );
}

function DashboardSkeleton(): React.JSX.Element {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="px-6 py-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-9 w-32" />
            <Skeleton className="mt-3 h-3 w-28" />
          </Card>
        ))}
      </div>
      <div className={TWO_COLUMN_GRID}>
        <Card className="px-6 py-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-5 h-[250px] w-full" />
        </Card>
        <Card className="px-6 py-5">
          <Skeleton className="h-4 w-32" />
          <div className="mt-5 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function DashboardScreen(): React.JSX.Element {
  const { shellVariant, user } = useSession();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.getDashboard(),
  });

  const firstName = user.name.split(/\s+/)[0] ?? user.name;

  const header = (
    <PageHeader
      eyebrow="PORTFOLIO · FY 2026 · AS OF JUL 10"
      title={`Good day, ${firstName}.`}
      actions={
        <Button asChild variant="primary" size="sm">
          <Link to="/clients/new">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add client
          </Link>
        </Button>
      }
    />
  );

  if (isLoading) {
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  }

  if (isError || !data) {
    return (
      <>
        {header}
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card bg-danger-bg px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <p className="text-[13.5px] font-semibold text-danger-ink">
                Couldn&rsquo;t load the dashboard.
              </p>
              <p className="text-[12px] text-content-secondary">
                The portfolio summary failed to load. Please try again.
              </p>
            </div>
          </div>
          <Button variant="danger" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      </>
    );
  }

  if (data.kpis.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          variant="dashed"
          icon={<McrcMark size={56} className="opacity-30" />}
          title="Your portfolio is empty"
          description="Add your first client to start tracking income, expenses, tax estimates, and BIR filings across your firm."
        >
          <Button asChild variant="primary" size="md">
            <Link to="/clients/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add your first client
            </Link>
          </Button>
        </EmptyState>
      </>
    );
  }

  return (
    <>
      {header}

      {shellVariant === "B" ? (
        <HeroPanel kpis={data.kpis} />
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {data.kpis.map((kpi) => (
            <KpiTile key={kpi.label} kpi={kpi} />
          ))}
        </div>
      )}

      <div className={cn(TWO_COLUMN_GRID, "mt-5")}>
        <Card>
          <CardHeader>
            <CardTitle>Income vs expenses</CardTitle>
            <p className="text-[12px] text-content-secondary">
              Portfolio totals · last 6 months
            </p>
          </CardHeader>
          <CardContent>
            <IncomeExpensesBar data={data.incomeVsExpenses} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.recentActivity.map((item) => (
              <div key={item.id} className="flex items-start gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>{item.initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-[13px] leading-snug text-content">{item.text}</p>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
                    {item.time}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className={cn(TWO_COLUMN_GRID, "mt-5")}>
        <Card>
          <CardHeader>
            <CardTitle>Upcoming filings</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-line-divider py-0">
            {data.upcomingFilings.map((item) => (
              <UpcomingRow key={item.id} item={item} />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regime mix</CardTitle>
            <p className="text-[12px] text-content-secondary">Clients by tax regime</p>
          </CardHeader>
          <CardContent>
            <RegimeMixBar mix={data.regimeMix} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

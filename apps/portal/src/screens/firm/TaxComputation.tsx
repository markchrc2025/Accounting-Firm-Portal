/**
 * Screen 13 — Tax Computation (firm client workspace).
 *
 * An in-app ESTIMATE for planning only. The gold banner makes clear the authoritative
 * figure comes from the BIR Form Generator when the return is filed. Left: a graduated
 * ledger card. Right rail: navy FILED card (with estimate-vs-filed variance), an
 * Assumptions card, and a link to configure tax rules. Four states.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui";
import { TWO_COLUMN_GRID } from "@/components/shell";
import { api } from "@/mock";
import type { TaxBracket } from "@/types";
import { useSession } from "@/session";
import { cn, peso } from "@/lib/utils";

/** Selectable quarters (mock echoes the period back; c1/c2 base is unchanged). */
const PERIODS = ["2026-Q2", "2026-Q1", "2025-Q4", "2025-Q3"] as const;

/** Human range label for a graduated bracket. */
function bracketRange(b: TaxBracket): string {
  if (b.notOver === null) {
    return `Over ${peso(b.over)} and above`;
  }
  if (b.over === 0) {
    return `₱0 – ${peso(b.notOver)}`;
  }
  return `Over ${peso(b.over)} – ${peso(b.notOver)}`;
}

/** Marginal tax contributed by this bracket for a given taxable income. */
function marginalTax(b: TaxBracket, taxableIncome: number): number {
  const upper = b.notOver === null ? taxableIncome : Math.min(taxableIncome, b.notOver);
  const inBracket = Math.max(0, upper - b.over);
  return inBracket * (b.rate / 100);
}

function TaxComputationSkeleton(): React.JSX.Element {
  return (
    <div className={TWO_COLUMN_GRID}>
      <Card className="px-6 py-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
        <Skeleton className="mt-8 h-10 w-48" />
      </Card>
      <div className="space-y-5">
        <Skeleton className="h-52 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    </div>
  );
}

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

export function TaxComputationScreen(): React.JSX.Element {
  const { activeClientId, activeClient } = useSession();
  const [period, setPeriod] = React.useState<string>("2026-Q2");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["tax-computation", activeClientId, period],
    queryFn: () => api.getTaxComputation(activeClientId, period),
  });

  const header = (
    <PageHeader
      eyebrow={activeClient ? `${activeClient.name} · Income tax` : "Income tax"}
      title="Tax computation"
      description="Graduated income-tax estimate for planning, alongside the filed figure."
      actions={
        <div className="min-w-[160px]">
          <label htmlFor="tax-period" className="sr-only">
            Period
          </label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger id="tax-period">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    />
  );

  if (isLoading) {
    return (
      <>
        {header}
        <EstimateBanner />
        <TaxComputationSkeleton />
      </>
    );
  }

  if (isError) {
    return (
      <>
        {header}
        <EstimateBanner />
        <ErrorState
          title="Couldn't load the computation"
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
          title="No computation for this period"
          description="There's no income-tax estimate for the selected client and period yet. Record income and expenses, or choose another period."
        />
      </>
    );
  }

  const varianceHigher = data.variance > 0;
  const varianceEqual = data.variance === 0;

  return (
    <>
      {header}
      <EstimateBanner />

      <div className={TWO_COLUMN_GRID}>
        {/* LEFT — graduated ledger */}
        <Card>
          <CardHeader>
            <CardTitle>Graduated income-tax ledger</CardTitle>
            <p className="text-[12px] text-content-secondary">
              TRAIN brackets · {data.period}
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

            <div className="eyebrow mt-6">Graduated brackets applied</div>
            <ul className="mt-3 space-y-2">
              {data.brackets.map((b) => {
                const tax = marginalTax(b, data.taxableIncome);
                const active = data.taxableIncome > b.over;
                return (
                  <li
                    key={b.over}
                    className={cn(
                      "flex items-center justify-between gap-4 rounded-input px-3 py-2 text-[12.5px]",
                      active ? "bg-rowhover" : "opacity-45",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate text-content">{bracketRange(b)}</div>
                      <div className="font-mono text-[10.5px] uppercase tracking-[.1em] text-content-muted">
                        rate {b.rate}% · base {peso(b.baseTax)}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono tabular-nums text-content-secondary">
                      {peso(tax)}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-6 flex items-end justify-between border-t border-line-strong pt-4">
              <div>
                <div className="eyebrow">Estimated tax due</div>
                <div className="mt-1 text-[11px] text-content-muted">
                  Planning estimate — not the filed figure
                </div>
              </div>
              <div className="font-serif text-[34px] font-medium leading-none text-navy">
                {peso(data.estimatedTaxDue)}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT rail */}
        <div className="space-y-5">
          {/* Navy FILED card */}
          <div className="rounded-card bg-navy px-6 py-5 text-white">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[10px] uppercase tracking-[.18em] text-gold-soft">
                Filed · Authoritative
              </div>
              <Chip variant="gold" size="sm">
                {data.filed.form}
              </Chip>
            </div>
            <div className="mt-3 font-serif text-[30px] font-medium leading-none">
              {peso(data.filed.figure)}
            </div>
            <div className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-[12.5px]">
              <div className="flex items-center justify-between">
                <span className="text-white/60">Filed date</span>
                <span className="font-mono tabular-nums text-white/90">
                  {data.filed.filedDate}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-white/60">Status</span>
                <span className="font-semibold text-white/90">{data.filed.status}</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-2">
                <span className="text-white/60">Estimate vs filed</span>
                <span
                  className={cn(
                    "font-mono font-semibold tabular-nums",
                    varianceEqual ? "text-white/90" : "text-gold-soft",
                  )}
                >
                  {varianceEqual ? peso(0) : `${varianceHigher ? "+" : "−"}${peso(Math.abs(data.variance))}`}
                </span>
              </div>
              <p className="pt-1 text-[11.5px] leading-snug text-white/55">
                {varianceEqual
                  ? "The estimate matches the filed figure."
                  : `The estimate is ${varianceHigher ? "higher" : "lower"} than the filed figure by ${peso(
                      Math.abs(data.variance),
                    )}.`}
              </p>
            </div>
          </div>

          {/* Assumptions */}
          <Card className="px-6 py-5">
            <div className="eyebrow">Assumptions</div>
            <ul className="mt-3 space-y-2 text-[12.5px] text-content-secondary">
              <li className="flex justify-between gap-3">
                <span>Method</span>
                <span className="text-content">Graduated (TRAIN)</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>Period</span>
                <span className="font-mono tabular-nums text-content">{data.period}</span>
              </li>
              <li className="flex justify-between gap-3">
                <span>Deductions basis</span>
                <span className="text-content">Itemized · recorded expenses</span>
              </li>
            </ul>
            <div className="mt-4 border-t border-line-divider pt-3">
              <Button asChild variant="link" size="sm">
                <Link to="/tax-rules">Configure tax rules →</Link>
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

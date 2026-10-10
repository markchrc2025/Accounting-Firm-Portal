// TaxEstimateView — what both tax pages show of the API's estimate (W11 R1).
//
// GUARDRAIL 1: the estimate is the API's management estimate (U10, D47); the
// filed BIR returns listed beside it are the figures that count. This file
// computes no tax: every figure, rate, sentence and label it shows of the
// estimate is the API's own. The pages only choose the period to ask for.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { TaxEstimate } from "../lib/api";
import {
  businessTaxNote,
  methodLabel,
  methodNote,
  sourceLabel,
} from "../lib/taxEstimate";
import { yearOptions } from "../lib/taxPeriod";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  cn,
  peso,
  RegimeChip,
  Skeleton,
} from "./ui";

/** Year and quarter selects, plus "Whole year" (W11 R1). */
export function TaxPeriodPicker({
  year,
  quarter,
  onChange,
}: {
  year: number;
  quarter: number | null;
  onChange: (next: { year: number; quarter: number | null }) => void;
}) {
  const years = yearOptions();
  if (!years.includes(year)) years.push(year);
  const labelCls =
    "mb-1 block font-mono text-[10px] uppercase tracking-[.14em] text-content-muted";
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className={labelCls} htmlFor="tax-estimate-year">
          Year
        </label>
        <select
          id="tax-estimate-year"
          className="input"
          value={year}
          onChange={(e) => onChange({ year: Number(e.target.value), quarter })}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelCls} htmlFor="tax-estimate-quarter">
          Quarter
        </label>
        <select
          id="tax-estimate-quarter"
          className="input"
          value={quarter ?? "year"}
          onChange={(e) =>
            onChange({
              year,
              quarter: e.target.value === "year" ? null : Number(e.target.value),
            })
          }
        >
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={q}>
              Q{q}
            </option>
          ))}
          <option value="year">Whole year</option>
        </select>
      </div>
    </div>
  );
}

/** The estimate banner: the API's notice word for word once it has loaded. */
export function EstimateNotice({ notice }: { notice?: string }) {
  return (
    <div className="mb-6 flex items-start gap-3 rounded-card border border-warn/40 bg-warn-bg-2 px-5 py-4 text-warn">
      <span className="mt-px inline-flex flex-none items-center rounded-chip bg-warn/10 px-[9px] py-[3px] font-mono text-[10px] font-semibold uppercase leading-none tracking-[.12em]">
        Estimate
      </span>
      {notice ? (
        <p data-estimate-notice className="text-[13px] leading-relaxed">
          {notice}
        </p>
      ) : (
        <p className="text-[13px] leading-relaxed">
          This computation is an in-app estimate for planning. The authoritative figure
          comes from the BIR Form Generator when the return is filed.
        </p>
      )}
    </div>
  );
}

/** The loading skeleton both pages show while the estimate is on its way. */
export function TaxEstimateSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <Card className="min-w-0">
        <CardContent className="space-y-4">
          <Skeleton className="h-5 w-44" />
          <Skeleton />
          <Skeleton className="w-3/4" />
          <Skeleton className="w-2/3" />
          <Skeleton className="h-9 w-40" />
        </CardContent>
      </Card>
      <div className="min-w-0 space-y-6">
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton />
            <Skeleton className="w-2/3" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="w-3/4" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * The estimate: the income-tax build-up and the assumptions on the left; the
 * filed returns for the period and the business tax on the right.
 * `filedFormHref` links each filed return when the reader may open it.
 */
export function TaxEstimateBody({
  estimate,
  filedFormHref,
  aside,
}: {
  estimate: TaxEstimate;
  filedFormHref?: (id: string) => string;
  aside?: ReactNode;
}) {
  const it = estimate.incomeTax;
  return (
    <div className="space-y-4">
      <p
        data-period-label
        className="font-mono text-[11.5px] uppercase tracking-[.08em] text-content-secondary"
      >
        {estimate.period.label}
      </p>
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Income tax estimate</CardTitle>
              <Chip variant={estimate.method.source === "saved" ? "gold" : "neutral"}>
                {sourceLabel(estimate.method.source)}
              </Chip>
            </CardHeader>
            <CardContent className="space-y-6">
              <div
                data-method
                className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-content-secondary"
              >
                <span className="font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
                  Method
                </span>
                <span className="text-content">{methodLabel(estimate.method)}</span>
                <span>({sourceLabel(estimate.method.source)})</span>
                {methodNote(estimate) ? (
                  <p
                    data-method-note
                    className="mt-1 basis-full text-[12.5px] text-content"
                  >
                    {methodNote(estimate)}
                  </p>
                ) : null}
              </div>
              <div>
                <div className="eyebrow mb-1.5">Taxable income</div>
                <LedgerRow
                  data="gross"
                  label="Gross income"
                  value={peso(it.grossIncome)}
                />
                <LedgerRow
                  data="deductible"
                  label="Deductible expenses"
                  value={peso(it.deductibleExpenses)}
                  muted
                />
                <LedgerRow
                  data="taxable"
                  label="Taxable income"
                  value={peso(it.taxableIncome)}
                  strong
                />
              </div>
              <div data-income="due" className="border-t border-line pt-4">
                <div className="eyebrow mb-1">Estimated income tax due</div>
                <div className="font-serif text-[30px] font-medium leading-none text-navy">
                  {peso(it.due)}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assumptions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul
                data-assumptions
                className="list-disc space-y-2 pl-5 text-[13px] text-content"
              >
                {estimate.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <FiledReturns estimate={estimate} href={filedFormHref} />
          <BusinessTaxCard estimate={estimate} />
          {aside}
        </div>
      </div>
    </div>
  );
}

/** The filed returns that cover the period: the figures that count (guardrail 1). */
function FiledReturns({
  estimate,
  href,
}: {
  estimate: TaxEstimate;
  href?: (id: string) => string;
}) {
  const forms = estimate.filedForms;
  return (
    <Card data-filed-returns className="border-success/40">
      <CardHeader>
        <CardTitle>Filed returns for this period</CardTitle>
        <Chip variant="success">AUTHORITATIVE</Chip>
      </CardHeader>
      <CardContent className="space-y-3">
        {forms.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-content-secondary">
            No return has been filed for this period.
          </p>
        ) : (
          <>
            <p className="text-[12.5px] leading-relaxed text-content-secondary">
              A filed return&apos;s figures are the ones that count; they supersede the
              estimate for the period they cover.
            </p>
            <ul className="divide-y divide-line-divider">
              {forms.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    {href ? (
                      <Link
                        to={href(f.id)}
                        className="font-mono text-[13px] font-semibold text-navy hover:underline"
                      >
                        {f.form}
                      </Link>
                    ) : (
                      <span className="font-mono text-[13px] font-semibold text-navy">
                        {f.form}
                      </span>
                    )}
                    <span className="ml-2 font-mono text-[11.5px] text-content-secondary">
                      {f.period || "—"}
                    </span>
                    {f.superseded ? (
                      <span className="ml-2">
                        <Chip variant="neutral">Superseded by an amendment</Chip>
                      </span>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[14px] font-semibold tabular-nums text-navy">
                      {f.figures ? peso(f.figures.totalPayable) : "—"}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[.12em] text-content-muted">
                      Payable
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The business tax, by the kind the API names. */
function BusinessTaxCard({ estimate }: { estimate: TaxEstimate }) {
  const bt = estimate.businessTax;
  const note = businessTaxNote(estimate);

  if (bt.kind === "vat") {
    return (
      <Card data-business-tax="vat">
        <CardHeader>
          <CardTitle>VAT position (estimate)</CardTitle>
          <Chip variant="vat">VAT</Chip>
        </CardHeader>
        <CardContent className="space-y-1">
          <LedgerRow label="Output VAT" value={peso(bt.outputVAT)} />
          <LedgerRow label="Input VAT" op="−" value={peso(bt.inputVAT)} muted />
          <LedgerRow
            label={
              bt.due >= 0
                ? "Net VAT payable (estimate)"
                : "Net input VAT credit (estimate)"
            }
            value={peso(Math.abs(bt.due))}
            strong
          />
          {bt.due < 0 ? (
            <p className="pt-1 text-[12px] text-content-secondary">
              Input VAT exceeds output VAT — the excess carries forward as a creditable
              input-VAT credit.
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (bt.kind === "percentage") {
    return (
      <Card data-business-tax="percentage">
        <CardHeader>
          <CardTitle>Percentage tax (estimate)</CardTitle>
          {bt.rate !== null ? <Chip variant="gold">{bt.rate}%</Chip> : null}
        </CardHeader>
        <CardContent className="space-y-1">
          <LedgerRow label="Gross receipts" value={peso(bt.grossReceipts)} />
          {bt.rate !== null ? (
            <LedgerRow label="Rate" value={`× ${bt.rate}%`} muted />
          ) : null}
          <LedgerRow label="Percentage tax due (estimate)" value={peso(bt.due)} strong />
          {bt.rate === null && note ? (
            <p data-business-tax-note className="pt-1 text-[12px] text-content-secondary">
              {note}
            </p>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  // "none": the API estimated no business tax. Its own sentence says why.
  const exempt = estimate.client.regime === "EXEMPT";
  return (
    <Card data-business-tax="none">
      <CardHeader>
        <CardTitle>Business tax (estimate)</CardTitle>
        <RegimeChip regime={exempt ? null : estimate.client.regime} />
      </CardHeader>
      <CardContent>
        <p data-business-tax-note className="text-[13px] text-content-secondary">
          {note}
        </p>
      </CardContent>
    </Card>
  );
}

/** One label ⇄ money row in a computation ledger. */
function LedgerRow({
  label,
  value,
  op,
  strong,
  muted,
  data,
}: {
  label: ReactNode;
  value: ReactNode;
  op?: string;
  strong?: boolean;
  muted?: boolean;
  /** The row's `data-income` name, for the income-tax build-up. */
  data?: string;
}) {
  return (
    <div
      data-income={data}
      className={cn(
        "flex items-baseline justify-between gap-4 py-2",
        strong && "mt-1 border-t border-line pt-3",
      )}
    >
      <span
        className={cn(
          "text-[13.5px]",
          strong ? "font-semibold text-content" : "text-content-secondary",
        )}
      >
        {op ? (
          <span className="mr-1 inline-block w-3 text-content-muted">{op}</span>
        ) : null}
        {label}
      </span>
      <span
        className={cn(
          "shrink-0 font-mono tabular-nums",
          strong
            ? "text-[15px] font-semibold text-navy"
            : muted
              ? "text-[13.5px] text-content-secondary"
              : "text-[13.5px] text-content",
        )}
      >
        {value}
      </span>
    </div>
  );
}

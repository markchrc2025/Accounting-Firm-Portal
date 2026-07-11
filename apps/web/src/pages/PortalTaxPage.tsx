import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchIncomeSummary,
  fetchPortalContext,
  fetchPurchaseSummary,
} from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  cn,
  ErrorState,
  PageHeader,
  peso,
  Skeleton,
} from "../components/ui";

/**
 * Client-portal, READ-ONLY tax estimate for the signed-in client's own org.
 *
 * GUARDRAIL: this is an in-app *management estimate* only — never authoritative.
 * The filed figure is owned by the BIR Form Generator. It is built from the
 * user-facing management-estimate summaries (`.../summary`), NOT the OAuth-scoped
 * integration aggregates.
 */

interface TrainBracket {
  /** Lower bound (exclusive) of taxable income for this bracket. */
  over: number;
  /** Upper bound (inclusive); `null` for the open-ended top bracket. */
  notOver: number | null;
  /** Fixed tax on the bracket floor. */
  baseTax: number;
  /** Marginal rate on the excess over `over`, as a whole-number percent. */
  rate: number;
}

/**
 * TRAIN-law graduated income-tax schedule (annual, individuals): tax =
 * baseTax + (taxableIncome − over) × rate%, for the bracket containing the
 * taxable income; income ≤ ₱250,000 is exempt (0).
 */
const TRAIN_BRACKETS: TrainBracket[] = [
  { over: 0, notOver: 250000, baseTax: 0, rate: 0 },
  { over: 250000, notOver: 400000, baseTax: 0, rate: 15 },
  { over: 400000, notOver: 800000, baseTax: 22500, rate: 20 },
  { over: 800000, notOver: 2000000, baseTax: 102500, rate: 25 },
  { over: 2000000, notOver: 8000000, baseTax: 402500, rate: 30 },
  { over: 8000000, notOver: null, baseTax: 2202500, rate: 35 },
];

/** The bracket that contains `taxable` (undefined when ≤ ₱250,000 / exempt). */
function findBracket(taxable: number): TrainBracket | undefined {
  const t = Math.max(0, taxable);
  return TRAIN_BRACKETS.find(
    (b) => t > b.over && (b.notOver === null || t <= b.notOver),
  );
}

export default function PortalTaxPage() {
  const ctxQ = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });

  const clientId = ctxQ.data?.id ?? "";

  const incomeQ = useQuery({
    queryKey: ["portal-income-summary", clientId],
    queryFn: () => fetchIncomeSummary(clientId),
    enabled: clientId !== "",
  });
  const purchaseQ = useQuery({
    queryKey: ["portal-purchase-summary", clientId],
    queryFn: () => fetchPurchaseSummary(clientId),
    enabled: clientId !== "",
  });

  // --- Business-context guards (needed for the header + regime) --------------
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
  // Regime from tax type: contains "VAT" (but not "NON") → VAT, else percentage.
  const taxType = (ctx.taxType ?? "").toUpperCase();
  const isVat = taxType.includes("VAT") && !taxType.includes("NON");

  const retry = () => {
    void incomeQ.refetch();
    void purchaseQ.refetch();
  };

  let body: ReactNode;
  if (incomeQ.isError || purchaseQ.isError) {
    body = (
      <Card>
        <ErrorState
          message="Could not load your transaction summaries."
          onRetry={retry}
        />
      </Card>
    );
  } else if (
    incomeQ.isPending ||
    purchaseQ.isPending ||
    !incomeQ.data ||
    !purchaseQ.data
  ) {
    body = (
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
        <Card className="min-w-0">
          <CardContent className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton />
            <Skeleton className="w-2/3" />
          </CardContent>
        </Card>
      </div>
    );
  } else {
    const inc = incomeQ.data;
    const pur = purchaseQ.data;

    // Income-tax build-up (management estimate). Zero data still renders at ₱0.00.
    const grossIncome = inc.totalNet;
    const deductible = pur.deductibleNet;
    const taxableIncome = Math.max(0, grossIncome - deductible);
    const bracket = findBracket(taxableIncome);
    const excessTax = bracket
      ? (Math.max(0, taxableIncome - bracket.over) * bracket.rate) / 100
      : 0;
    const incomeTaxDue = bracket ? bracket.baseTax + excessTax : 0;

    // Business tax (estimate) — VAT position or 3% percentage tax.
    const netVat = inc.totalOutputVAT - pur.totalInputVAT;
    const percentageTax = inc.totalNet * 0.03;

    body = (
      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* LEFT — income-tax ledger */}
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Income tax estimate</CardTitle>
            <Chip variant="gold">GRADUATED · TRAIN</Chip>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Taxable income build-up */}
            <div>
              <div className="eyebrow mb-1.5">Taxable income</div>
              <LedgerRow label="Gross income" value={peso(grossIncome)} />
              <LedgerRow
                label="Deductible expenses"
                op="−"
                value={peso(deductible)}
                muted
              />
              <LedgerRow
                label="Taxable income"
                value={peso(taxableIncome)}
                strong
              />
            </div>

            {/* Graduated schedule applied to taxable income */}
            <div>
              <div className="eyebrow mb-1.5">TRAIN graduated schedule</div>
              <div className="overflow-x-auto rounded-input border border-line-divider">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-3 py-2 font-semibold">Over</th>
                      <th className="px-3 py-2 font-semibold">Not over</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Base tax
                      </th>
                      <th className="px-3 py-2 text-right font-semibold">
                        On excess
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {TRAIN_BRACKETS.map((b) => {
                      const active = b === bracket;
                      return (
                        <tr
                          key={b.over}
                          className={cn(
                            "text-[12.5px]",
                            active
                              ? "bg-warn-bg-2 font-semibold text-navy"
                              : "text-content-secondary",
                          )}
                        >
                          <td className="px-3 py-2 font-mono tabular-nums">
                            {peso(b.over)}
                          </td>
                          <td className="px-3 py-2 font-mono tabular-nums">
                            {b.notOver === null ? "—" : peso(b.notOver)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {peso(b.baseTax)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">
                            {b.rate}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Applied computation + headline figure */}
            <div>
              {bracket && bracket.rate > 0 ? (
                <div>
                  <LedgerRow
                    label={`Base tax (over ${peso(bracket.over)})`}
                    value={peso(bracket.baseTax)}
                  />
                  <LedgerRow
                    label={`${bracket.rate}% of excess over ${peso(bracket.over)}`}
                    op="+"
                    value={peso(excessTax)}
                  />
                </div>
              ) : (
                <p className="text-[13px] text-content-secondary">
                  Taxable income is within the {peso(250000)} exempt threshold —
                  the estimated income tax is {peso(0)}.
                </p>
              )}
              <div className="mt-4 border-t border-line pt-4">
                <div className="eyebrow mb-1">Estimated income tax due</div>
                <div className="font-serif text-[30px] font-medium leading-none text-navy">
                  {peso(incomeTaxDue)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT — business tax (VAT position or percentage tax) */}
        <div className="min-w-0">
          {isVat ? (
            <Card>
              <CardHeader>
                <CardTitle>VAT position (estimate)</CardTitle>
                <Chip variant="vat">VAT</Chip>
              </CardHeader>
              <CardContent className="space-y-1">
                <LedgerRow label="Output VAT" value={peso(inc.totalOutputVAT)} />
                <LedgerRow
                  label="Input VAT"
                  op="−"
                  value={peso(pur.totalInputVAT)}
                  muted
                />
                <LedgerRow
                  label={
                    netVat >= 0
                      ? "Net VAT payable (estimate)"
                      : "Net input VAT credit (estimate)"
                  }
                  value={peso(Math.abs(netVat))}
                  strong
                />
                {netVat < 0 ? (
                  <p className="pt-1 text-[12px] text-content-secondary">
                    Input VAT exceeds output VAT — the excess carries forward as
                    a creditable input-VAT credit.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Percentage tax (estimate)</CardTitle>
                <Chip variant="gold">3%</Chip>
              </CardHeader>
              <CardContent className="space-y-1">
                <LedgerRow label="Gross receipts" value={peso(inc.totalNet)} />
                <LedgerRow label="Rate" value="× 3%" muted />
                <LedgerRow
                  label="Percentage tax due (estimate)"
                  value={peso(percentageTax)}
                  strong
                />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Tax Estimate"
        eyebrow="MANAGEMENT ESTIMATE"
        description={ctx.businessName}
      />

      {/* Prominent guardrail: this is an estimate, not the authoritative figure. */}
      <div className="mb-6 flex items-start gap-3 rounded-card border border-warn/40 bg-warn-bg-2 px-5 py-4 text-warn">
        <span className="mt-px inline-flex flex-none items-center rounded-chip bg-warn/10 px-[9px] py-[3px] font-mono text-[10px] font-semibold uppercase leading-none tracking-[.12em]">
          Estimate
        </span>
        <p className="text-[13px] leading-relaxed">
          This computation is an in-app estimate for planning. The authoritative
          figure comes from the BIR Form Generator when the return is filed.
        </p>
      </div>

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

/** One label ⇄ money row in a computation ledger. */
function LedgerRow({
  label,
  value,
  op,
  strong,
  muted,
}: {
  label: ReactNode;
  value: ReactNode;
  op?: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div
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

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  fetchDashboard,
  type DashboardData,
  type DashboardKpi,
  type DashboardMonthPoint,
  type DashboardUpcomingFiling,
} from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  cn,
  peso,
} from "../components/ui";
import { McrcMark } from "../components/McrcMark";

/** Time-of-day greeting from the local hour. */
function greeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Format a KPI: currency KPIs via peso(), count KPIs via locale string. */
function formatKpi(kpi: DashboardKpi): string {
  return kpi.isCurrency ? peso(kpi.value) : kpi.value.toLocaleString();
}

/** A single KPI card (variant A). */
function KpiTile({ kpi }: { kpi: DashboardKpi }) {
  return (
    <Card className="px-6 py-5">
      <div className="eyebrow">{kpi.label}</div>
      <div className="mt-2 font-serif text-[34px] font-medium leading-none text-navy">
        {formatKpi(kpi)}
      </div>
      <div className="mt-2 text-[12px] text-content-secondary">{kpi.delta}</div>
    </Card>
  );
}

/**
 * Lightweight grouped bar chart (income vs expenses) rendered as inline SVG — no
 * charting dependency. The fill colours MUST be literal hex because SVG `fill`
 * cannot consume Tailwind classes; they mirror the design tokens navy/gold/beige.
 */
const CHART_NAVY = "#0e2a45"; // token: navy — income bars
const CHART_GOLD = "#c0902f"; // token: gold — expense bars
const CHART_BEIGE = "#efe8d8"; // token: line — gridlines

function IncomeExpensesChart({ data }: { data: DashboardMonthPoint[] }) {
  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-[13px] text-content-muted">
        No transaction history yet.
      </p>
    );
  }

  const W = 640;
  const H = 240;
  const padTop = 12;
  const padBottom = 30;
  const padX = 10;
  const plotH = H - padTop - padBottom;
  const plotW = W - padX * 2;
  const n = data.length;
  const groupW = plotW / n;
  const barW = Math.min(26, groupW * 0.26);

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(d.income, d.expenses)),
  );

  const gridFracs = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label="Income versus expenses by month"
        preserveAspectRatio="xMidYMid meet"
      >
        {gridFracs.map((frac) => {
          const y = padTop + plotH * (1 - frac);
          return (
            <line
              key={frac}
              x1={padX}
              x2={W - padX}
              y1={y}
              y2={y}
              stroke={CHART_BEIGE}
              strokeWidth={1}
            />
          );
        })}
        {data.map((d, i) => {
          const center = padX + groupW * i + groupW / 2;
          const incomeH = (d.income / maxVal) * plotH;
          const expenseH = (d.expenses / maxVal) * plotH;
          const baseY = padTop + plotH;
          return (
            <g key={d.month}>
              <rect
                x={center - barW - 2}
                y={baseY - incomeH}
                width={barW}
                height={incomeH}
                rx={3}
                fill={CHART_NAVY}
              />
              <rect
                x={center + 2}
                y={baseY - expenseH}
                width={barW}
                height={expenseH}
                rx={3}
                fill={CHART_GOLD}
              />
              <text
                x={center}
                y={H - 10}
                textAnchor="middle"
                fontFamily='"IBM Plex Mono", ui-monospace, monospace'
                fontSize={11}
                fill="#8a94a0"
              >
                {d.month}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-3 flex items-center gap-5 text-[12px] text-content-secondary">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-navy" aria-hidden="true" />
          Income
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-gold" aria-hidden="true" />
          Expenses
        </span>
      </div>
    </div>
  );
}

/** One row of the upcoming-filings list. */
function UpcomingRow({ item }: { item: DashboardUpcomingFiling }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Chip variant="neutral" className="shrink-0">
        {item.form}
      </Chip>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold text-content">{item.client}</div>
        <div className="truncate text-[12px] text-content-secondary">{item.period}</div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-chip px-[9px] py-[3px] font-mono text-[10px] font-semibold",
          item.urgency === "urgent"
            ? "bg-warn-bg-2 text-gold-deep"
            : "bg-info-bg text-info",
        )}
      >
        {item.due}
      </span>
    </div>
  );
}

/** Segmented horizontal regime-mix bar (VAT navy / Percentage gold). */
function RegimeMixBar({ mix }: { mix: DashboardData["regimeMix"] }) {
  const total = Math.max(mix.vat + mix.percentage, 1);
  const vatPct = (mix.vat / total) * 100;
  const pctPct = (mix.percentage / total) * 100;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-chip bg-line">
        <div className="bg-navy" style={{ width: `${vatPct}%` }} aria-hidden="true" />
        <div className="bg-gold" style={{ width: `${pctPct}%` }} aria-hidden="true" />
      </div>
      <div className="mt-3 flex items-center gap-5 text-[12px] text-content-secondary">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-navy" aria-hidden="true" />
          VAT
          <span className="font-mono text-content">{mix.vat}</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-gold" aria-hidden="true" />
          Percentage
          <span className="font-mono text-content">{mix.percentage}</span>
        </span>
      </div>
    </div>
  );
}

const TWO_COLUMN_GRID = "grid gap-6 lg:grid-cols-[1.9fr_1fr]";

export default function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const canCreateClient = hasPermission("Clients:Create");

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
  });

  const fullName = user?.fullName ?? "";
  const firstName = fullName.split(/\s+/)[0] ?? fullName;

  const addClientAction = canCreateClient ? (
    <Link
      to="/clients/new"
      className="inline-flex items-center rounded-btn bg-navy px-4 py-[10px] text-[13.5px] font-semibold text-white transition-colors hover:bg-navy-hover"
    >
      + Add client
    </Link>
  ) : null;

  const header = (
    <PageHeader
      title={`${greeting(new Date().getHours())}, ${firstName}.`}
      eyebrow={`PORTFOLIO · ${fullName}`}
      actions={addClientAction}
    />
  );

  if (dashboard.isPending) {
    return (
      <div className="animate-fade-rise">
        {header}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="px-6 py-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-9 w-32" />
              <Skeleton className="mt-3 h-3 w-28" />
            </Card>
          ))}
        </div>
        <div className={cn(TWO_COLUMN_GRID, "mt-6")}>
          <Card className="px-6 py-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-5 h-[220px] w-full" />
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

  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="animate-fade-rise">
        {header}
        <Card>
          <ErrorState
            message="The portfolio summary failed to load. Please try again."
            onRetry={() => void dashboard.refetch()}
          />
        </Card>
      </div>
    );
  }

  const data = dashboard.data;
  const kpisAllZero = data.kpis.every((k) => k.value === 0);
  const regimeEmpty = data.regimeMix.vat + data.regimeMix.percentage === 0;
  const isEmptyFirm = kpisAllZero && regimeEmpty;

  if (isEmptyFirm) {
    return (
      <div className="animate-fade-rise">
        {header}
        <Card className="border-dashed">
          <EmptyState
            title="No clients yet"
            description="Add your first client to start tracking income, expenses, tax estimates, and BIR filings across your firm."
          >
            <McrcMark size={56} className="mb-2 opacity-30" />
            {addClientAction}
          </EmptyState>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-rise">
      {header}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((kpi) => (
          <KpiTile key={kpi.label} kpi={kpi} />
        ))}
      </div>

      <div className={cn(TWO_COLUMN_GRID, "mt-6")}>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Income vs expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <IncomeExpensesChart data={data.incomeVsExpenses} />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.recentActivity.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-content-muted">
                No recent activity.
              </p>
            ) : (
              data.recentActivity.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-navy font-mono text-[11px] font-semibold text-gold-soft">
                    {item.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] leading-snug text-content">{item.text}</p>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[.14em] text-content-muted">
                      {item.time}
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className={cn(TWO_COLUMN_GRID, "mt-6")}>
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Upcoming filings</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-line-divider py-0">
            {data.upcomingFilings.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-content-muted">
                No upcoming filings.
              </p>
            ) : (
              data.upcomingFilings.map((item) => <UpcomingRow key={item.id} item={item} />)
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Regime mix</CardTitle>
          </CardHeader>
          <CardContent>
            <RegimeMixBar mix={data.regimeMix} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

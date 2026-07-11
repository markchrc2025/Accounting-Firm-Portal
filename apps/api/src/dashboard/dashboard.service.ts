import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

/** One headline KPI tile on the firm dashboard. */
export interface DashboardKpi {
  label: string;
  value: number;
  isCurrency: boolean;
  delta: string;
}

export interface IncomeVsExpensesPoint {
  month: string;
  income: number;
  expenses: number;
}

export interface RecentActivityItem {
  id: string;
  initials: string;
  text: string;
  time: string;
}

export interface UpcomingFiling {
  id: string;
  form: string;
  client: string;
  period: string;
  due: string;
  urgency: "urgent" | "normal";
}

export interface FirmDashboard {
  kpis: DashboardKpi[];
  incomeVsExpenses: IncomeVsExpensesPoint[];
  recentActivity: RecentActivityItem[];
  upcomingFilings: UpcomingFiling[];
  regimeMix: { vat: number; percentage: number };
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function num(v: Prisma.Decimal | null | undefined): number {
  return v == null ? 0 : v.toNumber();
}

/** First two initials from an actor's display name (e.g. "Jane Roe" → "JR"). */
function initialsOf(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0))
    .filter((c) => c.length > 0);
  const joined = (letters[0] ?? "") + (letters[1] ?? "");
  return (joined || name.slice(0, 2) || "?").toUpperCase();
}

/** Human one-liner from an audit action + entity, e.g. "Created Income Transaction". */
function activityText(action: string, entityType: string): string {
  const verb = action.split(".").pop() ?? action;
  const verbLabel: Record<string, string> = {
    create: "Created",
    update: "Updated",
    delete: "Deleted",
    upload: "Uploaded",
    login: "Signed in to",
    send: "Sent",
    revoke: "Revoked",
  };
  const label = verbLabel[verb] ?? verb.charAt(0).toUpperCase() + verb.slice(1);
  const noun = entityType.replace(/([a-z])([A-Z])/g, "$1 $2");
  return `${label} ${noun}`;
}

/** Relative "N MIN AGO" / "N HR AGO" / "N DAY AGO" from a timestamp. */
function relativeTime(ts: Date, now: number): string {
  const diff = Math.max(0, now - ts.getTime());
  if (diff < HOUR_MS) {
    const m = Math.max(1, Math.floor(diff / MINUTE_MS));
    return `${m} MIN AGO`;
  }
  if (diff < DAY_MS) {
    const h = Math.floor(diff / HOUR_MS);
    return `${h} HR AGO`;
  }
  const d = Math.floor(diff / DAY_MS);
  return `${d} DAY AGO`;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async firmOverview(firmId: string): Promise<FirmDashboard> {
    const clients = await this.prisma.client.findMany({
      where: { firmId },
      select: { id: true, businessName: true, taxType: true, status: true },
    });

    if (clients.length === 0) {
      return {
        kpis: [
          { label: "Portfolio income", value: 0, isCurrency: true, delta: "" },
          { label: "Portfolio expenses", value: 0, isCurrency: true, delta: "" },
          {
            label: "Active clients",
            value: 0,
            isCurrency: false,
            delta: "0 total · 0 active",
          },
          { label: "BIR filings", value: 0, isCurrency: false, delta: "on record" },
        ],
        incomeVsExpenses: [],
        recentActivity: [],
        upcomingFilings: [],
        regimeMix: { vat: 0, percentage: 0 },
      };
    }

    const now = new Date();
    const window = this.monthWindow(now, 6);
    const windowStart = window[0]?.start ?? now;

    const [incomeAgg, expenseAgg, filingCount, incomeRows, expenseRows, auditRows] =
      await Promise.all([
        this.prisma.incomeTransaction.aggregate({
          where: { client: { firmId } },
          _sum: { netAmount: true },
        }),
        this.prisma.purchaseTransaction.aggregate({
          where: { client: { firmId } },
          _sum: { netAmount: true },
        }),
        this.prisma.bIRFiling.count({ where: { client: { firmId } } }),
        this.prisma.incomeTransaction.findMany({
          where: { client: { firmId }, txnDate: { gte: windowStart } },
          select: { txnDate: true, netAmount: true },
        }),
        this.prisma.purchaseTransaction.findMany({
          where: { client: { firmId }, txnDate: { gte: windowStart } },
          select: { txnDate: true, netAmount: true },
        }),
        this.prisma.auditLog.findMany({
          where: {
            OR: [
              { user: { is: { firmId } } },
              { metadata: { path: ["firmId"], equals: firmId } },
            ],
          },
          select: {
            id: true,
            action: true,
            entityType: true,
            timestamp: true,
            user: { select: { fullName: true } },
          },
          orderBy: { timestamp: "desc" },
          take: 5,
        }),
      ]);

    const totalClients = clients.length;
    const activeClients = clients.filter((c) => c.status === "ACTIVE").length;
    const vatClients = clients.filter((c) => c.taxType === "VAT").length;
    const percentageClients = clients.filter((c) => c.taxType === "PERCENTAGE").length;

    const kpis: DashboardKpi[] = [
      {
        label: "Portfolio income",
        value: num(incomeAgg._sum.netAmount),
        isCurrency: true,
        delta: "across the firm",
      },
      {
        label: "Portfolio expenses",
        value: num(expenseAgg._sum.netAmount),
        isCurrency: true,
        delta: "across the firm",
      },
      {
        label: "Active clients",
        value: activeClients,
        isCurrency: false,
        delta: `${totalClients} total · ${activeClients} active`,
      },
      {
        label: "BIR filings",
        value: filingCount,
        isCurrency: false,
        delta: "on record",
      },
    ];

    return {
      kpis,
      incomeVsExpenses: this.groupByMonth(window, incomeRows, expenseRows),
      recentActivity: auditRows.map((r) => {
        const actor = r.user?.fullName ?? "System";
        return {
          id: r.id,
          initials: initialsOf(actor),
          text: activityText(r.action, r.entityType),
          time: relativeTime(r.timestamp, now.getTime()),
        };
      }),
      upcomingFilings: this.upcomingFilings(now, clients),
      regimeMix: { vat: vatClients, percentage: percentageClients },
    };
  }

  /** The last `count` calendar months, oldest first, each with [start, end). */
  private monthWindow(
    now: Date,
    count: number,
  ): { year: number; month: number; start: Date; label: string }[] {
    const out: { year: number; month: number; start: Date; label: string }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        start: d,
        label: MONTH_LABELS[d.getMonth()] ?? "",
      });
    }
    return out;
  }

  private groupByMonth(
    window: { year: number; month: number; label: string }[],
    incomeRows: { txnDate: Date; netAmount: Prisma.Decimal }[],
    expenseRows: { txnDate: Date; netAmount: Prisma.Decimal }[],
  ): IncomeVsExpensesPoint[] {
    const key = (year: number, month: number) => `${year}-${month}`;
    const income = new Map<string, number>();
    const expenses = new Map<string, number>();
    for (const r of incomeRows) {
      const k = key(r.txnDate.getUTCFullYear(), r.txnDate.getUTCMonth());
      income.set(k, (income.get(k) ?? 0) + num(r.netAmount));
    }
    for (const r of expenseRows) {
      const k = key(r.txnDate.getUTCFullYear(), r.txnDate.getUTCMonth());
      expenses.set(k, (expenses.get(k) ?? 0) + num(r.netAmount));
    }
    return window.map((w) => {
      const k = key(w.year, w.month);
      return {
        month: w.label,
        income: income.get(k) ?? 0,
        expenses: expenses.get(k) ?? 0,
      };
    });
  }

  /** Quarterly returns due for each active client, derived from its regime. */
  private upcomingFilings(
    now: Date,
    clients: { id: string; businessName: string; taxType: string | null; status: string }[],
  ): UpcomingFiling[] {
    const quarter = Math.floor(now.getMonth() / 3) + 1; // 1..4
    const year = now.getFullYear();
    // Quarter end month index (0-based) and the due date (25th of the next month).
    const quarterEndMonth = quarter * 3 - 1; // Mar=2, Jun=5, Sep=8, Dec=11
    const dueMonth = (quarterEndMonth + 1) % 12;
    const dueLabel = `DUE ${(MONTH_LABELS[dueMonth] ?? "").toUpperCase()} 25`;

    const out: UpcomingFiling[] = [];
    for (const c of clients) {
      if (c.status !== "ACTIVE") continue;
      const isVat = c.taxType === "VAT";
      const isPercentage = c.taxType === "PERCENTAGE";
      if (!isVat && !isPercentage) continue;
      const form = isVat ? "2550Q" : "2551Q";
      const kind = isVat ? "VAT" : "Percentage";
      out.push({
        id: `${c.id}:${form}:${year}Q${quarter}`,
        form,
        client: c.businessName,
        period: `Q${quarter} ${year} · ${kind} return`,
        due: dueLabel,
        urgency: "normal",
      });
      if (out.length >= 6) break;
    }
    return out;
  }
}

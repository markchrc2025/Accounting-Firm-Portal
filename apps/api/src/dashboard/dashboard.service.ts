import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { ClientScope } from "../rbac/rbac.service";

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
  /** U9 R4: exempt = ACTIVE clients with no regime (they file no business-tax return). */
  regimeMix: { vat: number; percentage: number; exempt: number };
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

  /**
   * `visible` (U4-A1, D42): "all" for a Clients:ViewAll holder — the whole firm, as
   * before — otherwise the caller's visible clients. Every figure is computed over
   * them, and the firm's audit activity appears only for "all".
   */
  async firmOverview(firmId: string, visible: ClientScope = "all"): Promise<FirmDashboard> {
    const scoped = visible !== "all";
    const ids = scoped ? [...visible] : [];
    const clients = await this.prisma.client.findMany({
      where: { firmId, ...(scoped ? { id: { in: ids } } : {}) },
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
        regimeMix: { vat: 0, percentage: 0, exempt: 0 },
      };
    }

    const now = new Date();
    const window = this.monthWindow(now, 6);
    const windowStart = window[0]?.start ?? now;

    // The clients every figure covers: the firm, or the caller's visible ones.
    const of = scoped ? { client: { firmId }, clientId: { in: ids } } : { client: { firmId } };
    const [incomeAgg, expenseAgg, filingCount, incomeRows, expenseRows, auditRows] =
      await Promise.all([
        this.prisma.incomeTransaction.aggregate({
          where: of,
          _sum: { netAmount: true },
        }),
        this.prisma.purchaseTransaction.aggregate({
          where: { ...of, status: "posted" }, // held imports excluded (U6, R7)
          _sum: { netAmount: true },
        }),
        this.prisma.bIRFiling.count({ where: of }),
        this.prisma.incomeTransaction.findMany({
          where: { ...of, txnDate: { gte: windowStart } },
          select: { txnDate: true, netAmount: true },
        }),
        this.prisma.purchaseTransaction.findMany({
          where: { ...of, txnDate: { gte: windowStart }, status: "posted" },
          select: { txnDate: true, netAmount: true },
        }),
        // The firm's audit activity is a firm record: Clients:ViewAll holders only.
        scoped ? Promise.resolve([]) : this.prisma.auditLog.findMany({
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
    const across = scoped ? "across your clients" : "across the firm";

    const totalClients = clients.length;
    const activeClients = clients.filter((c) => c.status === "ACTIVE").length;
    // A client with no regime (EXEMPT, U8 D39) owes no business tax: it is counted
    // in neither regime here and files neither return in upcomingFilings().
    const vatClients = clients.filter((c) => c.taxType === "VAT").length;
    const percentageClients = clients.filter((c) => c.taxType === "PERCENTAGE").length;
    const exemptClients = clients.filter((c) => c.status === "ACTIVE" && c.taxType === null).length;

    const kpis: DashboardKpi[] = [
      {
        label: "Portfolio income",
        value: num(incomeAgg._sum.netAmount),
        isCurrency: true,
        delta: across,
      },
      {
        label: "Portfolio expenses",
        value: num(expenseAgg._sum.netAmount),
        isCurrency: true,
        delta: across,
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
      regimeMix: { vat: vatClients, percentage: percentageClients, exempt: exemptClients },
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

  /**
   * U9 R4 (D45): for each active VAT or PERCENTAGE client, the business-tax return
   * whose deadline comes next — the quarter that most recently ended, until the
   * 25th of the following month has passed, then the quarter after it. Every date
   * is a Manila date (UTC+8, no daylight saving). Sorted by due date, then client
   * name; at most six rows. Exempt clients file no business-tax return.
   */
  private upcomingFilings(
    now: Date,
    clients: { id: string; businessName: string; taxType: string | null; status: string }[],
  ): UpcomingFiling[] {
    const next = dueNext(now);
    const dueLabel = `DUE ${(MONTH_LABELS[next.dueMonth] ?? "").toUpperCase()} 25`;
    const out: (UpcomingFiling & { dueAt: number })[] = [];
    for (const c of clients) {
      if (c.status !== "ACTIVE") continue;
      const isVat = c.taxType === "VAT";
      const isPercentage = c.taxType === "PERCENTAGE";
      if (!isVat && !isPercentage) continue;
      const form = isVat ? "2550Q" : "2551Q";
      const kind = isVat ? "VAT" : "Percentage";
      out.push({
        id: `${c.id}:${form}:${next.year}Q${next.quarter}`,
        form,
        client: c.businessName,
        period: `Q${next.quarter} ${next.year} · ${kind} return`,
        due: dueLabel,
        urgency: "normal",
        dueAt: Date.UTC(next.dueYear, next.dueMonth, 25),
      });
    }
    out.sort((a, b) => a.dueAt - b.dueAt || a.client.localeCompare(b.client));
    return out.slice(0, 6).map(({ dueAt: _dueAt, ...f }) => f);
  }
}

/** Manila is UTC+8 all year. */
const MANILA_OFFSET_MS = 8 * HOUR_MS;

/**
 * The quarterly return whose deadline comes next on `now`'s Manila date: the
 * quarter that most recently ended while its 25th-of-the-next-month deadline has
 * not passed, otherwise the current quarter (due the 25th after it ends).
 */
export function dueNext(now: Date): {
  year: number;
  quarter: number;
  dueYear: number;
  dueMonth: number;
} {
  const m = new Date(now.getTime() + MANILA_OFFSET_MS);
  const year = m.getUTCFullYear();
  const month = m.getUTCMonth(); // 0-based
  const day = m.getUTCDate();
  const current = Math.floor(month / 3) + 1;
  const firstMonthOfCurrent = (current - 1) * 3;
  if (month === firstMonthOfCurrent && day <= 25) {
    // The previous quarter's return is due on the 25th of this month.
    const quarter = current === 1 ? 4 : current - 1;
    return { year: current === 1 ? year - 1 : year, quarter, dueYear: year, dueMonth: month };
  }
  const dueMonth = (current * 3) % 12;
  return { year, quarter: current, dueYear: current === 4 ? year + 1 : year, dueMonth };
}

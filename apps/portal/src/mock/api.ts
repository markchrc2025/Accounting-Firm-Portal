/**
 * In-memory, promise-based mock API for the MCRC portal.
 *
 * Every method returns a Promise and simulates network latency (~350–650ms) so screens
 * exercise their real loading/success paths. The implementation satisfies the `ApiClient`
 * interface (see `./index`), so a real fetch-based client can be dropped in later without
 * touching call sites.
 *
 * ── DEV SCENARIO FLAG (drive the 4 list states WITHOUT a debug UI) ──────────────────────
 * Each method honors a "scenario" resolved from, in order of precedence:
 *   1. a module-level override set via `setScenario(...)` (highest precedence)
 *   2. the URL query string `?state=loading|empty|error`
 *   3. otherwise "default"
 *
 * Effect per scenario:
 *   • "default"  → normal latency, real seed data
 *   • "loading"  → much longer latency (1.6–2.4s) so skeletons stay visible, then real data
 *   • "empty"    → resolves the method's empty value ([] for lists, a zeroed dashboard,
 *                  `undefined` for single-entity getters)
 *   • "error"    → rejects with an `ApiError` so screens render their error state / Retry
 *
 * Examples:
 *   • open the app at `…/clients?state=empty` to preview the empty state
 *   • call `setScenario("error")` from a dev console to force every call to fail
 *   • `setScenario(null)` clears the override and falls back to the URL/default
 */
import type {
  ApiClient,
  Scenario,
} from "./index";
import type {
  AnyTxn,
  AuditFilters,
  AuditRow,
  Client,
  ClientFilters,
  CreateTransactionInput,
  DashboardData,
  ExpenseTxn,
  Filing,
  FilingForm,
  FirmUser,
  IncomeTxn,
  IntegrationClient,
  Invoice,
  PortalUser,
  Service,
  TaxComputation,
} from "../types";
import {
  AUDIT,
  CLIENTS,
  DASHBOARD,
  EXPENSES,
  FILINGS,
  FIRM_USERS,
  INCOME,
  INTEGRATIONS,
  INVOICES,
  PORTAL_USERS,
  SERVICES,
  TAX_COMPUTATIONS,
} from "./seed";

/* ------------------------------------------------------------------------------------- *
 * Scenario resolution
 * ------------------------------------------------------------------------------------- */

let scenarioOverride: Scenario | null = null;

/** Force a scenario for every subsequent call. Pass `null` to clear and fall back to URL. */
export function setScenario(scenario: Scenario | null): void {
  scenarioOverride = scenario;
}

/** The currently forced override, if any. */
export function getScenarioOverride(): Scenario | null {
  return scenarioOverride;
}

function scenarioFromUrl(): Scenario {
  if (typeof window === "undefined") return "default";
  const raw = new URLSearchParams(window.location.search).get("state");
  if (raw === "loading" || raw === "empty" || raw === "error") return raw;
  return "default";
}

function effectiveScenario(): Scenario {
  return scenarioOverride ?? scenarioFromUrl();
}

/* ------------------------------------------------------------------------------------- *
 * Latency + error helpers
 * ------------------------------------------------------------------------------------- */

/** Error thrown when the "error" scenario is active. */
export class ApiError extends Error {
  constructor(message = "Something went wrong while contacting the server.") {
    super(message);
    this.name = "ApiError";
  }
}

function randBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Apply latency + the active scenario to a computed result.
 * @param data       the real (default) value
 * @param emptyValue the value to resolve when the "empty" scenario is active
 */
async function respond<T>(data: T, emptyValue: T): Promise<T> {
  const scenario = effectiveScenario();
  await sleep(scenario === "loading" ? randBetween(1600, 2400) : randBetween(350, 650));
  if (scenario === "error") throw new ApiError();
  if (scenario === "empty") return emptyValue;
  return data;
}

/** Like `respond`, but with no distinct empty value (mutations ignore the empty scenario). */
async function respondValue<T>(data: T): Promise<T> {
  return respond(data, data);
}

const EMPTY_DASHBOARD: DashboardData = {
  kpis: [],
  incomeVsExpenses: [],
  recentActivity: [],
  upcomingFilings: [],
  regimeMix: { vat: 0, percentage: 0 },
};

/* ------------------------------------------------------------------------------------- *
 * Mutable stores (seeded copies so `createTransaction` can append)
 * ------------------------------------------------------------------------------------- */

const incomeStore: IncomeTxn[] = [...INCOME];
const expenseStore: ExpenseTxn[] = [...EXPENSES];
let txnSeq = 0;

/* ------------------------------------------------------------------------------------- *
 * The mock API
 * ------------------------------------------------------------------------------------- */

export const api = {
  async listClients(filters?: ClientFilters): Promise<Client[]> {
    let rows = CLIENTS;
    if (filters) {
      const search = filters.search?.trim().toLowerCase();
      rows = rows.filter((c) => {
        if (search && !c.name.toLowerCase().includes(search) && !c.tin.includes(search)) {
          return false;
        }
        if (filters.regime && c.regime !== filters.regime) return false;
        if (filters.status && c.status !== filters.status) return false;
        if (filters.staff && c.assignedStaff !== filters.staff) return false;
        return true;
      });
    }
    return respond(rows, []);
  },

  async getClient(id: string): Promise<Client | undefined> {
    const client = CLIENTS.find((c) => c.id === id);
    return respond(client, undefined);
  },

  async listIncome(clientId: string, period?: string): Promise<IncomeTxn[]> {
    const rows = incomeStore.filter(
      (t) => t.clientId === clientId && (period === undefined || t.period === period),
    );
    return respond(rows, []);
  },

  async listExpenses(clientId: string, period?: string): Promise<ExpenseTxn[]> {
    const rows = expenseStore.filter(
      (t) => t.clientId === clientId && (period === undefined || t.period === period),
    );
    return respond(rows, []);
  },

  async createTransaction(input: CreateTransactionInput): Promise<AnyTxn> {
    txnSeq += 1;
    if (input.kind === "income") {
      const txn: IncomeTxn = { ...input, id: `in-new-${txnSeq}`, source: input.source ?? "manual" };
      incomeStore.unshift(txn);
      return respondValue(txn);
    }
    const txn: ExpenseTxn = { ...input, id: `ex-new-${txnSeq}`, source: input.source ?? "manual" };
    expenseStore.unshift(txn);
    return respondValue(txn);
  },

  async listFilings(clientId: string, form?: FilingForm): Promise<Filing[]> {
    const rows = FILINGS.filter(
      (f) => f.clientId === clientId && (form === undefined || f.form === form),
    );
    return respond(rows, []);
  },

  async listInvoices(clientId?: string): Promise<Invoice[]> {
    const rows = clientId ? INVOICES.filter((i) => i.clientId === clientId) : INVOICES;
    return respond(rows, []);
  },

  async listUsers(): Promise<FirmUser[]> {
    return respond(FIRM_USERS, []);
  },

  async listPortalUsers(clientId: string): Promise<PortalUser[]> {
    const rows = PORTAL_USERS.filter((u) => u.clientId === clientId);
    return respond(rows, []);
  },

  async listAudit(filters?: AuditFilters): Promise<AuditRow[]> {
    let rows = AUDIT;
    if (filters) {
      const entity = filters.entity?.trim().toLowerCase();
      rows = rows.filter((a) => {
        if (filters.actor && a.actor !== filters.actor) return false;
        if (filters.action && a.action !== filters.action) return false;
        if (entity && !a.entity.toLowerCase().includes(entity)) return false;
        if (filters.dateFrom && a.timestamp < filters.dateFrom) return false;
        if (filters.dateTo && a.timestamp > filters.dateTo) return false;
        return true;
      });
    }
    return respond(rows, []);
  },

  async listServices(): Promise<Service[]> {
    return respond(SERVICES, []);
  },

  async getIntegrations(): Promise<IntegrationClient[]> {
    return respond(INTEGRATIONS, []);
  },

  async getDashboard(): Promise<DashboardData> {
    return respond(DASHBOARD, EMPTY_DASHBOARD);
  },

  async getTaxComputation(clientId: string, period: string): Promise<TaxComputation | undefined> {
    const base = TAX_COMPUTATIONS[clientId];
    const result = base ? { ...base, period } : undefined;
    return respond(result, undefined);
  },
} satisfies ApiClient;

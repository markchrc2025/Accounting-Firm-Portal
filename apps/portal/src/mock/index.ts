/**
 * Mock-API barrel for the MCRC portal.
 *
 * Import the API and seed data from here:
 *   import { api, setScenario, CLIENTS, type ApiClient } from "@/mock";
 *
 * The `ApiClient` interface below is the contract the in-memory `api` satisfies. A real
 * fetch/HTTP client can implement the same interface and replace `api` with zero changes
 * at the call sites (screens depend only on `ApiClient`, never on the mock).
 */
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

/** Dev scenario used to preview the 4 list states without a debug UI. */
export type Scenario = "default" | "loading" | "empty" | "error";

/**
 * The data-access contract. Both the in-memory mock and any future real client implement
 * this, so screens can depend on the interface rather than a concrete implementation.
 */
export interface ApiClient {
  listClients(filters?: ClientFilters): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  listIncome(clientId: string, period?: string): Promise<IncomeTxn[]>;
  listExpenses(clientId: string, period?: string): Promise<ExpenseTxn[]>;
  createTransaction(input: CreateTransactionInput): Promise<AnyTxn>;
  listFilings(clientId: string, form?: FilingForm): Promise<Filing[]>;
  listInvoices(clientId?: string): Promise<Invoice[]>;
  listUsers(): Promise<FirmUser[]>;
  listPortalUsers(clientId: string): Promise<PortalUser[]>;
  listAudit(filters?: AuditFilters): Promise<AuditRow[]>;
  listServices(): Promise<Service[]>;
  getIntegrations(): Promise<IntegrationClient[]>;
  getDashboard(): Promise<DashboardData>;
  getTaxComputation(clientId: string, period: string): Promise<TaxComputation | undefined>;
}

export { api, setScenario, getScenarioOverride, ApiError } from "./api";
export * from "./seed";
export * from "../types";

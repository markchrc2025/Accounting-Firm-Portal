/**
 * Shared entity types for the MCRC Accounting Firm Portal (firm UI + client portal).
 *
 * Money is always a plain `number` (major currency units, e.g. 182500.5 = ₱182,500.50).
 * Formatting to `₱1,234,567.00` happens in the view layer, never here.
 *
 * The tax-classification enums (`VatClass`, `InputVATCategory`, `InputTaxAttribution`) are
 * the FROZEN contract from `@portal/shared` — imported here as the field types, never
 * re-declared. See `packages/shared/src/enums.ts`.
 */
import type {
  VatClass,
  InputVATCategory,
  InputTaxAttribution,
  TransactionSource,
} from "@portal/shared";

export type { VatClass, InputVATCategory, InputTaxAttribution, TransactionSource };

/* ------------------------------------------------------------------------------------- *
 * Roles
 * ------------------------------------------------------------------------------------- */

/** Firm-staff RBAC roles. */
export type FirmRole = "Super Admin" | "Manager" | "Accountant" | "Bookkeeper" | "Auditor";

/** Client-portal roles, scoped to a single organization. */
export type PortalRole = "Owner" | "Manager" | "Viewer";

/* ------------------------------------------------------------------------------------- *
 * Clients (a Portal client maps 1:1 onto a BIR filer record)
 * ------------------------------------------------------------------------------------- */

/**
 * Tax regime. The regime is *derived* from the client's registered BIR tax types
 * (2550Q registered → VAT; 2551Q registered → PERCENTAGE) but is denormalized here for
 * convenient conditional UI. The prototype used the short code `PCT`; the product type is
 * the explicit `"PERCENTAGE"`.
 */
export type Regime = "VAT" | "PERCENTAGE";

export type ClientStatus = "Active" | "Onboarding" | "Inactive";

/** BIR filer identity kind — switches which identity fields apply. */
export type FilerType = "individual" | "company";

/** How the firm bills this engagement (firm-internal; never exported to BIR). */
export type BillingMethod = "Quarterly" | "Monthly" | "As Filing";

export type TaxTypeFrequency = "Monthly" | "Quarterly" | "Annually";

export type TaxpayerClassification = "Small" | "Medium" | "Large";

export type TaxpayerType = "Corporation" | "Partnership" | "OPC" | "Cooperative";

export type CivilStatus = "Single" | "Married" | "Widowed" | "Separated";

/** A single row of the client's registered BIR tax types (from the COR tax-types grid). */
export interface ClientTaxType {
  taxType: string; // e.g. "Value-Added Tax"
  form: string; // e.g. "2550Q", "0619-E", "0605"
  frequency: TaxTypeFrequency;
  startDate: string; // ISO date "YYYY-MM-DD"
}

export interface Client {
  id: string;
  /** Registered / trade name shown in the UI. */
  name: string;
  tradeName?: string;
  filerType: FilerType;
  tin: string; // "010-582-334-000"
  branchCode: string; // "00000"
  rdoCode: string; // "047"
  regime: Regime;
  status: ClientStatus;
  classification: TaxpayerClassification;
  citizenship?: string;
  /** Firm staff member assigned to this client (display name). */
  assignedStaff: string;
  city: string;
  address?: string;
  zip?: string;
  email?: string;
  phone?: string;
  /** Fiscal-year start month, e.g. "January" / "July". */
  fiscalYearStart: string;
  /** Portal seats allocated (minimum 3). */
  seats: number;

  // Individual-only identity fields
  lastName?: string;
  firstName?: string;
  middleName?: string;
  dateOfBirth?: string;
  civilStatus?: CivilStatus;

  // Company-only identity fields
  taxpayerType?: TaxpayerType;
  dateOfIncorporation?: string;

  /** Registered BIR tax types — drives which forms apply and the derived regime. */
  taxTypes: ClientTaxType[];

  // Engagement card (firm-internal — never part of the BIR filer profile)
  professionalFee: number;
  billingMethod: BillingMethod;
}

export interface ClientFilters {
  search?: string; // matches name or TIN
  regime?: Regime;
  status?: ClientStatus;
  staff?: string;
}

/* ------------------------------------------------------------------------------------- *
 * Transactions
 * ------------------------------------------------------------------------------------- */

export type TransactionKind = "income" | "expense";

/**
 * Income record. Amounts are stored NET of VAT (`netAmount`); for PERCENTAGE clients the
 * same field carries gross receipts and `vatClass` is always `NON_VAT`.
 */
export interface IncomeTxn {
  id: string;
  clientId: string;
  kind: "income";
  date: string; // display date, e.g. "Jun 28, 2026"
  reference: string; // "SI-1042"
  customer: string;
  category: string;
  vatClass: VatClass;
  /** Net of VAT (VAT clients) or gross receipts (PERCENTAGE clients). */
  netAmount: number;
  /** VAT + Income only: sale to government / GOCC (5% final VAT withheld). */
  saleToGov?: boolean;
  period: string; // "2026-Q2"
  source: TransactionSource;
}

/**
 * Expense record. `inputVatCategory` and `inputTaxAttribution` are `null` for PERCENTAGE
 * clients (input VAT is not tracked). `amount` is net of VAT for VAT clients.
 */
export interface ExpenseTxn {
  id: string;
  clientId: string;
  kind: "expense";
  date: string;
  reference: string; // "EXP-0871"
  supplier: string;
  category: string;
  /** null for PERCENTAGE clients (shown as "N/A"). */
  inputVatCategory: InputVATCategory | null;
  /** null for PERCENTAGE clients; else how input tax is attributed. */
  inputTaxAttribution: InputTaxAttribution | null;
  /** Deductible for income tax. */
  deductible: boolean;
  amount: number;
  /** CAPITAL_GOODS_GT_1M only: useful life in months (amortization, max 60). */
  usefulLifeMonths?: number;
  period: string;
  source: TransactionSource;
}

export type AnyTxn = IncomeTxn | ExpenseTxn;

/** Discriminated inputs for `createTransaction`. Server assigns `id`/`source`. */
export type CreateIncomeInput = Omit<IncomeTxn, "id" | "source"> & {
  source?: TransactionSource;
};
export type CreateExpenseInput = Omit<ExpenseTxn, "id" | "source"> & {
  source?: TransactionSource;
};
export type CreateTransactionInput = CreateIncomeInput | CreateExpenseInput;

/* ------------------------------------------------------------------------------------- *
 * BIR Filings (pushed read-only by the integration; the Portal displays them)
 * ------------------------------------------------------------------------------------- */

/** Form codes the Portal displays across both regimes. */
export type FilingForm = "2550Q" | "2551Q" | "1701Q" | "1701" | "0619-E";

/** Display lifecycle for a filed artifact (as accepted by eFPS). */
export type FilingDisplayStatus = "Accepted" | "Amended";

export interface Filing {
  id: string;
  clientId: string;
  form: FilingForm;
  period: string; // "Q1 2026 · Quarterly VAT return"
  filed: string; // "Apr 24, 2026"
  reference: string; // "EFPS-882314"
  status: FilingDisplayStatus;
}

/* ------------------------------------------------------------------------------------- *
 * Billing / Invoices
 * ------------------------------------------------------------------------------------- */

export type InvoiceStatus = "Paid" | "Sent" | "Overdue" | "Draft";

export interface InvoiceLineItem {
  description: string;
  qty: number;
  rate: number;
  amount: number;
}

export interface Invoice {
  id: string;
  number: string; // "INV-2026-041"
  clientId: string;
  description: string;
  issued: string; // "Jul 01, 2026"
  due: string; // "Jul 15, 2026"
  amount: number;
  status: InvoiceStatus;
  lineItems: InvoiceLineItem[];
}

/* ------------------------------------------------------------------------------------- *
 * Users
 * ------------------------------------------------------------------------------------- */

export type MfaStatus = "Enrolled" | "Pending";
export type FirmUserStatus = "Active" | "Invited";
export type PortalUserStatus = "Active" | "Invited";

export interface FirmUser {
  id: string;
  name: string;
  email: string;
  role: FirmRole;
  mfa: MfaStatus;
  status: FirmUserStatus;
}

export interface PortalUser {
  id: string;
  clientId: string;
  name: string;
  email: string;
  role: PortalRole;
  status: PortalUserStatus;
}

/* ------------------------------------------------------------------------------------- *
 * Audit log (immutable; includes integration actors)
 * ------------------------------------------------------------------------------------- */

export type AuditAction = "create" | "update" | "delete" | "login" | "export";

export interface AuditRow {
  id: string;
  timestamp: string; // "2026-07-10 17:42:11"
  actor: string;
  action: AuditAction;
  entity: string;
  ip: string;
}

export interface AuditFilters {
  actor?: string;
  action?: AuditAction;
  /** Substring match against the entity description. */
  entity?: string;
  /** Inclusive ISO-ish bounds compared against `timestamp` lexicographically. */
  dateFrom?: string;
  dateTo?: string;
}

/* ------------------------------------------------------------------------------------- *
 * Services catalog
 * ------------------------------------------------------------------------------------- */

export type ServiceStatus = "Active" | "Retired";

export interface Service {
  id: string;
  name: string;
  description: string;
  defaultFee: number;
  billingMethod: BillingMethod;
  status: ServiceStatus;
  /** Optional linked BIR form (drives "As Filing" auto-billing). */
  linkedForm?: FilingForm | null;
}

/* ------------------------------------------------------------------------------------- *
 * Integrations (OAuth2 client-credentials)
 * ------------------------------------------------------------------------------------- */

export type IntegrationStatus = "Active" | "Disabled";

export interface IntegrationClient {
  id: string;
  name: string;
  status: IntegrationStatus;
  clientKey: string;
  /** Returned only at creation/rotation ("reveal once"); masked otherwise. */
  clientSecret: string;
  scopes: string[];
  lastUsed?: string;
}

/* ------------------------------------------------------------------------------------- *
 * Dashboard aggregates
 * ------------------------------------------------------------------------------------- */

export interface KpiCard {
  label: string;
  /** Numeric value (money or count) — formatted by the view. */
  value: number;
  /** True if `value` is a currency figure (drives ₱ formatting). */
  isCurrency: boolean;
  /** Delta caption, e.g. "+12.4% vs last quarter". */
  delta: string;
}

export interface MonthlyIncomeExpense {
  month: string; // "Jan", "Feb", …
  income: number;
  expenses: number;
}

export interface ActivityItem {
  id: string;
  initials: string;
  text: string;
  time: string; // "24 MIN AGO"
}

export interface UpcomingFiling {
  id: string;
  form: FilingForm;
  client: string;
  period: string; // "Q2 2026 · VAT return"
  due: string; // "DUE JUL 25"
  urgency: "urgent" | "normal";
}

export interface RegimeMix {
  vat: number; // count of VAT clients
  percentage: number; // count of PERCENTAGE clients
}

export interface DashboardData {
  kpis: KpiCard[];
  incomeVsExpenses: MonthlyIncomeExpense[];
  recentActivity: ActivityItem[];
  upcomingFilings: UpcomingFiling[];
  regimeMix: RegimeMix;
}

/* ------------------------------------------------------------------------------------- *
 * Tax computation (an in-app ESTIMATE — never the authoritative filed figure)
 * ------------------------------------------------------------------------------------- */

export interface TaxBracket {
  over: number;
  /** `null` = ∞ (top bracket). */
  notOver: number | null;
  baseTax: number;
  rate: number; // percent, e.g. 20
}

/** The authoritative filed counterpart (pushed by the BIR Form Generator). */
export interface FiledReference {
  form: FilingForm;
  figure: number;
  filedDate: string;
  status: string; // "Accepted by eFPS"
}

export interface TaxComputation {
  clientId: string;
  period: string; // "2026-Q2"
  grossIncome: number;
  deductions: number;
  taxableIncome: number;
  brackets: TaxBracket[];
  estimatedTaxDue: number;
  filed: FiledReference;
  /** estimate − filed (positive = estimate higher than filed). */
  variance: number;
}

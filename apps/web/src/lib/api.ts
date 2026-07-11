/** Thin API client with bearer-token auth and JSON handling. */
// Resolution order: runtime config (window.__PORTAL_ENV__, written by the web
// container from API_BASE_URL) → build-time VITE_API_BASE_URL → local default.
const API_BASE_URL =
  (typeof window !== "undefined" && window.__PORTAL_ENV__?.API_BASE_URL) ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000/api/v1";

const TOKEN_KEY = "portal_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const message =
      (body && (body.message as string)) || `Request failed (${res.status})`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

// --- Health (Phase 0) --------------------------------------------------------
export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  shared: { vatClasses: string[]; integrationScopes: string[] };
}
export function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health", { auth: false });
}

// --- Auth --------------------------------------------------------------------
export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  userType: "FIRM" | "CLIENT";
  firmId: string;
  clientId?: string;
  mfaEnabled: boolean;
}

export type LoginResponse =
  | { status: "ok"; accessToken: string; user: PublicUser }
  | { status: "mfa_required"; mfaToken: string };

export function login(email: string, password: string): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ email, password }),
  });
}

export function verifyMfa(
  mfaToken: string,
  code: string,
): Promise<{ accessToken: string; user: PublicUser }> {
  return apiFetch("/auth/mfa/verify", {
    method: "POST",
    auth: false,
    body: JSON.stringify({ mfaToken, code }),
  });
}

export interface PermissionsView {
  global: string[];
  clients: { clientId: string; permissions: string[] }[];
  assignedClientIds: string[];
  canViewAllClients: boolean;
}
export interface MeResponse {
  user: PublicUser;
  permissions: PermissionsView;
}
export function fetchMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me");
}

// --- Clients / Users (read for the dashboard) --------------------------------
export interface ClientSummary {
  id: string;
  businessName: string;
  tin?: string | null;
  taxType?: string | null;
  currency: string;
  status: string;
}

/** One row of the COR "Tax Types" table, as stored in `taxTypesJson`. Mirrors
 *  the API's `TaxTypeRow` (apps/api/src/clients/dto/client.schemas.ts). */
export interface ClientTaxTypeRow {
  type: string;
  form: string;
  frequency: string;
  startDate?: string;
}

/**
 * The full client row the API returns from GET/POST/PATCH /clients — the entire
 * Prisma `Client` record. A superset of `ClientSummary` (so `fetchClient`
 * callers that only read summary fields still type-check) carrying the whole BIR
 * filer profile used to prefill the edit form. Dates come back as ISO datetime
 * strings; `professionalFee` is a Prisma Decimal serialized as a string;
 * `taxTypesJson` is the parsed JSON array.
 */
export interface Client extends ClientSummary {
  kind?: string | null;
  regName?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  tradeName?: string | null;
  branch?: string | null;
  rdo?: string | null;
  rdoName?: string | null;
  city?: string | null;
  zip?: string | null;
  address?: string | null;
  birthdate?: string | null;
  incorpDate?: string | null;
  fiscalYearStart?: string | null;
  email?: string | null;
  phone?: string | null;
  citizenship?: string | null;
  civilStatus?: string | null;
  taxpayerType?: string | null;
  classification?: string | null;
  taxTypesJson?: ClientTaxTypeRow[] | null;
  professionalFee?: string | number | null;
  billingMethod?: string | null;
  seatLimit?: number | null;
  /** S3 object key of the stored COR, or null when none has been uploaded. */
  corPath?: string | null;
}

export function fetchClients(): Promise<ClientSummary[]> {
  return apiFetch<ClientSummary[]>("/clients");
}

export function createClient(body: unknown): Promise<Client> {
  return apiFetch<Client>("/clients", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateClient(clientId: string, body: unknown): Promise<Client> {
  return apiFetch<Client>(`/clients/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

// --- COR file storage (Phase C2) ---------------------------------------------
// The COR is sent as RAW binary (the File itself) with the file's own
// Content-Type — NOT JSON — so the backend stores the bytes verbatim.

/** Fall back to an extension → MIME guess when the browser reports no type,
 *  so the server's content-type allow-list accepts the upload. */
function corContentType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  const byExt: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
  };
  return (ext && byExt[ext]) || "application/octet-stream";
}

export function uploadCor(
  clientId: string,
  file: File,
): Promise<{ corPath: string }> {
  return apiFetch<{ corPath: string }>(`/clients/${clientId}/cor`, {
    method: "PUT",
    headers: { "Content-Type": corContentType(file) },
    body: file,
  });
}

export function getCorUrl(clientId: string): Promise<{ url: string | null }> {
  return apiFetch<{ url: string | null }>(`/clients/${clientId}/cor-url`);
}

export function deleteCor(clientId: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/clients/${clientId}/cor`, {
    method: "DELETE",
  });
}

export interface FirmUserSummary {
  id: string;
  email: string;
  fullName: string;
  status: string;
  mfaEnabled: boolean;
  userRoles: { role: { name: string }; clientScopeId: string | null }[];
}
export function fetchUsers(): Promise<FirmUserSummary[]> {
  return apiFetch<FirmUserSummary[]>("/users");
}

export function acceptInvitation(input: {
  token: string;
  fullName: string;
  password: string;
}): Promise<{ userId: string; email: string; clientId: string }> {
  return apiFetch("/invitations/accept", {
    method: "POST",
    auth: false,
    body: JSON.stringify(input),
  });
}

export function fetchClient(clientId: string): Promise<Client> {
  return apiFetch<Client>(`/clients/${clientId}`);
}

// --- Categories (Phase 2) ----------------------------------------------------
export interface Category {
  id: string;
  clientId: string;
  type: "INCOME" | "EXPENSE";
  name: string;
  isDeductible: boolean;
}
export function fetchCategories(
  clientId: string,
  type?: "INCOME" | "EXPENSE",
): Promise<Category[]> {
  const q = type ? `?type=${type}` : "";
  return apiFetch<Category[]>(`/clients/${clientId}/categories${q}`);
}
export function createCategory(
  clientId: string,
  input: { type: "INCOME" | "EXPENSE"; name: string; isDeductible?: boolean },
): Promise<Category> {
  return apiFetch(`/clients/${clientId}/categories`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// --- Transactions (Phase 2) --------------------------------------------------
export interface IncomeTxn {
  id: string;
  txnDate: string;
  referenceNo?: string;
  customer?: string;
  description: string;
  categoryId: string;
  netAmount: number;
  vatClass: string;
  saleToGovernment: boolean;
  outputVAT?: number;
  creditableVATWithheld5pct?: number;
  atc?: string;
  source: string;
}
export interface PurchaseTxn {
  id: string;
  txnDate: string;
  referenceNo?: string;
  vendor?: string;
  description: string;
  categoryId: string;
  netAmount: number;
  inputVATCategory?: string;
  inputVAT?: number;
  isCapitalGood: boolean;
  capitalGoodAcquisitionCost?: number;
  estimatedUsefulLifeMonths?: number;
  inputTaxAttribution?: string;
  deductible: boolean;
  source: string;
}
export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v);
  return entries.length ? `?${new URLSearchParams(entries as [string, string][])}` : "";
}

export function fetchIncome(
  clientId: string,
  filters: Record<string, string | undefined> = {},
): Promise<Paginated<IncomeTxn>> {
  return apiFetch(`/clients/${clientId}/income-transactions${qs(filters)}`);
}
export function createIncome(clientId: string, body: unknown): Promise<IncomeTxn> {
  return apiFetch(`/clients/${clientId}/income-transactions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updateIncome(
  clientId: string,
  txnId: string,
  body: unknown,
): Promise<IncomeTxn> {
  return apiFetch(`/clients/${clientId}/income-transactions/${txnId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export function deleteIncome(clientId: string, txnId: string): Promise<unknown> {
  return apiFetch(`/clients/${clientId}/income-transactions/${txnId}`, {
    method: "DELETE",
  });
}

export function fetchPurchases(
  clientId: string,
  filters: Record<string, string | undefined> = {},
): Promise<Paginated<PurchaseTxn>> {
  return apiFetch(`/clients/${clientId}/purchase-transactions${qs(filters)}`);
}
export function createPurchase(clientId: string, body: unknown): Promise<PurchaseTxn> {
  return apiFetch(`/clients/${clientId}/purchase-transactions`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
export function updatePurchase(
  clientId: string,
  txnId: string,
  body: unknown,
): Promise<PurchaseTxn> {
  return apiFetch(`/clients/${clientId}/purchase-transactions/${txnId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
export function deletePurchase(clientId: string, txnId: string): Promise<unknown> {
  return apiFetch(`/clients/${clientId}/purchase-transactions/${txnId}`, {
    method: "DELETE",
  });
}

// --- Management-estimate summaries (user-facing; NOT the integration aggregates) ----
export interface IncomeSummary {
  basis: "management-estimate";
  totalNet: number;
  totalOutputVAT: number;
  count: number;
  byVatClass: { vatClass: string; net: number; outputVAT: number; count: number }[];
}
export interface PurchaseSummary {
  basis: "management-estimate";
  totalNet: number;
  totalInputVAT: number;
  count: number;
  deductibleNet: number;
  nonDeductibleNet: number;
  byInputVATCategory: {
    inputVATCategory: string | null;
    net: number;
    inputVAT: number;
    count: number;
  }[];
}
export function fetchIncomeSummary(
  clientId: string,
  filters: Record<string, string | undefined> = {},
): Promise<IncomeSummary> {
  return apiFetch(`/clients/${clientId}/income-transactions/summary${qs(filters)}`);
}
export function fetchPurchaseSummary(
  clientId: string,
  filters: Record<string, string | undefined> = {},
): Promise<PurchaseSummary> {
  return apiFetch(`/clients/${clientId}/purchase-transactions/summary${qs(filters)}`);
}

// --- BIR filings (firm-facing read; the integration owns the authoritative push) ----
export interface Filing {
  id: string;
  form: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  xmlFilename: string;
  pdfUrl: string | null;
  updatedAt: string;
}
export function fetchFilings(clientId: string): Promise<Filing[]> {
  return apiFetch(`/clients/${clientId}/filings`);
}

// --- Services catalog (firm-scoped; seeds engagement fees + invoice line items) -----
export interface Service {
  id: string;
  name: string;
  description: string;
  /** Prisma Decimal serialized as a string; may also arrive as a number. */
  defaultFee: string | number;
  billingMethod: string; // "Quarterly" | "Monthly" | "As Filing"
  linkedForm: string | null; // FormCode or null
  status: string; // "Active" | "Retired"
}
export interface ServiceInput {
  name: string;
  description?: string;
  defaultFee: number;
  billingMethod: string;
  linkedForm?: string | null;
  status?: string;
}
export function fetchServices(): Promise<Service[]> {
  return apiFetch<Service[]>("/services");
}
export function createService(body: ServiceInput): Promise<Service> {
  return apiFetch("/services", { method: "POST", body: JSON.stringify(body) });
}
export function updateService(id: string, body: Partial<ServiceInput>): Promise<Service> {
  return apiFetch(`/services/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

// --- Tax rules (per-client management-estimate config; NOT the authoritative BIR calc) --
export type TaxMethod = "graduated" | "flat" | "percentage" | "simplified8";
export interface TaxBracket {
  over: number;
  notOver: number | null;
  baseTax: number;
  rate: number;
}
export interface TaxRule {
  method: TaxMethod;
  /** Single rate (%) for flat / percentage / simplified8; null for graduated. */
  flatRate: number | null;
  brackets: TaxBracket[];
}
export function fetchTaxRules(clientId: string): Promise<TaxRule> {
  return apiFetch<TaxRule>(`/clients/${clientId}/tax-rules`);
}
export function saveTaxRules(clientId: string, body: TaxRule): Promise<TaxRule> {
  return apiFetch(`/clients/${clientId}/tax-rules`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// --- Billing / Invoices (firm-scoped; billed against a client) ----------------------
export interface InvoiceLineItem {
  id?: string;
  description: string;
  qty: number | string;
  rate: number | string;
  amount: number | string;
}
export interface Invoice {
  id: string;
  number: string;
  clientId: string;
  /** Joined convenience field — the client's business name. */
  clientName?: string;
  description: string;
  issuedDate: string;
  dueDate: string;
  status: string; // "Draft" | "Sent" | "Paid" | "Overdue"
  subtotal: number | string;
  vat: number | string;
  total: number | string;
  lineItems: InvoiceLineItem[];
}
export interface InvoiceLineItemInput {
  description: string;
  qty: number;
  rate: number;
}
export interface InvoiceInput {
  clientId: string;
  description?: string;
  issuedDate: string;
  dueDate: string;
  lineItems: InvoiceLineItemInput[];
  status?: string;
}
export function fetchInvoices(clientId?: string): Promise<Invoice[]> {
  return apiFetch<Invoice[]>(`/invoices${clientId ? `?clientId=${clientId}` : ""}`);
}
export function createInvoice(body: InvoiceInput): Promise<Invoice> {
  return apiFetch("/invoices", { method: "POST", body: JSON.stringify(body) });
}
export function updateInvoice(id: string, body: Partial<InvoiceInput>): Promise<Invoice> {
  return apiFetch(`/invoices/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}
export function sendInvoice(id: string): Promise<Invoice> {
  return apiFetch(`/invoices/${id}/send`, { method: "POST" });
}

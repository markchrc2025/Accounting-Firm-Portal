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

// --- BIR tax-code reference data ---------------------------------------------
export interface BirTaxType {
  code: string;
  name: string;
  forms: string[];
  status: string;
  notes?: string | null;
}
export interface BirAtcCode {
  atc: string;
  classification: string;
  taxTypeCode: string;
  payeeType: string;
  description: string;
  condition?: string | null;
  rate?: string | number | null;
  rateBasis?: string | null;
  thresholdAmount?: string | number | null;
  bracket?: string | null;
  forms: string[];
  certificate?: string | null;
  status: string;
  notes?: string | null;
}
export function fetchBirTaxTypes(status?: string): Promise<BirTaxType[]> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch<BirTaxType[]>(`/bir/tax-types${q}`);
}
export function fetchBirAtcCodes(filters?: {
  classification?: string;
  taxTypeCode?: string;
  status?: string;
  search?: string;
}): Promise<BirAtcCode[]> {
  const p = new URLSearchParams();
  if (filters?.classification) p.set("classification", filters.classification);
  if (filters?.taxTypeCode) p.set("taxTypeCode", filters.taxTypeCode);
  if (filters?.status) p.set("status", filters.status);
  if (filters?.search) p.set("search", filters.search);
  const q = p.toString();
  return apiFetch<BirAtcCode[]>(`/bir/atc-codes${q ? `?${q}` : ""}`);
}

// --- Chart of Accounts reference data -----------------------------------------
export interface ChartAccount {
  code: string;
  name: string;
  class: string;
  accountType: string;
  parentCode?: string | null;
  /** Resolved name of the parent group/account (server-side join). */
  parentName?: string | null;
  normalBalance: string;
  currency: string;
  lockDate?: string | null;
  monthlyMovement: boolean;
  description?: string | null;
  postable?: boolean;
  source?: string; // "seed" | "custom"
  editedAt?: string | null;
  archived?: boolean;
}
export interface CoaParent {
  code: string;
  name: string;
  class: string;
  postable: boolean;
}
export interface AccountTaxMapping {
  accountCode: string;
  taxCategory: string;
  accountName: string;
  taxReturnLine?: string | null;
  source?: string;
  editedAt?: string | null;
}
export function fetchChartAccounts(filters?: {
  class?: string;
  search?: string;
}): Promise<ChartAccount[]> {
  const p = new URLSearchParams();
  if (filters?.class) p.set("class", filters.class);
  if (filters?.search) p.set("search", filters.search);
  const q = p.toString();
  return apiFetch<ChartAccount[]>(`/coa/accounts${q ? `?${q}` : ""}`);
}
export function fetchAccountTaxMappings(): Promise<AccountTaxMapping[]> {
  return apiFetch<AccountTaxMapping[]>("/coa/mappings");
}
export function fetchCoaParents(): Promise<CoaParent[]> {
  return apiFetch<CoaParent[]>("/coa/parents");
}
export interface ChartAccountInput {
  code: string;
  name: string;
  class: string;
  accountType: string;
  parentCode?: string;
  description?: string;
  monthlyMovement?: boolean;
  taxReturnLine?: string;
}
export function createChartAccount(body: ChartAccountInput): Promise<ChartAccount> {
  return apiFetch("/coa/accounts", { method: "POST", body: JSON.stringify(body) });
}
export function updateChartAccount(
  code: string,
  body: Partial<Omit<ChartAccountInput, "code" | "taxReturnLine">>,
): Promise<ChartAccount> {
  return apiFetch(`/coa/accounts/${code}`, { method: "PATCH", body: JSON.stringify(body) });
}
export function archiveChartAccount(code: string): Promise<ChartAccount> {
  return apiFetch(`/coa/accounts/${code}/archive`, { method: "POST" });
}
export function restoreChartAccount(code: string): Promise<ChartAccount> {
  return apiFetch(`/coa/accounts/${code}/restore`, { method: "POST" });
}
export function setAccountTaxMapping(
  accountCode: string,
  taxReturnLine: string,
): Promise<AccountTaxMapping> {
  return apiFetch(`/coa/mappings/${accountCode}`, {
    method: "PUT",
    body: JSON.stringify({ taxReturnLine }),
  });
}
export function deleteAccountTaxMapping(accountCode: string): Promise<{ ok: boolean }> {
  return apiFetch(`/coa/mappings/${accountCode}`, { method: "DELETE" });
}

// --- Financial Statement Creator (standalone) --------------------------------
export interface FsPeriod {
  id: string;
  label: string;
  endDate: string | null;
  periodType: string;
  sortOrder: number;
}
export interface FsReport {
  id: string;
  clientId?: string | null;
  clientName?: string | null;
  entityName: string;
  secRegistrationNo?: string | null;
  registeredAddress?: string | null;
  businessDescription?: string | null;
  framework: string;
  functionalCurrency: string;
  approvalDate?: string | null;
  authorizedShares?: number | null;
  issuedShares?: number | null;
  parValue?: number | null;
  includeNotes?: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  periods: FsPeriod[];
}
export interface FsRow {
  kind: "section" | "group" | "line" | "subtotal" | "total" | "spacer";
  label: string;
  level: number;
  code?: string;
  amounts?: Record<string, number>;
  emphasis?: boolean;
}
export interface FsStatements {
  report: FsReport;
  periods: { id: string; label: string; endDate: string | null; sortOrder: number }[];
  incomeStatement: { rows: FsRow[]; netIncomeAfterTax: Record<string, number> };
  balanceSheet: {
    rows: FsRow[];
    totalAssets: Record<string, number>;
    totalLiabilitiesAndEquity: Record<string, number>;
    balanceCheck: Record<string, number>;
  };
  cashFlow: { rows: FsRow[]; check: Record<string, number> };
  changesInEquity: { rows: FsRow[] };
}
export interface TrialBalanceRow {
  periodId: string;
  accountCode: string;
  amount: number;
}
export interface FsAdjustment {
  id: string;
  periodId: string;
  memo: string;
  createdAt: string;
  lines: { accountCode: string; debit: number; credit: number }[];
}
export interface FsPeriodInput {
  label: string;
  endDate: string;
  periodType?: "FY" | "Interim";
}
export interface CreateFsReportInput {
  clientId?: string;
  entityName?: string;
  secRegistrationNo?: string;
  registeredAddress?: string;
  businessDescription?: string;
  framework?: string;
  functionalCurrency?: string;
  approvalDate?: string;
  authorizedShares?: number;
  issuedShares?: number;
  parValue?: number;
  includeNotes?: boolean;
  periods: FsPeriodInput[];
}

export function fetchFsReports(): Promise<FsReport[]> {
  return apiFetch<FsReport[]>("/fs/reports");
}
export function fetchFsReport(id: string): Promise<FsReport> {
  return apiFetch<FsReport>(`/fs/reports/${id}`);
}
export function createFsReport(body: CreateFsReportInput): Promise<FsReport> {
  return apiFetch("/fs/reports", { method: "POST", body: JSON.stringify(body) });
}
export function updateFsReport(id: string, body: Partial<Omit<CreateFsReportInput, "periods">> & { status?: string }): Promise<FsReport> {
  return apiFetch(`/fs/reports/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}
export function deleteFsReport(id: string): Promise<{ ok: boolean }> {
  return apiFetch(`/fs/reports/${id}`, { method: "DELETE" });
}
export function setFsPeriods(id: string, periods: FsPeriodInput[]): Promise<FsReport> {
  return apiFetch(`/fs/reports/${id}/periods`, { method: "PUT", body: JSON.stringify({ periods }) });
}
export function fetchFsTrialBalance(id: string): Promise<TrialBalanceRow[]> {
  return apiFetch<TrialBalanceRow[]>(`/fs/reports/${id}/trial-balance`);
}
export function setFsTrialBalance(
  id: string,
  periodId: string,
  entries: { accountCode: string; amount: number }[],
): Promise<{ ok: boolean; entries: number }> {
  return apiFetch(`/fs/reports/${id}/periods/${periodId}/trial-balance`, {
    method: "PUT",
    body: JSON.stringify({ entries }),
  });
}
export function fetchFsAdjustments(id: string): Promise<FsAdjustment[]> {
  return apiFetch<FsAdjustment[]>(`/fs/reports/${id}/adjustments`);
}
export function createFsAdjustment(
  id: string,
  body: { periodId: string; memo?: string; lines: { accountCode: string; debit?: number; credit?: number }[] },
): Promise<{ id: string }> {
  return apiFetch(`/fs/reports/${id}/adjustments`, { method: "POST", body: JSON.stringify(body) });
}
export function deleteFsAdjustment(id: string, adjustmentId: string): Promise<{ ok: boolean }> {
  return apiFetch(`/fs/reports/${id}/adjustments/${adjustmentId}`, { method: "DELETE" });
}
export function fetchFsStatements(id: string): Promise<FsStatements> {
  return apiFetch<FsStatements>(`/fs/reports/${id}/statements`);
}

export interface FsNoteTableRow {
  label: string;
  amounts: Record<string, number>;
  emphasis?: boolean;
}
export interface FsNoteDocItem {
  number: number;
  key: string;
  kind: "policy" | "account" | "custom";
  id?: string;
  title: string;
  paragraphs?: string[];
  table?: { rows: FsNoteTableRow[] };
}
export interface FsPolicyBlock {
  blockKey: string;
  title: string;
  body: string;
  included: boolean;
  overridden: boolean;
}
export interface FsCustomNote {
  id: string;
  title: string | null;
  body: string;
  included: boolean;
  sortOrder: number;
}
export interface FsNotesDocument {
  report: FsReport;
  periods: { id: string; label: string; endDate: string | null; sortOrder: number }[];
  document: FsNoteDocItem[];
  policyBlocks: FsPolicyBlock[];
  customNotes: FsCustomNote[];
}

export function fetchFsNotes(id: string): Promise<FsNotesDocument> {
  return apiFetch<FsNotesDocument>(`/fs/reports/${id}/notes`);
}
/** Download the assembled AFS workbook. Returns the file blob, the server's
 *  suggested filename (Content-Disposition) and the export-warning count. */
export async function exportFsReport(
  id: string,
  options?: { presentation?: "formal" | "detailed" },
): Promise<{ blob: Blob; filename: string; warnings: number }> {
  const token = getToken();
  const q = options?.presentation ? `?presentation=${options.presentation}` : "";
  const res = await fetch(`${API_BASE_URL}/fs/reports/${id}/export${q}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    // Error paths return the usual JSON envelope — surface its message.
    let message = `Export failed (${res.status})`;
    let body: unknown;
    try {
      body = JSON.parse(await res.text());
      const m = (body as { message?: unknown }).message;
      if (typeof m === "string" && m) message = m;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new ApiError(res.status, message, body);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "Financial Statements.xlsx";
  const warnings = Number(res.headers.get("X-Export-Warnings") ?? "0") || 0;
  return { blob: await res.blob(), filename, warnings };
}
export function setFsPolicyNote(
  id: string,
  blockKey: string,
  body: { included?: boolean; title?: string; body?: string },
): Promise<FsNotesDocument> {
  return apiFetch(`/fs/reports/${id}/notes/policy/${blockKey}`, { method: "PUT", body: JSON.stringify(body) });
}
export function resetFsPolicyNote(id: string, blockKey: string): Promise<FsNotesDocument> {
  return apiFetch(`/fs/reports/${id}/notes/policy/${blockKey}`, { method: "DELETE" });
}
export function addFsCustomNote(id: string, body: { title?: string; body: string }): Promise<FsNotesDocument> {
  return apiFetch(`/fs/reports/${id}/notes/custom`, { method: "POST", body: JSON.stringify(body) });
}
export function updateFsCustomNote(
  id: string,
  noteId: string,
  body: { title?: string; body?: string; included?: boolean },
): Promise<FsNotesDocument> {
  return apiFetch(`/fs/reports/${id}/notes/custom/${noteId}`, { method: "PATCH", body: JSON.stringify(body) });
}
export function deleteFsCustomNote(id: string, noteId: string): Promise<FsNotesDocument> {
  return apiFetch(`/fs/reports/${id}/notes/custom/${noteId}`, { method: "DELETE" });
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
/** Re-issue a fresh access token for the current session (sliding refresh). */
export function refreshSession(): Promise<{ accessToken: string }> {
  return apiFetch<{ accessToken: string }>("/auth/refresh", { method: "POST" });
}

// --- Clients / Users (read for the dashboard) --------------------------------
export interface ClientSummary {
  id: string;
  businessName: string;
  tin?: string | null;
  taxType?: string | null;
  currency: string;
  status: string;
  // Location — surfaced on the roster for filtering/slicing (the list endpoint
  // returns full client rows, so these are always present).
  city?: string | null;
  province?: string | null;
  region?: string | null;
  /** Sub-client billing link: the main client this one is billed under. */
  billingParentId?: string | null;
  /** Firm-only engagement fee (Decimal serializes as a string over JSON). */
  professionalFee?: number | string | null;
}

/** One row of the COR "Tax Types" table, as stored in `taxTypesJson`. Mirrors
 *  the API's `TaxTypeRow` (apps/api/src/clients/dto/client.schemas.ts). */
export interface ClientTaxTypeRow {
  type: string;
  form: string;
  frequency: string;
  startDate?: string;
}

/** One branch office of a client (same TIN, distinct branch code). */
export interface ClientBranch {
  branchCode: string;
  tradeName: string;
  address: string;
  city: string;
  province: string;
  region: string;
  zip: string;
  rdo: string;
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
  province?: string | null;
  region?: string | null;
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
  hasBranches?: boolean | null;
  branchesJson?: ClientBranch[] | null;
  professionalFee?: string | number | null;
  billingMethod?: string | null;
  /** Sub-client billing link: billed under this main client (billing/AR only). */
  billingParentId?: string | null;
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

/** One object in the firm's storage bucket, mapped to its client (Documents page). */
export interface StoredFile {
  key: string;
  kind: "cor";
  size: number;
  lastModified: string | null;
  clientId: string | null;
  clientName: string | null;
  tin: string | null;
  clientStatus: string | null;
}

export function fetchStoredFiles(): Promise<{ files: StoredFile[] }> {
  return apiFetch<{ files: StoredFile[] }>("/files");
}

export function fetchStoredFileUrl(key: string): Promise<{ url: string }> {
  return apiFetch<{ url: string }>(`/files/url?key=${encodeURIComponent(key)}`);
}

export interface FirmUserSummary {
  id: string;
  email: string;
  fullName: string;
  status: string;
  mfaEnabled: boolean;
  /** Presigned URL of the user's profile photo, or null. */
  avatarUrl?: string | null;
  userRoles: { role: { name: string }; clientScopeId: string | null }[];
}
export function fetchUsers(): Promise<FirmUserSummary[]> {
  return apiFetch<FirmUserSummary[]>("/users");
}

// --- Firm-staff invitations (Users & Roles) -------------------------------------
export interface FirmInvitation {
  id: string;
  email: string;
  role: string;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
  /** Invite-email delivery: null = never attempted. */
  emailStatus: "SENT" | "FAILED" | null;
  emailError?: string | null;
  invitedByName?: string | null;
}
export function fetchFirmInvitations(): Promise<FirmInvitation[]> {
  return apiFetch("/firm-invitations");
}
export function createFirmInvitation(body: {
  email: string;
  roleName: string;
}): Promise<FirmInvitation> {
  return apiFetch("/firm-invitations", { method: "POST", body: JSON.stringify(body) });
}
export function resendFirmInvitation(id: string): Promise<FirmInvitation> {
  return apiFetch(`/firm-invitations/${id}/resend`, { method: "POST" });
}
export function revokeFirmInvitation(id: string): Promise<{ revoked: boolean }> {
  return apiFetch(`/firm-invitations/${id}/revoke`, { method: "POST" });
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
  customerTin?: string;
  dueDate?: string;
  terms?: string;
  account?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
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
  vendorTin?: string;
  dueDate?: string;
  account?: string;
  atc?: string;
  taxAmount?: number;
  /** Creditable withholding tax withheld from the supplier (ATC in `atc`). */
  whtAmount?: number;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
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
/** Fetch every income row matching the filters (pages through for export). */
export async function fetchAllIncome(
  clientId: string,
  filters: Record<string, string | undefined> = {},
): Promise<IncomeTxn[]> {
  const out: IncomeTxn[] = [];
  for (let page = 1; page <= 200; page++) {
    const res = await fetchIncome(clientId, { ...filters, page: String(page), pageSize: "200" });
    out.push(...res.data);
    if (out.length >= res.total || res.data.length === 0) break;
  }
  return out;
}
export interface ImportResult {
  created: number;
  failed: number;
  errors: { row: number; message: string }[];
}
export function importIncome(
  clientId: string,
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  return apiFetch(`/clients/${clientId}/income-transactions/import`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
}
export function importPurchases(
  clientId: string,
  rows: Record<string, unknown>[],
): Promise<ImportResult> {
  return apiFetch(`/clients/${clientId}/purchase-transactions/import`, {
    method: "POST",
    body: JSON.stringify({ rows }),
  });
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
/** Fetch every purchase row matching the filters (pages through for export). */
export async function fetchAllPurchases(
  clientId: string,
  filters: Record<string, string | undefined> = {},
): Promise<PurchaseTxn[]> {
  const out: PurchaseTxn[] = [];
  for (let page = 1; page <= 200; page++) {
    const res = await fetchPurchases(clientId, { ...filters, page: String(page), pageSize: "200" });
    out.push(...res.data);
    if (out.length >= res.total || res.data.length === 0) break;
  }
  return out;
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
  /** Sub-client the engagement was for, when billed under a main client. */
  billedForClientId?: string | null;
  billedForName?: string | null;
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

// --- Integration clients (OAuth2 machine-to-machine credentials) --------------------
export interface Integration {
  id: string;
  name: string;
  clientKey: string;
  scopes: string[];
  status: string; // "ACTIVE" | "DISABLED"
  lastUsedAt: string | null;
}
/** Returned ONLY at creation/rotation — the plaintext secret is shown once. */
export interface IntegrationReveal extends Integration {
  clientSecret: string;
}
export function fetchIntegrations(): Promise<Integration[]> {
  return apiFetch<Integration[]>("/integrations");
}
export function createIntegration(body: {
  name: string;
  scopes: string[];
}): Promise<IntegrationReveal> {
  return apiFetch("/integrations", { method: "POST", body: JSON.stringify(body) });
}
export function rotateIntegrationSecret(id: string): Promise<IntegrationReveal> {
  return apiFetch(`/integrations/${id}/rotate`, { method: "POST" });
}
export function revokeIntegration(id: string): Promise<Integration> {
  return apiFetch(`/integrations/${id}/revoke`, { method: "POST" });
}

// --- Claude connector (MCP) — Super Admin only ---------------------------------
export interface McpConnector {
  enabled: boolean;
  /** "portal" = rotated from this page; "environment" = MCP_SHARED_SECRET env var. */
  source: "portal" | "environment" | null;
  secret: string | null;
}
export function fetchMcpConnector(): Promise<McpConnector> {
  return apiFetch("/mcp-connector");
}
export function rotateMcpConnector(): Promise<McpConnector> {
  return apiFetch("/mcp-connector/rotate", { method: "POST" });
}
export function disableMcpConnector(): Promise<McpConnector> {
  return apiFetch("/mcp-connector/disable", { method: "POST" });
}
/** The full connector URL Claude needs (the API base already ends in /api/v1). */
export function mcpConnectorUrl(secret: string): string {
  const base = API_BASE_URL.startsWith("http")
    ? API_BASE_URL
    : `${window.location.origin}${API_BASE_URL}`;
  return `${base}/mcp/${secret}`;
}

// --- Audit log (append-only; firm-scoped read) --------------------------------------
export interface AuditRow {
  id: string;
  timestamp: string;
  /** Resolved actor name (user full name, or "Integration"/"System"). */
  actor: string;
  action: string; // "create" | "update" | "delete" | "login" | "export" | …
  entityType: string;
  entityId: string | null;
  ipAddress: string | null;
}
export interface AuditFilters {
  actor?: string;
  action?: string;
  entity?: string;
  from?: string;
  to?: string;
}
export function fetchAuditLogs(filters: AuditFilters = {}): Promise<AuditRow[]> {
  return apiFetch<AuditRow[]>(`/audit-logs${qs(filters as Record<string, string | undefined>)}`);
}

// --- Client portal (a CLIENT user's own organization) -------------------------------
export interface PortalContext {
  id: string;
  businessName: string;
  taxType: string | null;
  status: string;
  seatLimit: number | null;
}
export interface PortalUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  status: string;
}
export function fetchPortalContext(): Promise<PortalContext> {
  return apiFetch<PortalContext>("/portal/context");
}
export function fetchPortalUsers(): Promise<PortalUser[]> {
  return apiFetch<PortalUser[]>("/portal/users");
}

// --- Firm dashboard aggregates ------------------------------------------------------
export interface DashboardKpi {
  label: string;
  value: number;
  isCurrency: boolean;
  delta: string;
}
export interface DashboardMonthPoint {
  month: string;
  income: number;
  expenses: number;
}
export interface DashboardActivity {
  id: string;
  initials: string;
  text: string;
  time: string;
}
export interface DashboardUpcomingFiling {
  id: string;
  form: string;
  client: string;
  period: string;
  due: string;
  urgency: "urgent" | "normal";
}
export interface DashboardData {
  kpis: DashboardKpi[];
  incomeVsExpenses: DashboardMonthPoint[];
  recentActivity: DashboardActivity[];
  upcomingFilings: DashboardUpcomingFiling[];
  regimeMix: { vat: number; percentage: number };
}
export function fetchDashboard(): Promise<DashboardData> {
  return apiFetch<DashboardData>("/dashboard");
}

// --- User profile + avatar (own account) --------------------------------------------
export interface Profile {
  id: string;
  fullName: string;
  email: string;
  userType: "FIRM" | "CLIENT";
  mfaEnabled: boolean;
  /** Presigned URL of the uploaded profile photo, or null. */
  avatarUrl: string | null;
}
export function fetchProfile(): Promise<Profile> {
  return apiFetch<Profile>("/profile/me");
}
export function updateProfile(body: { fullName: string }): Promise<Profile> {
  return apiFetch("/profile/me", { method: "PATCH", body: JSON.stringify(body) });
}
/** Change the login email (firm users only; re-authenticates with the password). */
export function changeProfileEmail(body: {
  newEmail: string;
  currentPassword: string;
}): Promise<Profile> {
  return apiFetch("/profile/me/email", { method: "PATCH", body: JSON.stringify(body) });
}
/**
 * Upload a profile photo. Uses XMLHttpRequest (not fetch) so the caller can
 * observe real upload progress: `onProgress` receives an integer 0–100, and
 * -1 once the bytes are fully sent but the server is still responding
 * (indeterminate tail — e.g. object-storage write + presign).
 */
export function uploadAvatar(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<{ avatarUrl: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${API_BASE_URL}/profile/me/avatar`);
    xhr.responseType = "text";
    xhr.setRequestHeader("Content-Type", file.type);
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (!onProgress) return;
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    // Bytes fully sent; server now processing — switch the ring to indeterminate.
    xhr.upload.onload = () => onProgress?.(-1);

    xhr.onload = () => {
      const text = xhr.responseText;
      const body = text ? JSON.parse(text) : undefined;
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as { avatarUrl: string });
      } else {
        const message =
          (body && (body.message as string)) || `Request failed (${xhr.status})`;
        reject(new ApiError(xhr.status, message, body));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload."));
    xhr.send(file);
  });
}
export function deleteAvatar(): Promise<{ ok: boolean }> {
  return apiFetch("/profile/me/avatar", { method: "DELETE" });
}

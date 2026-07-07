/** Thin API client with bearer-token auth and JSON handling. */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000/api/v1";

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
export function fetchClients(): Promise<ClientSummary[]> {
  return apiFetch<ClientSummary[]>("/clients");
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

export function fetchClient(clientId: string): Promise<ClientSummary> {
  return apiFetch<ClientSummary>(`/clients/${clientId}`);
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

// apiTokens.ts - a person's personal API tokens (PB3, Track A PA3 / D67): the list, making one
// (the only moment the token itself is ever answered), revoking, and for a Super Admin every token
// of the firm. A token is never stored here: the one made is held by the page that made it, in its
// own state, until it is closed.
import { apiFetch } from "./api";

export const TOKEN_SCOPES = ["read", "read_write"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const TOKEN_SCOPE_LABEL: Record<TokenScope, string> = {
  read: "Read",
  read_write: "Read and write",
};
export const tokenScopeLabel = (s: string): string =>
  TOKEN_SCOPE_LABEL[s as TokenScope] ?? s;

export interface ApiToken {
  id: string;
  name: string;
  scope: TokenScope;
  /** The first characters of the token, to tell tokens apart. */
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}
export interface FirmApiToken extends ApiToken {
  owner: { id: string; fullName: string; email: string };
}
/** The answer to making a token: the token is in it, and never in any other answer. */
export interface CreatedApiToken extends ApiToken {
  token: string;
}

export const fetchMyTokens = () => apiFetch<{ items: ApiToken[] }>("/tokens");
export const fetchFirmTokens = () => apiFetch<{ items: FirmApiToken[] }>("/tokens/firm");
export const createApiToken = (b: { name: string; scope: TokenScope }) =>
  apiFetch<CreatedApiToken>("/tokens", { method: "POST", body: JSON.stringify(b) });
export const revokeApiToken = (id: string) =>
  apiFetch<ApiToken>(`/tokens/${encodeURIComponent(id)}/revoke`, { method: "POST" });

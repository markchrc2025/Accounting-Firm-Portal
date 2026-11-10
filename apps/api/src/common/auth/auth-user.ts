import type { Request } from "express";

/** Discriminates a firm-staff account from a client-portal account. */
export type UserType = "FIRM" | "CLIENT";

/**
 * The authenticated principal attached to a request by JwtAuthGuard.
 * `clientId` is set for CLIENT users (their own organization) and is undefined
 * for FIRM users, whose client visibility is resolved via assignments.
 */
export interface AuthUser {
  id: string;
  firmId: string;
  userType: UserType;
  email: string;
  clientId?: string;
  /**
   * PA3 (D67): set by the sign-in guard when the call came with a personal API token. The Projects
   * module logs such a change through the "api" channel, with the work session the caller named.
   */
  via?: { channel: "api"; sessionId: string | null; tokenId: string };
}

/** Token kinds issued by the auth service. */
export type TokenType = "access" | "mfa" | "integration";

/** JWT payload shape (claims). */
export interface JwtPayload {
  sub: string; // user id
  firmId: string;
  userType: UserType;
  email: string;
  typ: TokenType;
  clientId?: string;
}

export interface RequestWithUser extends Request {
  user?: AuthUser;
  /** PA3 (D67): the personal API token the call came with, when it did. */
  apiToken?: { id: string };
}

/**
 * The machine principal attached to a request by IntegrationAuthGuard for
 * server-to-server (OAuth2 client-credentials) calls from the BIR Form Generator.
 * It is firm-scoped and carries the granted OAuth scopes; per-client visibility
 * is still enforced at the data layer (the client must belong to `firmId`).
 */
export interface IntegrationPrincipal {
  /** IntegrationClient id (the `sub` claim). */
  id: string;
  firmId: string;
  scopes: string[];
}

/** JWT payload for an integration (client-credentials) token. */
export interface IntegrationJwtPayload {
  sub: string; // IntegrationClient id
  firmId: string;
  typ: "integration";
  scopes: string[];
}

export interface RequestWithIntegration extends Request {
  integration?: IntegrationPrincipal;
}

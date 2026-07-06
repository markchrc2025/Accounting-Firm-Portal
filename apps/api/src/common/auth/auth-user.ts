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
}

/** Token kinds issued by the auth service. */
export type TokenType = "access" | "mfa";

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
}

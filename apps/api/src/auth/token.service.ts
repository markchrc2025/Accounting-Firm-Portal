import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type {
  AuthUser,
  IntegrationJwtPayload,
  IntegrationPrincipal,
  JwtPayload,
  TokenType,
} from "../common/auth/auth-user";

interface UserForToken {
  id: string;
  firmId: string;
  userType: "FIRM" | "CLIENT";
  email: string;
  clientId?: string | null;
}

/**
 * Issues and verifies the two JWT kinds:
 *  - `access`: full session token returned after auth (and MFA, if enabled).
 *  - `mfa`: short-lived token returned after a correct password when MFA is
 *    required; it only authorizes the `POST /auth/mfa/verify` step.
 */
@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly accessTtl: string;
  private readonly mfaTtl: string;
  private readonly integrationTtl: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>("JWT_SECRET", "dev-insecure-secret-change-me");
    // 4h matches the client's idle-logout window: the token is re-issued on
    // activity (POST /auth/refresh), so it expires ~4h after the LAST activity —
    // a server-side backstop for the inactivity timeout.
    this.accessTtl = config.get<string>("JWT_ACCESS_TTL", "4h");
    this.mfaTtl = config.get<string>("JWT_MFA_TTL", "5m");
    this.integrationTtl = config.get<string>("OAUTH_TOKEN_TTL", "1h");
  }

  signAccess(user: UserForToken): string {
    return this.sign(user, "access", this.accessTtl);
  }

  signMfa(user: UserForToken): string {
    return this.sign(user, "mfa", this.mfaTtl);
  }

  private sign(user: UserForToken, typ: TokenType, expiresIn: string): string {
    const payload: JwtPayload = {
      sub: user.id,
      firmId: user.firmId,
      userType: user.userType,
      email: user.email,
      typ,
      ...(user.clientId ? { clientId: user.clientId } : {}),
    };
    return this.jwt.sign(payload, { secret: this.secret, expiresIn });
  }

  /** Peek at a token's `typ` claim WITHOUT verifying the signature (routing only). */
  peekType(token: string): TokenType | undefined {
    const decoded = this.jwt.decode(token) as { typ?: TokenType } | null;
    return decoded?.typ;
  }

  /** Verify a token and assert its `typ`. Throws if invalid/expired/wrong kind. */
  verify(token: string, expected: TokenType): JwtPayload {
    const payload = this.jwt.verify<JwtPayload>(token, { secret: this.secret });
    if (payload.typ !== expected) {
      throw new Error(`Expected ${expected} token, got ${payload.typ}`);
    }
    return payload;
  }

  /**
   * Sign an OAuth2 client-credentials access token for the BIR Form Generator.
   * Firm-scoped; carries only the granted scopes (per-client visibility is still
   * enforced at the data layer). Returns the token and its lifetime in seconds.
   */
  signIntegration(client: { id: string; firmId: string; scopes: string[] }): {
    token: string;
    expiresInSeconds: number;
  } {
    const payload: IntegrationJwtPayload = {
      sub: client.id,
      firmId: client.firmId,
      typ: "integration",
      scopes: client.scopes,
    };
    const token = this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: this.integrationTtl,
    });
    return { token, expiresInSeconds: this.ttlToSeconds(this.integrationTtl) };
  }

  /** Verify an integration token and return the machine principal. */
  verifyIntegration(token: string): IntegrationPrincipal {
    const payload = this.jwt.verify<IntegrationJwtPayload>(token, {
      secret: this.secret,
    });
    if (payload.typ !== "integration") {
      throw new Error(`Expected integration token, got ${payload.typ}`);
    }
    return {
      id: payload.sub,
      firmId: payload.firmId,
      scopes: Array.isArray(payload.scopes) ? payload.scopes : [],
    };
  }

  /** Convert a jsonwebtoken-style TTL ("1h", "30m", "3600") to seconds. */
  private ttlToSeconds(ttl: string): number {
    const match = /^(\d+)\s*([smhd])?$/.exec(ttl.trim());
    if (!match) return 3600;
    const value = Number(match[1]);
    const unit = match[2] ?? "s";
    const factor = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
    return value * factor;
  }

  static toAuthUser(payload: JwtPayload): AuthUser {
    return {
      id: payload.sub,
      firmId: payload.firmId,
      userType: payload.userType,
      email: payload.email,
      ...(payload.clientId ? { clientId: payload.clientId } : {}),
    };
  }
}

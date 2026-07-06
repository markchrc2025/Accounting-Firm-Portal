import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { AuthUser, JwtPayload, TokenType } from "../common/auth/auth-user";

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

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>("JWT_SECRET", "dev-insecure-secret-change-me");
    this.accessTtl = config.get<string>("JWT_ACCESS_TTL", "1h");
    this.mfaTtl = config.get<string>("JWT_MFA_TTL", "5m");
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

  /** Verify a token and assert its `typ`. Throws if invalid/expired/wrong kind. */
  verify(token: string, expected: TokenType): JwtPayload {
    const payload = this.jwt.verify<JwtPayload>(token, { secret: this.secret });
    if (payload.typ !== expected) {
      throw new Error(`Expected ${expected} token, got ${payload.typ}`);
    }
    return payload;
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

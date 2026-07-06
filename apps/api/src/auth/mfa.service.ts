import { Injectable } from "@nestjs/common";
import { authenticator } from "otplib";

export interface MfaEnrollment {
  secret: string;
  /** otpauth:// URI to render as a QR code in an authenticator app. */
  otpauthUrl: string;
}

/**
 * TOTP MFA via otplib. The Portal is the issuer; secrets are base32 and stored
 * on the user (encrypt at rest in production).
 */
@Injectable()
export class MfaService {
  private readonly issuer = "Accounting Firm Portal";

  /** Generate a new secret + provisioning URI for an account. */
  enroll(accountEmail: string): MfaEnrollment {
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(accountEmail, this.issuer, secret);
    return { secret, otpauthUrl };
  }

  /** Verify a 6-digit TOTP code against a secret. */
  verify(secret: string, token: string): boolean {
    try {
      return authenticator.verify({ token: token.trim(), secret });
    } catch {
      return false;
    }
  }
}

// SSO sign-in with Google and Microsoft (OIDC authorization-code flow,
// server-side). SSO is a LOGIN method, not a signup path: the provider only
// proves ownership of an email address, and that email must already belong to
// a portal account (invited staff or client seat). Accounts with TOTP enabled
// still pass the portal's own MFA challenge after the provider hop.

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { TokenService } from "./token.service";

export type SsoProvider = "google" | "microsoft";
export const SSO_PROVIDERS: SsoProvider[] = ["google", "microsoft"];

/** Machine-readable failure; the controller redirects with this code only —
 *  provider payloads and account details never reach the browser. */
export class SsoError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface SsoResult {
  kind: "access" | "mfa";
  token: string;
}

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get stateSecret(): string {
    return this.config.get<string>("JWT_SECRET", "dev-insecure-secret-change-me");
  }

  /** Public API origin the provider redirects back to (must be registered). */
  private apiPublicUrl(): string {
    return (this.config.get<string>("API_PUBLIC_URL", "") ?? "").replace(/\/+$/, "");
  }

  private webAppUrl(): string {
    return (
      this.config.get<string>("WEB_APP_URL", "https://acctgfirm.mcrctas.com") ?? ""
    ).replace(/\/+$/, "");
  }

  redirectUri(provider: SsoProvider): string {
    return `${this.apiPublicUrl()}/api/v1/auth/sso/${provider}/callback`;
  }

  loginRedirect(errorCode?: string): string {
    return errorCode
      ? `${this.webAppUrl()}/login?sso_error=${encodeURIComponent(errorCode)}`
      : `${this.webAppUrl()}/login`;
  }

  callbackRedirect(result: SsoResult): string {
    // The token travels in the URL FRAGMENT so it never appears in server or
    // proxy access logs; the web callback page consumes and discards it.
    return `${this.webAppUrl()}/sso/callback#sso=${result.kind}&token=${encodeURIComponent(
      result.token,
    )}`;
  }

  private providerConfig(provider: SsoProvider): ProviderConfig | null {
    if (provider === "google") {
      const clientId = this.config.get<string>("GOOGLE_CLIENT_ID", "") ?? "";
      const clientSecret = this.config.get<string>("GOOGLE_CLIENT_SECRET", "") ?? "";
      if (!clientId || !clientSecret) return null;
      return {
        clientId,
        clientSecret,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scope: "openid email profile",
      };
    }
    const clientId = this.config.get<string>("MS_CLIENT_ID", "") ?? "";
    const clientSecret = this.config.get<string>("MS_CLIENT_SECRET", "") ?? "";
    if (!clientId || !clientSecret) return null;
    const tenant = this.config.get<string>("MS_TENANT", "common") ?? "common";
    return {
      clientId,
      clientSecret,
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      // Only the OIDC basics — these are user-consentable and don't require an
      // Azure admin to pre-approve the app (unlike Graph's User.Read). The email
      // comes straight from the id_token, so no Microsoft Graph call is needed.
      scope: "openid profile email",
    };
  }

  /** Which providers are configured (drives the login-page buttons). */
  providers(): Record<SsoProvider, boolean> {
    const ready = Boolean(this.apiPublicUrl());
    return {
      google: ready && this.providerConfig("google") !== null,
      microsoft: ready && this.providerConfig("microsoft") !== null,
    };
  }

  /** Build the provider authorize URL with a signed anti-CSRF state. */
  startUrl(provider: SsoProvider): string {
    const cfg = this.providerConfig(provider);
    if (!cfg || !this.apiPublicUrl()) throw new SsoError("unavailable");
    const state = this.jwt.sign(
      { typ: "sso-state", provider },
      { secret: this.stateSecret, expiresIn: "10m" },
    );
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: "code",
      scope: cfg.scope,
      state,
      ...(provider === "google" ? { prompt: "select_account" } : {}),
    });
    return `${cfg.authorizeUrl}?${params.toString()}`;
  }

  /** Handle the provider redirect: verify state, exchange code, sign in. */
  async handleCallback(
    provider: SsoProvider,
    code: string,
    state: string,
    ip?: string,
  ): Promise<SsoResult> {
    const cfg = this.providerConfig(provider);
    if (!cfg) throw new SsoError("unavailable");

    let statePayload: { typ?: string; provider?: string };
    try {
      statePayload = this.jwt.verify(state, { secret: this.stateSecret });
    } catch {
      throw new SsoError("state");
    }
    if (statePayload.typ !== "sso-state" || statePayload.provider !== provider) {
      throw new SsoError("state");
    }

    const tokens = await this.exchangeCode(cfg, provider, code);
    const email = (await this.fetchEmail(provider, tokens)).toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { clientProfile: true },
    });
    // Uniform failure — SSO never reveals whether an account exists.
    if (!user || user.status !== "ACTIVE") {
      await this.audit.record({
        action: "auth.sso.rejected",
        entityType: "User",
        metadata: { provider, reason: "no_active_account" },
        ipAddress: ip,
      });
      throw new SsoError("no-account");
    }

    const tokenUser = {
      id: user.id,
      firmId: user.firmId,
      userType: user.userType,
      email: user.email,
      clientId: user.clientProfile?.clientId ?? null,
    };

    if (user.mfaEnabled) {
      await this.audit.record({
        userId: user.id,
        action: "auth.sso.mfa_challenge",
        entityType: "User",
        entityId: user.id,
        metadata: { provider },
        ipAddress: ip,
      });
      return { kind: "mfa", token: this.tokens.signMfa(tokenUser) };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      action: "auth.sso.login",
      entityType: "User",
      entityId: user.id,
      metadata: { provider },
      ipAddress: ip,
    });
    return { kind: "access", token: this.tokens.signAccess(tokenUser) };
  }

  /** Authorization-code → provider tokens (access + id token). */
  private async exchangeCode(
    cfg: ProviderConfig,
    provider: SsoProvider,
    code: string,
  ): Promise<{ accessToken: string; idToken?: string }> {
    const res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri(provider),
      }).toString(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      this.logger.warn(`${provider} token exchange failed (${res.status}): ${detail.slice(0, 300)}`);
      throw new SsoError("exchange");
    }
    const data = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      id_token?: string;
    };
    if (!data.access_token) throw new SsoError("exchange");
    return { accessToken: data.access_token, idToken: data.id_token };
  }

  /**
   * Verified email from the provider. Google uses its OIDC userinfo endpoint;
   * Microsoft reads the id_token claims directly (email → preferred_username →
   * upn), which needs no Graph permission and works for work/school accounts
   * whose UPN is the login address (e.g. name@mcrctas.com).
   */
  private async fetchEmail(
    provider: SsoProvider,
    tokens: { accessToken: string; idToken?: string },
  ): Promise<string> {
    if (provider === "google") {
      const info = await this.getJson(
        "https://openidconnect.googleapis.com/v1/userinfo",
        tokens.accessToken,
      );
      const email = typeof info.email === "string" ? info.email : "";
      if (!email || info.email_verified === false) throw new SsoError("email");
      return email;
    }

    // Microsoft: the id_token carries the identity — no Graph call required.
    const claims = tokens.idToken ? decodeJwtClaims(tokens.idToken) : {};
    const fromClaims =
      firstString(claims.email) || firstString(claims.preferred_username) || firstString(claims.upn);
    if (fromClaims && fromClaims.includes("@")) return fromClaims;

    // Fallback (only the OIDC scope is needed): the userinfo endpoint.
    const info = await this.getJson(
      "https://graph.microsoft.com/oidc/userinfo",
      tokens.accessToken,
    );
    const fromInfo = firstString(info.email) || firstString(info.preferred_username);
    if (fromInfo && fromInfo.includes("@")) return fromInfo;
    throw new SsoError("email");
  }

  private async getJson(url: string, accessToken: string): Promise<Record<string, unknown>> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      this.logger.warn(`SSO userinfo fetch failed (${res.status}) for ${url}`);
      throw new SsoError("userinfo");
    }
    return ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  }
}

/** A non-empty string, or "". */
function firstString(v: unknown): string {
  return typeof v === "string" && v ? v : "";
}

/**
 * Decode a JWT's claims WITHOUT verifying the signature. Safe here because the
 * token came straight from the provider's token endpoint over TLS (OIDC code
 * flow) — we never accept an id_token from the browser.
 */
function decodeJwtClaims(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return {};
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

import { Injectable, UnauthorizedException } from "@nestjs/common";
import { OAUTH_SCOPES } from "@portal/shared";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { PrismaService } from "../prisma/prisma.service";
import type { OAuthTokenResponse } from "./dto/oauth-token.schema";

/**
 * Manages OAuth2 client-credentials machine clients (the BIR Form Generator's
 * `portal-sync` connector). Secrets are stored argon2-hashed and never returned.
 */
@Injectable()
export class IntegrationClientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  /** Verify client_id + client_secret and mint a scoped bearer token. */
  async issueToken(
    clientKey: string,
    clientSecret: string,
    requestedScope?: string,
  ): Promise<OAuthTokenResponse> {
    const client = await this.prisma.integrationClient.findUnique({
      where: { clientKey },
    });
    const badCreds = new UnauthorizedException("Invalid client credentials");
    if (!client || client.status !== "ACTIVE") throw badCreds;

    const ok = await this.passwords.verify(client.clientSecretHash, clientSecret);
    if (!ok) throw badCreds;

    const granted = this.parseScopes(client.grantedScopesJson);
    const scopes = requestedScope
      ? this.narrow(granted, requestedScope)
      : granted;

    await this.prisma.integrationClient.update({
      where: { id: client.id },
      data: { lastUsedAt: new Date() },
    });

    const { token, expiresInSeconds } = this.tokens.signIntegration({
      id: client.id,
      firmId: client.firmId,
      scopes,
    });

    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresInSeconds,
      scope: scopes.join(" "),
    };
  }

  /**
   * Create or rotate a machine client (used by the seed). Returns nothing
   * secret-bearing; the plaintext secret is chosen by the caller/env.
   */
  async upsert(input: {
    firmId: string;
    clientKey: string;
    clientSecret: string;
    scopes: string[];
  }): Promise<{ id: string; clientKey: string; scopes: string[] }> {
    const scopes = input.scopes.filter((s) =>
      (OAUTH_SCOPES as readonly string[]).includes(s),
    );
    const clientSecretHash = await this.passwords.hash(input.clientSecret);
    const client = await this.prisma.integrationClient.upsert({
      where: { clientKey: input.clientKey },
      create: {
        firmId: input.firmId,
        clientKey: input.clientKey,
        clientSecretHash,
        grantedScopesJson: scopes,
        status: "ACTIVE",
      },
      update: { clientSecretHash, grantedScopesJson: scopes, status: "ACTIVE" },
    });
    return { id: client.id, clientKey: client.clientKey, scopes };
  }

  private parseScopes(json: unknown): string[] {
    if (!Array.isArray(json)) return [];
    return json.filter(
      (s): s is string =>
        typeof s === "string" && (OAUTH_SCOPES as readonly string[]).includes(s),
    );
  }

  /** Intersect a requested (space-separated) scope string with what's granted. */
  private narrow(granted: string[], requested: string): string[] {
    const want = new Set(requested.split(/\s+/).filter(Boolean));
    return granted.filter((s) => want.has(s));
  }
}

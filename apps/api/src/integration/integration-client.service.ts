import { randomBytes } from "node:crypto";
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import type { IntegrationClient } from "@prisma/client";
import { OAUTH_SCOPES } from "@portal/shared";
import { AuditService } from "../audit/audit.service";
import { PasswordService } from "../auth/password.service";
import { TokenService } from "../auth/token.service";
import { PrismaService } from "../prisma/prisma.service";
import type { OAuthTokenResponse } from "./dto/oauth-token.schema";

/** Firm-facing view of an integration client. NEVER carries the secret/hash. */
export interface IntegrationClientDto {
  id: string;
  name: string;
  clientKey: string;
  scopes: string[];
  status: string;
  lastUsedAt: Date | null;
}

/** A reveal-once result: the safe DTO plus the plaintext secret (shown once). */
export type IntegrationClientSecretDto = IntegrationClientDto & {
  clientSecret: string;
};

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
    private readonly audit: AuditService,
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

  // --- Firm-facing management (Super Admin) ---------------------------------

  /** The firm's integration clients, secrets omitted. */
  async listForFirm(firmId: string): Promise<IntegrationClientDto[]> {
    const rows = await this.prisma.integrationClient.findMany({
      where: { firmId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Provision a new machine client for the firm. Generates the `clientKey` and a
   * random plaintext secret, persists only the argon2 hash, and returns the row
   * plus the plaintext secret (reveal-once — it is never retrievable again).
   */
  async createForFirm(
    firmId: string,
    input: { name: string; scopes: string[] },
  ): Promise<IntegrationClientSecretDto> {
    const scopes = this.validScopes(input.scopes);
    const clientKey = `mcrc_${randomBytes(12).toString("hex")}`;
    const clientSecret = randomBytes(32).toString("base64url");
    const clientSecretHash = await this.passwords.hash(clientSecret);

    const client = await this.prisma.integrationClient.create({
      data: {
        firmId,
        name: input.name,
        clientKey,
        clientSecretHash,
        grantedScopesJson: scopes,
        status: "ACTIVE",
      },
    });

    await this.audit.record({
      action: "integration-client.create",
      entityType: "IntegrationClient",
      entityId: client.id,
      metadata: { firmId, name: input.name, scopes },
    });

    return { ...this.toDto(client), clientSecret };
  }

  /**
   * Rotate a firm's integration-client secret: mint a new plaintext secret, store
   * its hash, and return the row plus the new plaintext secret (reveal-once).
   * 404s if the client does not belong to `firmId`.
   */
  async rotateForFirm(
    firmId: string,
    id: string,
  ): Promise<IntegrationClientSecretDto> {
    await this.loadOwned(firmId, id);
    const clientSecret = randomBytes(32).toString("base64url");
    const clientSecretHash = await this.passwords.hash(clientSecret);

    const client = await this.prisma.integrationClient.update({
      where: { id },
      data: { clientSecretHash },
    });

    await this.audit.record({
      action: "integration-client.rotate",
      entityType: "IntegrationClient",
      entityId: id,
      metadata: { firmId },
    });

    return { ...this.toDto(client), clientSecret };
  }

  /** Disable a firm's integration client. 404s if it is not in the firm. */
  async revokeForFirm(firmId: string, id: string): Promise<IntegrationClientDto> {
    await this.loadOwned(firmId, id);
    const client = await this.prisma.integrationClient.update({
      where: { id },
      data: { status: "DISABLED" },
    });

    await this.audit.record({
      action: "integration-client.revoke",
      entityType: "IntegrationClient",
      entityId: id,
      metadata: { firmId },
    });

    return this.toDto(client);
  }

  /** Map a persisted row to the firm-facing DTO (never exposes the secret hash). */
  private toDto(client: IntegrationClient): IntegrationClientDto {
    return {
      id: client.id,
      name: client.name,
      clientKey: client.clientKey,
      scopes: this.parseScopes(client.grantedScopesJson),
      status: client.status,
      lastUsedAt: client.lastUsedAt,
    };
  }

  /** Keep only requested scopes that are members of the frozen OAUTH_SCOPES. */
  private validScopes(scopes: string[]): string[] {
    return scopes.filter((s) => (OAUTH_SCOPES as readonly string[]).includes(s));
  }

  /** Resolve a client that must belong to `firmId`; 404 otherwise. */
  private async loadOwned(firmId: string, id: string): Promise<IntegrationClient> {
    const client = await this.prisma.integrationClient.findFirst({
      where: { id, firmId },
    });
    if (!client) throw new NotFoundException("Integration client not found");
    return client;
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

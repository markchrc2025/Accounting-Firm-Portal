// api-tokens.service.ts — PA3 (D67): personal API tokens.
//
// A person makes a token to let Claude Code, a script or the Projects MCP connector act as them.
// The token is answered once; only its SHA-256 is stored. A token acts as its user with that
// user's permissions. It is read only if it was made read only, and also when its user holds only
// Projects:Read (a Viewer) whatever the token says.
import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { SUPER_ADMIN_ROLE } from "../rbac/permissions.constants";
import type { CreateTokenInput, TokenScope } from "./dto/api-tokens.schemas";
import { generateToken, hashToken, looksLikeToken } from "./token-format";

export const TOKEN_NOT_FOUND = "Token not found.";
export const TOKEN_INVALID = "Invalid or revoked token.";
export const TOKEN_READ_ONLY = "This token is read-only.";
export const TOKEN_NOT_HERE = "Personal tokens cannot be used on this route.";
export const SUPER_ADMIN_ONLY = "Only a Super Admin can list every token of the firm.";

/** The Projects permissions that let a person change things. Holding none of them: read only. */
const PROJECTS_WRITE = ["Projects:Create", "Projects:Update", "Projects:Configure"];
/** A token's last-used time is written at most this often. */
const LAST_USED_EVERY_MS = 60_000;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ApiTokenDto {
  id: string;
  name: string;
  scope: string;
  prefix: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Who a valid token stands for. */
export interface ApiTokenPrincipal {
  tokenId: string;
  /** What the token was made with. */
  scope: TokenScope;
  user: AuthUser;
}

interface TokenRow {
  id: string;
  name: string;
  scope: string;
  prefix: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

const tokenDto = (r: TokenRow): ApiTokenDto => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  prefix: r.prefix,
  lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
  revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
  createdAt: r.createdAt.toISOString(),
});

@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly audit: AuditService,
  ) {}

  /** Make a token. The only time the plain token is ever returned. */
  async create(user: AuthUser, input: CreateTokenInput) {
    const { token, hash, prefix } = generateToken();
    const row = await this.prisma.apiToken.create({
      data: {
        firmId: user.firmId,
        userId: user.id,
        name: input.name,
        scope: input.scope,
        tokenHash: hash,
        prefix,
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "api-token.created",
      entityType: "ApiToken",
      entityId: row.id,
      metadata: { name: row.name, scope: row.scope, prefix: row.prefix },
    });
    return { ...tokenDto(row), token };
  }

  /** The signed-in person's own tokens, newest first. */
  async list(user: AuthUser) {
    const rows = await this.prisma.apiToken.findMany({
      where: { firmId: user.firmId, userId: user.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return { items: rows.map(tokenDto) };
  }

  /** A Super Admin: every token of the firm with who owns it. Never the token. */
  async listFirm(user: AuthUser) {
    if (!(await this.isSuperAdmin(user))) throw new ForbiddenException(SUPER_ADMIN_ONLY);
    const rows = await this.prisma.apiToken.findMany({
      where: { firmId: user.firmId },
      include: { user: { select: { id: true, fullName: true, email: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    return {
      items: rows.map((r) => ({
        ...tokenDto(r),
        owner: { id: r.user.id, fullName: r.user.fullName, email: r.user.email },
      })),
    };
  }

  /** Revoke: the owner, or a Super Admin of the firm. Revoking twice changes nothing. */
  async revoke(user: AuthUser, id: string) {
    if (!UUID_SHAPE.test(id)) throw new NotFoundException(TOKEN_NOT_FOUND);
    const row = await this.prisma.apiToken.findFirst({
      where: { id, firmId: user.firmId },
    });
    if (!row) throw new NotFoundException(TOKEN_NOT_FOUND);
    if (row.userId !== user.id && !(await this.isSuperAdmin(user))) {
      throw new NotFoundException(TOKEN_NOT_FOUND);
    }
    if (row.revokedAt) return tokenDto(row);
    const revokedAt = new Date();
    const updated = await this.prisma.apiToken.update({
      where: { id },
      data: { revokedAt },
    });
    await this.audit.record({
      userId: user.id,
      action: "api-token.revoked",
      entityType: "ApiToken",
      entityId: id,
      metadata: { ownerId: row.userId, name: row.name, prefix: row.prefix },
    });
    return tokenDto(updated);
  }

  /**
   * The person a token stands for, or null: an unknown or revoked token, a user who is not
   * active, and a client user are all refused the same way. Writes last-used at most once a minute.
   */
  async authenticate(token: string): Promise<ApiTokenPrincipal | null> {
    if (!looksLikeToken(token)) return null;
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: {
          select: { id: true, firmId: true, userType: true, email: true, status: true },
        },
      },
    });
    if (!row || row.revokedAt) return null;
    const u = row.user;
    if (u.status !== "ACTIVE" || u.userType !== "FIRM" || u.firmId !== row.firmId)
      return null;
    await this.prisma.apiToken.updateMany({
      where: {
        id: row.id,
        OR: [
          { lastUsedAt: null },
          { lastUsedAt: { lt: new Date(Date.now() - LAST_USED_EVERY_MS) } },
        ],
      },
      data: { lastUsedAt: new Date() },
    });
    return {
      tokenId: row.id,
      scope: row.scope === "read" ? "read" : "read_write",
      user: { id: u.id, firmId: u.firmId, userType: "FIRM", email: u.email },
    };
  }

  /**
   * What the token may do right now: read only if it was made read only, or if its user holds no
   * Projects permission that changes anything (a Viewer). Asked on each use, so a role that
   * changes takes effect with the next call.
   */
  async effectiveScope(p: ApiTokenPrincipal): Promise<TokenScope> {
    if (p.scope === "read") return "read";
    const eff = await this.rbac.getEffectivePermissions(p.user);
    return PROJECTS_WRITE.some((perm) => eff.global.has(perm)) ? "read_write" : "read";
  }

  /** A session id sent with a call is used only if it is this person's own, in their firm. */
  async ownSessionId(user: AuthUser, value: string | undefined): Promise<string | null> {
    if (!value || !UUID_SHAPE.test(value)) return null;
    const s = await this.prisma.projectWorkSession.findFirst({
      where: { id: value, firmId: user.firmId, userId: user.id },
      select: { id: true },
    });
    return s?.id ?? null;
  }

  async isSuperAdmin(user: AuthUser): Promise<boolean> {
    const n = await this.prisma.user.count({
      where: {
        id: user.id,
        firmId: user.firmId,
        status: "ACTIVE",
        userRoles: {
          some: { clientScopeId: null, role: { name: SUPER_ADMIN_ROLE, scope: "FIRM" } },
        },
      },
    });
    return n > 0;
  }
}

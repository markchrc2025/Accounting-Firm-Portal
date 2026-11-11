// projects.access.ts — PA1 (D65): who may see and change what in the Projects module.
//
// The roles are the Portal's data-driven ones: Projects:Read, Create, Update, Configure.
// Tenant: every query filters by the caller's firmId, so another firm's project is a 404.
// Client link: a project linked to a client follows the Portal's client visibility (a firm user
// sees it only if they can see that client: Clients:ViewAll, or assigned). A project with no
// client is visible to every firm user with Projects:Read. A client user never sees Projects.
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { missingPermissionsMessage, RbacService } from "../rbac/rbac.service";
import {
  DEFAULT_ISSUE_STATUSES,
  DEFAULT_ISSUE_TYPES,
  DEFAULT_PROJECT_CATEGORIES,
  MESSAGES,
  PROJECT_KEY_RE,
  type ActorType,
  type Channel,
} from "./projects.constants";

/** Who is making a change, and through which door. Every change is logged with both. */
export interface ProjectsActor {
  user: AuthUser;
  actorType: ActorType;
  channel: Channel;
  sessionId?: string | null;
  /** PA3: the personal API token the call came with, if any (a work session remembers it). */
  tokenId?: string | null;
  /** PA3: what is calling, for a work session: claude-code, claude.ai, rest, web ... */
  client?: string;
}

/**
 * An actor for a signed-in person. On the web it is the "web" channel; with a personal API token
 * (PA3, D67) the sign-in guard marks the user and the change is logged through "api", with the work
 * session the caller named, if any. Either way the person is a USER: Claude acts through the MCP.
 */
export const webActor = (user: AuthUser): ProjectsActor => ({
  user,
  actorType: "USER",
  channel: user.via?.channel ?? "web",
  sessionId: user.via?.sessionId ?? null,
  tokenId: user.via?.tokenId ?? null,
});

/**
 * An actor for GitHub (PA4, D68): a change made by a webhook delivery. There is no user behind it:
 * the user here is a stand-in that matches no row of the users table, so the activity is written
 * with no user, nobody is left out of a notification, and nothing is checked against a permission
 * (the services that take it do not ask for one).
 */
export const GITHUB_ACTOR_USER_ID = "00000000-0000-0000-0000-000000000000";
export const githubActor = (firmId: string): ProjectsActor => ({
  user: { id: GITHUB_ACTOR_USER_ID, firmId, userType: "FIRM", email: "" },
  actorType: "GITHUB",
  channel: "github",
});

/**
 * An actor for the Portal itself (PA8, D70): a change the system makes, such as a task a recurring
 * project makes for an occurrence. Written as SYSTEM through the "system" channel with no user.
 */
export const systemActor = (firmId: string): ProjectsActor => ({
  user: { id: GITHUB_ACTOR_USER_ID, firmId, userType: "FIRM", email: "" },
  actorType: "SYSTEM",
  channel: "system",
});

export type Tx = Prisma.TransactionClient;

@Injectable()
export class ProjectsAccess {
  /** Firms whose starting issue types and statuses are known to exist (kept per process). */
  private readonly seeded = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
  ) {}

  /** The caller must hold every permission firm-wide (and be firm staff); else 403 in the Portal's words. */
  async need(actor: ProjectsActor, ...required: string[]): Promise<void> {
    if (
      actor.user.userType !== "FIRM" ||
      !(await this.rbac.authorize(actor.user, required))
    ) {
      throw new ForbiddenException(missingPermissionsMessage(required));
    }
    await this.ensureDefaults(actor.user.firmId);
  }

  /** The starting issue types and statuses, for a firm that has none yet. Safe to call twice. */
  async ensureDefaults(firmId: string): Promise<void> {
    if (this.seeded.has(firmId)) return;
    const [types, statuses, categories] = await Promise.all([
      this.prisma.issueType.count({ where: { firmId } }),
      this.prisma.issueStatus.count({ where: { firmId } }),
      this.prisma.projectCategory.count({ where: { firmId } }),
    ]);
    if (categories === 0) {
      // PA8: the starting project categories (a firm that existed at migration 46 has them already)
      await this.prisma.projectCategory
        .createMany({
          data: DEFAULT_PROJECT_CATEGORIES.map((c) => ({ firmId, ...c })),
          skipDuplicates: true,
        })
        .catch(() => undefined);
    }
    if (types === 0) {
      await this.prisma.issueType.createMany({
        data: DEFAULT_ISSUE_TYPES.map((t) => ({ firmId, ...t })),
        skipDuplicates: true,
      });
    }
    if (statuses === 0) {
      await this.prisma.issueStatus
        .createMany({
          data: DEFAULT_ISSUE_STATUSES.map((s) => ({ firmId, ...s })),
          skipDuplicates: true,
        })
        .catch(() => undefined); // two requests seeding at once: the other one won
    }
    this.seeded.add(firmId);
  }

  /** The projects the caller may see: their firm's, with a client only if the caller can see it. */
  async visibleWhere(user: AuthUser): Promise<Prisma.ProjectWhereInput> {
    const scope = await this.rbac.authorizedClients(user, []);
    if (scope === "all") return { firmId: user.firmId };
    return {
      firmId: user.firmId,
      OR: [{ clientId: null }, { clientId: { in: [...scope] } }],
    };
  }

  /** The clients the caller may see: "all" or the set of ids (Clients:ViewAll, or assigned). */
  async visibleClients(user: AuthUser): Promise<"all" | Set<string>> {
    return this.rbac.authorizedClients(user, []);
  }

  /** Can the caller see this client at all (Clients:ViewAll, or assigned)? */
  async canSeeClient(user: AuthUser, clientId: string): Promise<boolean> {
    return this.rbac.authorize(user, [], clientId);
  }

  /** A project by key, for a caller who may see it; else 404 (it makes no difference which). */
  async project(user: AuthUser, key: string, db: Tx | PrismaService = this.prisma) {
    const k = (key ?? "").trim().toUpperCase();
    const row = PROJECT_KEY_RE.test(k)
      ? await db.project.findFirst({ where: { firmId: user.firmId, key: k } })
      : null;
    if (!row) throw new NotFoundException(MESSAGES.projectNotFound);
    if (row.clientId && !(await this.canSeeClient(user, row.clientId))) {
      throw new NotFoundException(MESSAGES.projectNotFound);
    }
    return row;
  }
}

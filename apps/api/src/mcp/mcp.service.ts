// MCP (Model Context Protocol) server for the Portal — lets the firm connect
// Claude (claude.ai / Cowork custom connector) to their own practice data.
//
// Scope, by design:
//   - Firm-scoped. The deployment is single-firm; all queries are pinned to
//     the first (seeded) firm's id, mirroring the OAuth integration caller.
//   - Reads AND writes. The six read tools below are queries; the write tools
//     (mcp-write-tools.ts) go through the same service layer as the web UI,
//     so validation, tenancy, and audit logging apply identically.
//   - GUARDRAIL #1 still holds: nothing here is authoritative BIR tax — the
//     figures exposed are the Portal's management records/estimates.
//
// A fresh McpServer is built per request (stateless Streamable HTTP), so
// request ids never collide across concurrent calls.

import { randomBytes } from "crypto";
import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@prisma/client";
import { z } from "zod/v3";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { dateToIso, isoToDate, toIncomeDto, toPurchaseDto } from "../financial/serialization";
import { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import { InvoicesService } from "../invoices/invoices.service";
import { PrismaService } from "../prisma/prisma.service";
import { PurchaseTransactionsService } from "../purchase-transactions/purchase-transactions.service";
import { SUPER_ADMIN_ROLE } from "../rbac/permissions.constants";
import { fail, isoDate, ok, READ_ONLY } from "./mcp-common";
import { mcpEnabled } from "./mcp-secret";
import { registerWriteTools } from "./mcp-write-tools";

/** A person, as the connector card and portal_whoami name them. */
export interface McpPerson {
  name: string;
  email: string;
}

/** What the Super-Admin connector surface sees. `secret` is the capability
 *  key itself — the whole point is that the admin can view and share it. */
export interface McpConnectorDto {
  enabled: boolean;
  /** Where the active secret lives: rotated from the portal, or the
   *  MCP_SHARED_SECRET env var. null when the connector is off. */
  source: "portal" | "environment" | null;
  secret: string | null;
  /** M1 R3 (D41 amendment): who issued the link in use — the user on the firm's
   *  newest mcp.connector.rotate row — and when. null for the environment link
   *  (never issued from the Portal) and while the connector is off. */
  issuedBy: McpPerson | null;
  issuedAt: string | null;
  /** Who connector writes act as (resolveActor), or why they refuse. Both null
   *  while the connector is off. */
  actingAs: McpPerson | null;
  actingProblem: string | null;
}

/** The connector's acting user (D41): the person writes run as. */
export interface McpActor {
  user: AuthUser;
  name: string;
}

/** resolveActor's answer: the acting user, or the refusal sentence (M1 R2). */
export type McpActorResolution =
  | { actor: McpActor; problem: null }
  | { actor: null; problem: string };

/** The newest rotation of the firm's connector link: who issued it, and when. */
interface McpIssuer {
  userId: string | null;
  person: McpPerson | null;
  at: Date;
}

/** U4 R3 (D15, D41): the two refusals of an MCP write, as the caller reads them. */
export const MCP_NO_SUPER_ADMIN =
  "MCP acts as the firm's Super Admin, and there is no active Super Admin.";
export const MCP_SEVERAL_SUPER_ADMINS =
  "More than one active Super Admin. Issue the connector key from the Portal's MCP " +
  "Connector page as the Super Admin Claude should act as.";

const SERVER_NAME = "mcrc-portal-mcp-server";
const SERVER_VERSION = "1.1.0";
/** Hard cap on list sizes so one call can't blow out the model's context. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** `txnDate` range filter from optional from/to ISO dates. */
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: isoToDate(from) } : {}),
    ...(to ? { lte: isoToDate(to) } : {}),
  };
}

@Injectable()
export class McpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly clients: ClientsService,
    private readonly income: IncomeTransactionsService,
    private readonly purchases: PurchaseTransactionsService,
    private readonly invoices: InvoicesService,
  ) {}

  /** The single firm this deployment serves (same model as the BIR caller). */
  private async firmId(): Promise<string> {
    const firm = await this.prisma.firm.findFirst({ orderBy: { createdAt: "asc" } });
    if (!firm) throw new Error("No firm exists yet — seed the database first.");
    return firm.id;
  }

  // --- Connector secret management (Super Admin surface) --------------------
  //
  // The capability secret lives in Firm.settingsJson.mcpSecret so the Super
  // Admin can view/rotate/disable it from the portal without a redeploy:
  //   string  → the active secret (rotated from the portal)
  //   null    → connector explicitly disabled (env var is IGNORED)
  //   absent  → fall back to the MCP_SHARED_SECRET env var (pre-portal setup)

  /** The stored secret: string = set, null = disabled, undefined = absent. */
  private async storedSecret(): Promise<string | null | undefined> {
    try {
      const firm = await this.prisma.firm.findFirst({
        orderBy: { createdAt: "asc" },
        select: { settingsJson: true },
      });
      const s = firm?.settingsJson;
      if (s && typeof s === "object" && !Array.isArray(s) && "mcpSecret" in s) {
        const v = (s as Record<string, unknown>).mcpSecret;
        if (typeof v === "string") return v;
        if (v === null) return null;
      }
      return undefined;
    } catch {
      // No DB reachable (e.g. hermetic boot) — behave as "nothing stored".
      return undefined;
    }
  }

  /** The secret the /mcp/<key> gate checks against (portal value wins). */
  async resolveSecret(): Promise<string | undefined> {
    const stored = await this.storedSecret();
    if (stored === null) return undefined; // explicitly disabled
    if (typeof stored === "string") return stored;
    return process.env.MCP_SHARED_SECRET;
  }

  private static readonly OFF: McpConnectorDto = {
    enabled: false,
    source: null,
    secret: null,
    issuedBy: null,
    issuedAt: null,
    actingAs: null,
    actingProblem: null,
  };

  /** The secret handling is unchanged; M1 adds who issued the link and who acts. */
  private async connectorDto(
    secret: string | undefined,
    source: "portal" | "environment",
  ): Promise<McpConnectorDto> {
    if (!mcpEnabled(secret)) return { ...McpService.OFF };
    const firmId = await this.firmId();
    const issuer = source === "portal" ? await this.newestRotation(firmId) : null;
    const resolved = await this.resolveActor();
    return {
      enabled: true,
      source,
      secret: secret as string,
      issuedBy: issuer?.person ?? null,
      issuedAt: issuer ? issuer.at.toISOString() : null,
      actingAs: resolved.actor
        ? { name: resolved.actor.name, email: resolved.actor.user.email }
        : null,
      actingProblem: resolved.problem,
    };
  }

  async getConnector(): Promise<McpConnectorDto> {
    const stored = await this.storedSecret();
    if (typeof stored === "string") return this.connectorDto(stored, "portal");
    if (stored === null) return { ...McpService.OFF };
    return this.connectorDto(process.env.MCP_SHARED_SECRET, "environment");
  }

  /** Write settingsJson.mcpSecret, preserving any other firm settings. */
  private async setStoredSecret(firmId: string, value: string | null): Promise<void> {
    const firm = await this.prisma.firm.findUniqueOrThrow({
      where: { id: firmId },
      select: { settingsJson: true },
    });
    const current =
      firm.settingsJson && typeof firm.settingsJson === "object" && !Array.isArray(firm.settingsJson)
        ? (firm.settingsJson as Record<string, unknown>)
        : {};
    await this.prisma.firm.update({
      where: { id: firmId },
      data: { settingsJson: { ...current, mcpSecret: value } as Prisma.InputJsonValue },
    });
  }

  /** Mint a fresh secret — the old link stops working immediately. */
  async rotateConnector(user: AuthUser): Promise<McpConnectorDto> {
    const secret = randomBytes(32).toString("base64url"); // 43 chars ≥ min 32
    await this.setStoredSecret(user.firmId, secret);
    await this.audit.record({
      userId: user.id,
      action: "mcp.connector.rotate",
      entityType: "Firm",
      entityId: user.firmId,
      metadata: { firmId: user.firmId },
    });
    return this.connectorDto(secret, "portal");
  }

  /** Turn the connector off entirely (the env fallback is ignored too). */
  async disableConnector(user: AuthUser): Promise<McpConnectorDto> {
    await this.setStoredSecret(user.firmId, null);
    await this.audit.record({
      userId: user.id,
      action: "mcp.connector.disable",
      entityType: "Firm",
      entityId: user.firmId,
      metadata: { firmId: user.firmId },
    });
    return { ...McpService.OFF };
  }

  /** The firm's newest connector-link rotation, with the person who did it. */
  private async newestRotation(firmId: string): Promise<McpIssuer | null> {
    const row = await this.prisma.auditLog.findFirst({
      where: { action: "mcp.connector.rotate", entityType: "Firm", entityId: firmId },
      orderBy: { timestamp: "desc" },
      select: { userId: true, timestamp: true, user: { select: { fullName: true, email: true } } },
    });
    if (!row) return null;
    return {
      userId: row.userId,
      person: row.user ? { name: row.user.fullName, email: row.user.email } : null,
      at: row.timestamp,
    };
  }

  /**
   * THE one place that decides who Claude acts as (U4 R3, D15, D41; M1 R2). Every
   * write tool (through getActor), portal_whoami and the Integrations card use it.
   * The candidates are the ACTIVE firm users holding the Super Admin role
   * firm-wide (clientScopeId null), chosen by role and never by creation order:
   *   - one: that user;
   *   - none: no one (MCP_NO_SUPER_ADMIN);
   *   - several: the one who issued the connector key in use — the user on the
   *     firm's newest mcp.connector.rotate audit row — when a candidate; else no
   *     one (MCP_SEVERAL_SUPER_ADMINS).
   * Service-layer audit rows attribute to this user; each write also records an
   * `mcp.<tool>` row marking the connector as the true actor (mcp-write-tools.ts).
   */
  async resolveActor(): Promise<McpActorResolution> {
    const firmId = await this.firmId();
    const candidates = await this.prisma.user.findMany({
      where: {
        firmId,
        userType: "FIRM",
        status: "ACTIVE",
        userRoles: {
          some: { clientScopeId: null, role: { name: SUPER_ADMIN_ROLE, scope: "FIRM" } },
        },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, email: true, fullName: true },
    });
    const acting = (u: { id: string; email: string; fullName: string }) => ({
      actor: {
        user: { id: u.id, firmId, userType: "FIRM" as const, email: u.email },
        name: u.fullName,
      },
      problem: null,
    });
    const [only] = candidates;
    if (!only) return { actor: null, problem: MCP_NO_SUPER_ADMIN };
    if (candidates.length === 1) return acting(only);
    const rotation = await this.newestRotation(firmId);
    const issuer = candidates.find((c) => c.id === rotation?.userId);
    if (!issuer) return { actor: null, problem: MCP_SEVERAL_SUPER_ADMINS };
    return acting(issuer);
  }

  /** The principal MCP WRITES run as; a refusal becomes the write tool's error. */
  private async getActor(): Promise<AuthUser> {
    const resolved = await this.resolveActor();
    if (!resolved.actor) throw new Error(resolved.problem);
    return resolved.actor.user;
  }

  /** portal_whoami (M1 R4): who Claude acts as, and who issued the link in use. */
  async whoami(): Promise<Record<string, unknown>> {
    const firmId = await this.firmId();
    const resolved = await this.resolveActor();
    const stored = await this.storedSecret();
    const issuer = typeof stored === "string" ? await this.newestRotation(firmId) : null;
    return {
      actingAs: resolved.actor
        ? { name: resolved.actor.name, email: resolved.actor.user.email, role: SUPER_ADMIN_ROLE }
        : null,
      writesAllowed: resolved.actor !== null,
      problem: resolved.problem,
      connectorIssuedBy: issuer?.person ?? null,
      connectorIssuedAt: issuer ? issuer.at.toISOString() : null,
    };
  }

  /** Resolve a client within the firm or explain how to find a valid id. */
  private async requireClient(firmId: string, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
      select: { id: true, businessName: true },
    });
    if (!client) {
      throw new Error(
        `Client ${clientId} was not found. Call portal_list_clients to look up valid client ids.`,
      );
    }
    return client;
  }

  /** Build a fresh, fully-registered server instance for one request. */
  buildServer(): McpServer {
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

    server.registerTool(
      "portal_whoami",
      {
        title: "Who Claude acts as",
        description:
          "Report who this connector's writes act as: the firm's Super Admin (actingAs, with " +
          "name, email and role), whether writes are allowed, and if not, why (problem — the " +
          "same sentence a write would refuse with). Also who issued the connector link in " +
          "use and when (null for a link from the server's environment). Call this before " +
          "recording anything.",
        inputSchema: {},
        annotations: READ_ONLY,
      },
      async () => {
        try {
          return ok(await this.whoami());
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      "portal_list_clients",
      {
        title: "List clients",
        description:
          "List the firm's clients (id, business name, TIN, tax regime VAT|PERCENTAGE or null " +
          "for a client exempt from business tax, status, " +
          "location, sub-client billing link). Optional case-insensitive substring filter on " +
          "business name or TIN. Use this first to resolve client ids for the other tools.",
        inputSchema: {
          query: z.string().max(200).optional().describe("Substring of business name or TIN"),
          includeArchived: z
            .boolean()
            .default(false)
            .describe("Also return ARCHIVED clients (default: active only)"),
        },
        annotations: READ_ONLY,
      },
      async ({ query, includeArchived }) => {
        try {
          const firmId = await this.firmId();
          const rows = await this.prisma.client.findMany({
            where: {
              firmId,
              ...(includeArchived ? {} : { status: "ACTIVE" }),
              ...(query
                ? {
                    OR: [
                      { businessName: { contains: query, mode: "insensitive" as const } },
                      { tin: { contains: query, mode: "insensitive" as const } },
                    ],
                  }
                : {}),
            },
            orderBy: { businessName: "asc" },
            select: {
              id: true,
              businessName: true,
              tin: true,
              taxType: true,
              status: true,
              city: true,
              province: true,
              billingParentId: true,
            },
          });
          return ok({ count: rows.length, clients: rows });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      "portal_get_client",
      {
        title: "Get client profile",
        description:
          "Fetch one client's full profile: BIR filer details (TIN, RDO, registered address, " +
          "registered tax types, branches), engagement fields (professional fee, billing method), " +
          "and the sub-client billing link if any.",
        inputSchema: {
          clientId: z.string().uuid().describe("Client id from portal_list_clients"),
        },
        annotations: READ_ONLY,
      },
      async ({ clientId }) => {
        try {
          const firmId = await this.firmId();
          const row = await this.prisma.client.findFirst({
            where: { id: clientId, firmId },
          });
          if (!row) {
            return fail(
              `Client ${clientId} was not found. Call portal_list_clients to look up valid client ids.`,
            );
          }
          // corPath is an internal object-storage key — not useful to the model.
          const { corPath: _cor, ...client } = row;
          return ok({ client: JSON.parse(JSON.stringify(client)) as Record<string, unknown> });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      "portal_list_invoices",
      {
        title: "List invoices (firm billing)",
        description:
          "The firm's consolidated billing: invoices across all clients, newest first. Optional " +
          "filters: clientId (also matches invoices billed FOR that client as a sub-client) and " +
          "status (Draft|Sent|Paid|Overdue). Amounts are the firm's service billing in PHP — " +
          "subtotal, 12% VAT estimate, total. `billedForName` marks a sub-client engagement " +
          "recorded under its main client.",
        inputSchema: {
          clientId: z.string().uuid().optional().describe("Narrow to one client"),
          status: z.enum(["Draft", "Sent", "Paid", "Overdue"]).optional(),
          limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
          offset: z.number().int().min(0).default(0),
        },
        annotations: READ_ONLY,
      },
      async ({ clientId, status, limit, offset }) => {
        try {
          const firmId = await this.firmId();
          const where: Prisma.InvoiceWhereInput = {
            firmId,
            ...(clientId ? { OR: [{ clientId }, { billedForClientId: clientId }] } : {}),
            ...(status ? { status } : {}),
          };
          const [total, rows] = await Promise.all([
            this.prisma.invoice.count({ where }),
            this.prisma.invoice.findMany({
              where,
              include: {
                client: { select: { businessName: true } },
                billedFor: { select: { businessName: true } },
                lineItems: true,
              },
              orderBy: { createdAt: "desc" },
              take: limit,
              skip: offset,
            }),
          ]);
          const invoices = rows.map((inv) => ({
            id: inv.id,
            number: inv.number,
            clientId: inv.clientId,
            clientName: inv.client?.businessName ?? "",
            billedForName: inv.billedFor?.businessName ?? null,
            description: inv.description,
            issuedDate: dateToIso(inv.issuedDate),
            dueDate: dateToIso(inv.dueDate),
            status: inv.status,
            subtotal: inv.subtotal.toNumber(),
            vat: inv.vat.toNumber(),
            total: inv.total.toNumber(),
            lineItems: inv.lineItems.map((li) => ({
              description: li.description,
              qty: li.qty.toNumber(),
              rate: li.rate.toNumber(),
              amount: li.amount.toNumber(),
            })),
          }));
          return ok({
            total,
            count: invoices.length,
            offset,
            has_more: total > offset + invoices.length,
            invoices,
          });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      "portal_list_income_transactions",
      {
        title: "List sales / income transactions",
        description:
          "A client's sales/income records (bookkeeping, PHP, amounts NET of VAT — VAT rides in " +
          "its own fields), newest first, with category names. Filter by txnDate range. These are " +
          "the client's business sales, NOT the firm's invoices (use portal_list_invoices for those).",
        inputSchema: {
          clientId: z.string().uuid().describe("Client id from portal_list_clients"),
          from: isoDate.optional(),
          to: isoDate.optional(),
          limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
          offset: z.number().int().min(0).default(0),
        },
        annotations: READ_ONLY,
      },
      async ({ clientId, from, to, limit, offset }) => {
        try {
          const firmId = await this.firmId();
          await this.requireClient(firmId, clientId);
          const where: Prisma.IncomeTransactionWhereInput = {
            clientId,
            ...(dateRange(from, to) ? { txnDate: dateRange(from, to) } : {}),
          };
          const [total, rows, categories] = await Promise.all([
            this.prisma.incomeTransaction.count({ where }),
            this.prisma.incomeTransaction.findMany({
              where,
              orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
              take: limit,
              skip: offset,
            }),
            this.prisma.category.findMany({
              where: { clientId },
              select: { id: true, name: true },
            }),
          ]);
          const catName = new Map(categories.map((c) => [c.id, c.name]));
          const items = rows.map((t) => ({
            ...toIncomeDto(t),
            categoryName: catName.get(t.categoryId) ?? null,
          }));
          return ok({
            total,
            count: items.length,
            offset,
            has_more: total > offset + items.length,
            transactions: items,
          });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      "portal_list_expense_transactions",
      {
        title: "List expense / purchase transactions",
        description:
          "A client's expense/purchase records (bookkeeping, PHP, amounts NET of VAT — input VAT " +
          "rides in its own fields), newest first, with category names. Filter by txnDate range.",
        inputSchema: {
          clientId: z.string().uuid().describe("Client id from portal_list_clients"),
          from: isoDate.optional(),
          to: isoDate.optional(),
          limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
          offset: z.number().int().min(0).default(0),
          status: z
            .enum(["posted", "held"])
            .optional()
            .describe("Only posted, or only held (imported, awaiting an accountant). Omit for both."),
          needsReview: z.boolean().optional().describe("Only records flagged for review (true) or not (false)."),
        },
        annotations: READ_ONLY,
      },
      async ({ clientId, from, to, limit, offset, status, needsReview }) => {
        try {
          const firmId = await this.firmId();
          await this.requireClient(firmId, clientId);
          const where: Prisma.PurchaseTransactionWhereInput = {
            clientId,
            ...(dateRange(from, to) ? { txnDate: dateRange(from, to) } : {}),
            ...(status ? { status } : {}), // U6-A1 (R2)
            ...(needsReview !== undefined ? { needsReview } : {}),
          };
          const [total, rows, categories] = await Promise.all([
            this.prisma.purchaseTransaction.count({ where }),
            this.prisma.purchaseTransaction.findMany({
              where,
              orderBy: [{ txnDate: "desc" }, { createdAt: "desc" }],
              take: limit,
              skip: offset,
            }),
            this.prisma.category.findMany({
              where: { clientId },
              select: { id: true, name: true },
            }),
          ]);
          const catName = new Map(categories.map((c) => [c.id, c.name]));
          const items = rows.map((t) => ({
            ...toPurchaseDto(t),
            categoryName: catName.get(t.categoryId) ?? null,
          }));
          return ok({
            total,
            count: items.length,
            offset,
            has_more: total > offset + items.length,
            transactions: items,
          });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    server.registerTool(
      "portal_financial_summary",
      {
        title: "Client financial summary",
        description:
          "Totals for one client over an optional txnDate range: income and expense counts, net " +
          "amounts (NET of VAT, PHP), per-category breakdowns, and net result (income − expenses). " +
          "This is a management summary from the Portal's books — NOT authoritative BIR tax (the " +
          "BIR Form Generator owns filed figures).",
        inputSchema: {
          clientId: z.string().uuid().describe("Client id from portal_list_clients"),
          from: isoDate.optional(),
          to: isoDate.optional(),
        },
        annotations: READ_ONLY,
      },
      async ({ clientId, from, to }) => {
        try {
          const firmId = await this.firmId();
          const client = await this.requireClient(firmId, clientId);
          const range = dateRange(from, to);
          const txnFilter = range ? { txnDate: range } : {};
          const [incomeByCat, expenseByCat, categories] = await Promise.all([
            this.prisma.incomeTransaction.groupBy({
              by: ["categoryId"],
              where: { clientId, ...txnFilter },
              _sum: { netAmount: true },
              _count: { _all: true },
            }),
            this.prisma.purchaseTransaction.groupBy({
              by: ["categoryId"],
              where: { clientId, ...txnFilter, status: "posted" }, // held imports excluded (U6, R7)
              _sum: { netAmount: true },
              _count: { _all: true },
            }),
            this.prisma.category.findMany({
              where: { clientId },
              select: { id: true, name: true },
            }),
          ]);
          const catName = new Map(categories.map((c) => [c.id, c.name]));
          const breakdown = (
            groups: { categoryId: string; _sum: { netAmount: Prisma.Decimal | null }; _count: { _all: number } }[],
          ) =>
            groups
              .map((g) => ({
                categoryId: g.categoryId,
                categoryName: catName.get(g.categoryId) ?? null,
                count: g._count._all,
                totalNet: g._sum.netAmount?.toNumber() ?? 0,
              }))
              .sort((a, b) => b.totalNet - a.totalNet);
          const income = breakdown(incomeByCat);
          const expenses = breakdown(expenseByCat);
          const incomeTotal = income.reduce((s, g) => s + g.totalNet, 0);
          const expenseTotal = expenses.reduce((s, g) => s + g.totalNet, 0);
          return ok({
            client: client.businessName,
            period: { from: from ?? null, to: to ?? null },
            income: {
              count: income.reduce((s, g) => s + g.count, 0),
              totalNet: incomeTotal,
              byCategory: income,
            },
            expenses: {
              count: expenses.reduce((s, g) => s + g.count, 0),
              totalNet: expenseTotal,
              byCategory: expenses,
            },
            netResult: incomeTotal - expenseTotal,
            note: "Management figures from the Portal's books (net of VAT) — not authoritative BIR tax.",
          });
        } catch (err) {
          return fail(err instanceof Error ? err.message : String(err));
        }
      },
    );

    registerWriteTools(server, {
      prisma: this.prisma,
      audit: this.audit,
      clients: this.clients,
      income: this.income,
      purchases: this.purchases,
      invoices: this.invoices,
      getActor: () => this.getActor(),
      getFirmId: () => this.firmId(),
    });

    return server;
  }
}

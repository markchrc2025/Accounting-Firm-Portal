// MCP (Model Context Protocol) server for the Portal — lets the firm connect
// Claude (claude.ai / Cowork custom connector) to their own practice data.
//
// Scope, by design:
//   - READ-ONLY. Every tool is a query; nothing mutates the database.
//   - Firm-scoped. The deployment is single-firm; all queries are pinned to
//     the first (seeded) firm's id, mirroring the OAuth integration caller.
//   - GUARDRAIL #1 still holds: nothing here is authoritative BIR tax — the
//     figures exposed are the Portal's management records/estimates.
//
// A fresh McpServer is built per request (stateless Streamable HTTP), so
// request ids never collide across concurrent calls.

import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Prisma } from "@prisma/client";
import { z } from "zod/v3";
import { dateToIso, isoToDate, toIncomeDto, toPurchaseDto } from "../financial/serialization";
import { PrismaService } from "../prisma/prisma.service";

const SERVER_NAME = "mcrc-portal-mcp-server";
const SERVER_VERSION = "1.0.0";
/** Hard cap on list sizes so one call can't blow out the model's context. */
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .describe("Calendar date, YYYY-MM-DD");

/** Successful tool result: pretty JSON text + the same object structured. */
function ok(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** Failed tool result with an actionable message (never throws at the client). */
function fail(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true as const,
  };
}

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

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
  constructor(private readonly prisma: PrismaService) {}

  /** The single firm this deployment serves (same model as the BIR caller). */
  private async firmId(): Promise<string> {
    const firm = await this.prisma.firm.findFirst({ orderBy: { createdAt: "asc" } });
    if (!firm) throw new Error("No firm exists yet — seed the database first.");
    return firm.id;
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
      "portal_list_clients",
      {
        title: "List clients",
        description:
          "List the firm's clients (id, business name, TIN, tax regime VAT|PERCENTAGE, status, " +
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
        },
        annotations: READ_ONLY,
      },
      async ({ clientId, from, to, limit, offset }) => {
        try {
          const firmId = await this.firmId();
          await this.requireClient(firmId, clientId);
          const where: Prisma.PurchaseTransactionWhereInput = {
            clientId,
            ...(dateRange(from, to) ? { txnDate: dateRange(from, to) } : {}),
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
              where: { clientId, ...txnFilter },
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

    return server;
  }
}

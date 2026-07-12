import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { IncomeTransaction, SalesImportRow } from "@portal/shared";
import type { AuthUser } from "../common/auth/auth-user";
import { parseOrBadRequest } from "../common/validation/zod.util";
import { AuditService } from "../audit/audit.service";
import { CategoriesService } from "../categories/categories.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import { RegimeValidator } from "../financial/regime-validator";
import { isoToDate, toIncomeDto } from "../financial/serialization";
import type { IncomeListQuery, IncomeSummaryQuery } from "./dto/income-query.schemas";

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

@Injectable()
export class IncomeTransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly categories: CategoriesService,
    private readonly regime: RegimeValidator,
    private readonly audit: AuditService,
  ) {}

  async create(user: AuthUser, clientId: string, body: unknown) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const regime = this.regime.requireRegime(client.taxType);

    // The FROZEN @portal/shared schema is the sole shape/coupling validator.
    const input = parseOrBadRequest(IncomeTransaction, {
      ...asObject(body),
      clientId,
      source: "manual",
    });
    this.regime.validateIncome(regime, input);
    await this.categories.resolveForTransaction(clientId, input.categoryId, "INCOME");

    const row = await this.prisma.incomeTransaction.create({
      data: this.toDb(clientId, input),
    });
    await this.audit.record({
      userId: user.id,
      action: "income.create",
      entityType: "IncomeTransaction",
      entityId: row.id,
      metadata: { clientId, netAmount: input.netAmount, vatClass: input.vatClass },
    });
    return toIncomeDto(row);
  }

  /** Bulk import income rows (from the Sales/Income template). Each row is
   *  validated + created independently so a bad row never blocks the rest; the
   *  Category name is resolved (created if new) and cached across rows. */
  async importRows(user: AuthUser, clientId: string, rows: unknown[]) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const regime = this.regime.requireRegime(client.taxType);
    const errors: { row: number; message: string }[] = [];
    const catCache = new Map<string, string>();
    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        const parsed = parseOrBadRequest(SalesImportRow, rows[i]);
        const key = parsed.Category.trim().toLowerCase();
        let categoryId = catCache.get(key);
        if (!categoryId) {
          const cat = await this.categories.resolveByName(clientId, parsed.Category, "INCOME");
          categoryId = cat.id;
          catCache.set(key, categoryId);
        }
        const input = parseOrBadRequest(IncomeTransaction, {
          clientId,
          categoryId,
          txnDate: parsed.Date,
          referenceNo: parsed.ReferenceNo,
          customer: parsed.Customer,
          description: parsed.Description,
          netAmount: parsed.NetAmount,
          vatClass: parsed.VatClass,
          saleToGovernment: parsed.SaleToGovernment ?? false,
          outputVAT: parsed.OutputVAT,
          creditableVATWithheld5pct: parsed.CreditableVATWithheld5pct,
          atc: parsed.ATC,
          source: "import",
          customerTin: parsed.CustomerTIN,
          dueDate: parsed.DueDate,
          terms: parsed.Terms,
          account: parsed.Account,
          unit: parsed.Unit,
          quantity: parsed.Quantity,
          unitPrice: parsed.UnitPrice,
          discount: parsed.Discount,
        });
        this.regime.validateIncome(regime, input);
        await this.prisma.incomeTransaction.create({ data: this.toDb(clientId, input) });
        created += 1;
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.audit.record({
      userId: user.id,
      action: "income.import",
      entityType: "IncomeTransaction",
      entityId: clientId,
      metadata: { clientId, created, failed: errors.length },
    });
    return { created, failed: errors.length, errors };
  }

  async list(user: AuthUser, clientId: string, query: IncomeListQuery) {
    await this.clients.assertInFirm(user.firmId, clientId);
    const where = this.buildWhere(clientId, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.incomeTransaction.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.incomeTransaction.count({ where }),
    ]);
    return {
      data: rows.map(toIncomeDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(user: AuthUser, clientId: string, txnId: string) {
    await this.clients.assertInFirm(user.firmId, clientId);
    return toIncomeDto(await this.loadOwned(clientId, txnId));
  }

  async update(user: AuthUser, clientId: string, txnId: string, body: unknown) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const existing = await this.loadOwned(clientId, txnId);
    const regime = this.regime.requireRegime(client.taxType);

    // Load existing → merge patch → validate the FULL object, so the shared
    // cross-field couplings (gov-sale, capital-goods) and regime rules re-run.
    const base = toIncomeDto(existing);
    const merged = {
      ...base,
      ...asObject(body),
      clientId, // never re-parented
      source: existing.source, // immutable
    };
    const input = parseOrBadRequest(IncomeTransaction, merged);
    this.regime.validateIncome(regime, input);
    if (input.categoryId !== existing.categoryId) {
      await this.categories.resolveForTransaction(clientId, input.categoryId, "INCOME");
    }

    const row = await this.prisma.incomeTransaction.update({
      where: { id: txnId },
      data: this.toDb(clientId, input),
    });
    await this.audit.record({
      userId: user.id,
      action: "income.update",
      entityType: "IncomeTransaction",
      entityId: txnId,
    });
    return toIncomeDto(row);
  }

  async remove(user: AuthUser, clientId: string, txnId: string) {
    await this.clients.assertInFirm(user.firmId, clientId);
    await this.loadOwned(clientId, txnId);
    await this.prisma.incomeTransaction.delete({ where: { id: txnId } });
    await this.audit.record({
      userId: user.id,
      action: "income.delete",
      entityType: "IncomeTransaction",
      entityId: txnId,
    });
    return { deleted: true };
  }

  /**
   * Management roll-up (NOT the authoritative Phase-6 vat-summary): totals and a
   * by-vatClass breakdown over an optional period. Clearly a Portal estimate.
   */
  async summary(user: AuthUser, clientId: string, query: IncomeSummaryQuery) {
    await this.clients.assertInFirm(user.firmId, clientId);
    const where = this.buildWhere(clientId, query);
    const [overall, byClass] = await this.prisma.$transaction([
      this.prisma.incomeTransaction.aggregate({
        where,
        _sum: { netAmount: true, outputVAT: true },
        _count: true,
      }),
      this.prisma.incomeTransaction.groupBy({
        by: ["vatClass"],
        where,
        _sum: { netAmount: true, outputVAT: true },
        _count: true,
        orderBy: { vatClass: "asc" },
      }),
    ]);
    return {
      basis: "management-estimate" as const,
      totalNet: num(overall._sum.netAmount),
      totalOutputVAT: num(overall._sum.outputVAT),
      count: overall._count,
      byVatClass: byClass.map((g) => ({
        vatClass: g.vatClass,
        net: num(g._sum?.netAmount ?? null),
        outputVAT: num(g._sum?.outputVAT ?? null),
        count: g._count,
      })),
    };
  }

  private buildWhere(
    clientId: string,
    q: IncomeListQuery | IncomeSummaryQuery,
  ): Prisma.IncomeTransactionWhereInput {
    const full = q as IncomeListQuery;
    return {
      clientId,
      ...(q.dateFrom || q.dateTo
        ? {
            txnDate: {
              ...(q.dateFrom ? { gte: isoToDate(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: isoToDate(q.dateTo) } : {}),
            },
          }
        : {}),
      ...(full.categoryId ? { categoryId: full.categoryId } : {}),
      ...(full.vatClass ? { vatClass: full.vatClass } : {}),
      ...(full.saleToGovernment !== undefined
        ? { saleToGovernment: full.saleToGovernment }
        : {}),
      ...(full.source ? { source: full.source } : {}),
      ...(full.search
        ? {
            OR: [
              { description: { contains: full.search, mode: "insensitive" } },
              { customer: { contains: full.search, mode: "insensitive" } },
              { referenceNo: { contains: full.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }

  private toDb(
    clientId: string,
    input: IncomeTransaction,
  ): Prisma.IncomeTransactionUncheckedCreateInput {
    return {
      clientId,
      categoryId: input.categoryId,
      txnDate: isoToDate(input.txnDate),
      referenceNo: input.referenceNo ?? null,
      customer: input.customer ?? null,
      description: input.description,
      netAmount: input.netAmount,
      vatClass: input.vatClass,
      saleToGovernment: input.saleToGovernment,
      outputVAT: input.outputVAT ?? null,
      creditableVATWithheld5pct: input.creditableVATWithheld5pct ?? null,
      atc: input.atc ?? null,
      source: input.source,
      customerTin: input.customerTin ?? null,
      dueDate: input.dueDate ? isoToDate(input.dueDate) : null,
      terms: input.terms ?? null,
      account: input.account ?? null,
      unit: input.unit ?? null,
      quantity: input.quantity ?? null,
      unitPrice: input.unitPrice ?? null,
      discount: input.discount ?? null,
    };
  }

  private async loadOwned(clientId: string, txnId: string) {
    const row = await this.prisma.incomeTransaction.findFirst({
      where: { id: txnId, clientId },
    });
    if (!row) throw new NotFoundException("Income transaction not found");
    return row;
  }
}

function num(v: Prisma.Decimal | null): number {
  return v === null ? 0 : v.toNumber();
}

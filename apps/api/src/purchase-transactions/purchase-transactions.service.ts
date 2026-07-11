import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ExpenseImportRow, PurchaseTransaction } from "@portal/shared";
import type { AuthUser } from "../common/auth/auth-user";
import { parseOrBadRequest } from "../common/validation/zod.util";
import { AuditService } from "../audit/audit.service";
import { CategoriesService } from "../categories/categories.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import { RegimeValidator } from "../financial/regime-validator";
import { isoToDate, toPurchaseDto } from "../financial/serialization";
import type {
  PurchaseListQuery,
  PurchaseSummaryQuery,
} from "./dto/purchase-query.schemas";

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

@Injectable()
export class PurchaseTransactionsService {
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

    const raw = asObject(body);
    const parsed = parseOrBadRequest(PurchaseTransaction, {
      ...raw,
      clientId,
      source: "manual",
    });
    const category = await this.categories.resolveForTransaction(
      clientId,
      parsed.categoryId,
      "EXPENSE",
    );
    // Default deductibility from the category unless the caller set it explicitly.
    const input: PurchaseTransaction = {
      ...parsed,
      deductible: "deductible" in raw ? parsed.deductible : category.isDeductible,
    };
    this.regime.validatePurchase(regime, input);

    const row = await this.prisma.purchaseTransaction.create({
      data: this.toDb(clientId, input),
    });
    await this.audit.record({
      userId: user.id,
      action: "purchase.create",
      entityType: "PurchaseTransaction",
      entityId: row.id,
      metadata: {
        clientId,
        netAmount: input.netAmount,
        inputVATCategory: input.inputVATCategory,
      },
    });
    return toPurchaseDto(row);
  }

  /** Bulk import expense rows (from the Expenses/Purchases template). Per-row
   *  isolation: a bad row is reported, not fatal. Category name resolved/created
   *  and cached. NetAmount is stored net of VAT (Guardrail #3). */
  async importRows(user: AuthUser, clientId: string, rows: unknown[]) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const regime = this.regime.requireRegime(client.taxType);
    const errors: { row: number; message: string }[] = [];
    const catCache = new Map<string, string>();
    let created = 0;
    for (let i = 0; i < rows.length; i++) {
      try {
        const parsed = parseOrBadRequest(ExpenseImportRow, rows[i]);
        const key = parsed.Category.trim().toLowerCase();
        let categoryId = catCache.get(key);
        if (!categoryId) {
          const cat = await this.categories.resolveByName(clientId, parsed.Category, "EXPENSE");
          categoryId = cat.id;
          catCache.set(key, categoryId);
        }
        const input = parseOrBadRequest(PurchaseTransaction, {
          clientId,
          categoryId,
          txnDate: parsed.Date,
          referenceNo: parsed.ReferenceNo,
          vendor: parsed.Vendor,
          description: parsed.Description,
          netAmount: parsed.NetAmount,
          inputVATCategory: parsed.InputVATCategory,
          inputVAT: parsed.InputVAT,
          isCapitalGood: parsed.IsCapitalGood ?? false,
          capitalGoodAcquisitionCost: parsed.CapitalGoodAcquisitionCost,
          estimatedUsefulLifeMonths: parsed.EstimatedUsefulLifeMonths,
          inputTaxAttribution: parsed.InputTaxAttribution,
          deductible: parsed.Deductible ?? true,
          source: "import",
        });
        this.regime.validatePurchase(regime, input);
        await this.prisma.purchaseTransaction.create({ data: this.toDb(clientId, input) });
        created += 1;
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.audit.record({
      userId: user.id,
      action: "purchase.import",
      entityType: "PurchaseTransaction",
      entityId: clientId,
      metadata: { clientId, created, failed: errors.length },
    });
    return { created, failed: errors.length, errors };
  }

  async list(user: AuthUser, clientId: string, query: PurchaseListQuery) {
    await this.clients.assertInFirm(user.firmId, clientId);
    const where = this.buildWhere(clientId, query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseTransaction.findMany({
        where,
        orderBy: { [query.sortBy]: query.sortDir },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.purchaseTransaction.count({ where }),
    ]);
    return {
      data: rows.map(toPurchaseDto),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async get(user: AuthUser, clientId: string, txnId: string) {
    await this.clients.assertInFirm(user.firmId, clientId);
    return toPurchaseDto(await this.loadOwned(clientId, txnId));
  }

  async update(user: AuthUser, clientId: string, txnId: string, body: unknown) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const existing = await this.loadOwned(clientId, txnId);
    const regime = this.regime.requireRegime(client.taxType);

    const base = toPurchaseDto(existing);
    const merged = {
      ...base,
      ...asObject(body),
      clientId,
      source: existing.source,
    };
    const input = parseOrBadRequest(PurchaseTransaction, merged);
    this.regime.validatePurchase(regime, input);
    if (input.categoryId !== existing.categoryId) {
      await this.categories.resolveForTransaction(clientId, input.categoryId, "EXPENSE");
    }

    const row = await this.prisma.purchaseTransaction.update({
      where: { id: txnId },
      data: this.toDb(clientId, input),
    });
    await this.audit.record({
      userId: user.id,
      action: "purchase.update",
      entityType: "PurchaseTransaction",
      entityId: txnId,
    });
    return toPurchaseDto(row);
  }

  async remove(user: AuthUser, clientId: string, txnId: string) {
    await this.clients.assertInFirm(user.firmId, clientId);
    await this.loadOwned(clientId, txnId);
    await this.prisma.purchaseTransaction.delete({ where: { id: txnId } });
    await this.audit.record({
      userId: user.id,
      action: "purchase.delete",
      entityType: "PurchaseTransaction",
      entityId: txnId,
    });
    return { deleted: true };
  }

  /**
   * Management roll-up (NOT the Phase-6 vat-summary): totals, a by-inputVATCategory
   * breakdown, and a deductible split for the income-tax estimate. A Portal estimate.
   */
  async summary(user: AuthUser, clientId: string, query: PurchaseSummaryQuery) {
    await this.clients.assertInFirm(user.firmId, clientId);
    const where = this.buildWhere(clientId, query);
    const [overall, byCategory, deductibleAgg] = await this.prisma.$transaction([
      this.prisma.purchaseTransaction.aggregate({
        where,
        _sum: { netAmount: true, inputVAT: true },
        _count: true,
      }),
      this.prisma.purchaseTransaction.groupBy({
        by: ["inputVATCategory"],
        where,
        _sum: { netAmount: true, inputVAT: true },
        _count: true,
        orderBy: { inputVATCategory: "asc" },
      }),
      this.prisma.purchaseTransaction.groupBy({
        by: ["deductible"],
        where,
        _sum: { netAmount: true },
        orderBy: { deductible: "asc" },
      }),
    ]);
    const deductibleNet = num(
      deductibleAgg.find((d) => d.deductible)?._sum?.netAmount ?? null,
    );
    const nonDeductibleNet = num(
      deductibleAgg.find((d) => !d.deductible)?._sum?.netAmount ?? null,
    );
    return {
      basis: "management-estimate" as const,
      totalNet: num(overall._sum.netAmount),
      totalInputVAT: num(overall._sum.inputVAT),
      count: overall._count,
      deductibleNet,
      nonDeductibleNet,
      byInputVATCategory: byCategory.map((g) => ({
        inputVATCategory: g.inputVATCategory,
        net: num(g._sum?.netAmount ?? null),
        inputVAT: num(g._sum?.inputVAT ?? null),
        count: g._count,
      })),
    };
  }

  private buildWhere(
    clientId: string,
    q: PurchaseListQuery | PurchaseSummaryQuery,
  ): Prisma.PurchaseTransactionWhereInput {
    const full = q as PurchaseListQuery;
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
      ...(full.inputVATCategory ? { inputVATCategory: full.inputVATCategory } : {}),
      ...(full.inputTaxAttribution
        ? { inputTaxAttribution: full.inputTaxAttribution }
        : {}),
      ...(full.isCapitalGood !== undefined ? { isCapitalGood: full.isCapitalGood } : {}),
      ...(full.deductible !== undefined ? { deductible: full.deductible } : {}),
      ...(full.source ? { source: full.source } : {}),
      ...(full.search
        ? {
            OR: [
              { description: { contains: full.search, mode: "insensitive" } },
              { vendor: { contains: full.search, mode: "insensitive" } },
              { referenceNo: { contains: full.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
  }

  private toDb(
    clientId: string,
    input: PurchaseTransaction,
  ): Prisma.PurchaseTransactionUncheckedCreateInput {
    return {
      clientId,
      categoryId: input.categoryId,
      txnDate: isoToDate(input.txnDate),
      referenceNo: input.referenceNo ?? null,
      vendor: input.vendor ?? null,
      description: input.description,
      netAmount: input.netAmount,
      inputVATCategory: input.inputVATCategory ?? null,
      inputVAT: input.inputVAT ?? null,
      isCapitalGood: input.isCapitalGood,
      capitalGoodAcquisitionCost: input.capitalGoodAcquisitionCost ?? null,
      estimatedUsefulLifeMonths: input.estimatedUsefulLifeMonths ?? null,
      inputTaxAttribution: input.inputTaxAttribution ?? null,
      deductible: input.deductible,
      source: input.source,
    };
  }

  private async loadOwned(clientId: string, txnId: string) {
    const row = await this.prisma.purchaseTransaction.findFirst({
      where: { id: txnId, clientId },
    });
    if (!row) throw new NotFoundException("Purchase transaction not found");
    return row;
  }
}

function num(v: Prisma.Decimal | null): number {
  return v === null ? 0 : v.toNumber();
}

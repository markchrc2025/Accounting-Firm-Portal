import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
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

/**
 * Fields only the server writes (U6-A1, R4): the import stamps them, :id/post
 * moves status, and no edit may set them. A body carrying any of them is a
 * 400 that names the field — never silently dropped.
 */
const SERVER_OWNED_FIELDS = ["status", "needsReview", "vatClaimable", "importBatchId", "sourceFile"] as const;

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

  /**
   * The web's Account picker sends a Chart-of-Accounts account NAME in `account`;
   * the per-client Category is resolved here (created on first use, same as the
   * import path) so callers don't need Categories:Create. An explicit categoryId
   * always wins.
   */
  private async resolveCategoryFromAccount(
    clientId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const account = typeof raw.account === "string" ? raw.account.trim() : "";
    if (raw.categoryId || !account) return raw;
    const cat = await this.categories.resolveByName(clientId, account, "EXPENSE");
    return { ...raw, categoryId: cat.id };
  }

  async create(user: AuthUser, clientId: string, body: unknown) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const regime = this.regime.requireRegime(client.taxType);

    const raw = await this.resolveCategoryFromAccount(clientId, asObject(body));
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
    const isVat = client.taxType === "VAT";
    const errors: { row: number; message: string }[] = [];
    const catCache = new Map<string, string>();
    const rateCache = new Map<string, number>();
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
        const atc = parsed.ATC ?? parsed.TaxCode;
        // Amount is tax-inclusive; back out input VAT via the Tax Code / Tax Type
        // (VAT-registered clients only). taxAmount records the tax on the line.
        const rate = isVat ? await this.vatRate(atc, parsed.TaxType, rateCache) : 0;
        let netAmount: number;
        let inputVAT: number | undefined;
        let taxAmount: number | undefined = parsed.TaxAmount;
        if (parsed.Amount !== undefined) {
          netAmount = Math.round((parsed.Amount / (1 + rate)) * 100) / 100;
          const tax = rate > 0 ? Math.round((parsed.Amount - netAmount) * 100) / 100 : 0;
          inputVAT = rate > 0 ? tax : parsed.InputVAT;
          if (taxAmount === undefined && tax > 0) taxAmount = tax;
        } else {
          netAmount = parsed.NetAmount ?? 0;
          inputVAT = parsed.InputVAT;
        }
        const input = parseOrBadRequest(PurchaseTransaction, {
          clientId,
          categoryId,
          txnDate: parsed.Date,
          referenceNo: parsed.ReferenceNo,
          vendor: parsed.Vendor,
          description: parsed.Description,
          netAmount,
          inputVATCategory:
            parsed.InputVATCategory ?? (isVat && rate > 0 ? "DOMESTIC_PURCHASES" : undefined),
          inputVAT,
          isCapitalGood: parsed.IsCapitalGood ?? false,
          capitalGoodAcquisitionCost: parsed.CapitalGoodAcquisitionCost,
          estimatedUsefulLifeMonths: parsed.EstimatedUsefulLifeMonths,
          inputTaxAttribution: parsed.InputTaxAttribution,
          deductible: parsed.Deductible ?? true,
          source: "import",
          vendorTin: parsed.VendorTIN,
          dueDate: parsed.DueDate,
          account: parsed.Account,
          atc,
          taxAmount,
          unit: parsed.Unit,
          quantity: parsed.Quantity,
          unitPrice: parsed.UnitPrice,
          discount: parsed.Discount,
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
    // U9 R2 (D45): a client principal sees posted records only, whatever it asks
    // for — held records are the firm's working state.
    const where = {
      ...this.buildWhere(clientId, query),
      ...(user.userType === "CLIENT" ? { status: "posted" } : {}),
    };
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
    return toPurchaseDto(await this.loadOwned(clientId, txnId, user));
  }

  async update(user: AuthUser, clientId: string, txnId: string, body: unknown) {
    this.rejectServerOwned(asObject(body));
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const existing = await this.loadOwned(clientId, txnId, user);
    const regime = this.regime.requireRegime(client.taxType);

    // A patch that changes `account` (without a categoryId) re-resolves the
    // category so the two never drift apart.
    const base = toPurchaseDto(existing);
    const merged = {
      ...base,
      ...(await this.resolveCategoryFromAccount(clientId, asObject(body))),
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
    await this.loadOwned(clientId, txnId, user);
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
    // Held imports (U6, R7) are not part of any total until an accountant posts them.
    const where = { ...this.buildWhere(clientId, query), status: "posted" };
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
      ...(full.status ? { status: full.status } : {}),
      ...(full.needsReview !== undefined ? { needsReview: full.needsReview } : {}),
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

  /** VAT rate (0, or the ATC / tax-type rate) used to back input VAT out of a
   *  tax-inclusive Amount. Uses the seeded BIR data, else the Tax Type string. */
  private async vatRate(
    taxCode: string | undefined,
    taxType: string | undefined,
    cache: Map<string, number>,
  ): Promise<number> {
    const key = `${taxCode ?? ""}|${taxType ?? ""}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let rate = 0;
    const code = taxCode?.trim().toUpperCase();
    if (code) {
      const a = await this.prisma.birAtcCode.findUnique({ where: { atc: code } });
      if (a && a.classification === "vat" && a.rate != null) rate = Number(a.rate);
    }
    if (rate === 0) {
      const t = (taxType ?? "").trim().toUpperCase();
      if (t === "VT" || t.includes("VAT")) rate = 0.12;
    }
    cache.set(key, rate);
    return rate;
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
      vendorTin: input.vendorTin ?? null,
      dueDate: input.dueDate ? isoToDate(input.dueDate) : null,
      account: input.account ?? null,
      atc: input.atc ?? null,
      taxAmount: input.taxAmount ?? null,
      whtAmount: input.whtAmount ?? null,
      unit: input.unit ?? null,
      quantity: input.quantity ?? null,
      unitPrice: input.unitPrice ?? null,
      discount: input.discount ?? null,
    };
  }

  /** 400 naming every server-owned field the body carries (same shape as the validation pipe). */
  private rejectServerOwned(raw: Record<string, unknown>): void {
    const offending = SERVER_OWNED_FIELDS.filter((f) => f in raw);
    if (offending.length === 0) return;
    throw new BadRequestException({
      message: "Validation failed",
      errors: offending.map((f) => ({
        path: f,
        message: `${f} is set by the server and cannot be changed through an edit.`,
      })),
    });
  }

  /** A record of the client (404 otherwise); to a client principal, posted ones only (U9 R2). */
  private async loadOwned(clientId: string, txnId: string, user?: AuthUser) {
    const row = await this.prisma.purchaseTransaction.findFirst({
      where: { id: txnId, clientId, ...(user?.userType === "CLIENT" ? { status: "posted" } : {}) },
    });
    if (!row) throw new NotFoundException("Purchase transaction not found");
    return row;
  }
}

function num(v: Prisma.Decimal | null): number {
  return v === null ? 0 : v.toNumber();
}

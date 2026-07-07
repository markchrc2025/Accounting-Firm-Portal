import { Prisma } from "@prisma/client";
import type {
  Category as CategoryRow,
  IncomeTransaction as IncomeRow,
  PurchaseTransaction as PurchaseRow,
} from "@prisma/client";

/**
 * Serialization at the API boundary. Prisma returns Decimal columns as
 * Prisma.Decimal (which JSON-stringifies to a string) and @db.Date as a Date;
 * the wire contract (@portal/shared zMoney / zIsoDate) is JSON numbers and
 * 'YYYY-MM-DD' strings. These mappers bridge that, so responses round-trip
 * through the web forms' zodResolver.
 */

export function decToNum(v: Prisma.Decimal | null): number | undefined {
  return v === null ? undefined : v.toNumber();
}

/** A required Decimal column → number. */
export function decToNumReq(v: Prisma.Decimal): number {
  return v.toNumber();
}

/** Prisma @db.Date → 'YYYY-MM-DD' (UTC calendar date, no time component). */
export function dateToIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → a UTC-midnight Date for a @db.Date column (no TZ drift). */
export function isoToDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export function toCategoryDto(c: CategoryRow) {
  return {
    id: c.id,
    clientId: c.clientId,
    type: c.type,
    name: c.name,
    isDeductible: c.isDeductible,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toIncomeDto(t: IncomeRow) {
  return {
    id: t.id,
    clientId: t.clientId,
    categoryId: t.categoryId,
    txnDate: dateToIso(t.txnDate),
    referenceNo: t.referenceNo ?? undefined,
    customer: t.customer ?? undefined,
    description: t.description,
    netAmount: decToNumReq(t.netAmount),
    vatClass: t.vatClass,
    saleToGovernment: t.saleToGovernment,
    outputVAT: decToNum(t.outputVAT),
    creditableVATWithheld5pct: decToNum(t.creditableVATWithheld5pct),
    atc: t.atc ?? undefined,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toPurchaseDto(t: PurchaseRow) {
  return {
    id: t.id,
    clientId: t.clientId,
    categoryId: t.categoryId,
    txnDate: dateToIso(t.txnDate),
    referenceNo: t.referenceNo ?? undefined,
    vendor: t.vendor ?? undefined,
    description: t.description,
    netAmount: decToNumReq(t.netAmount),
    inputVATCategory: t.inputVATCategory ?? undefined,
    inputVAT: decToNum(t.inputVAT),
    isCapitalGood: t.isCapitalGood,
    capitalGoodAcquisitionCost: decToNum(t.capitalGoodAcquisitionCost),
    estimatedUsefulLifeMonths: t.estimatedUsefulLifeMonths ?? undefined,
    inputTaxAttribution: t.inputTaxAttribution ?? undefined,
    deductible: t.deductible,
    source: t.source,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

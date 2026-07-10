import { Injectable, NotFoundException } from "@nestjs/common";
import {
  PercentageTaxSummaryResponse,
  round2,
  VatSummaryResponse,
} from "@portal/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { buildVatSummary, quarterToRange } from "./aggregation";

/** ISO yyyy-mm-dd from a Prisma @db.Date value. */
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dec(value: Prisma.Decimal | null): number {
  return value ? Number(value) : 0;
}

@Injectable()
export class AggregationService {
  constructor(private readonly prisma: PrismaService) {}

  /** 2550Q roll-up of a VAT client's classified transactions for a quarter. */
  async vatSummary(
    firmId: string,
    clientId: string,
    year: number,
    quarter: number,
  ): Promise<VatSummaryResponse> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
    });
    if (!client) throw new NotFoundException("Client not found");

    const { start, end } = quarterToRange(year, quarter);
    const range = { gte: new Date(start), lte: new Date(end) };

    const [income, purchases] = await Promise.all([
      this.prisma.incomeTransaction.findMany({
        where: { clientId, txnDate: range },
      }),
      this.prisma.purchaseTransaction.findMany({
        where: { clientId, txnDate: range },
      }),
    ]);

    const summary = buildVatSummary(
      { id: client.id, tin: client.tin ?? "" },
      { year, quarter, start, end },
      income.map((r) => ({
        vatClass: r.vatClass,
        netAmount: dec(r.netAmount),
        saleToGovernment: r.saleToGovernment,
        creditableVATWithheld5pct: r.creditableVATWithheld5pct
          ? Number(r.creditableVATWithheld5pct)
          : null,
      })),
      purchases.map((r) => ({
        inputVATCategory: r.inputVATCategory,
        netAmount: dec(r.netAmount),
        inputVAT: r.inputVAT ? Number(r.inputVAT) : null,
        capitalGoodAcquisitionCost: r.capitalGoodAcquisitionCost
          ? Number(r.capitalGoodAcquisitionCost)
          : null,
        estimatedUsefulLifeMonths: r.estimatedUsefulLifeMonths,
        inputTaxAttribution: r.inputTaxAttribution,
        txnDate: toIsoDate(r.txnDate),
      })),
    );

    // Defensive: fail loudly if we ever drift from the shared contract shape.
    return VatSummaryResponse.parse(summary);
  }

  /** 2551Q gross-receipts roll-up for a percentage-tax (non-VAT) client. */
  async percentageTaxSummary(
    firmId: string,
    clientId: string,
    year: number,
    quarter: number,
  ): Promise<PercentageTaxSummaryResponse> {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId },
    });
    if (!client) throw new NotFoundException("Client not found");

    const { start, end } = quarterToRange(year, quarter);
    const income = await this.prisma.incomeTransaction.findMany({
      where: { clientId, txnDate: { gte: new Date(start), lte: new Date(end) } },
    });

    const grossReceipts = round2(
      income.reduce((acc, r) => acc + Number(r.netAmount), 0),
    );

    // Optional per-ATC breakdown when a client genuinely tags multiple streams.
    const byAtcMap = new Map<string, number>();
    for (const r of income) {
      if (r.atc) {
        byAtcMap.set(r.atc, round2((byAtcMap.get(r.atc) ?? 0) + Number(r.netAmount)));
      }
    }
    const byAtc =
      byAtcMap.size > 0
        ? [...byAtcMap.entries()].map(([atc, gr]) => ({ atc, grossReceipts: gr }))
        : undefined;

    return PercentageTaxSummaryResponse.parse({
      client: { id: client.id, tin: client.tin ?? "", vatRegistered: false },
      period: { year, quarter, start, end },
      grossReceipts,
      ...(byAtc ? { byAtc } : {}),
    });
  }
}

/**
 * track-a-regime-summaries.spec.ts — each integration summary answers only for the
 * regime that files its return (U9 R3, D45). Hermetic: the real AggregationService
 * over a Prisma stub; the client is invented.
 *
 * T5  vat-summary: VAT clients only; percentage-tax-summary: PERCENTAGE clients
 *     only; every other regime gets 409, and no transaction is read.
 */
import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AggregationService } from "./aggregation.service";
import type { PrismaService } from "../prisma/prisma.service";

const CLIENT_ID = "33333333-3333-4333-8333-333333333333";
const NAME = "Invented Regime Trader";

function aggregation(taxType: string | null) {
  const prisma = {
    client: {
      findFirst: jest.fn().mockResolvedValue({
        id: CLIENT_ID,
        firmId: "f1",
        businessName: NAME,
        tin: "000123456",
        taxType,
      }),
    },
    incomeTransaction: {
      findMany: jest.fn().mockResolvedValue([
        {
          netAmount: new Prisma.Decimal(20000),
          outputVAT: new Prisma.Decimal(taxType === "VAT" ? 2400 : 0),
          vatClass: taxType === "VAT" ? "VATABLE_12" : "NON_VAT",
          atc: null,
          saleToGovernment: false,
          creditableVATWithheld5pct: null,
        },
      ]),
    },
    purchaseTransaction: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { svc: new AggregationService(prisma as unknown as PrismaService), prisma };
}

describe("U9 T5 · each summary answers only for its own regime", () => {
  it("a PERCENTAGE client's vat-summary answers 409, and no transaction is read", async () => {
    const { svc, prisma } = aggregation("PERCENTAGE");
    const err = await svc.vatSummary("f1", CLIENT_ID, 2026, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(
      `${NAME} is a percentage-tax client and files no 2550Q, so there is no VAT summary.`,
    );
    expect(prisma.incomeTransaction.findMany).not.toHaveBeenCalled();
  });

  it("a VAT client's percentage-tax summary answers 409, and no transaction is read", async () => {
    const { svc, prisma } = aggregation("VAT");
    const err = await svc
      .percentageTaxSummary("f1", CLIENT_ID, 2026, 3)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as Error).message).toBe(
      `${NAME} is VAT-registered and files no 2551Q, so there is no percentage-tax summary.`,
    );
    expect(prisma.incomeTransaction.findMany).not.toHaveBeenCalled();
  });

  it("each summary still answers for its own regime as before", async () => {
    const vat = await aggregation("VAT").svc.vatSummary("f1", CLIENT_ID, 2026, 3);
    expect(vat.client).toMatchObject({ id: CLIENT_ID, vatRegistered: true });
    const pct = await aggregation("PERCENTAGE").svc.percentageTaxSummary(
      "f1",
      CLIENT_ID,
      2026,
      3,
    );
    expect(pct).toMatchObject({ grossReceipts: 20000, client: { vatRegistered: false } });
  });

  it("an exempt client keeps U8's 409 on both", async () => {
    for (const [fn, form] of [
      ["vatSummary", "2550Q"],
      ["percentageTaxSummary", "2551Q"],
    ] as const) {
      const err = await aggregation(null)
        .svc[fn]("f1", CLIENT_ID, 2026, 3)
        .catch((e: unknown) => e);
      expect((err as Error).message).toContain(
        `has no tax regime: it is exempt from business tax and files no ${form}`,
      );
    }
  });
});

/**
 * ai-settings.service.ts — the firm's AI settings and its budget for the month
 * (U11 R1, R5). Settings are read from Firm.settingsJson.ai, falling back to the
 * owner's defaults; no route changes them until U12. The key is only ever tested
 * for presence here.
 */
import { Inject, Injectable } from "@nestjs/common";
import { AiModel, type AiStatus } from "@portal/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AI_CLOCK, type AiClock } from "./ai.tokens";
import { round6 } from "./prices";

/** The statuses whose estimate is held against the budget (U14: "preparing" too). */
export const RESERVING = ["preparing", "reading"] as const;

/** The owner's decisions of 2026-10-10 (R1). */
export const AI_DEFAULTS = {
  enabled: true,
  budget: 25,
  usdToPhp: 62.77,
  model: "claude-sonnet-5-5" as AiModel,
};

/** The share of the budget at which the status warns. */
export const WARNING_SHARE = 0.8;

export interface AiSettings {
  enabled: boolean;
  budget: number;
  usdToPhp: number;
  model: AiModel;
}

/** The Manila calendar month ("YYYY-MM") of a moment. Manila is UTC+8 all year. */
export function manilaMonth(at: Date): string {
  return new Date(at.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7);
}

/** True when the API service has an Anthropic key. Presence only — never the key. */
export function aiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_CLOCK) private readonly clock: AiClock,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async settings(firmId: string): Promise<AiSettings> {
    const firm = await this.prisma.firm.findUnique({
      where: { id: firmId },
      select: { settingsJson: true },
    });
    const root = firm?.settingsJson;
    const ai =
      root && typeof root === "object" && !Array.isArray(root)
        ? ((root as Record<string, unknown>).ai as Record<string, unknown> | undefined)
        : undefined;
    const num = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
    const model = AiModel.safeParse(ai?.model);
    return {
      enabled: typeof ai?.enabled === "boolean" ? ai.enabled : AI_DEFAULTS.enabled,
      budget: num(ai?.budget, AI_DEFAULTS.budget),
      usdToPhp: num(ai?.usdToPhp, AI_DEFAULTS.usdToPhp) || AI_DEFAULTS.usdToPhp,
      model: model.success ? model.data : AI_DEFAULTS.model,
    };
  }

  /** Spent = actual cost of results received this month; reserved = the estimates
   *  of piles still being prepared (U14) or read. Both by the month each pile was
   *  created in. */
  async usage(
    firmId: string,
    month: string,
  ): Promise<{ spent: number; reserved: number }> {
    const [spent, reserved] = await Promise.all([
      this.prisma.receiptScan.aggregate({
        where: { firmId, month },
        _sum: { actualUsd: true },
      }),
      this.prisma.receiptScan.aggregate({
        where: { firmId, month, status: { in: [...RESERVING] } },
        _sum: { estimatedUsd: true },
      }),
    ]);
    return {
      spent: round6(Number(spent._sum.actualUsd ?? 0)),
      reserved: round6(Number(reserved._sum.estimatedUsd ?? 0)),
    };
  }

  async status(firmId: string): Promise<AiStatus> {
    const s = await this.settings(firmId);
    const month = manilaMonth(this.now());
    const { spent, reserved } = await this.usage(firmId, month);
    return {
      configured: aiKeyConfigured(),
      enabled: s.enabled,
      month,
      budgetUsd: s.budget,
      spentUsd: spent,
      reservedUsd: reserved,
      remainingUsd: round6(Math.max(0, s.budget - spent - reserved)),
      warning: spent + reserved >= WARNING_SHARE * s.budget,
      usdToPhp: s.usdToPhp,
      model: s.model,
    };
  }
}

/** US$ and ₱ as the messages show them: "US$0.03 (₱1.88)". */
export function money(usd: number, usdToPhp: number, round: "up" | "down"): string {
  const cents =
    round === "up" ? Math.ceil(usd * 100 - 1e-9) : Math.floor(usd * 100 + 1e-9);
  const dollars = cents / 100;
  const php = (Math.round(dollars * usdToPhp * 100) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `US$${dollars.toFixed(2)} (₱${php})`;
}

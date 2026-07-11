import { Injectable } from "@nestjs/common";
import type { TaxRule as TaxRuleRow } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  DEFAULT_TAX_RULE,
  TaxBracketSchema,
  type TaxBracket,
  type TaxRuleInput,
} from "./dto/tax-rule.schemas";

/**
 * Per-client income-tax configuration (a Portal MANAGEMENT ESTIMATE — guardrail
 * #1: the Portal never computes authoritative BIR tax). Exactly one rule per
 * client; when none is configured the API serves the TRAIN graduated default
 * WITHOUT persisting it.
 */
@Injectable()
export class TaxRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  /** The client's rule, or the TRAIN graduated default when none exists. */
  async get(user: AuthUser, clientId: string): Promise<TaxRuleInput> {
    await this.clients.assertInFirm(user.firmId, clientId);
    const row = await this.prisma.taxRule.findUnique({ where: { clientId } });
    return row ? toTaxRuleDto(row) : DEFAULT_TAX_RULE;
  }

  /** Validate + upsert (create or update by clientId); returns the saved rule. */
  async upsert(
    user: AuthUser,
    clientId: string,
    input: TaxRuleInput,
  ): Promise<TaxRuleInput> {
    await this.clients.assertInFirm(user.firmId, clientId);
    const data = {
      method: input.method,
      flatRate: input.flatRate,
      bracketsJson: input.brackets,
    };
    const row = await this.prisma.taxRule.upsert({
      where: { clientId },
      create: { clientId, ...data },
      update: data,
    });
    await this.audit.record({
      userId: user.id,
      action: "tax-rule.upsert",
      entityType: "TaxRule",
      entityId: row.id,
      metadata: { clientId, method: input.method },
    });
    return toTaxRuleDto(row);
  }
}

/** Map a stored row to the API shape: Decimal→number, JSON→bracket array. */
function toTaxRuleDto(row: TaxRuleRow): TaxRuleInput {
  return {
    method: row.method as TaxRuleInput["method"],
    flatRate: row.flatRate === null ? null : Number(row.flatRate),
    brackets: coerceBrackets(row.bracketsJson),
  };
}

/** Coerce the stored `bracketsJson` back into a validated bracket array. */
function coerceBrackets(value: unknown): TaxBracket[] {
  if (!Array.isArray(value)) return [];
  const out: TaxBracket[] = [];
  for (const entry of value) {
    const parsed = TaxBracketSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

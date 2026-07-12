import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { ChartAccount as ChartAccountRow } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  derivedParentCode,
  expectedNormalBalance,
  validateChartOfAccounts,
  validateTaxMappings,
  type CoaAccount,
  type CoaTaxMapping,
} from "./coa-import";
import type { CreateAccountInput, UpdateAccountInput } from "./dto/coa.schemas";

/**
 * Chart of Accounts reads + guarded CRUD. Every write is validated by
 * replaying the FULL prospective chart through the same convention validators
 * that guard the xlsx seed — an edit that would break the numbering scheme,
 * normal balances, the PHP-only rule or BIR P&L coverage is rejected with a
 * 400 naming the offending account code. Writes stamp `editedAt`, which tells
 * the seeder to leave the row alone on future deploys (user edits win).
 */
@Injectable()
export class CoaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ reads

  async listAccounts(filters: { class?: string; search?: string }) {
    const { class: cls, search } = filters;
    const rows = await this.prisma.chartAccount.findMany({
      where: {
        ...(cls ? { class: cls } : {}),
        ...(search
          ? {
              OR: [
                { code: { contains: search, mode: "insensitive" as const } },
                { name: { contains: search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      orderBy: { code: "asc" },
    });
    return rows.map((a) => ({
      ...a,
      lockDate: a.lockDate ? a.lockDate.toISOString().slice(0, 10) : null,
    }));
  }

  listMappings() {
    return this.prisma.accountTaxMapping.findMany({ orderBy: { accountCode: "asc" } });
  }

  // ---------------------------------------------------------------- helpers

  private toCoaAccount(row: ChartAccountRow): CoaAccount {
    return {
      code: row.code,
      name: row.name,
      class: row.class,
      accountType: row.accountType,
      parentCode: row.parentCode,
      normalBalance: row.normalBalance === "credit" ? "credit" : "debit",
      currency: row.currency,
      lockDate: row.lockDate ? row.lockDate.toISOString().slice(0, 10) : null,
      monthlyMovement: row.monthlyMovement,
      description: row.description,
      archived: row.archived,
    };
  }

  private async loadAll(): Promise<{ accounts: CoaAccount[]; mappings: CoaTaxMapping[] }> {
    const [accountRows, mappingRows] = await Promise.all([
      this.prisma.chartAccount.findMany(),
      this.prisma.accountTaxMapping.findMany(),
    ]);
    return {
      accounts: accountRows.map((r) => this.toCoaAccount(r)),
      mappings: mappingRows.map((m) => ({
        accountCode: m.accountCode,
        taxCategory: m.taxCategory,
        accountName: m.accountName,
        taxReturnLine: m.taxReturnLine,
      })),
    };
  }

  /** Reject the write when the prospective chart breaks any convention. */
  private check(accounts: CoaAccount[], mappings: CoaTaxMapping[]): void {
    const errors = [
      ...validateChartOfAccounts(accounts),
      ...validateTaxMappings(accounts, mappings),
    ];
    if (errors.length > 0) {
      throw new BadRequestException(errors.join(" • "));
    }
  }

  private async requireAccount(code: string): Promise<ChartAccountRow> {
    const row = await this.prisma.chartAccount.findUnique({ where: { code } });
    if (!row) throw new NotFoundException(`Account ${code} not found.`);
    return row;
  }

  // ----------------------------------------------------------------- writes

  async createAccount(user: AuthUser, input: CreateAccountInput) {
    const { accounts, mappings } = await this.loadAll();
    const candidate: CoaAccount = {
      code: input.code,
      name: input.name,
      class: input.class,
      accountType: input.accountType,
      parentCode: derivedParentCode(input.code),
      normalBalance: expectedNormalBalance(input.class, input.code),
      currency: "PHP",
      lockDate: null,
      monthlyMovement: input.monthlyMovement ?? false,
      description: input.description?.trim() || null,
      archived: false,
    };
    const nextMappings = input.taxReturnLine
      ? [
          ...mappings,
          {
            accountCode: input.code,
            taxCategory: "Regular",
            accountName: input.name,
            taxReturnLine: input.taxReturnLine.trim(),
          },
        ]
      : mappings;
    this.check([...accounts, candidate], nextMappings);

    const now = new Date();
    const row = await this.prisma.chartAccount.create({
      data: {
        code: candidate.code,
        name: candidate.name,
        class: candidate.class,
        accountType: candidate.accountType,
        parentCode: candidate.parentCode,
        normalBalance: candidate.normalBalance,
        currency: candidate.currency,
        lockDate: null,
        monthlyMovement: candidate.monthlyMovement,
        description: candidate.description,
        source: "custom",
        editedAt: now,
      },
    });
    if (input.taxReturnLine) {
      await this.prisma.accountTaxMapping.create({
        data: {
          accountCode: input.code,
          taxCategory: "Regular",
          accountName: input.name,
          taxReturnLine: input.taxReturnLine.trim(),
          source: "custom",
          editedAt: now,
        },
      });
    }
    await this.audit.record({
      userId: user.id,
      action: "coa.account.create",
      entityType: "ChartAccount",
      entityId: row.code,
      metadata: { class: row.class, name: row.name },
    });
    return row;
  }

  async updateAccount(user: AuthUser, code: string, input: UpdateAccountInput) {
    const existing = await this.requireAccount(code);
    const { accounts, mappings } = await this.loadAll();
    const merged: CoaAccount = {
      ...this.toCoaAccount(existing),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.class !== undefined ? { class: input.class } : {}),
      ...(input.accountType !== undefined ? { accountType: input.accountType } : {}),
      ...(input.description !== undefined
        ? { description: input.description.trim() || null }
        : {}),
      ...(input.monthlyMovement !== undefined
        ? { monthlyMovement: input.monthlyMovement }
        : {}),
    };
    // The balance follows the (possibly changed) class — never client-supplied.
    merged.normalBalance = expectedNormalBalance(merged.class, code);
    this.check(
      accounts.map((a) => (a.code === code ? merged : a)),
      mappings,
    );

    const row = await this.prisma.chartAccount.update({
      where: { code },
      data: {
        name: merged.name,
        class: merged.class,
        accountType: merged.accountType,
        normalBalance: merged.normalBalance,
        monthlyMovement: merged.monthlyMovement,
        description: merged.description,
        editedAt: new Date(),
      },
    });
    await this.audit.record({
      userId: user.id,
      action: "coa.account.update",
      entityType: "ChartAccount",
      entityId: code,
      metadata: { fields: Object.keys(input) },
    });
    return row;
  }

  /** Soft delete / restore. Archived accounts are exempt from P&L coverage and
   *  stamped edited, so the seeder never resurrects them. */
  async setArchived(user: AuthUser, code: string, archived: boolean) {
    await this.requireAccount(code);
    const { accounts, mappings } = await this.loadAll();
    this.check(
      accounts.map((a) => (a.code === code ? { ...a, archived } : a)),
      mappings,
    );
    const row = await this.prisma.chartAccount.update({
      where: { code },
      data: { archived, editedAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      action: archived ? "coa.account.archive" : "coa.account.restore",
      entityType: "ChartAccount",
      entityId: code,
    });
    return row;
  }

  /** Create or replace the account's BIR income-tax return line ("Regular"). */
  async setMapping(user: AuthUser, accountCode: string, taxReturnLine: string) {
    const account = await this.requireAccount(accountCode);
    const { accounts, mappings } = await this.loadAll();
    const line = taxReturnLine.trim();
    const next: CoaTaxMapping = {
      accountCode,
      taxCategory: "Regular",
      accountName: account.name,
      taxReturnLine: line,
    };
    const others = mappings.filter(
      (m) => !(m.accountCode === accountCode && m.taxCategory === "Regular"),
    );
    this.check(accounts, [...others, next]);

    const where = { accountCode_taxCategory: { accountCode, taxCategory: "Regular" } };
    const row = await this.prisma.accountTaxMapping.upsert({
      where,
      create: { ...next, source: "custom", editedAt: new Date() },
      update: { accountName: account.name, taxReturnLine: line, editedAt: new Date() },
    });
    await this.audit.record({
      userId: user.id,
      action: "coa.mapping.set",
      entityType: "AccountTaxMapping",
      entityId: accountCode,
      metadata: { taxReturnLine: line },
    });
    return row;
  }

  /** Remove a mapping. Coverage validation blocks this for an active P&L
   *  account outside {4001, 4002, 5008} — archive the account first. */
  async deleteMapping(user: AuthUser, accountCode: string) {
    const where = { accountCode_taxCategory: { accountCode, taxCategory: "Regular" } };
    const existing = await this.prisma.accountTaxMapping.findUnique({ where });
    if (!existing) throw new NotFoundException(`No mapping for account ${accountCode}.`);
    const { accounts, mappings } = await this.loadAll();
    this.check(
      accounts,
      mappings.filter(
        (m) => !(m.accountCode === accountCode && m.taxCategory === "Regular"),
      ),
    );
    await this.prisma.accountTaxMapping.delete({ where });
    await this.audit.record({
      userId: user.id,
      action: "coa.mapping.delete",
      entityType: "AccountTaxMapping",
      entityId: accountCode,
    });
    return { ok: true };
  }
}

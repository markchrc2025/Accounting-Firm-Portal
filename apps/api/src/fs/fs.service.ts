import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildBalanceSheet,
  buildIncomeStatement,
  type FsAccountMeta,
  type FsEngineInput,
} from "./fs-engine";
import type {
  CreateAdjustmentInput,
  CreateReportInput,
  SetPeriodsInput,
  SetTrialBalanceInput,
  UpdateReportInput,
} from "./dto/fs.schemas";

const num = (d: Prisma.Decimal | number): number => Number(d);
const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/**
 * Financial Statement Creator — a standalone, firm-scoped workbench. It READS
 * the live Chart of Accounts to validate every trial-balance / adjustment code
 * and to drive statement roll-ups, but owns no relations into Client/Firm/CoA.
 * Balances are entered or imported per period; the tested `fs-engine` turns the
 * adjusted trial balance into the statements.
 */
@Injectable()
export class FsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ CoA read/validate

  /** Chart-of-Accounts metadata for the engine (all accounts, so parentName
   *  resolves), plus the set of postable codes a TB/adjustment may reference. */
  private async loadCoa(): Promise<{ meta: FsAccountMeta[]; postable: Set<string> }> {
    const rows = await this.prisma.chartAccount.findMany({ orderBy: { code: "asc" } });
    const nameByCode = new Map(rows.map((r) => [r.code, r.name]));
    const meta: FsAccountMeta[] = rows.map((r) => ({
      code: r.code,
      name: r.name,
      class: r.class,
      accountType: r.accountType,
      parentCode: r.parentCode,
      parentName: r.parentCode ? (nameByCode.get(r.parentCode) ?? null) : null,
    }));
    const postable = new Set(rows.filter((r) => r.postable && !r.archived).map((r) => r.code));
    return { meta, postable };
  }

  private assertCodes(codes: string[], postable: Set<string>): void {
    const bad = [...new Set(codes)].filter((c) => !postable.has(c));
    if (bad.length > 0) {
      throw new BadRequestException(
        `These account codes are not postable Chart-of-Accounts entries: ${bad.join(", ")}.`,
      );
    }
  }

  // --------------------------------------------------------------------- reports

  async listReports(user: AuthUser) {
    const rows = await this.prisma.fsReport.findMany({
      where: { firmId: user.firmId },
      orderBy: { updatedAt: "desc" },
      include: { periods: { orderBy: { sortOrder: "asc" } } },
    });
    return rows.map((r) => this.toReportDto(r));
  }

  async getReport(user: AuthUser, id: string) {
    const report = await this.requireReport(user, id);
    return this.toReportDto(report);
  }

  async createReport(user: AuthUser, input: CreateReportInput) {
    const report = await this.prisma.fsReport.create({
      data: {
        firmId: user.firmId,
        createdById: user.id,
        entityName: input.entityName,
        secRegistrationNo: input.secRegistrationNo ?? null,
        registeredAddress: input.registeredAddress ?? null,
        businessDescription: input.businessDescription ?? null,
        framework: input.framework ?? "PFRS for Small Entities",
        functionalCurrency: input.functionalCurrency ?? "PHP",
        approvalDate: input.approvalDate ? toDate(input.approvalDate) : null,
        periods: {
          create: input.periods.map((p, i) => ({
            label: p.label,
            endDate: toDate(p.endDate),
            periodType: p.periodType ?? "FY",
            sortOrder: i,
          })),
        },
      },
      include: { periods: { orderBy: { sortOrder: "asc" } } },
    });
    await this.audit.record({
      userId: user.id,
      action: "fs.report.create",
      entityType: "FsReport",
      entityId: report.id,
      metadata: { entityName: report.entityName, periods: input.periods.length },
    });
    return this.toReportDto(report);
  }

  async updateReport(user: AuthUser, id: string, input: UpdateReportInput) {
    await this.requireReport(user, id);
    const report = await this.prisma.fsReport.update({
      where: { id },
      data: {
        ...(input.entityName !== undefined ? { entityName: input.entityName } : {}),
        ...(input.secRegistrationNo !== undefined ? { secRegistrationNo: input.secRegistrationNo } : {}),
        ...(input.registeredAddress !== undefined ? { registeredAddress: input.registeredAddress } : {}),
        ...(input.businessDescription !== undefined ? { businessDescription: input.businessDescription } : {}),
        ...(input.framework !== undefined ? { framework: input.framework } : {}),
        ...(input.functionalCurrency !== undefined ? { functionalCurrency: input.functionalCurrency } : {}),
        ...(input.approvalDate !== undefined
          ? { approvalDate: input.approvalDate ? toDate(input.approvalDate) : null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { periods: { orderBy: { sortOrder: "asc" } } },
    });
    await this.audit.record({
      userId: user.id,
      action: "fs.report.update",
      entityType: "FsReport",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return this.toReportDto(report);
  }

  async deleteReport(user: AuthUser, id: string) {
    await this.requireReport(user, id);
    await this.prisma.fsReport.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      action: "fs.report.delete",
      entityType: "FsReport",
      entityId: id,
    });
    return { ok: true };
  }

  /** Replace the period configuration. Uses the delete-then-create shape so a
   *  removed period cascades its trial-balance rows; unchanged sort orders keep
   *  their columns lined up. */
  async setPeriods(user: AuthUser, id: string, input: SetPeriodsInput) {
    await this.requireReport(user, id);
    // Reconfiguring periods mints new period ids, cascade-clearing their trial
    // balances. Clear adjustments too so none is left pointing at a dead period.
    await this.prisma.$transaction([
      this.prisma.fsAdjustment.deleteMany({ where: { reportId: id } }),
      this.prisma.fsPeriod.deleteMany({ where: { reportId: id } }),
      this.prisma.fsPeriod.createMany({
        data: input.periods.map((p, i) => ({
          reportId: id,
          label: p.label,
          endDate: toDate(p.endDate),
          periodType: p.periodType ?? "FY",
          sortOrder: i,
        })),
      }),
    ]);
    await this.audit.record({
      userId: user.id,
      action: "fs.report.setPeriods",
      entityType: "FsReport",
      entityId: id,
      metadata: { periods: input.periods.length },
    });
    return this.getReport(user, id);
  }

  // ------------------------------------------------------------- trial balance

  async getTrialBalance(user: AuthUser, id: string) {
    await this.requireReport(user, id);
    const entries = await this.prisma.trialBalanceEntry.findMany({ where: { reportId: id } });
    return entries.map((e) => ({
      periodId: e.periodId,
      accountCode: e.accountCode,
      amount: num(e.amount),
    }));
  }

  /** Replace one period's trial balance in full. Every code is validated against
   *  the postable Chart of Accounts; blank/zero rows are dropped. */
  async setTrialBalance(user: AuthUser, id: string, periodId: string, input: SetTrialBalanceInput) {
    await this.requireReport(user, id);
    await this.requirePeriod(id, periodId);
    const { postable } = await this.loadCoa();
    const entries = input.entries.filter((e) => e.amount !== 0);
    this.assertCodes(entries.map((e) => e.accountCode), postable);
    // Reject a duplicated code in the same submission (would violate the unique key).
    const codes = entries.map((e) => e.accountCode);
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dupes.length > 0) {
      throw new BadRequestException(`Duplicate account code(s) in the trial balance: ${[...new Set(dupes)].join(", ")}.`);
    }

    await this.prisma.$transaction([
      this.prisma.trialBalanceEntry.deleteMany({ where: { periodId } }),
      this.prisma.trialBalanceEntry.createMany({
        data: entries.map((e) => ({
          reportId: id,
          periodId,
          accountCode: e.accountCode,
          amount: new Prisma.Decimal(e.amount),
        })),
      }),
    ]);
    await this.audit.record({
      userId: user.id,
      action: "fs.tb.set",
      entityType: "FsPeriod",
      entityId: periodId,
      metadata: { entries: entries.length },
    });
    return { ok: true, entries: entries.length };
  }

  // --------------------------------------------------------------- adjustments

  async listAdjustments(user: AuthUser, id: string) {
    await this.requireReport(user, id);
    const rows = await this.prisma.fsAdjustment.findMany({
      where: { reportId: id },
      orderBy: { createdAt: "asc" },
      include: { lines: true },
    });
    return rows.map((a) => ({
      id: a.id,
      periodId: a.periodId,
      memo: a.memo,
      createdAt: a.createdAt.toISOString(),
      lines: a.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: num(l.debit),
        credit: num(l.credit),
      })),
    }));
  }

  async createAdjustment(user: AuthUser, id: string, input: CreateAdjustmentInput) {
    await this.requireReport(user, id);
    await this.requirePeriod(id, input.periodId);
    const { postable } = await this.loadCoa();
    this.assertCodes(input.lines.map((l) => l.accountCode), postable);

    const totalDebit = round2(input.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const totalCredit = round2(input.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    if (totalDebit !== totalCredit) {
      throw new BadRequestException(
        `Adjustment does not balance: debits ${totalDebit} ≠ credits ${totalCredit}.`,
      );
    }

    const adjustment = await this.prisma.fsAdjustment.create({
      data: {
        reportId: id,
        periodId: input.periodId,
        memo: input.memo ?? "",
        lines: {
          create: input.lines.map((l) => ({
            accountCode: l.accountCode,
            debit: new Prisma.Decimal(l.debit ?? 0),
            credit: new Prisma.Decimal(l.credit ?? 0),
          })),
        },
      },
      include: { lines: true },
    });
    await this.audit.record({
      userId: user.id,
      action: "fs.adjustment.create",
      entityType: "FsAdjustment",
      entityId: adjustment.id,
      metadata: { periodId: input.periodId, lines: input.lines.length },
    });
    return { id: adjustment.id };
  }

  async deleteAdjustment(user: AuthUser, id: string, adjustmentId: string) {
    await this.requireReport(user, id);
    const adj = await this.prisma.fsAdjustment.findFirst({ where: { id: adjustmentId, reportId: id } });
    if (!adj) throw new NotFoundException(`Adjustment ${adjustmentId} not found.`);
    await this.prisma.fsAdjustment.delete({ where: { id: adjustmentId } });
    await this.audit.record({
      userId: user.id,
      action: "fs.adjustment.delete",
      entityType: "FsAdjustment",
      entityId: adjustmentId,
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------- statements

  /** Compute the statements from the adjusted trial balance. */
  async getStatements(user: AuthUser, id: string) {
    const report = await this.requireReport(user, id);
    const { meta } = await this.loadCoa();
    const [tb, adjustments] = await Promise.all([
      this.prisma.trialBalanceEntry.findMany({ where: { reportId: id } }),
      this.prisma.fsAdjustment.findMany({ where: { reportId: id }, include: { lines: true } }),
    ]);

    const engineInput: FsEngineInput = {
      accounts: meta,
      periods: report.periods.map((p) => ({ id: p.id, label: p.label, sortOrder: p.sortOrder })),
      tb: tb.map((e) => ({ periodId: e.periodId, accountCode: e.accountCode, amount: num(e.amount) })),
      adjustments: adjustments.flatMap((a) =>
        a.lines.map((l) => ({
          periodId: a.periodId,
          accountCode: l.accountCode,
          debit: num(l.debit),
          credit: num(l.credit),
        })),
      ),
    };

    return {
      report: this.toReportDto(report),
      periods: [...report.periods]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({ id: p.id, label: p.label, endDate: isoDate(p.endDate), sortOrder: p.sortOrder })),
      incomeStatement: buildIncomeStatement(engineInput),
      balanceSheet: buildBalanceSheet(engineInput),
    };
  }

  // -------------------------------------------------------------------- helpers

  private async requireReport(user: AuthUser, id: string) {
    const report = await this.prisma.fsReport.findFirst({
      where: { id, firmId: user.firmId },
      include: { periods: { orderBy: { sortOrder: "asc" } } },
    });
    if (!report) throw new NotFoundException(`FS report ${id} not found.`);
    return report;
  }

  private async requirePeriod(reportId: string, periodId: string) {
    const period = await this.prisma.fsPeriod.findFirst({ where: { id: periodId, reportId } });
    if (!period) throw new NotFoundException(`Period ${periodId} not found on this report.`);
    return period;
  }

  private toReportDto(
    r: Prisma.FsReportGetPayload<{ include: { periods: true } }>,
  ) {
    return {
      id: r.id,
      entityName: r.entityName,
      secRegistrationNo: r.secRegistrationNo,
      registeredAddress: r.registeredAddress,
      businessDescription: r.businessDescription,
      framework: r.framework,
      functionalCurrency: r.functionalCurrency,
      approvalDate: isoDate(r.approvalDate),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      periods: [...r.periods]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({
          id: p.id,
          label: p.label,
          endDate: isoDate(p.endDate),
          periodType: p.periodType,
          sortOrder: p.sortOrder,
        })),
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

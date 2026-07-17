import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildBalanceSheet,
  buildCashFlow,
  buildChangesInEquity,
  buildIncomeStatement,
  type FsAccountMeta,
  type FsEngineInput,
} from "./fs-engine";
import {
  buildAccountNotes,
  policyBlocksFor,
  renderTokens,
  type FsNoteTableRow,
  type NoteMergeContext,
} from "./fs-notes";
import { buildFsWorkbook, exportFileName } from "./fs-export";
import * as XLSX from "xlsx";
import type {
  AddCustomNoteInput,
  CreateAdjustmentInput,
  CreateReportInput,
  SetPeriodsInput,
  SetPolicyNoteInput,
  SetTrialBalanceInput,
  UpdateCustomNoteInput,
  UpdateReportInput,
} from "./dto/fs.schemas";

const splitParagraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

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

  private async buildEngineInput(
    report: Prisma.FsReportGetPayload<{ include: { periods: true } }>,
  ): Promise<FsEngineInput> {
    const { meta } = await this.loadCoa();
    const [tb, adjustments] = await Promise.all([
      this.prisma.trialBalanceEntry.findMany({ where: { reportId: report.id } }),
      this.prisma.fsAdjustment.findMany({ where: { reportId: report.id }, include: { lines: true } }),
    ]);
    return {
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
  }

  /** Compute the statements from the adjusted trial balance. */
  async getStatements(user: AuthUser, id: string) {
    const report = await this.requireReport(user, id);
    const engineInput = await this.buildEngineInput(report);

    return {
      report: this.toReportDto(report),
      periods: [...report.periods]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({ id: p.id, label: p.label, endDate: isoDate(p.endDate), sortOrder: p.sortOrder })),
      incomeStatement: buildIncomeStatement(engineInput),
      balanceSheet: buildBalanceSheet(engineInput),
      cashFlow: buildCashFlow(engineInput),
      changesInEquity: buildChangesInEquity(engineInput),
    };
  }

  // -------------------------------------------------------------------- export

  /** The full AFS as an xlsx workbook (BS · IS · CF · CE · Notes), mirroring
   *  the firm's template layout. Statements and notes are derived from ONE
   *  report + engine-input snapshot, so a concurrent edit (trial-balance save,
   *  adjustment, period change) can never produce a workbook whose Notes don't
   *  tie to its statement captions. */
  async getExport(user: AuthUser, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const report = await this.requireReport(user, id);
    const engineInput = await this.buildEngineInput(report);
    const notes = await this.composeNotes(report, engineInput);
    const workbook = buildFsWorkbook({
      entityName: report.entityName,
      periods: notes.periods,
      balanceSheet: buildBalanceSheet(engineInput),
      incomeStatement: buildIncomeStatement(engineInput),
      cashFlow: buildCashFlow(engineInput),
      changesInEquity: buildChangesInEquity(engineInput),
      notes: notes.document,
    });
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    await this.audit.record({
      userId: user.id,
      action: "fs.report.export",
      entityType: "FsReport",
      entityId: id,
    });
    return { buffer, filename: exportFileName(report.entityName, notes.periods) };
  }

  // -------------------------------------------------------------------- notes

  /** Assemble the Notes to Financial Statements: the framework's policy blocks
   *  (merged with entity facts + per-report overrides), then numeric account
   *  notes from the trial balance, then custom notes — numbered 1..N. Also
   *  returns the editable policy/custom state for the edit panel. */
  async getNotes(user: AuthUser, id: string) {
    const report = await this.requireReport(user, id);
    const engineInput = await this.buildEngineInput(report);
    return this.composeNotes(report, engineInput);
  }

  /** Notes assembly from an already-loaded snapshot (shared by getNotes and
   *  getExport so the export is internally consistent). */
  private async composeNotes(
    report: Prisma.FsReportGetPayload<{ include: { periods: true } }>,
    engineInput: FsEngineInput,
  ) {
    const id = report.id;
    const sortedPeriods = [...report.periods].sort((a, b) => a.sortOrder - b.sortOrder);

    const ctx: NoteMergeContext = {
      entityName: report.entityName,
      secRegistrationNo: report.secRegistrationNo,
      registeredAddress: report.registeredAddress,
      businessDescription: report.businessDescription,
      framework: report.framework,
      functionalCurrency: report.functionalCurrency,
      approvalDate: isoDate(report.approvalDate),
      periodLabels: sortedPeriods.map((p) => p.label),
    };

    const rows = await this.prisma.fsNote.findMany({ where: { reportId: id } });
    const overrideByKey = new Map(
      rows.filter((r) => r.kind === "policy" && r.blockKey).map((r) => [r.blockKey!, r]),
    );
    const customRows = rows
      .filter((r) => r.kind === "custom")
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime());

    // Editable policy state (all blocks, incl. excluded ones), for the edit panel.
    const policyBlocks = policyBlocksFor(report.framework).map((block) => {
      const ov = overrideByKey.get(block.key);
      return {
        blockKey: block.key,
        title: ov?.title ?? block.title,
        body: ov?.body ?? renderTokens(block.body, ctx),
        included: ov ? ov.included : true,
        overridden: Boolean(ov && (ov.title !== null || ov.body !== null)),
      };
    });

    // Assembled, numbered document (only included sections).
    const document: Array<{
      number: number;
      key: string;
      kind: string;
      id?: string;
      title: string;
      paragraphs?: string[];
      table?: { rows: FsNoteTableRow[] };
    }> = [];
    for (const b of policyBlocks) {
      if (!b.included) continue;
      document.push({ number: 0, key: b.blockKey, kind: "policy", title: b.title, paragraphs: splitParagraphs(b.body) });
    }
    for (const note of buildAccountNotes(engineInput)) {
      document.push({ number: 0, key: note.key, kind: "account", title: note.title, table: note.table });
    }
    for (const c of customRows.filter((r) => r.included)) {
      document.push({
        number: 0,
        key: `custom-${c.id}`,
        kind: "custom",
        id: c.id,
        title: c.title ?? "Note",
        paragraphs: splitParagraphs(c.body ?? ""),
      });
    }
    document.forEach((d, i) => (d.number = i + 1));

    return {
      report: this.toReportDto(report),
      periods: sortedPeriods.map((p) => ({ id: p.id, label: p.label, endDate: isoDate(p.endDate), sortOrder: p.sortOrder })),
      document,
      policyBlocks,
      customNotes: customRows.map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body ?? "",
        included: c.included,
        sortOrder: c.sortOrder,
      })),
    };
  }

  /** Override or toggle a policy block. `body`/`title` null resets to the
   *  library default while keeping the include flag. */
  async setPolicyNote(user: AuthUser, id: string, blockKey: string, input: SetPolicyNoteInput) {
    const report = await this.requireReport(user, id);
    const known = policyBlocksFor(report.framework).some((b) => b.key === blockKey);
    if (!known) throw new BadRequestException(`Unknown policy block "${blockKey}".`);
    const where = { reportId_blockKey: { reportId: id, blockKey } };
    await this.prisma.fsNote.upsert({
      where,
      create: {
        reportId: id,
        kind: "policy",
        blockKey,
        included: input.included ?? true,
        title: input.title ?? null,
        body: input.body ?? null,
      },
      update: {
        ...(input.included !== undefined ? { included: input.included } : {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
      },
    });
    await this.audit.record({ userId: user.id, action: "fs.note.policy", entityType: "FsReport", entityId: id, metadata: { blockKey } });
    return this.getNotes(user, id);
  }

  /** Reset a policy block to the library default (remove the override row). */
  async resetPolicyNote(user: AuthUser, id: string, blockKey: string) {
    await this.requireReport(user, id);
    await this.prisma.fsNote.deleteMany({ where: { reportId: id, blockKey } });
    return this.getNotes(user, id);
  }

  async addCustomNote(user: AuthUser, id: string, input: AddCustomNoteInput) {
    await this.requireReport(user, id);
    const max = await this.prisma.fsNote.aggregate({
      where: { reportId: id, kind: "custom" },
      _max: { sortOrder: true },
    });
    const note = await this.prisma.fsNote.create({
      data: {
        reportId: id,
        kind: "custom",
        title: input.title ?? null,
        body: input.body,
        sortOrder: (max._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record({ userId: user.id, action: "fs.note.custom.add", entityType: "FsNote", entityId: note.id });
    return this.getNotes(user, id);
  }

  async updateCustomNote(user: AuthUser, id: string, noteId: string, input: UpdateCustomNoteInput) {
    await this.requireReport(user, id);
    const existing = await this.prisma.fsNote.findFirst({ where: { id: noteId, reportId: id, kind: "custom" } });
    if (!existing) throw new NotFoundException(`Custom note ${noteId} not found.`);
    await this.prisma.fsNote.update({
      where: { id: noteId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.included !== undefined ? { included: input.included } : {}),
      },
    });
    return this.getNotes(user, id);
  }

  async deleteCustomNote(user: AuthUser, id: string, noteId: string) {
    await this.requireReport(user, id);
    const existing = await this.prisma.fsNote.findFirst({ where: { id: noteId, reportId: id, kind: "custom" } });
    if (!existing) throw new NotFoundException(`Custom note ${noteId} not found.`);
    await this.prisma.fsNote.delete({ where: { id: noteId } });
    return this.getNotes(user, id);
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

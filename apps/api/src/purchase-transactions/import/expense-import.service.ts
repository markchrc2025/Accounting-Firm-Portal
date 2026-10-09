// expense-import.service.ts — the Expenses import v2 (U6): generate the
// template for a client, validate an uploaded workbook row by row, split mixed
// receipts, stamp the client's VAT treatment, detect duplicates, hold what
// cannot post, and report every row. A dry run does all of it and writes
// nothing.
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PurchaseTransaction, round2 } from "@portal/shared";
import type { Prisma } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { CategoriesService } from "../../categories/categories.service";
import { ClientsService } from "../../clients/clients.service";
import type { AuthUser } from "../../common/auth/auth-user";
import { RegimeValidator } from "../../financial/regime-validator";
import { isoToDate, toPurchaseDto } from "../../financial/serialization";
import { PrismaService } from "../../prisma/prisma.service";
import { RbacService } from "../../rbac/rbac.service";
import {
  DOCUMENT_TYPES,
  MAX_REFERENCE_LENGTH,
  NEEDS_REVIEW_VALUES,
  TEMPLATE_VERSION,
  UNASSIGNED_CATEGORY,
  type Classification,
  type ExpenseHeader,
} from "./expense-import.constants";
import { ImportFileError, parseExpenseWorkbook, type ParsedClientSheet, type ParsedRow } from "./expense-import.parser";
import {
  cellText,
  cellToIsoDate,
  fileDuplicateKey,
  footsToGross,
  isRealIsoDate,
  normaliseTin,
  parseMoney,
  splitRow,
  vendorDisplayName,
  type RecordPart,
  type Regime,
} from "./expense-import.rules";
import { buildExpenseTemplate, classifyAccounts, templateFilename, type TemplateAccount } from "./expense-template";

/** What the multipart interceptor hands us. Declared here rather than taken
 *  from @types/multer, which is not a dependency. */
export interface UploadedWorkbook {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size?: number;
}

export type RowOutcome = "posted" | "held" | "rejected";

export interface ImportRecordResult {
  id: string | null;
  classification: Classification;
  amount: number;
  vatAmount: number;
  vatClaimable: boolean;
}

export interface ImportRowResult {
  rowNumber: number;
  outcome: RowOutcome;
  needsReview: boolean;
  messages: string[];
  records: ImportRecordResult[];
}

export interface ExpenseImportResult {
  templateVersion: string;
  clientId: string;
  periodFrom: string;
  periodTo: string;
  rows: ImportRowResult[];
  totals: { rows: number; posted: number; held: number; rejected: number; grossAmount: number };
}

/** Everything decided about one row before anything is written. */
interface RowPlan {
  rowNumber: number;
  outcome: RowOutcome;
  needsReview: boolean;
  messages: string[];
  parts: RecordPart[];
  gross: number;
  tin: string | null;
  referenceNo: string | null;
  date: string;
  account: TemplateAccount | null;
  base: Omit<Prisma.PurchaseTransactionUncheckedCreateInput, "categoryId" | "netAmount" | "clientId">;
  recordIds: string[];
}

const PLACEHOLDER_CATEGORY = "00000000-0000-4000-8000-000000000000";

@Injectable()
export class ExpenseImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly categories: CategoriesService,
    private readonly regime: RegimeValidator,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {}

  // ------------------------------------------------------------ template

  async template(user: AuthUser, clientId: string): Promise<{ buffer: Buffer; filename: string }> {
    const client = await this.requireClient(user, clientId);
    const accounts = await this.loadAccounts();
    const buffer = await buildExpenseTemplate({
      client: {
        id: client.id,
        tin: client.tin,
        branch: client.branch,
        businessName: client.businessName,
        regimeLabel: regimeLabel(client.taxType),
      },
      accounts,
    });
    return { buffer, filename: templateFilename(client.id, new Date()) };
  }

  // ------------------------------------------------------------ import

  async importFile(
    user: AuthUser,
    clientId: string,
    file: UploadedWorkbook,
    dryRun: boolean,
  ): Promise<ExpenseImportResult> {
    const client = await this.requireClient(user, clientId);
    const regime = this.regime.requireRegime(client.taxType);

    let parsed: { client: ParsedClientSheet; rows: ParsedRow[] };
    try {
      parsed = await parseExpenseWorkbook(file.buffer);
    } catch (e) {
      if (e instanceof ImportFileError) throw new BadRequestException(e.message);
      throw e;
    }
    const period = this.checkHeaderBlock(parsed.client, client.id, client.businessName);

    const accounts = await this.loadAccounts();
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const plans: RowPlan[] = [];
    for (const row of parsed.rows) plans.push(await this.planRow(row, regime, period, byCode));
    this.markFileDuplicates(plans);
    await this.markLedgerDuplicates(client.id, plans);

    let batchId: string | null = null;
    if (!dryRun) {
      batchId = randomUUID();
      await this.write(user, client.id, plans, batchId);
    }
    const result = this.toResult(client.id, period, plans);
    if (!dryRun && batchId) {
      await this.audit.record({
        userId: user.id,
        action: "purchase.import.batch",
        entityType: "PurchaseImport",
        entityId: batchId,
        metadata: {
          clientId: client.id,
          batchId,
          fileName: file.originalname,
          templateVersion: TEMPLATE_VERSION,
          periodFrom: period.from,
          periodTo: period.to,
          totals: result.totals,
        },
      });
    }
    return result;
  }

  /** Post a held record. 409 unless it is held; 400 while it has no account. */
  async postHeld(user: AuthUser, id: string) {
    const row = await this.prisma.purchaseTransaction.findFirst({ where: { id } });
    if (!row) throw new NotFoundException("Purchase transaction not found");
    await this.requireClient(user, row.clientId);
    if (row.status !== "held") {
      throw new ConflictException(`Record ${id} is ${row.status}, not held — there is nothing to post.`);
    }
    if (!row.account) {
      throw new BadRequestException(
        "This record has no account yet. Assign a COA account to it (edit the record) before posting.",
      );
    }
    const updated = await this.prisma.purchaseTransaction.update({ where: { id }, data: { status: "posted" } });
    await this.audit.record({
      userId: user.id,
      action: "purchase.post",
      entityType: "PurchaseTransaction",
      entityId: id,
      metadata: { clientId: row.clientId, from: "held", to: "posted" },
    });
    return toPurchaseDto(updated);
  }

  // ------------------------------------------------------------ internals

  /** Firm tenancy (assertInFirm) AND per-client assignment scope. The routes
   *  carry clientId as a query parameter, which PermissionsGuard does not scope
   *  on (it reads route params only), so the assignment check happens here. */
  private async requireClient(user: AuthUser, clientId: string) {
    const client = await this.clients.assertInFirm(user.firmId, clientId);
    const ok = await this.rbac.authorize(user, ["Expenses:Create"], clientId);
    if (!ok) throw new ForbiddenException("You are not assigned to this client.");
    return client;
  }

  private async loadAccounts(): Promise<TemplateAccount[]> {
    const rows = await this.prisma.chartAccount.findMany({ orderBy: { code: "asc" } });
    return classifyAccounts(rows);
  }

  private checkHeaderBlock(
    sheet: ParsedClientSheet,
    clientId: string,
    clientName: string,
  ): { from: string; to: string } {
    if (sheet.version !== TEMPLATE_VERSION) {
      throw new BadRequestException(
        `Unknown template version "${sheet.version || "(blank)"}" on the CLIENT sheet — this importer reads ${TEMPLATE_VERSION}. Download a fresh template.`,
      );
    }
    if (sheet.clientId !== clientId) {
      throw new BadRequestException(
        `This file was generated for another client (${sheet.name || sheet.clientId || "unknown"}) and cannot be imported into ${clientName}.`,
      );
    }
    const from = cellToIsoDate(sheet.periodFrom);
    const to = cellToIsoDate(sheet.periodTo);
    if (!from || !isRealIsoDate(from)) {
      throw new BadRequestException("Period From on the CLIENT sheet is blank or not a date (yyyy-mm-dd). Fill it in before importing.");
    }
    if (!to || !isRealIsoDate(to)) {
      throw new BadRequestException("Period To on the CLIENT sheet is blank or not a date (yyyy-mm-dd). Fill it in before importing.");
    }
    if (from > to) throw new BadRequestException(`Period From (${from}) is after Period To (${to}) on the CLIENT sheet.`);
    return { from, to };
  }

  private async planRow(
    row: ParsedRow,
    regime: Regime,
    period: { from: string; to: string },
    accounts: Map<string, TemplateAccount>,
  ): Promise<RowPlan> {
    const c = row.cells;
    const text = (h: ExpenseHeader) => cellText(c[h]);
    const errors: string[] = [];
    const notes: string[] = [];
    let needsReview = false;

    // Date
    const date = cellToIsoDate(c.Date);
    if (!date || !isRealIsoDate(date)) errors.push("Date is required and must be a real date cell.");
    else if (date < period.from || date > period.to) {
      errors.push(`Date ${date} is outside the period ${period.from} – ${period.to} declared on the CLIENT sheet.`);
    }

    // Document type
    const docCode = text("Document Type").toUpperCase().replace(/\s+/g, "_");
    const doc = DOCUMENT_TYPES.find((d) => d.code === docCode);
    if (!docCode) errors.push("Document Type is required — pick one from the list.");
    else if (!doc) errors.push(`Document Type "${text("Document Type")}" is not one of the allowed values (see REFERENCE).`);

    // Vendor TIN + branch
    const tinResult = normaliseTin(c["Vendor TIN"], c["Vendor Branch"]);
    if (tinResult.error) errors.push(tinResult.error);
    else if (!tinResult.tin) {
      needsReview = true;
      notes.push("No Vendor TIN on the receipt: the row is flagged for review (D28).");
    }

    // Vendor name
    const vendor = vendorDisplayName({
      regName: text("Vendor Registered Name") || undefined,
      lastName: text("Vendor Lastname") || undefined,
      firstName: text("Vendor Firstname") || undefined,
      middleName: text("Vendor Middlename") || undefined,
      tradeName: text("Trade Name") || undefined,
    });
    if (!vendor) errors.push("Vendor name is required: Vendor Registered Name, or Vendor Lastname + Firstname.");

    // Reference number
    let referenceNo: string | null = null;
    const rawRef = c["Reference Number"];
    if (typeof rawRef === "number") {
      if (!Number.isSafeInteger(rawRef)) {
        errors.push("Reference Number must be typed as text — as a number it is too long to keep its digits.");
      } else referenceNo = String(rawRef);
    } else referenceNo = text("Reference Number") || null;
    if (referenceNo && referenceNo.length > MAX_REFERENCE_LENGTH) {
      errors.push(`Reference Number is longer than ${MAX_REFERENCE_LENGTH} characters.`);
    }
    if (!referenceNo && doc?.isInvoice) {
      errors.push(`Reference Number is required for ${doc.code} (an invoice document).`);
    }

    // Amounts
    const money = (h: ExpenseHeader) => {
      const r = parseMoney(c[h], h);
      if (r.error) errors.push(r.error);
      return r.value;
    };
    const vatable = money("Vatable Amount") ?? 0;
    const vat = money("VAT Amount") ?? 0;
    const exempt = money("VAT-Exempt Amount") ?? 0;
    const zeroRated = money("Zero-rated Amount") ?? 0;
    const other = money("Other Non-vatable") ?? 0;
    const grossCell = money("Gross Total");
    const gross = grossCell ?? 0;
    if (grossCell === null) errors.push("Gross Total is required.");
    else {
      const parts = [vatable, vat, exempt, zeroRated, other];
      if (parts.every((p) => p === 0)) {
        errors.push("Enter the breakdown (Vatable, VAT, VAT-Exempt, Zero-rated or Other Non-vatable) that foots to Gross Total.");
      } else {
        if (vatable > 0 && vat === 0) errors.push("VAT Amount is required when Vatable Amount is given (copy the VAT line from the receipt).");
        if (vat > 0 && vatable === 0) errors.push("VAT Amount is given without a Vatable Amount.");
        if (!footsToGross(parts, gross)) {
          const sum = round2(parts.reduce((a, b) => a + b, 0));
          errors.push(`The breakdown (${sum.toFixed(2)}) does not foot to Gross Total (${gross.toFixed(2)}): off by ${Math.abs(round2(sum - gross)).toFixed(2)}.`);
        }
      }
    }

    // COA
    const coaCode = text("COA Code");
    let account: TemplateAccount | null = null;
    if (!coaCode) {
      notes.push("COA Code is blank: the row is held until an accountant assigns an account.");
    } else {
      const found = accounts.get(coaCode) ?? accounts.get(coaCode.replace(/\.0+$/, ""));
      if (!found) errors.push(`COA Code "${coaCode}" is not on the chart (see the COA sheet).`);
      else if (!found.allowed) errors.push(`COA Code ${found.code} (${found.name}) is not allowed on expense rows (class ${found.class}).`);
      else account = found;
    }

    // ATC + withholding (D29)
    const atc = text("ATC").toUpperCase() || null;
    const wht = money("Withholding Amount");
    if (atc && (wht === null || wht === 0)) errors.push("Withholding Amount is required when an ATC is given.");
    if (!atc && wht !== null && wht > 0) errors.push("ATC is required when a Withholding Amount is given.");
    if (atc) {
      const code = await this.prisma.birAtcCode.findUnique({ where: { atc } });
      if (!code) errors.push(`ATC "${atc}" is not a BIR ATC code.`);
    }
    if (wht !== null && wht > gross) errors.push("Withholding Amount is larger than Gross Total.");

    // Needs review
    const nr = text("Needs Review").toUpperCase();
    if (nr) {
      if (["Y", "YES", "TRUE", "1"].includes(nr)) needsReview = true;
      else if (!["N", "NO", "FALSE", "0"].includes(nr)) errors.push(`Needs Review must be ${NEEDS_REVIEW_VALUES.join(" or ")}.`);
    }

    // Outcome
    let outcome: RowOutcome;
    if (errors.length > 0) outcome = "rejected";
    else {
      outcome = "posted";
      if (doc && !doc.isInvoice) {
        outcome = "held";
        notes.push(`Held: ${doc.code} is not an official invoice — an accountant must post it (D25).`);
      }
      if (!account) outcome = "held";
    }

    const parts = outcome === "rejected" ? [] : splitRow({ vatable, vat, exempt, zeroRated, other }, regime);
    const description = text("Description") || vendor || "Expense";
    const base: RowPlan["base"] = {
      txnDate: isoToDate(date ?? period.from),
      referenceNo,
      vendor,
      description,
      inputVATCategory: null,
      inputVAT: null,
      isCapitalGood: false,
      deductible: account ? !account.personal : true,
      source: "import",
      vendorTin: tinResult.tin,
      vendorBranch: tinResult.branch,
      tradeName: text("Trade Name") || null,
      province: text("Province") || null,
      account: account?.name ?? null,
      atc: null,
      whtAmount: null,
      taxAmount: null,
      status: outcome === "rejected" ? "posted" : outcome,
      needsReview,
      documentType: doc?.code ?? null,
      sourceFile: text("Source File") || null,
      remarks: text("Remarks") || null,
      vatClaimable: null,
      importBatchId: null,
    };

    // The regime validator and the shared schema run on every part, exactly as
    // the manual create path runs them.
    if (outcome !== "rejected") {
      for (const part of parts) {
        const candidate = PurchaseTransaction.safeParse({
          clientId: PLACEHOLDER_CATEGORY,
          categoryId: PLACEHOLDER_CATEGORY,
          txnDate: date,
          referenceNo: referenceNo ?? undefined,
          vendor: vendor ?? undefined,
          description,
          netAmount: part.netAmount,
          inputVATCategory: part.inputVATCategory,
          inputVAT: part.inputVAT,
          deductible: base.deductible,
          source: "import",
          vendorTin: tinResult.tin ?? undefined,
          account: account?.name,
          atc: atc ?? undefined,
          taxAmount: part.taxAmount,
          whtAmount: wht ?? undefined,
        });
        if (!candidate.success) {
          errors.push(...candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
          continue;
        }
        try {
          this.regime.validatePurchase(regime, candidate.data);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (errors.length > 0) outcome = "rejected";
    }

    return {
      rowNumber: row.rowNumber,
      outcome,
      needsReview,
      messages: outcome === "rejected" ? [...errors, ...notes] : notes,
      parts: outcome === "rejected" ? [] : parts,
      gross,
      tin: tinResult.tin,
      referenceNo,
      date: date ?? "",
      account,
      base: { ...base, atc, whtAmount: wht },
      recordIds: [],
    };
  }

  /** R6, within the file: the second of two identical rows is rejected. */
  private markFileDuplicates(plans: RowPlan[]): void {
    const seen = new Map<string, number>();
    for (const p of plans) {
      if (p.outcome === "rejected") continue;
      const key = fileDuplicateKey({ tin: p.tin, referenceNo: p.referenceNo, date: p.date, gross: p.gross });
      const first = seen.get(key);
      if (first !== undefined) {
        p.outcome = "rejected";
        p.parts = [];
        p.messages = [
          `Duplicate of row ${first} in this file (same vendor TIN, reference number, date and gross).`,
          ...p.messages,
        ];
      } else seen.set(key, p.rowNumber);
    }
  }

  /** R6, against the ledger: an existing record with the same vendor TIN and
   *  reference (or, with no reference, the same vendor TIN, date and amount)
   *  rejects the row and is named. */
  private async markLedgerDuplicates(clientId: string, plans: RowPlan[]): Promise<void> {
    for (const p of plans) {
      if (p.outcome === "rejected") continue;
      let existing: { id: string }[] = [];
      if (p.referenceNo) {
        existing = await this.prisma.purchaseTransaction.findMany({
          where: { clientId, vendorTin: p.tin, referenceNo: p.referenceNo },
          select: { id: true },
        });
      } else {
        for (const part of p.parts) {
          const hit = await this.prisma.purchaseTransaction.findFirst({
            where: { clientId, vendorTin: p.tin, referenceNo: null, txnDate: isoToDate(p.date), netAmount: part.netAmount },
            select: { id: true },
          });
          if (hit) existing.push(hit);
        }
      }
      if (existing.length > 0) {
        p.outcome = "rejected";
        p.parts = [];
        p.messages = [
          `Already in this client's books: matches existing record${existing.length > 1 ? "s" : ""} ${existing.map((e) => e.id).join(", ")}` +
            (p.referenceNo ? " (same vendor TIN and reference number)." : " (same vendor TIN, date and amount; no reference number)."),
          ...p.messages,
        ];
      }
    }
  }

  /** One transaction per row: its records land together or not at all. */
  private async write(user: AuthUser, clientId: string, plans: RowPlan[], batchId: string): Promise<void> {
    const categoryCache = new Map<string, string>();
    const categoryFor = async (name: string): Promise<string> => {
      const hit = categoryCache.get(name);
      if (hit) return hit;
      const cat = await this.categories.resolveByName(clientId, name, "EXPENSE");
      categoryCache.set(name, cat.id);
      return cat.id;
    };
    for (const p of plans) {
      if (p.outcome === "rejected" || p.parts.length === 0) continue;
      const categoryId = await categoryFor(p.account ? p.account.name : UNASSIGNED_CATEGORY);
      const records = await this.prisma.$transaction(async (tx) => {
        const out: { id: string }[] = [];
        for (const [i, part] of p.parts.entries()) {
          const data: Prisma.PurchaseTransactionUncheckedCreateInput = {
            ...p.base,
            clientId,
            categoryId,
            netAmount: part.netAmount,
            inputVAT: part.inputVAT ?? null,
            taxAmount: part.taxAmount ?? null,
            inputVATCategory: part.inputVATCategory ?? null,
            vatClaimable: part.vatClaimable,
            importBatchId: batchId,
            // Withholding rides on the first part only, never duplicated.
            atc: i === 0 ? p.base.atc : null,
            whtAmount: i === 0 ? p.base.whtAmount : null,
          };
          out.push(await tx.purchaseTransaction.create({ data }));
        }
        return out;
      });
      p.recordIds = records.map((r) => r.id);
      for (const [i, r] of records.entries()) {
        await this.audit.record({
          userId: user.id,
          action: "purchase.import.record",
          entityType: "PurchaseTransaction",
          entityId: r.id,
          metadata: {
            clientId,
            batchId,
            rowNumber: p.rowNumber,
            outcome: p.outcome,
            classification: p.parts[i]?.classification ?? null,
            vatClaimable: p.parts[i]?.vatClaimable ?? null,
          },
        });
      }
    }
  }

  private toResult(clientId: string, period: { from: string; to: string }, plans: RowPlan[]): ExpenseImportResult {
    const rows: ImportRowResult[] = plans.map((p) => ({
      rowNumber: p.rowNumber,
      outcome: p.outcome,
      needsReview: p.needsReview,
      messages: p.messages,
      records:
        p.outcome === "rejected"
          ? []
          : p.parts.map((part, i) => ({
              id: p.recordIds[i] ?? null,
              classification: part.classification,
              amount: part.netAmount,
              vatAmount: part.taxAmount ?? part.inputVAT ?? 0,
              vatClaimable: part.vatClaimable,
            })),
    }));
    const count = (o: RowOutcome) => plans.filter((p) => p.outcome === o).length;
    return {
      templateVersion: TEMPLATE_VERSION,
      clientId,
      periodFrom: period.from,
      periodTo: period.to,
      rows,
      totals: {
        rows: plans.length,
        posted: count("posted"),
        held: count("held"),
        rejected: count("rejected"),
        grossAmount: round2(plans.filter((p) => p.outcome !== "rejected").reduce((a, p) => a + p.gross, 0)),
      },
    };
  }
}

function regimeLabel(taxType: string | null | undefined): string {
  if (taxType === "VAT") return "VAT-registered";
  if (taxType === "PERCENTAGE") return "Non-VAT (percentage tax)";
  return "NOT SET — set the client's tax type before importing";
}

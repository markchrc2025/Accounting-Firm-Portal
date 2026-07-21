import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { round2 } from "@portal/shared";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { dateToIso, isoToDate } from "../financial/serialization";
import { invoiceDueEmail } from "../mail/email-templates";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { EmailSettingsService } from "../settings/email-settings.service";
import type {
  CreateInvoiceInput,
  InvoiceLineItemInput,
  UpdateInvoiceInput,
} from "./dto/invoice.schemas";

/** ₱-formatted amount for the billing email (currency per guardrails: PHP). */
function pesoLabel(v: Prisma.Decimal | number | string): string {
  return `₱${Number(String(v)).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Long-form Manila date, e.g. "August 5, 2026". */
function longDate(d: Date): string {
  return d.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

/** The relations loaded for every invoice DTO: line items + the client's name. */
const invoiceInclude = {
  lineItems: true,
  client: { select: { businessName: true } },
  billedFor: { select: { businessName: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

/** Computed line: the caller-supplied fields plus the derived `amount`. */
interface ComputedLine {
  description: string;
  qty: number;
  rate: number;
  amount: number;
  taxCode: string;
}

/**
 * The row shape returned to the firm UI. Decimal columns serialize to strings
 * over JSON; the web client accepts string | number. `clientName` is the joined
 * client `businessName`; `@db.Date` columns become 'YYYY-MM-DD'.
 */
function toInvoiceDto(inv: InvoiceRow) {
  return {
    id: inv.id,
    firmId: inv.firmId,
    clientId: inv.clientId,
    clientName: inv.client?.businessName ?? "",
    billedForClientId: inv.billedForClientId,
    billedForName: inv.billedFor?.businessName ?? null,
    number: inv.number,
    description: inv.description,
    issuedDate: dateToIso(inv.issuedDate),
    dueDate: dateToIso(inv.dueDate),
    status: inv.status,
    subtotal: inv.subtotal,
    vat: inv.vat,
    total: inv.total,
    lineItems: inv.lineItems.map((li) => ({
      id: li.id,
      description: li.description,
      qty: li.qty,
      rate: li.rate,
      amount: li.amount,
      taxCode: li.taxCode,
    })),
    createdAt: inv.createdAt.toISOString(),
    updatedAt: inv.updatedAt.toISOString(),
  };
}

/**
 * Firm-scoped invoices billed against a client (Portal-only engagement billing).
 * Every operation is confined to the actor's firmId; the target client must
 * belong to that firm (`ClientsService.assertInFirm`). The `vat` figure is a 12%
 * management estimate — NOT authoritative BIR tax (guardrail #1).
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly emailSettings: EmailSettingsService,
    config: ConfigService,
  ) {
    this.webAppUrl = (
      config.get<string>("WEB_APP_URL", "https://acctgfirm.mcrctas.com") ?? ""
    ).replace(/\/+$/, "");
  }

  async list(user: AuthUser, clientId?: string) {
    // A client's billing view includes invoices RECORDED under it (its own +
    // its sub-clients') and, for a sub-client, the invoices billed to its main
    // client on its behalf — so both workspaces see the engagement.
    const rows = await this.prisma.invoice.findMany({
      where: {
        firmId: user.firmId,
        ...(clientId ? { OR: [{ clientId }, { billedForClientId: clientId }] } : {}),
      },
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toInvoiceDto);
  }

  async get(user: AuthUser, id: string) {
    return toInvoiceDto(await this.loadOwned(user.firmId, id));
  }

  async create(user: AuthUser, input: CreateInvoiceInput) {
    const target = await this.clients.assertInFirm(user.firmId, input.clientId);
    // Sub-client billing: the invoice is RECORDED under the main client (the
    // payer / bill addressee); billedForClientId keeps the sub-client
    // provenance. Sales & expenses are untouched — this is billing/AR only.
    let payerId = input.clientId;
    let billedForClientId: string | null = null;
    if (target.billingParentId) {
      await this.clients.assertInFirm(user.firmId, target.billingParentId);
      payerId = target.billingParentId;
      billedForClientId = input.clientId;
    }
    const lines = computeLines(input.lineItems);
    const totals = computeTotals(lines);

    // Control number + row in ONE transaction: the counter upsert is atomic
    // (INSERT … ON CONFLICT … RETURNING), so concurrent saves serialize on the
    // counter row and numbers are assigned strictly in save order — no
    // read-then-count race, no duplicate-number unique violations.
    const invoice = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextControlNumber(tx, user.firmId, input.issuedDate);
      return tx.invoice.create({
        data: {
          firmId: user.firmId,
          clientId: payerId,
          billedForClientId,
          number,
          description: input.description,
          issuedDate: isoToDate(input.issuedDate),
          dueDate: isoToDate(input.dueDate),
          status: input.status,
          ...totals,
          lineItems: { create: lines },
        },
        include: invoiceInclude,
      });
    });
    await this.audit.record({
      userId: user.id,
      action: "invoice.create",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: {
        clientId: payerId,
        ...(billedForClientId ? { billedForClientId } : {}),
        number: invoice.number,
        total: totals.total,
      },
    });
    return toInvoiceDto(invoice);
  }

  async update(user: AuthUser, id: string, input: UpdateInvoiceInput) {
    await this.loadOwned(user.firmId, id);
    const data: Prisma.InvoiceUpdateInput = {
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.issuedDate !== undefined ? { issuedDate: isoToDate(input.issuedDate) } : {}),
      ...(input.dueDate !== undefined ? { dueDate: isoToDate(input.dueDate) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    };

    // Replacing line items must recompute totals atomically with the delete.
    const invoice = await this.prisma.$transaction(async (tx) => {
      if (input.lineItems) {
        const lines = computeLines(input.lineItems);
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: id } });
        return tx.invoice.update({
          where: { id },
          data: { ...data, ...computeTotals(lines), lineItems: { create: lines } },
          include: invoiceInclude,
        });
      }
      return tx.invoice.update({ where: { id }, data, include: invoiceInclude });
    });
    await this.audit.record({
      userId: user.id,
      action: "invoice.update",
      entityType: "Invoice",
      entityId: id,
      metadata: { fields: Object.keys(input) },
    });
    return toInvoiceDto(invoice);
  }

  async send(user: AuthUser, id: string) {
    await this.loadOwned(user.firmId, id);
    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: { status: "Sent" },
      include: invoiceInclude,
    });
    const emailedTo = await this.emailBillingStatement(user.firmId, invoice);
    await this.audit.record({
      userId: user.id,
      action: "invoice.send",
      entityType: "Invoice",
      entityId: id,
      ...(emailedTo ? { metadata: { emailedTo } } : {}),
    });
    return toInvoiceDto(invoice);
  }

  /**
   * Best-effort billing email (design-handoff template #12) to the paying
   * client's contact address when mail is configured. A provider failure never
   * blocks the status change — the billing page remains the source of truth.
   */
  private async emailBillingStatement(
    firmId: string,
    invoice: InvoiceRow,
  ): Promise<string | null> {
    try {
      if (!this.mail.isEnabled()) return null;
      const client = await this.prisma.client.findUnique({
        where: { id: invoice.clientId },
        select: { email: true },
      });
      if (!client?.email) return null;
      const ctx = await this.emailSettings.resolveContext(firmId);
      const rendered = invoiceDueEmail(
        {
          invoiceNo: invoice.number,
          amount: pesoLabel(invoice.total),
          dueDate: longDate(invoice.dueDate),
          lineItems: invoice.lineItems.map((li) => ({
            label: li.description,
            amount: pesoLabel(li.amount),
          })),
          payUrl: this.webAppUrl,
          billingEmail: ctx.billingFooterEmail,
        },
        ctx.theme,
      );
      await this.mail.send({
        to: client.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...ctx.senderFor(rendered.stream),
      });
      return client.email;
    } catch (err) {
      this.logger.warn(
        `Billing email for invoice ${invoice.number} failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Next per-firm control number: `BILL-<issuedYear>-<seq>` (4-digit pad).
   * The sequence lives in `billing_counters`, advanced with an atomic
   * INSERT … ON CONFLICT DO UPDATE … RETURNING — concurrent creates block on
   * the counter row and each gets a distinct, save-ordered number. When the
   * counter row is first created for a year it seeds PAST that year's
   * historical billings, so the series continues rather than restarting.
   */
  private async nextControlNumber(
    tx: Prisma.TransactionClient,
    firmId: string,
    issuedDate: string,
  ): Promise<string> {
    const year = issuedDate.slice(0, 4);
    const rows = await tx.$queryRaw<Array<{ nextSeq: number | bigint }>>`
      INSERT INTO "billing_counters" ("firmId", "year", "nextSeq")
      VALUES (
        ${firmId}::uuid,
        ${year},
        (SELECT COUNT(*) + 2 FROM "invoices"
          WHERE "firmId" = ${firmId}::uuid
            AND EXTRACT(YEAR FROM "issuedDate") = ${Number(year)})
      )
      ON CONFLICT ("firmId", "year")
      DO UPDATE SET "nextSeq" = "billing_counters"."nextSeq" + 1
      RETURNING "nextSeq"`;
    const seq = Number(rows[0]?.nextSeq ?? 1) - 1;
    return `BILL-${year}-${String(seq).padStart(4, "0")}`;
  }

  /** Resolve an invoice that must belong to `firmId`; 404 otherwise. */
  private async loadOwned(firmId: string, id: string): Promise<InvoiceRow> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, firmId },
      include: invoiceInclude,
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return invoice;
  }
}

/** Derive each line's `amount = qty * rate` (2dp, float-safe); carry its taxCode. */
function computeLines(items: InvoiceLineItemInput[]): ComputedLine[] {
  return items.map((li) => ({
    description: li.description,
    qty: li.qty,
    rate: li.rate,
    amount: round2(li.qty * li.rate),
    // Callers that bypass the Zod default (e.g. the MCP tool) keep VATABLE.
    taxCode: li.taxCode ?? "VAT12",
  }));
}

/**
 * subtotal = Σ amount; vat = 12% of the VATABLE lines' amounts (per-line
 * taxCode — a management estimate, guardrail #1); total = subtotal + vat.
 */
function computeTotals(lines: ComputedLine[]): {
  subtotal: number;
  vat: number;
  total: number;
} {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const vatBase = lines.reduce((sum, l) => (l.taxCode === "VAT12" ? sum + l.amount : sum), 0);
  const vat = round2(vatBase * 0.12);
  const total = round2(subtotal + vat);
  return { subtotal, vat, total };
}

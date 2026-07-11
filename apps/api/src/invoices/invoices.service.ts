import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { round2 } from "@portal/shared";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import { ClientsService } from "../clients/clients.service";
import { dateToIso, isoToDate } from "../financial/serialization";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateInvoiceInput,
  InvoiceLineItemInput,
  UpdateInvoiceInput,
} from "./dto/invoice.schemas";

/** The relations loaded for every invoice DTO: line items + the client's name. */
const invoiceInclude = {
  lineItems: true,
  client: { select: { businessName: true } },
} satisfies Prisma.InvoiceInclude;

type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

/** Computed line: the caller-supplied fields plus the derived `amount`. */
interface ComputedLine {
  description: string;
  qty: number;
  rate: number;
  amount: number;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, clientId?: string) {
    const rows = await this.prisma.invoice.findMany({
      where: { firmId: user.firmId, ...(clientId ? { clientId } : {}) },
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toInvoiceDto);
  }

  async get(user: AuthUser, id: string) {
    return toInvoiceDto(await this.loadOwned(user.firmId, id));
  }

  async create(user: AuthUser, input: CreateInvoiceInput) {
    await this.clients.assertInFirm(user.firmId, input.clientId);
    const lines = computeLines(input.lineItems);
    const totals = computeTotals(lines);
    const number = await this.nextNumber(user.firmId, input.issuedDate);

    const invoice = await this.prisma.invoice.create({
      data: {
        firmId: user.firmId,
        clientId: input.clientId,
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
    await this.audit.record({
      userId: user.id,
      action: "invoice.create",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { clientId: input.clientId, number, total: totals.total },
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
    await this.audit.record({
      userId: user.id,
      action: "invoice.send",
      entityType: "Invoice",
      entityId: id,
    });
    return toInvoiceDto(invoice);
  }

  /**
   * Next per-firm invoice number: `INV-<issuedYear>-<seq>`, where seq is the count
   * of this firm's invoices already numbered for that year, plus one, zero-padded
   * to three digits. Counting by the `INV-<year>-` prefix keeps the sequence tied
   * to the numbering scheme (and the `@@unique([firmId, number])` constraint).
   */
  private async nextNumber(firmId: string, issuedDate: string): Promise<string> {
    const year = issuedDate.slice(0, 4);
    const prefix = `INV-${year}-`;
    const count = await this.prisma.invoice.count({
      where: { firmId, number: { startsWith: prefix } },
    });
    return `${prefix}${String(count + 1).padStart(3, "0")}`;
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

/** Derive each line's `amount = qty * rate` (2dp, float-safe). */
function computeLines(items: InvoiceLineItemInput[]): ComputedLine[] {
  return items.map((li) => ({
    description: li.description,
    qty: li.qty,
    rate: li.rate,
    amount: round2(li.qty * li.rate),
  }));
}

/** subtotal = Σ amount; vat = 12% of subtotal (estimate); total = subtotal + vat. */
function computeTotals(lines: ComputedLine[]): {
  subtotal: number;
  vat: number;
  total: number;
} {
  const subtotal = round2(lines.reduce((sum, l) => sum + l.amount, 0));
  const vat = round2(subtotal * 0.12);
  const total = round2(subtotal + vat);
  return { subtotal, vat, total };
}

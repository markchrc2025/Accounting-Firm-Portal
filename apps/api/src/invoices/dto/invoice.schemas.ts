import { zIsoDate } from "@portal/shared";
import { z } from "zod";

/**
 * Invoice is a Portal-internal, firm-scoped billing entity (NOT part of the
 * frozen Portal⇄Generator contract), so its validation lives here rather than in
 * @portal/shared. The Portal's `vat` is a 12% MANAGEMENT ESTIMATE over the
 * subtotal — it is never an authoritative BIR figure (guardrail #1).
 */
export const InvoiceStatus = z.enum(["Draft", "Sent", "Paid", "Overdue"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

/**
 * Per-line tax treatment. "VAT12" adds 12% of the line to the invoice's VAT
 * estimate; "NONE" is untaxed. Defaults to "VAT12" so omitting callers (and
 * pre-existing rows) keep the historical behaviour; the web form sends the
 * choice explicitly and defaults NEW lines to "NONE".
 */
export const InvoiceTaxCode = z.enum(["VAT12", "NONE"]);
export type InvoiceTaxCode = z.infer<typeof InvoiceTaxCode>;

/** One billed line. `amount` is derived server-side (`qty * rate`), never sent. */
export const InvoiceLineItemSchema = z.object({
  description: z.string().min(1),
  qty: z.number().nonnegative(),
  rate: z.number().nonnegative(),
  taxCode: InvoiceTaxCode.default("VAT12"),
});
export type InvoiceLineItemInput = z.infer<typeof InvoiceLineItemSchema>;

export const CreateInvoiceSchema = z.object({
  clientId: z.string().uuid(),
  description: z.string().default(""),
  issuedDate: zIsoDate,
  dueDate: zIsoDate,
  lineItems: z.array(InvoiceLineItemSchema).min(1),
  status: InvoiceStatus.default("Draft"),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

export const UpdateInvoiceSchema = z
  .object({
    description: z.string().optional(),
    issuedDate: zIsoDate.optional(),
    dueDate: zIsoDate.optional(),
    lineItems: z.array(InvoiceLineItemSchema).min(1).optional(),
    status: InvoiceStatus.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field is required",
  });
export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;

/** `GET /invoices?clientId=` — optional firm-scoped client filter. */
export const ListInvoicesQuerySchema = z.object({
  clientId: z.string().uuid().optional(),
});
export type ListInvoicesQuery = z.infer<typeof ListInvoicesQuerySchema>;

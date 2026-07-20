// MCP WRITE tools — client management, bookkeeping transactions, and firm
// invoices. Every tool goes through the SAME service layer the web UI uses
// (ClientsService, Income/PurchaseTransactionsService, InvoicesService), so
// regime validation, category resolution, billing-link rules, control-number
// assignment, and audit logging all apply identically.
//
// Tenancy: firmId is resolved from the deployment context (first firm — the
// same convention as the read tools and the OAuth integration caller). It is
// NEVER a tool input, and every lookup is firm-scoped.
//
// Attribution: service-layer audit rows are attributed to the firm's earliest
// active staff user (the seeded Super Admin); each write ALSO records an
// `mcp.<tool>` audit row with `metadata.actor = "Claude (MCP)"` so the trail
// shows the change came through the MCP connector.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { round2 } from "@portal/shared";
import type { ZodTypeAny } from "zod";
import type { AuthUser } from "../common/auth/auth-user";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import {
  CreateClientSchema,
  UpdateClientSchema,
} from "../clients/dto/client.schemas";
import type { IncomeTransactionsService } from "../income-transactions/income-transactions.service";
import type { InvoicesService } from "../invoices/invoices.service";
import { CreateInvoiceSchema, UpdateInvoiceSchema } from "../invoices/dto/invoice.schemas";
import type { PurchaseTransactionsService } from "../purchase-transactions/purchase-transactions.service";
import type { PrismaService } from "../prisma/prisma.service";
import {
  errMsg,
  fail,
  isRealDate,
  isoDate,
  ok,
  READ_ONLY,
  todayIso,
  WRITE_CREATE,
  WRITE_MUTATE,
  WRITE_MUTATE_IDEMPOTENT,
} from "./mcp-common";

export interface McpWriteDeps {
  prisma: PrismaService;
  audit: AuditService;
  clients: ClientsService;
  income: IncomeTransactionsService;
  purchases: PurchaseTransactionsService;
  invoices: InvoicesService;
  /** Firm-scoped actor the writes run as (earliest active firm user). */
  getActor: () => Promise<AuthUser>;
}

/** VAT rate for the invoice estimate and VATABLE_12 sales — 12% (PH). The
 *  authoritative constant lives in InvoicesService.computeTotals / the entry
 *  UI; this mirrors it for the pre-computed outputVAT on income records. */
const VAT_RATE = 0.12;

const DEFAULT_INVOICE_TERMS_DAYS = 30; // mirrors the web UI's default Terms

/** Max free-text lengths (category names feed the per-client category table). */
const CATEGORY_MAX = 120;
const TEXT_MAX = 500;

// ---------------------------------------------------------------------------
// Client profile input fields (shared by create/update). zod/v3 shapes for the
// SDK; the values are re-validated by the app's own Create/UpdateClientSchema
// before hitting ClientsService — the same pipe the web UI goes through.
// ---------------------------------------------------------------------------

const taxTypeRowShape = z.object({
  type: z.string().max(120).describe('Tax type label, e.g. "Income Tax"'),
  form: z.string().max(30).describe('BIR form code, e.g. "1701Q"'),
  frequency: z.string().max(40).describe('Filing frequency, e.g. "Quarterly"'),
  startDate: isoDate.optional().describe("Registration start date, e.g. 2024-01-01"),
});

const branchRowShape = z.object({
  branchCode: z.string().max(10).describe('BIR branch code, e.g. "00001"'),
  tradeName: z.string().max(200).describe("Branch trade name"),
  address: z.string().max(300).describe("Branch street address"),
  city: z.string().max(120).describe("Branch city/municipality"),
  province: z.string().max(120).describe("Branch province"),
  region: z.string().max(120).describe("Branch region"),
  zip: z.string().max(10).describe('ZIP code, e.g. "1800"'),
  rdo: z.string().max(10).describe('RDO code, e.g. "045"'),
});

/** Optional profile fields accepted by both create and update. */
const clientProfileFields = {
  kind: z
    .enum(["individual", "non-individual"])
    .optional()
    .describe('Filer kind. Default: "non-individual" (company).'),
  regName: z.string().max(200).optional().describe("BIR registered name (companies)"),
  lastName: z.string().max(120).optional().describe("Last name (individuals)"),
  firstName: z.string().max(120).optional().describe("First name (individuals)"),
  middleName: z.string().max(120).optional().describe("Middle name (individuals)"),
  tradeName: z.string().max(200).optional().describe("Trade name / business style"),
  branch: z
    .string()
    .regex(/^\d{3,5}$/, "3-5 digits")
    .optional()
    .describe('BIR branch code of the head office, e.g. "00000" (default)'),
  rdo: z.string().max(10).optional().describe('BIR RDO code, e.g. "045" or "25B"'),
  rdoName: z.string().max(200).optional().describe("RDO office name"),
  address: z.string().max(300).optional().describe("Registered street address"),
  city: z.string().max(120).optional().describe("City / municipality"),
  province: z.string().max(120).optional().describe("Province"),
  region: z.string().max(120).optional().describe("Region"),
  zip: z.string().max(10).optional().describe('ZIP code, e.g. "1800"'),
  birthdate: isoDate.optional().describe("Birthdate (individuals), e.g. 1985-04-12"),
  incorpDate: isoDate.optional().describe("Incorporation date (companies), e.g. 2019-06-01"),
  email: z.string().email().optional().describe("Contact email"),
  phone: z.string().max(40).optional().describe("Contact phone"),
  citizenship: z.string().max(80).optional().describe('Citizenship, e.g. "Filipino"'),
  civilStatus: z.string().max(40).optional().describe('Civil status, e.g. "Single"'),
  taxpayerType: z.string().max(120).optional().describe("Taxpayer type label from the COR"),
  classification: z
    .string()
    .max(120)
    .optional()
    .describe('Classification, e.g. "Professional" or "Single Proprietorship"'),
  taxType: z
    .enum(["VAT", "PERCENTAGE"])
    .nullable()
    .optional()
    .describe(
      "Business-tax regime. null = no regime (client exempt from business tax). " +
        "Required before bookkeeping transactions can be recorded.",
    ),
  taxTypes: z
    .array(taxTypeRowShape)
    .optional()
    .describe("Registered tax types from the COR (replaces the whole list when provided)"),
  hasBranches: z.boolean().optional().describe("Whether the client has registered branches"),
  branches: z
    .array(branchRowShape)
    .optional()
    .describe("Branch offices (replaces the whole list when provided)"),
  professionalFee: z
    .number()
    .nonnegative()
    .optional()
    .describe("Monthly/quarterly professional fee in PHP, e.g. 5500. Required for MONTHLY/QUARTERLY billing."),
  billingMethod: z
    .enum(["MONTHLY", "QUARTERLY", "AS_FILING"])
    .optional()
    .describe("How the firm bills this client. AS_FILING = billed per filing, no fixed fee (default)."),
  billingParentId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .describe("Bill this client under a main client (sub-client link, one level deep). null clears the link."),
  currency: z.string().length(3).optional().describe('ISO currency, default "PHP"'),
  seatLimit: z.number().int().min(3).optional().describe("Client-portal seat limit (min 3, default 3)"),
};

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Strip separators; return the 9 TIN digits or null when not a valid TIN. */
function normalizeTin(tin: string): string | null {
  const digits = tin.replace(/[-\s.]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}

/** Parse through one of the app's own DTO schemas; throw a readable error. */
function parseDto<S extends ZodTypeAny>(schema: S, data: unknown): S["_output"] {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
      .join("; ");
    throw new Error(`Invalid input — ${issues}`);
  }
  return result.data;
}

/** The client row serialized exactly like portal_get_client (no corPath). */
function clientDto(row: Record<string, unknown>): Record<string, unknown> {
  const { corPath: _cor, ...client } = row;
  return JSON.parse(JSON.stringify(client)) as Record<string, unknown>;
}

/** Invoice DTO with Decimal money coerced to numbers (read-tool serialization). */
function invoiceDto(dto: {
  subtotal: unknown;
  vat: unknown;
  total: unknown;
  lineItems: { qty: unknown; rate: unknown; amount: unknown; [k: string]: unknown }[];
  [k: string]: unknown;
}): Record<string, unknown> {
  const n = (v: unknown) => Number(String(v));
  return {
    ...dto,
    subtotal: n(dto.subtotal),
    vat: n(dto.vat),
    total: n(dto.total),
    lineItems: dto.lineItems.map((li) => ({
      ...li,
      qty: n(li.qty),
      rate: n(li.rate),
      amount: n(li.amount),
    })),
  };
}

const INVOICE_TRANSITIONS: Record<string, string[]> = {
  Draft: ["Sent"],
  Sent: ["Paid", "Overdue"],
  Overdue: ["Paid"],
  Paid: [],
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerWriteTools(server: McpServer, deps: McpWriteDeps): void {
  const { prisma, audit, clients, income, purchases, invoices, getActor } = deps;

  /** One extra audit row per MCP write, so the trail shows the connector. */
  async function recordMcpWrite(
    firmId: string,
    tool: string,
    entityType: string,
    entityId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await audit.record({
      action: `mcp.${tool}`,
      entityType,
      entityId,
      metadata: { firmId, actor: "Claude (MCP)", ...metadata },
    });
  }

  /** Firm-scoped client fetch used by the validation paths below. */
  async function findClient(firmId: string, clientId: string) {
    return prisma.client.findFirst({
      where: { id: clientId, firmId },
      select: {
        id: true,
        businessName: true,
        status: true,
        taxType: true,
        billingParentId: true,
        billingMethod: true,
        professionalFee: true,
      },
    });
  }

  const CLIENT_NOT_FOUND = (id: string) =>
    `Client ${id} was not found. Call portal_list_clients to look up valid client ids.`;

  /**
   * TIN checks shared by create/update: digits-only 9-digit normalization and
   * per-firm uniqueness with an error that names the existing client.
   */
  async function checkTin(
    firmId: string,
    tin: string,
    excludeClientId?: string,
  ): Promise<{ tin: string } | { error: string }> {
    const digits = normalizeTin(tin);
    if (!digits) {
      return {
        error:
          `TIN "${tin}" is not valid — expected exactly 9 digits (separators allowed), ` +
          'e.g. "234-968-660". The head-office branch code (e.g. "00000") goes in the ' +
          "separate `branch` field, not in the TIN.",
      };
    }
    const others = await prisma.client.findMany({
      where: {
        firmId,
        tin: { not: null },
        ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
      },
      select: { id: true, businessName: true, tin: true },
    });
    const clash = others.find((c) => (c.tin ?? "").replace(/\D/g, "") === digits);
    if (clash) {
      return {
        error:
          `TIN ${digits} already belongs to ${clash.businessName} (id ${clash.id}). ` +
          "Use portal_update_client to modify that client, or double-check the TIN.",
      };
    }
    return { tin: digits };
  }

  /**
   * Billing-coupling rule: MONTHLY/QUARTERLY need a professionalFee; AS_FILING
   * is billed per filing so a fee makes no sense. `existing` supplies the
   * unchanged half on partial updates.
   */
  function checkBillingCoupling(
    patch: { billingMethod?: string; professionalFee?: number },
    existing?: { billingMethod: string; professionalFee: unknown },
  ): string | null {
    const method = patch.billingMethod ?? existing?.billingMethod ?? "AS_FILING";
    const fee =
      patch.professionalFee !== undefined
        ? patch.professionalFee
        : existing?.professionalFee != null
          ? Number(String(existing.professionalFee))
          : undefined;
    if ((method === "MONTHLY" || method === "QUARTERLY") && fee === undefined) {
      return `billingMethod ${method} requires professionalFee (the fixed fee in PHP, ≥ 0).`;
    }
    if (method === "AS_FILING" && patch.professionalFee !== undefined) {
      return (
        "billingMethod AS_FILING is billed per filing — it takes no fixed professionalFee. " +
        "Omit professionalFee, or set billingMethod to MONTHLY or QUARTERLY."
      );
    }
    return null;
  }

  /** Validate a billingParentId beyond the service rules: parent must be ACTIVE. */
  async function checkBillingParent(
    firmId: string,
    billingParentId: string,
  ): Promise<string | null> {
    const parent = await findClient(firmId, billingParentId);
    if (!parent) {
      return `billingParentId ${billingParentId} was not found. Call portal_list_clients to look up valid client ids.`;
    }
    if (parent.status !== "ACTIVE") {
      return `The selected main client ${parent.businessName} (id ${parent.id}) is ARCHIVED — reactivate it with portal_set_client_status first, or pick another main client.`;
    }
    return null; // one-level / self / same-firm rules run in ClientsService
  }

  // ------------------------------------------------------------- A. Clients

  server.registerTool(
    "portal_create_client",
    {
      title: "Create client",
      description:
        "Create a new client (BIR filer + engagement profile) in the firm; status starts ACTIVE. " +
        "Creates a permanent record — archive later with portal_set_client_status if needed. " +
        "For individuals pass kind=individual with lastName/firstName; companies use regName.",
      inputSchema: {
        businessName: z
          .string()
          .min(1)
          .max(200)
          .describe('Canonical display name, e.g. "HEBREWS 13-8 MILKTEA SHOP"'),
        tin: z
          .string()
          .describe('9-digit BIR TIN, separators allowed, e.g. "234-968-660" (stored as digits)'),
        ...clientProfileFields,
      },
      annotations: WRITE_CREATE,
    },
    async (args) => {
      try {
        const actor = await getActor();
        const tinCheck = await checkTin(actor.firmId, args.tin);
        if ("error" in tinCheck) return fail(tinCheck.error);
        const coupling = checkBillingCoupling(args);
        if (coupling) return fail(coupling);
        if (args.billingParentId) {
          const parentErr = await checkBillingParent(actor.firmId, args.billingParentId);
          if (parentErr) return fail(parentErr);
        }
        const { taxType, ...rest } = args;
        const input = parseDto(CreateClientSchema, {
          ...rest,
          tin: tinCheck.tin,
          // null = no business-tax regime (exempt); the service stores NULL for "".
          ...(taxType !== undefined ? { taxType: taxType ?? "" } : {}),
        });
        const row = await clients.create(actor, input);
        await recordMcpWrite(actor.firmId, "portal_create_client", "Client", row.id, {
          businessName: row.businessName,
        });
        return ok({ client: clientDto(row as unknown as Record<string, unknown>) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_update_client",
    {
      title: "Update client",
      description:
        "Partially update a client's profile — only the supplied fields change. " +
        "Overwrites existing values, so read the client first with portal_get_client. " +
        "Use portal_set_client_status (not this tool) to archive or reactivate.",
      inputSchema: {
        clientId: z.string().uuid().describe("Client id from portal_list_clients"),
        businessName: z.string().min(1).max(200).optional().describe("New display name"),
        tin: z
          .string()
          .optional()
          .describe('New 9-digit TIN, separators allowed, e.g. "234-968-660"'),
        ...clientProfileFields,
      },
      annotations: WRITE_MUTATE,
    },
    async ({ clientId, ...patch }) => {
      try {
        const actor = await getActor();
        const existing = await findClient(actor.firmId, clientId);
        if (!existing) return fail(CLIENT_NOT_FOUND(clientId));

        const supplied = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (supplied.length === 0) {
          return fail(
            "Empty update — supply at least one field to change (e.g. professionalFee, " +
              "billingMethod, address, taxType). Use portal_get_client to see current values.",
          );
        }
        let tin: string | undefined;
        if (patch.tin !== undefined) {
          const tinCheck = await checkTin(actor.firmId, patch.tin, clientId);
          if ("error" in tinCheck) return fail(tinCheck.error);
          tin = tinCheck.tin;
        }
        const coupling = checkBillingCoupling(patch, existing);
        if (coupling) return fail(coupling);
        if (patch.billingParentId) {
          const parentErr = await checkBillingParent(actor.firmId, patch.billingParentId);
          if (parentErr) return fail(parentErr);
        }
        const { taxType, ...rest } = Object.fromEntries(supplied);
        const input = parseDto(UpdateClientSchema, {
          ...rest,
          ...(tin !== undefined ? { tin } : {}),
          ...(taxType !== undefined ? { taxType: taxType ?? "" } : {}),
        });
        const row = await clients.update(actor, clientId, input);
        await recordMcpWrite(actor.firmId, "portal_update_client", "Client", clientId, {
          fields: supplied.map(([k]) => k),
        });
        return ok({ client: clientDto(row as unknown as Record<string, unknown>) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_set_client_status",
    {
      title: "Archive / reactivate client",
      description:
        "Soft-archive a client (hides it from active lists; nothing is deleted) or reactivate " +
        "an archived one. Archiving is blocked while ACTIVE sub-clients are still billed under " +
        "the client. Re-applying the current status is a no-op.",
      inputSchema: {
        clientId: z.string().uuid().describe("Client id from portal_list_clients"),
        status: z.enum(["ACTIVE", "ARCHIVED"]).describe("Target status"),
      },
      annotations: WRITE_MUTATE_IDEMPOTENT,
    },
    async ({ clientId, status }) => {
      try {
        const actor = await getActor();
        const existing = await findClient(actor.firmId, clientId);
        if (!existing) return fail(CLIENT_NOT_FOUND(clientId));
        if (existing.status === status) {
          return ok({
            client: clientDto(
              (await prisma.client.findFirst({
                where: { id: clientId, firmId: actor.firmId },
              })) as unknown as Record<string, unknown>,
            ),
            note: `Client is already ${status} — nothing changed.`,
          });
        }
        if (status === "ARCHIVED") {
          const subs = await prisma.client.findMany({
            where: { firmId: actor.firmId, billingParentId: clientId, status: "ACTIVE" },
            select: { id: true, businessName: true },
            orderBy: { businessName: "asc" },
          });
          if (subs.length > 0) {
            const list = subs.map((s) => `${s.businessName} (id ${s.id})`).join(", ");
            return fail(
              `${existing.businessName} is the billing parent of ${subs.length} ACTIVE ` +
                `sub-client(s): ${list}. Archive those sub-clients first, or clear their link ` +
                "with portal_update_client (billingParentId: null), then retry.",
            );
          }
        }
        const row = await clients.update(actor, clientId, { status });
        await recordMcpWrite(actor.firmId, "portal_set_client_status", "Client", clientId, {
          status,
        });
        return ok({ client: clientDto(row as unknown as Record<string, unknown>) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ------------------------------------------------- B. Bookkeeping records

  /** Fields shared by portal_record_income and portal_record_expense. */
  const recordFields = (side: "income" | "expense") => ({
    clientId: z.string().uuid().describe("Client id from portal_list_clients"),
    txnDate: isoDate.describe("Transaction date, e.g. 2026-07-15"),
    amount: z
      .number()
      .positive()
      .describe("Amount in PHP, NET of VAT (must be > 0), e.g. 12500.00"),
    category: z
      .string()
      .min(1)
      .max(CATEGORY_MAX)
      .describe(
        'Account/category name, e.g. "Service Income" or "Office Supplies". Call ' +
          "portal_list_transaction_categories for known values; new names are created on first use.",
      ),
    description: z
      .string()
      .max(TEXT_MAX)
      .optional()
      .describe("Particulars (defaults to the category name)"),
    counterparty: z
      .string()
      .max(200)
      .optional()
      .describe(side === "income" ? "Customer name" : "Vendor / payee name"),
    reference: z
      .string()
      .max(100)
      .optional()
      .describe('OR / invoice / reference number, e.g. "OR-00123"'),
  });

  interface RecordArgs {
    clientId: string;
    txnDate: string;
    amount: number;
    category: string;
    description?: string;
    counterparty?: string;
    reference?: string;
    vatClass?: "VATABLE_12" | "ZERO_RATED" | "EXEMPT";
    vatAmount?: number;
  }

  async function handleRecord(kind: "income" | "expense", args: RecordArgs) {
    const isIncome = kind === "income";
    try {
      const actor = await getActor();
      const client = await findClient(actor.firmId, args.clientId);
      if (!client) return fail(CLIENT_NOT_FOUND(args.clientId));
      if (client.status !== "ACTIVE") {
        return fail(
          `${client.businessName} is ARCHIVED. Reactivate it with portal_set_client_status ` +
            "before recording transactions.",
        );
      }
      if (!isRealDate(args.txnDate)) {
        return fail(`txnDate ${args.txnDate} is not a real calendar date.`);
      }
      const category = args.category.trim();
      if (!category) return fail("category must not be blank.");
      const isVatClient = client.taxType === "VAT";

      const base = {
        txnDate: args.txnDate,
        netAmount: round2(args.amount),
        description: (args.description ?? category).trim() || category,
        account: category, // resolves/creates the per-client category server-side
        ...(args.reference ? { referenceNo: args.reference } : {}),
      };

      let dto: Record<string, unknown>;
      if (isIncome) {
        if (args.vatClass && !isVatClient) {
          return fail(
            `${client.businessName} is not VAT-registered (regime: ${client.taxType ?? "none"}) — ` +
              "its sales are recorded NON_VAT automatically; omit vatClass.",
          );
        }
        const effectiveClass = isVatClient ? (args.vatClass ?? "VATABLE_12") : "NON_VAT";
        // Same 12% split the entry UI applies — the net amount stays authoritative.
        const outputVAT =
          effectiveClass === "VATABLE_12" ? round2(base.netAmount * VAT_RATE) : undefined;
        dto = (await income.create(actor, client.id, {
          ...base,
          ...(args.counterparty ? { customer: args.counterparty } : {}),
          vatClass: effectiveClass,
          ...(outputVAT ? { outputVAT } : {}),
        })) as unknown as Record<string, unknown>;
      } else {
        if (args.vatAmount && !isVatClient) {
          return fail(
            `${client.businessName} is not VAT-registered (regime: ${client.taxType ?? "none"}) — ` +
              "it claims no input VAT; omit vatAmount.",
          );
        }
        const vat = args.vatAmount ? round2(args.vatAmount) : undefined;
        dto = (await purchases.create(actor, client.id, {
          ...base,
          ...(args.counterparty ? { vendor: args.counterparty } : {}),
          ...(isVatClient
            ? {
                inputVATCategory: "DOMESTIC_PURCHASES",
                ...(vat ? { inputVAT: vat, taxAmount: vat } : {}),
              }
            : {}),
        })) as unknown as Record<string, unknown>;
      }
      await recordMcpWrite(
        actor.firmId,
        isIncome ? "portal_record_income" : "portal_record_expense",
        isIncome ? "IncomeTransaction" : "PurchaseTransaction",
        (dto.id as string) ?? null,
        { clientId: client.id, netAmount: base.netAmount, category },
      );
      return ok({
        transaction: { ...dto, categoryName: category },
        ...(args.txnDate > todayIso()
          ? { warning: `txnDate ${args.txnDate} is in the future.` }
          : {}),
      });
    } catch (err) {
      return fail(errMsg(err));
    }
  }

  server.registerTool(
    "portal_record_income",
    {
      title: "Record income (client sale)",
      description:
        "Record one sales/income bookkeeping entry for a client (PHP, amount NET of VAT — " +
        "12% output VAT is computed automatically for VAT-registered clients). Creates a " +
        "permanent record; use portal_delete_transaction to remove a mistake.",
      inputSchema: {
        ...recordFields("income"),
        vatClass: z
          .enum(["VATABLE_12", "ZERO_RATED", "EXEMPT"])
          .optional()
          .describe(
            "VAT-registered clients only (default VATABLE_12). Percentage-tax clients are " +
              "always NON_VAT — omit this.",
          ),
      },
      annotations: WRITE_CREATE,
    },
    (args) => handleRecord("income", args),
  );

  server.registerTool(
    "portal_record_expense",
    {
      title: "Record expense (client purchase)",
      description:
        "Record one expense/purchase bookkeeping entry for a client (PHP, amount NET of VAT — " +
        "pass the input VAT separately via vatAmount for VAT-registered clients). Creates a " +
        "permanent record; use portal_delete_transaction to remove a mistake.",
      inputSchema: {
        ...recordFields("expense"),
        vatAmount: z
          .number()
          .nonnegative()
          .optional()
          .describe("Input VAT on the purchase in PHP (VAT-registered clients only)"),
      },
      annotations: WRITE_CREATE,
    },
    (args) => handleRecord("expense", args),
  );

  server.registerTool(
    "portal_delete_transaction",
    {
      title: "Delete a bookkeeping transaction",
      description:
        "PERMANENTLY delete one wrongly-entered income or expense record (the same delete the " +
        "web app performs — there is no void/undo, though the deletion itself is audit-logged). " +
        "Verify the id with the list tools first.",
      inputSchema: {
        kind: z.enum(["income", "expense"]).describe("Which ledger the transaction lives in"),
        transactionId: z.string().uuid().describe("Transaction id from the list tools"),
        reason: z
          .string()
          .max(TEXT_MAX)
          .optional()
          .describe('Why it is being removed (recorded in the audit log), e.g. "duplicate entry"'),
      },
      annotations: WRITE_MUTATE,
    },
    async ({ kind, transactionId, reason }) => {
      try {
        const actor = await getActor();
        const table = kind === "income" ? prisma.incomeTransaction : prisma.purchaseTransaction;
        // Firm-scoped lookup: a cross-firm id reads as not-found, never leaks.
        const row = await (table as typeof prisma.incomeTransaction).findFirst({
          where: { id: transactionId, client: { firmId: actor.firmId } },
          select: { id: true, clientId: true, description: true, netAmount: true },
        });
        if (!row) {
          return fail(
            `No ${kind} transaction ${transactionId} was found. Check the id with ` +
              `portal_list_${kind === "income" ? "income" : "expense"}_transactions.`,
          );
        }
        if (kind === "income") await income.remove(actor, row.clientId, row.id);
        else await purchases.remove(actor, row.clientId, row.id);
        await recordMcpWrite(
          actor.firmId,
          "portal_delete_transaction",
          kind === "income" ? "IncomeTransaction" : "PurchaseTransaction",
          row.id,
          {
            clientId: row.clientId,
            description: row.description,
            netAmount: Number(String(row.netAmount)),
            ...(reason ? { reason } : {}),
          },
        );
        return ok({
          deleted: true,
          kind,
          transactionId: row.id,
          description: row.description,
          netAmount: Number(String(row.netAmount)),
        });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_list_transaction_categories",
    {
      title: "List transaction categories / accounts",
      description:
        "Discover valid `category` values for portal_record_income / portal_record_expense: " +
        "the client's existing income and expense categories plus the firm's Chart of Accounts " +
        "(the values the web UI's Account picker offers). Categories are created on first use, " +
        "so prefer an existing name over inventing a near-duplicate.",
      inputSchema: {
        clientId: z.string().uuid().describe("Client id from portal_list_clients"),
      },
      annotations: READ_ONLY,
    },
    async ({ clientId }) => {
      try {
        const actor = await getActor();
        const client = await findClient(actor.firmId, clientId);
        if (!client) return fail(CLIENT_NOT_FOUND(clientId));
        const [categories, accounts] = await Promise.all([
          prisma.category.findMany({
            where: { clientId },
            select: { name: true, type: true },
            orderBy: { name: "asc" },
          }),
          prisma.chartAccount.findMany({
            where: { postable: true, archived: false },
            select: { code: true, name: true, class: true },
            orderBy: { code: "asc" },
          }),
        ]);
        return ok({
          client: client.businessName,
          income: categories.filter((c) => c.type === "INCOME").map((c) => c.name),
          expense: categories.filter((c) => c.type === "EXPENSE").map((c) => c.name),
          chartAccounts: accounts,
          note: "Pass the NAME as `category`. Unknown names are accepted and created on first use.",
        });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  // ------------------------------------------------------------ C. Invoices

  server.registerTool(
    "portal_create_invoice",
    {
      title: "Create invoice (firm billing)",
      description:
        "Create a Draft invoice for the firm's services to a client. Subtotal, the 12% VAT " +
        "estimate, the total, and the BILL-<year>-NNNN control number are all computed " +
        "server-side from the line items. Move it along with portal_update_invoice_status.",
      inputSchema: {
        clientId: z
          .string()
          .uuid()
          .describe("The PAYING client (a main client, not a sub-client)"),
        billedForClientId: z
          .string()
          .uuid()
          .optional()
          .describe(
            "Optional sub-client this engagement is FOR — must be billed under clientId; " +
              "populates billedForName while the invoice is recorded on the paying client.",
          ),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(1).max(300).describe('e.g. "Monthly bookkeeping — July 2026"'),
              qty: z.number().positive().describe("Quantity, e.g. 1"),
              rate: z.number().nonnegative().describe("Unit rate in PHP, e.g. 5500.00"),
            }),
          )
          .min(1)
          .describe("At least one line; amount = qty × rate is derived server-side"),
        description: z.string().max(TEXT_MAX).optional().describe("Invoice memo / notes"),
        issuedDate: isoDate.optional().describe("Billing date (default: today)"),
        dueDate: isoDate.optional().describe("Due date (default: issuedDate + 30 days)"),
      },
      annotations: WRITE_CREATE,
    },
    async ({ clientId, billedForClientId, lineItems, description, issuedDate, dueDate }) => {
      try {
        const actor = await getActor();
        const payer = await findClient(actor.firmId, clientId);
        if (!payer) return fail(CLIENT_NOT_FOUND(clientId));
        if (payer.billingParentId) {
          const parent = await findClient(actor.firmId, payer.billingParentId);
          return fail(
            `${payer.businessName} is a sub-client billed under ` +
              `${parent?.businessName ?? "its main client"} (id ${payer.billingParentId}). ` +
              `Pass clientId=${payer.billingParentId} and billedForClientId=${clientId} instead.`,
          );
        }
        if (payer.status !== "ACTIVE") {
          return fail(
            `${payer.businessName} is ARCHIVED — reactivate it with portal_set_client_status first.`,
          );
        }
        if (billedForClientId) {
          const sub = await findClient(actor.firmId, billedForClientId);
          if (!sub) return fail(CLIENT_NOT_FOUND(billedForClientId));
          if (sub.billingParentId !== clientId) {
            return fail(
              `${sub.businessName} (id ${sub.id}) is not billed under ${payer.businessName} — ` +
                "billedForClientId must be a sub-client whose billing parent is clientId. " +
                "Link it first with portal_update_client (billingParentId), or drop billedForClientId.",
            );
          }
        }
        const issued = issuedDate ?? todayIso();
        if (!isRealDate(issued)) return fail(`issuedDate ${issued} is not a real calendar date.`);
        const due =
          dueDate ??
          new Date(new Date(`${issued}T00:00:00.000Z`).getTime() + DEFAULT_INVOICE_TERMS_DAYS * 86_400_000)
            .toISOString()
            .slice(0, 10);
        if (!isRealDate(due)) return fail(`dueDate ${due} is not a real calendar date.`);
        if (due < issued) return fail(`dueDate ${due} is before issuedDate ${issued}.`);

        // The service records a sub-client's invoice under its paying parent,
        // so pass the sub-client id when the engagement is FOR a sub-client.
        const input = parseDto(CreateInvoiceSchema, {
          clientId: billedForClientId ?? clientId,
          description: description ?? "",
          issuedDate: issued,
          dueDate: due,
          lineItems,
          status: "Draft",
        });
        const dto = await invoices.create(actor, input);
        await recordMcpWrite(actor.firmId, "portal_create_invoice", "Invoice", dto.id, {
          clientId,
          ...(billedForClientId ? { billedForClientId } : {}),
          number: dto.number,
        });
        return ok({ invoice: invoiceDto(dto) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_update_invoice_status",
    {
      title: "Update invoice status",
      description:
        "Move an invoice through its lifecycle: Draft→Sent, Sent→Paid, Sent→Overdue, " +
        "Overdue→Paid. Paid is final and no status can return to Draft. Re-applying the " +
        "current status is a no-op.",
      inputSchema: {
        invoiceId: z.string().uuid().describe("Invoice id from portal_list_invoices"),
        status: z.enum(["Draft", "Sent", "Paid", "Overdue"]).describe("Target status"),
      },
      annotations: WRITE_MUTATE_IDEMPOTENT,
    },
    async ({ invoiceId, status }) => {
      try {
        const actor = await getActor();
        const current = await invoices.get(actor, invoiceId); // firm-scoped; 404 otherwise
        if (current.status === status) {
          return ok({
            invoice: invoiceDto(current),
            note: `Invoice ${current.number} is already ${status} — nothing changed.`,
          });
        }
        const allowed = INVOICE_TRANSITIONS[current.status] ?? [];
        if (!allowed.includes(status)) {
          const next =
            allowed.length > 0 ? `Valid next status: ${allowed.join(" or ")}.` : "Paid is final.";
          return fail(
            `Invoice ${current.number} is ${current.status} — it cannot move to ${status}. ${next}`,
          );
        }
        const dto = await invoices.update(actor, invoiceId, { status });
        await recordMcpWrite(actor.firmId, "portal_update_invoice_status", "Invoice", invoiceId, {
          from: current.status,
          to: status,
          number: current.number,
        });
        return ok({ invoice: invoiceDto(dto) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );

  server.registerTool(
    "portal_update_invoice",
    {
      title: "Edit a Draft invoice",
      description:
        "Edit a Draft invoice's line items, memo, or dates — totals and the 12% VAT estimate " +
        "are recomputed server-side. Sent/Paid/Overdue invoices cannot be edited " +
        "(use portal_update_invoice_status for lifecycle changes).",
      inputSchema: {
        invoiceId: z.string().uuid().describe("Invoice id from portal_list_invoices"),
        lineItems: z
          .array(
            z.object({
              description: z.string().min(1).max(300).describe("Line description"),
              qty: z.number().positive().describe("Quantity, e.g. 1"),
              rate: z.number().nonnegative().describe("Unit rate in PHP, e.g. 5500.00"),
            }),
          )
          .min(1)
          .optional()
          .describe("Replaces ALL existing lines when provided"),
        description: z.string().max(TEXT_MAX).optional().describe("New memo / notes"),
        issuedDate: isoDate.optional().describe("New billing date"),
        dueDate: isoDate.optional().describe("New due date"),
      },
      annotations: WRITE_MUTATE,
    },
    async ({ invoiceId, ...patch }) => {
      try {
        const actor = await getActor();
        const current = await invoices.get(actor, invoiceId);
        if (current.status !== "Draft") {
          return fail(
            `Invoice ${current.number} is ${current.status} — only Draft invoices can be ` +
              "edited. Use portal_update_invoice_status for lifecycle changes.",
          );
        }
        const supplied = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (supplied.length === 0) {
          return fail(
            "Empty update — supply at least one of lineItems, description, issuedDate, dueDate.",
          );
        }
        for (const key of ["issuedDate", "dueDate"] as const) {
          const v = patch[key];
          if (v !== undefined && !isRealDate(v)) {
            return fail(`${key} ${v} is not a real calendar date.`);
          }
        }
        const issued = patch.issuedDate ?? current.issuedDate;
        const due = patch.dueDate ?? current.dueDate;
        if (due < issued) return fail(`dueDate ${due} is before issuedDate ${issued}.`);
        const input = parseDto(UpdateInvoiceSchema, Object.fromEntries(supplied));
        const dto = await invoices.update(actor, invoiceId, input);
        await recordMcpWrite(actor.firmId, "portal_update_invoice", "Invoice", invoiceId, {
          fields: supplied.map(([k]) => k),
          number: current.number,
        });
        return ok({ invoice: invoiceDto(dto) });
      } catch (err) {
        return fail(errMsg(err));
      }
    },
  );
}

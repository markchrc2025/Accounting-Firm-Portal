import { NotFoundException } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

/** A persisted invoice row (Decimals as strings, @db.Date as Date, with relations). */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv1",
    firmId: "f1",
    clientId: "c1",
    number: "INV-2026-003",
    description: "",
    issuedDate: new Date("2026-07-11T00:00:00.000Z"),
    dueDate: new Date("2026-07-25T00:00:00.000Z"),
    status: "Draft",
    subtotal: "2500.00",
    vat: "300.00",
    total: "2800.00",
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
    updatedAt: new Date("2026-07-11T00:00:00.000Z"),
    client: { businessName: "Acme Corp" },
    lineItems: [],
    ...overrides,
  };
}

function build(invoiceOverrides: Record<string, unknown> = {}) {
  const prisma = {
    invoice: {
      findMany: jest.fn().mockResolvedValue([makeRow()]),
      findFirst: jest.fn().mockResolvedValue(makeRow()),
      count: jest.fn().mockResolvedValue(2), // → next seq 003
      create: jest.fn().mockResolvedValue(makeRow()),
      update: jest.fn().mockResolvedValue(makeRow({ status: "Sent" })),
      ...invoiceOverrides,
    },
  } as unknown as PrismaService;
  const clients = {
    assertInFirm: jest.fn().mockResolvedValue({ id: "c1", firmId: "f1" }),
  } as unknown as ClientsService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return { svc: new InvoicesService(prisma, clients, audit), prisma, clients };
}

describe("InvoicesService", () => {
  it("computes line amounts, totals and the per-firm number on create", async () => {
    const { svc, prisma, clients } = build();
    await svc.create(actor, {
      clientId: "c1",
      description: "July retainer",
      issuedDate: "2026-07-11",
      dueDate: "2026-07-25",
      lineItems: [
        { description: "Bookkeeping", qty: 2, rate: 1000 },
        { description: "Filing", qty: 1, rate: 500 },
      ],
      status: "Draft",
    });

    // Client ownership is asserted against the actor's firm.
    expect(clients.assertInFirm).toHaveBeenCalledWith("f1", "c1");

    const arg = (prisma.invoice.create as jest.Mock).mock.calls[0][0];
    expect(arg.data).toEqual(
      expect.objectContaining({
        firmId: "f1",
        clientId: "c1",
        number: "INV-2026-003", // count 2 + 1, zero-padded
        subtotal: 2500,
        vat: 300, // 12% management estimate
        total: 2800,
      }),
    );
    // Each line carries its derived amount = qty * rate.
    expect(arg.data.lineItems.create).toEqual([
      { description: "Bookkeeping", qty: 2, rate: 1000, amount: 2000 },
      { description: "Filing", qty: 1, rate: 500, amount: 500 },
    ]);
  });

  it("404s when reading an invoice outside the firm", async () => {
    const { svc } = build({ findFirst: jest.fn().mockResolvedValue(null) });
    await expect(svc.get(actor, "other")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("404s when sending an invoice outside the firm", async () => {
    const { svc, prisma } = build({ findFirst: jest.fn().mockResolvedValue(null) });
    await expect(svc.send(actor, "other")).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("flips status to Sent on send", async () => {
    const { svc, prisma } = build();
    const res = await svc.send(actor, "inv1");
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "inv1" }, data: { status: "Sent" } }),
    );
    expect(res.status).toBe("Sent");
  });
});

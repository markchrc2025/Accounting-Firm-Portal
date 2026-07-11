import { TaxRulesService } from "./tax-rules.service";
import { DEFAULT_TAX_RULE } from "./dto/tax-rule.schemas";
import type { AuditService } from "../audit/audit.service";
import type { ClientsService } from "../clients/clients.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    taxRule: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      ...overrides,
    },
  } as unknown as PrismaService;
  const clients = {
    assertInFirm: jest.fn().mockResolvedValue({ id: "c1", firmId: "f1" }),
  } as unknown as ClientsService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return { svc: new TaxRulesService(prisma, clients, audit), prisma, clients };
}

describe("TaxRulesService", () => {
  it("returns the TRAIN graduated default when the client has no rule (no persist)", async () => {
    const { svc, prisma, clients } = build();
    const res = await svc.get(actor, "c1");
    expect(clients.assertInFirm).toHaveBeenCalledWith("f1", "c1");
    expect(res).toEqual(DEFAULT_TAX_RULE);
    expect(res.method).toBe("graduated");
    expect(res.flatRate).toBeNull();
    expect(res.brackets).toHaveLength(6);
    expect(res.brackets[5]).toEqual({
      over: 8000000,
      notOver: null,
      baseTax: 2202500,
      rate: 35,
    });
    // GET must never persist.
    expect((prisma as unknown as { taxRule: { upsert: jest.Mock } }).taxRule.upsert)
      .not.toHaveBeenCalled();
  });

  it("coerces a stored row back to the DTO shape (Decimal→number, JSON→brackets)", async () => {
    const { svc } = build({
      findUnique: jest.fn().mockResolvedValue({
        id: "t1",
        clientId: "c1",
        method: "flat",
        flatRate: "8.000",
        bracketsJson: [{ over: 0, notOver: null, baseTax: 0, rate: 8 }],
      }),
    });
    const res = await svc.get(actor, "c1");
    expect(res.method).toBe("flat");
    expect(res.flatRate).toBe(8);
    expect(res.brackets).toEqual([{ over: 0, notOver: null, baseTax: 0, rate: 8 }]);
  });

  it("upserts by clientId and returns the saved rule", async () => {
    const input = {
      method: "percentage" as const,
      flatRate: 3,
      brackets: [],
    };
    const saved = {
      id: "t1",
      clientId: "c1",
      method: "percentage",
      flatRate: "3.000",
      bracketsJson: [],
    };
    const { svc, prisma } = build({
      upsert: jest.fn().mockResolvedValue(saved),
    });
    const res = await svc.upsert(actor, "c1", input);
    expect((prisma as unknown as { taxRule: { upsert: jest.Mock } }).taxRule.upsert)
      .toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId: "c1" },
          create: expect.objectContaining({ clientId: "c1", method: "percentage" }),
          update: expect.objectContaining({ method: "percentage" }),
        }),
      );
    expect(res).toEqual({ method: "percentage", flatRate: 3, brackets: [] });
  });
});

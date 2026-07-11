import { AuditService } from "./audit.service";
import type { PrismaService } from "../prisma/prisma.service";

const userRow = {
  id: "a1",
  timestamp: new Date("2026-07-01T10:00:00.000Z"),
  action: "service.create",
  entityType: "Service",
  entityId: "s1",
  ipAddress: "10.0.0.1",
  metadata: {},
  user: { fullName: "Jane Manager" },
};

const systemRow = {
  id: "a2",
  timestamp: new Date("2026-07-01T09:00:00.000Z"),
  action: "integration.push",
  entityType: "VatSummary",
  entityId: null,
  ipAddress: null,
  metadata: { firmId: "f1", actor: "BIR Generator" },
  user: null,
};

function build(rows: unknown[] = [userRow, systemRow]) {
  const prisma = {
    auditLog: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as unknown as PrismaService;
  return { svc: new AuditService(prisma), prisma };
}

describe("AuditService.list", () => {
  it("maps actor from user.fullName, else metadata.actor, else System", async () => {
    const { svc } = build([
      userRow,
      systemRow,
      { ...systemRow, id: "a3", metadata: {} },
    ]);
    const res = await svc.list("f1");
    expect(res[0]).toEqual({
      id: "a1",
      timestamp: "2026-07-01T10:00:00.000Z",
      actor: "Jane Manager",
      action: "service.create",
      entityType: "Service",
      entityId: "s1",
      ipAddress: "10.0.0.1",
    });
    expect(res[1].actor).toBe("BIR Generator");
    expect(res[2].actor).toBe("System");
    // Raw metadata is never surfaced.
    expect(res[0]).not.toHaveProperty("metadata");
  });

  it("scopes to the firm via user relation OR metadata firmId, newest-first, capped", async () => {
    const { svc, prisma } = build();
    await svc.list("f1");
    const arg = (prisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.orderBy).toEqual({ timestamp: "desc" });
    expect(arg.take).toBe(200);
    expect(arg.where.AND).toContainEqual({
      OR: [
        { user: { is: { firmId: "f1" } } },
        { metadata: { path: ["firmId"], equals: "f1" } },
      ],
    });
  });

  it("filters by exact action, plus contains on actor/entity and timestamp bounds", async () => {
    const { svc, prisma } = build();
    await svc.list("f1", {
      actor: "jane",
      action: "service.create",
      entity: "serv",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    const arg = (prisma.auditLog.findMany as jest.Mock).mock.calls[0][0];
    const and = arg.where.AND as Array<Record<string, unknown>>;
    expect(and).toContainEqual({ action: "service.create" });
    expect(and).toContainEqual({
      user: { is: { fullName: { contains: "jane", mode: "insensitive" } } },
    });
    expect(and).toContainEqual({
      entityType: { contains: "serv", mode: "insensitive" },
    });
    expect(and).toContainEqual({
      timestamp: {
        gte: new Date("2026-07-01"),
        lte: new Date("2026-07-31"),
      },
    });
  });
});

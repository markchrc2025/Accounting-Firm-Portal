import { BirFormsService } from "./bir-forms.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "../common/auth/auth-user";

const actor: AuthUser = { id: "u1", firmId: "f1", userType: "FIRM", email: "a@f.test" };

function build(rows: unknown[] = []) {
  const findMany = jest.fn().mockResolvedValue(rows);
  const prisma = { birForm: { findMany } } as unknown as PrismaService;
  return { svc: new BirFormsService(prisma), findMany };
}

describe("BirFormsService", () => {
  it("exposes the BIR form catalog including 2551Q", () => {
    const catalog = build().svc.catalog();
    expect(catalog.find((f) => f.code === "2551Q")).toBeDefined();
    expect(catalog).toHaveLength(9);
  });

  it("lists a firm's saved forms, scoped to the firm", async () => {
    const { svc, findMany } = build([
      {
        id: "bf1",
        clientId: "c1",
        client: { businessName: "Acme" },
        form: "2551Q",
        status: "draft",
        period: "2026-Q1",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        updatedAt: new Date("2026-07-02T00:00:00Z"),
      },
    ]);
    const out = await svc.list(actor);
    expect(findMany.mock.calls[0]![0].where).toEqual({ firmId: "f1" });
    expect(out[0]).toEqual(
      expect.objectContaining({ form: "2551Q", clientName: "Acme", status: "draft" }),
    );
  });

  it("narrows the list to a client when clientId is given", async () => {
    const { svc, findMany } = build([]);
    await svc.list(actor, "c9");
    expect(findMany.mock.calls[0]![0].where).toEqual({ firmId: "f1", clientId: "c9" });
  });
});

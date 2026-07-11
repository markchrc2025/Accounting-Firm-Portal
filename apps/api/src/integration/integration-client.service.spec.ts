import { NotFoundException } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import type { PasswordService } from "../auth/password.service";
import type { TokenService } from "../auth/token.service";
import type { PrismaService } from "../prisma/prisma.service";
import { IntegrationClientService } from "./integration-client.service";

const existing = {
  id: "ic1",
  firmId: "f1",
  name: "BIR Form Generator",
  clientKey: "mcrc_deadbeefdeadbeefdeadbeef",
  clientSecretHash: "hash$OLD-SECRET",
  grantedScopesJson: ["clients:read", "bir-filings:write"],
  status: "ACTIVE",
  lastUsedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

/**
 * Builds the service with mocked deps. `passwords.hash` echoes `"hash$" + plain`
 * so tests can assert the STORED value is a hash of (and therefore differs from)
 * the returned plaintext secret. Prisma create/update echo back the passed data.
 */
function build(overrides: Record<string, unknown> = {}) {
  const prisma = {
    integrationClient: {
      findMany: jest.fn().mockResolvedValue([existing]),
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest
        .fn()
        .mockImplementation(async ({ data }) => ({
          ...existing,
          ...data,
          id: "ic-new",
        })),
      update: jest
        .fn()
        .mockImplementation(async ({ where, data }) => ({
          ...existing,
          id: where.id,
          ...data,
        })),
      ...overrides,
    },
  } as unknown as PrismaService;
  const passwords = {
    hash: jest.fn(async (plain: string) => `hash$${plain}`),
  } as unknown as PasswordService;
  const tokens = {} as unknown as TokenService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return {
    svc: new IntegrationClientService(prisma, passwords, tokens, audit),
    prisma,
    audit,
  };
}

describe("IntegrationClientService (management)", () => {
  it("lists the firm's clients without ever exposing the secret hash", async () => {
    const { svc, prisma } = build();
    const res = await svc.listForFirm("f1");
    expect(prisma.integrationClient.findMany).toHaveBeenCalledWith({
      where: { firmId: "f1" },
      orderBy: { createdAt: "asc" },
    });
    expect(res[0]).toEqual({
      id: "ic1",
      name: "BIR Form Generator",
      clientKey: "mcrc_deadbeefdeadbeefdeadbeef",
      scopes: ["clients:read", "bir-filings:write"],
      status: "ACTIVE",
      lastUsedAt: null,
    });
    expect(res[0]).not.toHaveProperty("clientSecret");
    expect(res[0]).not.toHaveProperty("clientSecretHash");
  });

  it("create returns a plaintext secret and stores a DIFFERENT (hashed) value", async () => {
    const { svc, prisma, audit } = build();
    const res = await svc.createForFirm("f1", {
      name: "BIR Form Generator",
      // "bogus" is not a real scope and must be dropped.
      scopes: ["clients:read", "bogus", "bir-filings:write"],
    });

    expect(typeof res.clientSecret).toBe("string");
    expect(res.clientSecret.length).toBeGreaterThan(0);
    expect(res.clientKey).toMatch(/^mcrc_[0-9a-f]{24}$/);

    const created = (prisma.integrationClient.create as jest.Mock).mock.calls[0][0]
      .data;
    // Stored value is the hash, not the plaintext.
    expect(created.clientSecretHash).toBe(`hash$${res.clientSecret}`);
    expect(created.clientSecretHash).not.toBe(res.clientSecret);
    // Invalid scopes filtered against OAUTH_SCOPES.
    expect(created.grantedScopesJson).toEqual([
      "clients:read",
      "bir-filings:write",
    ]);
    expect(created.status).toBe("ACTIVE");
    // Reveal-once DTO carries no hash.
    expect(res).not.toHaveProperty("clientSecretHash");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration-client.create",
        entityType: "IntegrationClient",
      }),
    );
  });

  it("rotate mints a new secret and stores a hash different from the old one", async () => {
    const { svc, prisma, audit } = build();
    const res = await svc.rotateForFirm("f1", "ic1");

    expect(prisma.integrationClient.findFirst).toHaveBeenCalledWith({
      where: { id: "ic1", firmId: "f1" },
    });
    const updated = (prisma.integrationClient.update as jest.Mock).mock.calls[0][0]
      .data;
    expect(updated.clientSecretHash).toBe(`hash$${res.clientSecret}`);
    expect(updated.clientSecretHash).not.toBe(existing.clientSecretHash);
    expect(res.clientSecret.length).toBeGreaterThan(0);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "integration-client.rotate" }),
    );
  });

  it("revoke sets status DISABLED and returns no secret", async () => {
    const { svc, prisma, audit } = build();
    const res = await svc.revokeForFirm("f1", "ic1");
    expect(prisma.integrationClient.update).toHaveBeenCalledWith({
      where: { id: "ic1" },
      data: { status: "DISABLED" },
    });
    expect(res.status).toBe("DISABLED");
    expect(res).not.toHaveProperty("clientSecret");
    expect(res).not.toHaveProperty("clientSecretHash");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "integration-client.revoke" }),
    );
  });

  it("404s when rotating a client outside the firm", async () => {
    const { svc, prisma } = build({
      findFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.rotateForFirm("f1", "other")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.integrationClient.update).not.toHaveBeenCalled();
  });

  it("404s when revoking a client outside the firm", async () => {
    const { svc, prisma } = build({
      findFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(svc.revokeForFirm("f1", "other")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.integrationClient.update).not.toHaveBeenCalled();
  });
});

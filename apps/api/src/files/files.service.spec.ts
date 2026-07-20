import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { FilesService } from "./files.service";
import type { AuthUser } from "../common/auth/auth-user";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";

const FIRM = "firm-1";
const user = { id: "u1", firmId: FIRM } as AuthUser;

const CLIENTS = [
  { id: "c-bbb", businessName: "BETA TRADING", tin: "222", status: "ACTIVE" },
  { id: "c-aaa", businessName: "ALPHA SHOP", tin: "111", status: "ARCHIVED" },
];

function makeService(opts?: { enabled?: boolean; objects?: unknown[] }) {
  const storage = {
    isEnabled: jest.fn(() => opts?.enabled ?? true),
    listObjects: jest.fn(async () =>
      opts?.objects ?? [
        { key: `${FIRM}/c-bbb`, size: 2048, lastModified: "2026-07-01T00:00:00.000Z" },
        { key: `${FIRM}/c-aaa`, size: 1024, lastModified: "2026-06-01T00:00:00.000Z" },
        { key: `${FIRM}/c-gone`, size: 512, lastModified: "2026-05-01T00:00:00.000Z" },
      ],
    ),
    signedGetUrl: jest.fn(async (key: string) => `https://signed.example/${key}`),
  };
  const prisma = { client: { findMany: jest.fn(async () => CLIENTS) } };
  const service = new FilesService(
    prisma as unknown as PrismaService,
    storage as unknown as StorageService,
  );
  return { service, storage, prisma };
}

describe("FilesService — firm file browser", () => {
  it("lists the firm prefix only and maps keys to client names, A→Z", async () => {
    const { service, storage } = makeService();
    const { files } = await service.list(user);
    expect(storage.listObjects).toHaveBeenCalledWith(`${FIRM}/`);
    expect(files.map((f) => f.clientName)).toEqual(["ALPHA SHOP", "BETA TRADING", null]);
    expect(files[0]).toMatchObject({
      key: `${FIRM}/c-aaa`,
      kind: "cor",
      clientId: "c-aaa",
      tin: "111",
      clientStatus: "ARCHIVED",
      size: 1024,
    });
  });

  it("keeps orphaned objects (deleted client) visible, flagged with a null client", async () => {
    const { service } = makeService();
    const { files } = await service.list(user);
    const orphan = files.find((f) => f.key === `${FIRM}/c-gone`);
    expect(orphan).toMatchObject({ clientId: null, clientName: null });
  });

  it("signs only keys under the caller's firm prefix", async () => {
    const { service } = makeService();
    await expect(service.signedUrl(user, `${FIRM}/c-aaa`)).resolves.toEqual({
      url: `https://signed.example/${FIRM}/c-aaa`,
    });
    await expect(service.signedUrl(user, "other-firm/c-aaa")).rejects.toThrow(NotFoundException);
    await expect(service.signedUrl(user, "avatars/u1")).rejects.toThrow(NotFoundException);
  });

  it("returns 503 when storage is not configured", async () => {
    const { service } = makeService({ enabled: false });
    await expect(service.list(user)).rejects.toThrow(ServiceUnavailableException);
    await expect(service.signedUrl(user, `${FIRM}/c-aaa`)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

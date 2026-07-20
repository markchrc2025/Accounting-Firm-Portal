import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

/** One stored object, enriched with the client it belongs to (when known). */
export interface StoredFileDto {
  /** Raw object key in the bucket (`<firmId>/<clientId>` for CORs). */
  key: string;
  kind: "cor";
  size: number;
  lastModified: string | null;
  /** The owning client — null when the object is orphaned (client deleted). */
  clientId: string | null;
  clientName: string | null;
  tin: string | null;
  clientStatus: string | null;
}

/**
 * Firm-level file browser over the object-storage bucket. Lists the firm's
 * stored documents (today: one COR per client, keyed `<firmId>/<clientId>`)
 * and signs short-lived view URLs. STRICTLY firm-scoped: only keys under the
 * caller's own `<firmId>/` prefix are listed or signed — a key outside it is a
 * 404, so one firm can never browse or sign another firm's objects.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private requireStorage(): void {
    if (!this.storage.isEnabled()) {
      throw new ServiceUnavailableException("File storage not configured");
    }
  }

  async list(user: AuthUser): Promise<{ files: StoredFileDto[] }> {
    this.requireStorage();
    const prefix = `${user.firmId}/`;
    const [objects, clients] = await Promise.all([
      this.storage.listObjects(prefix),
      this.prisma.client.findMany({
        where: { firmId: user.firmId },
        select: { id: true, businessName: true, tin: true, status: true },
      }),
    ]);
    const byId = new Map(clients.map((c) => [c.id, c]));
    const files = objects.map((obj): StoredFileDto => {
      const clientId = obj.key.slice(prefix.length).split("/")[0] ?? "";
      const client = byId.get(clientId);
      return {
        key: obj.key,
        kind: "cor",
        size: obj.size,
        lastModified: obj.lastModified,
        clientId: client?.id ?? null,
        clientName: client?.businessName ?? null,
        tin: client?.tin ?? null,
        clientStatus: client?.status ?? null,
      };
    });
    // Named clients A→Z first, orphaned objects last (newest first there).
    files.sort((a, b) => {
      if (a.clientName && b.clientName) return a.clientName.localeCompare(b.clientName);
      if (a.clientName !== b.clientName) return a.clientName ? -1 : 1;
      return (b.lastModified ?? "").localeCompare(a.lastModified ?? "");
    });
    return { files };
  }

  async signedUrl(user: AuthUser, key: string): Promise<{ url: string }> {
    this.requireStorage();
    // Firm scoping is the security boundary — never sign outside the prefix.
    if (!key.startsWith(`${user.firmId}/`)) {
      throw new NotFoundException("File not found");
    }
    return { url: await this.storage.signedGetUrl(key) };
  }
}

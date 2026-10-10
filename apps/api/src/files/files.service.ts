import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { missingPermissionsMessage, RbacService } from "../rbac/rbac.service";
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
 * 404, so one firm can never browse or sign another firm's objects. Within the
 * firm, a caller lists and signs only the CORs of clients they can see (U4-A1, D42).
 */
/** The route's permission (files.controller.ts), asked of each file's client. */
const FILES_PERMISSION = "Clients:Read";

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly rbac: RbacService,
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
    // U4-A1 (D42): only the CORs of clients the caller can see (Clients:Read for
    // that client); orphaned objects belong to no visible client.
    const visible = await this.rbac.authorizedClients(user, [FILES_PERMISSION]);
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
    const shown =
      visible === "all" ? files : files.filter((f) => f.clientId && visible.has(f.clientId));
    // Named clients A→Z first, orphaned objects last (newest first there).
    shown.sort((a, b) => {
      if (a.clientName && b.clientName) return a.clientName.localeCompare(b.clientName);
      if (a.clientName !== b.clientName) return a.clientName ? -1 : 1;
      return (b.lastModified ?? "").localeCompare(a.lastModified ?? "");
    });
    return { files: shown };
  }

  async signedUrl(user: AuthUser, key: string): Promise<{ url: string }> {
    this.requireStorage();
    // Firm scoping is the security boundary — never sign outside the prefix.
    if (!key.startsWith(`${user.firmId}/`)) {
      throw new NotFoundException("File not found");
    }
    // U4-A1 (D42): the key names its client (`<firmId>/<clientId>`); a caller who
    // cannot see that client is refused in the guard's words.
    const visible = await this.rbac.authorizedClients(user, [FILES_PERMISSION]);
    if (visible !== "all") {
      const clientId = key.slice(`${user.firmId}/`.length).split("/")[0] ?? "";
      if (!visible.has(clientId)) {
        throw new ForbiddenException(missingPermissionsMessage([FILES_PERMISSION], clientId));
      }
    }
    return { url: await this.storage.signedGetUrl(key) };
  }
}

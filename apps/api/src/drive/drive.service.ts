/**
 * drive.service.ts — receipt photos that stay in Google Drive (U14 R1, R2, D51).
 * A client's folder is shared with the Portal's read-only robot; the Portal keeps
 * only the folder's id and name, lists what is in it, and (receipt-scan.preparer)
 * reads the files a person chooses. Nothing from Drive is copied to the bucket.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import type { AuthUser } from "../common/auth/auth-user";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  DRIVE_API,
  DriveError,
  FOLDER_MIME,
  UNREACHABLE,
  type DriveApi,
  type DriveItem,
  type DriveStatus,
} from "./drive-api";
import {
  driveFolderOf,
  driveIdFromLink,
  folderLink,
  type DriveFolderRef,
} from "./drive-links";

// --- every sentence a user reads (contract B) -------------------------------------
export const DRIVE_NOT_SET_UP = "Google Drive isn't set up yet.";
export const NOT_A_FOLDER_LINK = "That isn't a Google Drive folder link.";
export const FILE_NOT_FOLDER = "That link is a file, not a folder.";
export const ROBOT_CANT_SEE = (robotEmail: string) =>
  `The Portal's robot can't see that folder. Share it with ${robotEmail} as Viewer, then try again.`;
export const TOO_LARGE = "Larger than 10 MB.";
/** One folder, one client: a link may never reach another client's receipts. */
export const FOLDER_TAKEN =
  "That folder is already linked to another client. A folder can belong to one client only.";
export const FOLDER_INSIDE_LINKED =
  "That folder is inside a folder already linked to another client. A folder can belong to one client only.";
export const FOLDER_HOLDS_LINKED =
  "That folder holds a folder already linked to another client. A folder can belong to one client only.";
/** How far up a folder's parents are followed when it is linked. */
const ANCESTOR_LEVELS = 20;

/** The largest file a pile takes (the upload's limit). */
export const MAX_DRIVE_FILE_BYTES = 10 * 1024 * 1024;
/** The listing: the linked folder and its subfolders this many levels deep. */
export const LIST_DEPTH = 3;
export const LIST_MAX_FILES = 500;
/** A bound on the folders walked, so a vast tree cannot hold a request open. */
const LIST_MAX_FOLDERS = 300;
const STATUS_TTL_MS = 5 * 60 * 1000;

const WORKSPACE_NAMES: Record<string, string> = {
  document: "Google Docs",
  spreadsheet: "Google Sheets",
  presentation: "Google Slides",
  drawing: "Google Drawings",
  form: "Google Forms",
  jam: "Google Jamboard",
  site: "Google Sites",
  script: "Google Apps Script",
  map: "Google My Maps",
};

/** Why a listed file cannot be sent, from what Drive says of it; null when it may
 *  be (its content is checked by its bytes once it is read). */
export function listingProblem(item: DriveItem): string | null {
  const m = /^application\/vnd\.google-apps\.(.+)$/.exec(item.mimeType);
  if (m) {
    if (m[1] === "shortcut") return "A shortcut, not a photo or PDF.";
    return `A ${WORKSPACE_NAMES[m[1]!] ?? "Google Workspace"} file, not a photo or PDF.`;
  }
  if (item.mimeType.startsWith("video/")) return "A video, not a photo or PDF.";
  if (item.mimeType.startsWith("audio/")) return "An audio file, not a photo or PDF.";
  if (item.size !== null && item.size > MAX_DRIVE_FILE_BYTES) return TOO_LARGE;
  return null;
}

export interface ListedFile extends DriveItem {
  /** The subfolder path inside the linked folder; "" at its top. */
  path: string;
}

@Injectable()
export class DriveService {
  private readonly logger = new Logger("Drive");
  private cached: { at: number; keyHash: string; value: DriveStatus } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(DRIVE_API) private readonly drive: DriveApi,
  ) {}

  /**
   * GET /drive/status: the robot checked once and remembered for 5 minutes (a
   * changed key is checked afresh). Google being unreachable is not remembered.
   */
  async status(): Promise<DriveStatus> {
    const keyHash = createHash("sha256")
      .update(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "")
      .digest("hex");
    const now = Date.now();
    if (
      this.cached &&
      this.cached.keyHash === keyHash &&
      now - this.cached.at < STATUS_TTL_MS
    )
      return this.cached.value;
    const value = await this.drive.status();
    if (value.problem !== UNREACHABLE) this.cached = { at: now, keyHash, value };
    // The sentence only: never the key, which the status does not carry.
    if (value.problem) this.logger.error(`Google Drive is not usable: ${value.problem}`);
    return value;
  }

  /**
   * A call to Drive, its refusals in plain words: a refused key or a disabled API
   * (forgotten from the status memory, so the next status check sees it), Google
   * busy or unreachable — each a 503 with its sentence, never a 500. "Not found"
   * is the caller's to word, so it passes through.
   */
  async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof DriveError) || err.kind === "not-found") throw err;
      if (err.kind !== "unreachable") this.cached = null;
      throw new ServiceUnavailableException(err.message);
    }
  }

  /** The robot, set up and working; otherwise 503 with what is wrong. */
  async requireDrive(): Promise<{ robotEmail: string }> {
    const s = await this.status();
    if (!s.configured || !s.robotEmail)
      throw new ServiceUnavailableException(s.problem ?? DRIVE_NOT_SET_UP);
    return { robotEmail: s.robotEmail };
  }

  /** PUT /clients/:clientId/drive-folder. */
  async linkFolder(
    user: AuthUser,
    clientId: string,
    link: unknown,
  ): Promise<DriveFolderRef> {
    const client = await this.clientOf(user, clientId);
    const { robotEmail } = await this.requireDrive();
    const id = typeof link === "string" ? driveIdFromLink(link) : null;
    if (!id) throw new BadRequestException(NOT_A_FOLDER_LINK);
    const item = await this.call(() => this.drive.getFile(id));
    if (!item) throw new ConflictException(ROBOT_CANT_SEE(robotEmail));
    if (item.mimeType !== FOLDER_MIME) throw new ConflictException(FILE_NOT_FOLDER);
    await this.assertFolderFree(client.id, item);
    try {
      await this.prisma.client.update({
        where: { id: client.id },
        data: { driveFolderId: item.id, driveFolderName: item.name },
      });
    } catch (err) {
      // Linked to another client between the check and this write (unique index).
      if ((err as { code?: unknown })?.code === "P2002")
        throw new ConflictException(FOLDER_TAKEN);
      throw err;
    }
    await this.audit.record({
      userId: user.id,
      action: "client.drive-folder.link",
      entityType: "Client",
      entityId: client.id,
      metadata: { folderId: item.id, folderName: item.name },
    });
    return { id: item.id, name: item.name, link: folderLink(item.id) };
  }

  /**
   * One folder, one client (review of U14): the folder is no other client's, is
   * not inside another client's folder (its parents, followed up), and holds none
   * (its subfolders as deep as a listing reads). Across every firm: the robot is
   * the deployment's one robot, so a folder id never reaches two clients' lists.
   */
  private async assertFolderFree(clientId: string, folder: DriveItem): Promise<void> {
    const linked = new Set(
      (
        await this.prisma.client.findMany({
          where: { driveFolderId: { not: null }, NOT: { id: clientId } },
          select: { driveFolderId: true },
        })
      ).map((c) => c.driveFolderId!),
    );
    if (linked.size === 0) return;
    if (linked.has(folder.id)) throw new ConflictException(FOLDER_TAKEN);
    let frontier = folder.parents ?? [];
    const seen = new Set<string>([folder.id]);
    for (let level = 0; level < ANCESTOR_LEVELS && frontier.length > 0; level++) {
      const next: string[] = [];
      for (const parent of frontier) {
        if (seen.has(parent)) continue;
        seen.add(parent);
        if (linked.has(parent)) throw new ConflictException(FOLDER_INSIDE_LINKED);
        const p = await this.call(() => this.drive.getFile(parent));
        next.push(...(p?.parents ?? []));
      }
      frontier = next;
    }
    const { folderIds } = await this.walk(folder.id);
    if (folderIds.some((id) => linked.has(id)))
      throw new ConflictException(FOLDER_HOLDS_LINKED);
  }

  /** DELETE /clients/:clientId/drive-folder. Nothing in Drive changes. */
  async unlinkFolder(user: AuthUser, clientId: string): Promise<{ driveFolder: null }> {
    const client = await this.clientOf(user, clientId);
    await this.prisma.client.update({
      where: { id: client.id },
      data: { driveFolderId: null, driveFolderName: null },
    });
    await this.audit.record({
      userId: user.id,
      action: "client.drive-folder.unlink",
      entityType: "Client",
      entityId: client.id,
      metadata: { folderId: client.driveFolderId },
    });
    return { driveFolder: null };
  }

  /**
   * The linked folder's files, its subfolders LIST_DEPTH levels deep, newest
   * first, at most LIST_MAX_FILES (truncated beyond). Folders are walked breadth
   * first; a subfolder's path is its names joined by "/".
   */
  async listFolderTree(
    folderId: string,
  ): Promise<{ files: ListedFile[]; truncated: boolean }> {
    const { files, truncated } = await this.walk(folderId);
    files.sort((a, b) =>
      a.modifiedTime < b.modifiedTime ? 1 : a.modifiedTime > b.modifiedTime ? -1 : 0,
    );
    return {
      files: files.slice(0, LIST_MAX_FILES),
      truncated: truncated || files.length > LIST_MAX_FILES,
    };
  }

  /** The folder's tree, breadth first, LIST_DEPTH levels deep: its files (with
   *  their path) and its subfolders' ids. */
  private async walk(
    folderId: string,
  ): Promise<{ files: ListedFile[]; folderIds: string[]; truncated: boolean }> {
    const files: ListedFile[] = [];
    const folderIds: string[] = [];
    const queue: Array<{ id: string; path: string; depth: number }> = [
      { id: folderId, path: "", depth: 0 },
    ];
    const seen = new Set<string>([folderId]);
    let walked = 0;
    let truncated = false;
    while (queue.length > 0) {
      const folder = queue.shift()!;
      if (++walked > LIST_MAX_FOLDERS) {
        truncated = true;
        break;
      }
      for (const item of await this.call(() => this.drive.listFolder(folder.id))) {
        if (item.mimeType === FOLDER_MIME) {
          if (folder.depth < LIST_DEPTH && !seen.has(item.id)) {
            seen.add(item.id);
            folderIds.push(item.id);
            queue.push({
              id: item.id,
              path: folder.path ? `${folder.path}/${item.name}` : item.name,
              depth: folder.depth + 1,
            });
          }
          continue;
        }
        files.push({ ...item, path: folder.path });
      }
    }
    return { files, folderIds, truncated };
  }

  /** The client (in the caller's firm) with its folder. */
  async clientOf(user: AuthUser, clientId: string) {
    const client = await this.prisma.client.findFirst({
      where: { id: clientId, firmId: user.firmId },
      select: { id: true, driveFolderId: true, driveFolderName: true },
    });
    if (!client) throw new NotFoundException("Client not found");
    return client;
  }

  folderOf = driveFolderOf;
}

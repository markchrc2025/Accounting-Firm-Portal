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
    const item = await this.drive.getFile(id);
    if (!item) throw new ConflictException(ROBOT_CANT_SEE(robotEmail));
    if (item.mimeType !== FOLDER_MIME) throw new ConflictException(FILE_NOT_FOLDER);
    await this.prisma.client.update({
      where: { id: client.id },
      data: { driveFolderId: item.id, driveFolderName: item.name },
    });
    await this.audit.record({
      userId: user.id,
      action: "client.drive-folder.link",
      entityType: "Client",
      entityId: client.id,
      metadata: { folderId: item.id, folderName: item.name },
    });
    return { id: item.id, name: item.name, link: folderLink(item.id) };
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
    const files: ListedFile[] = [];
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
      for (const item of await this.drive.listFolder(folder.id)) {
        if (item.mimeType === FOLDER_MIME) {
          if (folder.depth < LIST_DEPTH && !seen.has(item.id)) {
            seen.add(item.id);
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
    files.sort((a, b) =>
      a.modifiedTime < b.modifiedTime ? 1 : a.modifiedTime > b.modifiedTime ? -1 : 0,
    );
    if (files.length > LIST_MAX_FILES) truncated = true;
    return { files: files.slice(0, LIST_MAX_FILES), truncated };
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

/**
 * drive-api.ts — the Portal's only door to Google Drive (U14 R1, D51): the robot's
 * READ-ONLY calls to the Drive REST v3 API. The interface has reads only — status,
 * a file's details, a folder's children, a file's bytes — so nothing here can write,
 * move, rename, share or delete anything in Drive, and the token asks for the
 * drive.readonly scope alone.
 *
 * The real client (GoogleDriveApi) signs its own token request: an RS256 JWT made
 * with node:crypto and exchanged at Google's OAuth token endpoint (the
 * service-account flow), so the Portal adds no Google library. Its HTTP goes
 * through an injectable fetch (DRIVE_FETCH); tests use a fake DriveApi or a fake
 * fetch, and nothing in a test reaches Google.
 */
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { sign } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DriveStatus } from "@portal/shared";
import { KEY_UNREADABLE, readRobotKey, type RobotKey } from "./drive-key";

export const DRIVE_API = "DriveApi";
export const DRIVE_FETCH = "DriveFetch";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const DRIVE_URL = "https://www.googleapis.com/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";

// --- every sentence a user reads (R1) ---------------------------------------------
export const API_DISABLED =
  "Turn on the Google Drive API for the robot's project (Google Cloud → APIs & Services → Library).";
export const KEY_REFUSED =
  "Google refused the robot's key. Make a new key for the robot in Google Cloud and put it in GOOGLE_SERVICE_ACCOUNT_JSON.";
export const UNREACHABLE =
  "Google Drive could not be reached just now. Try again in a few minutes.";
export { KEY_UNREADABLE };

export type { DriveStatus };

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  /** Bytes; null for Google Docs, Sheets and other files Drive keeps no size for. */
  size: number | null;
  modifiedTime: string;
}

export type DownloadResult = "ok" | "gone" | "too-large";

/** The robot's read-only calls. */
export interface DriveApi {
  /** Whether the robot is set up and can reach Drive; never throws. */
  status(): Promise<DriveStatus>;
  /** A file's or folder's details; null when it does not exist or the robot
   *  cannot see it. */
  getFile(id: string): Promise<DriveItem | null>;
  /** A folder's direct children (files and folders), not in the trash. */
  listFolder(id: string): Promise<DriveItem[]>;
  /** A file's bytes, written to `dest`, at most `maxBytes`. */
  download(id: string, dest: string, maxBytes: number): Promise<DownloadResult>;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A Google refusal, in the robot's terms. */
export class DriveError extends Error {
  constructor(
    readonly kind: "api-disabled" | "key-refused" | "not-found" | "unreachable",
    message: string,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** The service-account assertion: an RS256 JWT for the drive.readonly scope. */
export function robotAssertion(key: RobotKey, nowSeconds: number): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.clientEmail,
      scope: DRIVE_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${claims}`),
    key.privateKey,
  );
  return `${header}.${claims}.${b64url(signature)}`;
}

/** Google's refusal of a Drive call, read from its JSON error body. */
async function refusal(res: Response): Promise<DriveError> {
  let body: {
    error?: {
      errors?: Array<{ reason?: string }>;
      status?: string;
      details?: Array<{ reason?: string }>;
    };
  } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // no JSON body
  }
  const reasons = [
    ...(body.error?.errors ?? []).map((e) => e.reason),
    ...(body.error?.details ?? []).map((d) => d.reason),
  ];
  if (reasons.some((r) => r === "accessNotConfigured" || r === "SERVICE_DISABLED"))
    return new DriveError("api-disabled", API_DISABLED);
  if (res.status === 401) return new DriveError("key-refused", KEY_REFUSED);
  if (res.status === 404 || res.status === 403)
    return new DriveError("not-found", "not visible to the robot");
  return new DriveError("unreachable", UNREACHABLE);
}

export class GoogleDriveApi implements DriveApi {
  private token: { value: string; until: number; rawKey: string } | null = null;

  constructor(
    private readonly fetcher: FetchLike,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private key() {
    return readRobotKey(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }

  /** A bearer token for drive.readonly, reused until a minute before it ends. */
  private async accessToken(key: RobotKey): Promise<string> {
    const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
    const nowMs = this.now().getTime();
    if (this.token && this.token.rawKey === raw && this.token.until > nowMs)
      return this.token.value;
    let res: Response;
    try {
      res = await this.fetcher(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: robotAssertion(key, Math.floor(nowMs / 1000)),
        }).toString(),
      });
    } catch {
      throw new DriveError("unreachable", UNREACHABLE);
    }
    if (!res.ok) {
      // 400 invalid_grant / 401 invalid_client: the key is wrong, disabled or deleted.
      if (res.status === 400 || res.status === 401)
        throw new DriveError("key-refused", KEY_REFUSED);
      throw new DriveError("unreachable", UNREACHABLE);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new DriveError("key-refused", KEY_REFUSED);
    this.token = {
      value: body.access_token,
      until: nowMs + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
      rawKey: raw,
    };
    return body.access_token;
  }

  /** A GET to the Drive API (the only method this client ever sends to Drive). */
  private async get(path: string): Promise<Response> {
    const read = this.key();
    if (!read || "problem" in read)
      throw new DriveError("key-refused", read ? read.problem : KEY_UNREADABLE);
    const token = await this.accessToken(read.key);
    let res: Response;
    try {
      res = await this.fetcher(`${DRIVE_URL}${path}`, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw new DriveError("unreachable", UNREACHABLE);
    }
    if (!res.ok) throw await refusal(res);
    return res;
  }

  async status(): Promise<DriveStatus> {
    const read = this.key();
    if (!read) return { configured: false, robotEmail: null, problem: null };
    if ("problem" in read)
      return { configured: false, robotEmail: null, problem: read.problem };
    const robotEmail = read.key.clientEmail;
    try {
      await this.get("/about?fields=user(emailAddress)");
      return { configured: true, robotEmail, problem: null };
    } catch (err) {
      const problem =
        err instanceof DriveError && err.kind !== "not-found" ? err.message : UNREACHABLE;
      return { configured: false, robotEmail, problem };
    }
  }

  private static item(f: Record<string, unknown>): DriveItem {
    return {
      id: String(f.id),
      name: String(f.name ?? ""),
      mimeType: String(f.mimeType ?? ""),
      size: f.size === undefined || f.size === null ? null : Number(f.size),
      modifiedTime: String(f.modifiedTime ?? ""),
    };
  }

  async getFile(id: string): Promise<DriveItem | null> {
    try {
      const res = await this.get(
        `/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,trashed&supportsAllDrives=true`,
      );
      const f = (await res.json()) as Record<string, unknown>;
      return f.trashed ? null : GoogleDriveApi.item(f);
    } catch (err) {
      if (err instanceof DriveError && err.kind === "not-found") return null;
      throw err;
    }
  }

  async listFolder(id: string): Promise<DriveItem[]> {
    const out: DriveItem[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(
        `'${id.replace(/'/g, "\\'")}' in parents and trashed = false`,
      );
      const res = await this.get(
        `/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime)` +
          `&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true` +
          (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""),
      );
      const page = (await res.json()) as {
        files?: Array<Record<string, unknown>>;
        nextPageToken?: string;
      };
      for (const f of page.files ?? []) out.push(GoogleDriveApi.item(f));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  async download(id: string, dest: string, maxBytes: number): Promise<DownloadResult> {
    let res: Response;
    try {
      res = await this.get(
        `/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
      );
    } catch (err) {
      if (err instanceof DriveError && err.kind === "not-found") return "gone";
      throw err;
    }
    if (!res.body) return "gone";
    let seen = 0;
    let tooLarge = false;
    const source = Readable.fromWeb(res.body as never);
    source.on("data", (chunk: Buffer) => {
      seen += chunk.length;
      if (seen > maxBytes && !tooLarge) {
        tooLarge = true;
        source.destroy();
      }
    });
    try {
      await pipeline(source, createWriteStream(dest, { mode: 0o600 }));
    } catch (err) {
      if (!tooLarge) throw err;
    }
    if (tooLarge) {
      await rm(dest, { force: true });
      return "too-large";
    }
    return "ok";
  }
}

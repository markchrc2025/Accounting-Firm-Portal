// drive.ts — receipt photos from Google Drive (W15, Track A U14 contract B):
// local types that mirror the contract, the calls, and the pure helpers the
// "From Google Drive" tab words things with. The Portal reads the client's
// folder through a read-only robot account and keeps only links.

import { apiFetch } from "./api";

/** GET /drive/status */
export interface DriveStatus {
  configured: boolean;
  /** The robot account's address, to share each folder with as Viewer. */
  robotEmail: string | null;
  /** Why a configured robot does not work; null when it does, or when absent. */
  problem: string | null;
}

export interface DriveFolder {
  id: string;
  name: string;
  link: string;
}

export interface DriveFile {
  driveFileId: string;
  name: string;
  /** The subfolder path inside the linked folder; "" at its top. */
  path: string;
  mimeType: string;
  bytes: number;
  modifiedTime: string;
  /** An earlier pile of this client already sent it, or matched it as a copy. */
  alreadyRead: boolean;
  /** Why it cannot be sent; null when it can. */
  problem: string | null;
}

/** GET /receipt-scans/drive?clientId */
export interface DriveListing {
  folder: DriveFolder | null;
  files: DriveFile[];
  /** More than 500 files: only the newest 500 are listed. */
  truncated: boolean;
}

/** 202 from either way of sending a pile: it is prepared in the background. */
export interface PileAccepted {
  id: string;
  status: "preparing";
  files: number;
}

export function fetchDriveStatus(): Promise<DriveStatus> {
  return apiFetch<DriveStatus>("/drive/status");
}

export function linkDriveFolder(clientId: string, link: string): Promise<DriveFolder> {
  return apiFetch<DriveFolder>(`/clients/${encodeURIComponent(clientId)}/drive-folder`, {
    method: "PUT",
    body: JSON.stringify({ link }),
  });
}

export function unlinkDriveFolder(clientId: string): Promise<{ driveFolder: null }> {
  return apiFetch(`/clients/${encodeURIComponent(clientId)}/drive-folder`, {
    method: "DELETE",
  });
}

export function fetchDriveFiles(clientId: string): Promise<DriveListing> {
  return apiFetch<DriveListing>(
    `/receipt-scans/drive?clientId=${encodeURIComponent(clientId)}`,
  );
}

export function sendDrivePile(input: {
  clientId: string;
  periodFrom: string;
  periodTo: string;
  driveFileIds: string[];
}): Promise<PileAccepted> {
  const q = new URLSearchParams({
    clientId: input.clientId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
  });
  return apiFetch<PileAccepted>(`/receipt-scans/drive?${q}`, {
    method: "POST",
    body: JSON.stringify({ driveFileIds: input.driveFileIds }),
  });
}

/** The most files one pile may hold (the upload's limit too). */
export const MAX_DRIVE_FILES = 100;

/** The files ticked when the tab opens: new ones that can be sent. */
export function driveDefaultTicks(files: readonly DriveFile[]): Set<string> {
  return new Set(
    files.filter((f) => !f.alreadyRead && f.problem === null).map((f) => f.driveFileId),
  );
}

/** "<n> new files in …": every file not already read. */
export function newFileCount(files: readonly DriveFile[]): number {
  return files.filter((f) => !f.alreadyRead).length;
}

/** The estimate's counts for the ticked files; PDFs by mimeType. */
export function driveCounts(
  files: readonly DriveFile[],
  ticked: ReadonlySet<string>,
): { images: number; pdfs: number } {
  const chosen = files.filter((f) => ticked.has(f.driveFileId));
  const pdfs = chosen.filter((f) => f.mimeType === "application/pdf").length;
  return { images: chosen.length - pdfs, pdfs };
}

/** The send button: the ticked count, or why it is off above 100. */
export function driveSendLabel(ticked: number): string {
  if (ticked > MAX_DRIVE_FILES) return "Up to 100 files per pile.";
  return `Send ${ticked} ${ticked === 1 ? "file" : "files"}`;
}

/** A file size as a person reads it: KB under a megabyte, MB above. */
export function fileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

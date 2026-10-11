/**
 * drive-links.ts — Google Drive links, read and written (U14 R2). Pure functions.
 */
import type { DriveFolder } from "@portal/shared";

/** A Drive id: letters, digits, "-" and "_" (folders and files alike). */
const ID = /^[A-Za-z0-9_-]{10,200}$/;

export type DriveFolderRef = DriveFolder;

export const folderLink = (id: string) => `https://drive.google.com/drive/folders/${id}`;
export const fileLink = (id: string) => `https://drive.google.com/file/d/${id}/view`;

/**
 * The id in a link a person pastes: drive.google.com/drive/folders/<id> (with or
 * without /u/N/ and ?usp=…), drive.google.com/open?id=<id>, a file's link
 * (drive.google.com/file/d/<id>, docs.google.com/…/d/<id>), or a bare id. Null when
 * it is none of these.
 */
export function driveIdFromLink(link: string): string | null {
  const text = link.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "drive.google.com" && host !== "docs.google.com") return null;
  const m =
    /\/drive\/(?:u\/\d+\/)?folders\/([^/?#]+)/.exec(url.pathname) ??
    /\/d\/([^/?#]+)/.exec(url.pathname);
  const id = m ? m[1]! : url.searchParams.get("id");
  return id && ID.test(id) ? id : null;
}

/** The client's linked folder, as GET /clients/:clientId shows it. */
export function driveFolderOf(c: {
  driveFolderId: string | null;
  driveFolderName: string | null;
}): DriveFolderRef | null {
  if (!c.driveFolderId) return null;
  return {
    id: c.driveFolderId,
    name: c.driveFolderName ?? "",
    link: folderLink(c.driveFolderId),
  };
}

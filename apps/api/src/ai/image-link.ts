/**
 * image-link.ts — a short-lived signed link to a scanned file's image (U14 contract
 * C). A Drive file is never stored, so its imageUrl points at the API, which reads
 * it from Drive and serves it: the link alone opens it (an <img> sends no auth
 * header), for an hour, and only for the file it names. The key is derived from
 * JWT_SECRET (read as TokenService reads it); a tampered or expired link is refused.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const IMAGE_LINK_SECONDS = 3600;

/** The secret as TokenService reads it (with its development fallback). */
export const imageLinkSecret = (config: { get<T>(k: string, d: T): T }) =>
  config.get<string>("JWT_SECRET", "dev-insecure-secret-change-me");

function signature(secret: string, fileId: string, expires: number): string {
  const key = createHmac("sha256", secret).update("receipt-image-link:v1").digest();
  return createHmac("sha256", key).update(`${fileId}.${expires}`).digest("base64url");
}

/** The absolute link (API_PUBLIC_URL in front when it is set), valid an hour. */
export function imageLink(
  secret: string,
  publicUrl: string,
  fileId: string,
  now: Date,
): string {
  const expires = Math.floor(now.getTime() / 1000) + IMAGE_LINK_SECONDS;
  return (
    `${publicUrl.replace(/\/+$/, "")}/api/v1/receipt-scans/files/${fileId}/content` +
    `?expires=${expires}&signature=${signature(secret, fileId, expires)}`
  );
}

/** True when the link is the one this API signed for the file, and unexpired. */
export function verifyImageLink(
  secret: string,
  fileId: string,
  expires: unknown,
  sig: unknown,
  now: Date,
): boolean {
  const exp = Number(expires);
  if (!Number.isInteger(exp) || typeof sig !== "string") return false;
  if (exp < Math.floor(now.getTime() / 1000)) return false;
  const want = Buffer.from(signature(secret, fileId, exp));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

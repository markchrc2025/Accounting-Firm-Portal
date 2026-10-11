/**
 * track-a-downloads.spec.ts — U14 R5 (hermetic): a signed link made with a filename
 * downloads under that name. The real StorageService and AWS presigner run here;
 * presigning is local arithmetic, so nothing reaches a bucket.
 */
import type { ConfigService } from "@nestjs/config";
import { StorageService, attachment } from "./storage.service";

const config = {
  get: (key: string, fallback?: string) =>
    ({
      S3_ENDPOINT: "https://s3.invented.test",
      S3_BUCKET: "invented-bucket",
      S3_ACCESS_KEY_ID: "INVENTEDKEYID",
      S3_SECRET_ACCESS_KEY: "invented-secret-not-real",
    })[key] ?? fallback,
} as unknown as ConfigService;

describe("U14 T5 · signed links that download", () => {
  const storage = new StorageService(config);
  const disposition = (url: string) =>
    new URL(url).searchParams.get("response-content-disposition");

  it("a link made with a filename carries Content-Disposition attachment with it, inside the signature", async () => {
    const name = "0005558880002551Qv2018122026Q3.pdf";
    const url = await storage.signedGetUrl(`bir-forms/f/b/${name}`, { filename: name });
    expect(disposition(url)).toBe(
      `attachment; filename="${name}"; filename*=UTF-8''${name}`,
    );
    // The disposition is one of the signed parameters, so it cannot be altered.
    expect(new URL(url).searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a link made without one is unchanged (no disposition)", async () => {
    expect(disposition(await storage.signedGetUrl("cor/f/c"))).toBeNull();
  });

  it("a name outside ASCII keeps an ASCII fallback and its exact form in filename*", () => {
    expect(attachment('Resibo "Peña".pdf')).toBe(
      `attachment; filename="Resibo _Pe_a_.pdf"; filename*=UTF-8''Resibo%20%22Pe%C3%B1a%22.pdf`,
    );
    // RFC 5987: ' ( ) * are encoded in filename* as well.
    expect(attachment("O'Brien (copy)*.pdf")).toBe(
      `attachment; filename="O'Brien (copy)*.pdf"; filename*=UTF-8''O%27Brien%20%28copy%29%2A.pdf`,
    );
  });
});
